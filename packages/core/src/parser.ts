/**
 * PolyScript recursive descent parser.
 * Follows the Python Lark grammar structure with Greedy argument parsing.
 */

import type {
  Expression, PipeOp, Statement, NamedArg, Program,
  Assignment, FuncDef, Import, Pipeline, ParamAnnotation,
  SourceLocation,
} from './ast.js';
import { SOURCE_COMMANDS, KEYWORDS, SELECTOR_ALIASES } from './ast.js';
import { TokenType, type Token, Lexer } from './lexer.js';
import { preprocess } from './preprocessor.js';
import { stripProfileBlock } from './profile.js';
import { isPlaneName, invalidPlaneMessage } from './ocp-kernel/geometry.js';

export class ParseError extends Error {
  line: number;
  column: number;
  constructor(message: string, line: number, column: number) {
    super(`${message} at line ${line}, column ${column}`);
    this.line = line;
    this.column = column;
  }
}

// Map keyword to AST node type for source commands
const SOURCE_CMD_TYPE: Record<string, string> = {
  box: 'BoxExpr', cylinder: 'CylinderExpr', sphere: 'SphereExpr', cone: 'ConeExpr', torus: 'TorusExpr', wedge: 'WedgeExpr',
  thread: 'ThreadExpr',
  rect: 'RectExpr', circle: 'CircleExpr', ellipse: 'EllipseExpr',
  polyline: 'PolylineExpr', polygon: 'PolygonExpr', text: 'TextExpr', sketch: 'SketchExpr',
  line: 'LinePathExpr', arc: 'ArcPathExpr',
  bezier: 'BezierPathExpr', helix: 'HelixPathExpr', spline: 'SplinePathExpr',
  wire: 'WireLiteralExpr',
  grid: 'GridPipe', polar: 'PolarPipe',
  union: 'Union', diff: 'Diff', inter: 'Inter',
  workplane: 'Workplane',
};

// Map keyword to AST node type for pipe operations
const PIPE_OP_TYPE: Record<string, string> = {
  faces: 'FacesSelect', edges: 'EdgesSelect', verts: 'VertsSelect',
  points: 'PointsSelect', workplane: 'Workplane',
  fillet: 'Fillet', chamfer: 'Chamfer', shell: 'Shell', offset: 'Offset',
  diff: 'Diff', union: 'Union', inter: 'Inter', place: 'Place',
  hole: 'Hole', cut: 'Cut',
  extrude: 'Extrude', sweep: 'Sweep', loft: 'Loft',
  translate: 'Translate', rotate: 'Rotate', scale: 'Scale', move: 'Move', moveto: 'MoveTo',
  mirror: 'Mirror',
  floor: 'Floor',
  color: 'Color',
  grid: 'GridPipe', polar: 'PolarPipe',
};

// Selection ops that support "as $tag"
const SELECTION_OPS = new Set(['faces', 'edges', 'verts']);

// Boolean ops that accept an inline source command as argument
const BOOLEAN_OPS = new Set(['diff', 'union', 'inter', 'place']);

// Ops whose single positional argument is a source command (e.g., profile)
const SOURCE_ARG_OPS = new Set(['sweep']);

// 2D primitives that can appear as pipe ops (Implicit2DPrimitive)
const PIPE_2D_PRIMITIVES: Record<string, string> = {
  rect: 'RectExpr', circle: 'CircleExpr', ellipse: 'EllipseExpr',
  polyline: 'PolylineExpr', polygon: 'PolygonExpr', text: 'TextExpr', sketch: 'SketchExpr',
  wire: 'WireLiteralExpr',
};

// 3D primitives that can appear as pipe ops (Implicit3DPrimitive)
const PIPE_3D_PRIMITIVES: Record<string, string> = {
  box: 'BoxExpr', cylinder: 'CylinderExpr', sphere: 'SphereExpr',
  cone: 'ConeExpr', torus: 'TorusExpr', wedge: 'WedgeExpr', thread: 'ThreadExpr',
};


export class Parser {
  private tokens: Token[];
  private pos = 0;
  private inGreedyContext = false;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // --- Token helpers ---

  private current(): Token {
    return this.tokens[this.pos] ?? { type: TokenType.EOF, value: '', line: 0, column: 0 };
  }

  private peek(offset = 0): Token {
    return this.tokens[this.pos + offset] ?? { type: TokenType.EOF, value: '', line: 0, column: 0 };
  }

  private advance(): Token {
    const token = this.current();
    this.pos++;
    return token;
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.current();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw this.error(`Expected ${value ?? type}, got '${token.value}' (${token.type})`);
    }
    return this.advance();
  }

  private match(type: TokenType, value?: string): boolean {
    const token = this.current();
    return token.type === type && (value === undefined || token.value === value);
  }

  private matchKeyword(value: string): boolean {
    return this.match(TokenType.Keyword, value);
  }

  /** Check if token at pos+1 is adjacent (no whitespace) to token at pos. */
  private isNextAdjacent(): boolean {
    const curr = this.tokens[this.pos];
    const next = this.tokens[this.pos + 1];
    if (!curr || !next) return false;
    return curr.line === next.line
        && next.column === curr.column + curr.value.length;
  }

  /** Check if token at pos is adjacent (no whitespace) to token at pos-1. */
  private isPrevAdjacent(): boolean {
    if (this.pos === 0) return false;
    const prev = this.tokens[this.pos - 1];
    const curr = this.tokens[this.pos];
    if (!prev || !curr) return false;
    return prev.line === curr.line
        && curr.column === prev.column + prev.value.length;
  }

  private skipNewlines(): void {
    while (this.match(TokenType.Newline)) this.advance();
  }

  private error(message: string): ParseError {
    const token = this.current();
    return new ParseError(message, token.line, token.column);
  }

  private isAtEnd(): boolean {
    return this.match(TokenType.EOF);
  }

  private isStatementEnd(): boolean {
    return this.match(TokenType.Newline) || this.match(TokenType.EOF);
  }

  /** Extract SourceLocation from a token. */
  private loc(token: Token): SourceLocation {
    return { line: token.line, column: token.column };
  }

  // --- Entry point ---

  parseProgram(): Program {
    const startToken = this.current();
    const statements: Statement[] = [];
    this.skipNewlines();
    while (!this.isAtEnd()) {
      statements.push(this.parseStatement());
      this.skipNewlines();
    }
    return { type: 'Program', statements, loc: this.loc(startToken) };
  }

  // --- Statements ---

  /**
   * Check if the current position is an assignment statement.
   * Matches: $name = expr  or  name = expr (where name is not a keyword).
   */
  private isAssignment(): boolean {
    // $name = expr (name can be identifier or keyword like $offset, $scale)
    if (this.match(TokenType.Dollar) && (this.peek(1).type === TokenType.Identifier || this.peek(1).type === TokenType.Keyword) && this.peek(2).type === TokenType.Eq) {
      return true;
    }
    // name = expr (non-keyword identifier followed by =)
    if (this.match(TokenType.Identifier) && !KEYWORDS.has(this.current().value) && this.peek(1).type === TokenType.Eq) {
      return true;
    }
    return false;
  }

  private parseStatement(): Statement {
    // @param annotation (must precede an assignment)
    if (this.match(TokenType.AtParam)) {
      const annotation = this.parseParamAnnotation();
      this.skipNewlines();
      // Next statement must be an assignment: $name = expr or name = expr
      if (this.isAssignment()) {
        const assignment = this.parseAssignment();
        assignment.annotation = annotation;
        return assignment;
      }
      throw this.error('@param annotation must be followed by a variable assignment');
    }
    // import "path"
    if (this.matchKeyword('import')) {
      return this.parseImport();
    }
    // def name(params) = body
    if (this.matchKeyword('def')) {
      return this.parseFuncDef();
    }
    // $name = expr  or  name = expr  (assignment)
    if (this.isAssignment()) {
      return this.parseAssignment();
    }
    // Pipeline statement
    const expr = this.parsePipeExpr();
    // Consume trailing newline/EOF
    if (this.match(TokenType.Newline)) this.advance();
    return expr;
  }

  private parseImport(): Import {
    const startToken = this.current();
    this.advance(); // 'import'
    const path = this.expect(TokenType.String).value;
    if (this.match(TokenType.Newline)) this.advance();
    return { type: 'Import', path, loc: this.loc(startToken) };
  }

  private parseFuncDef(): FuncDef {
    const startToken = this.current();
    this.advance(); // 'def'
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.LParen);
    const params: string[] = [];
    if (!this.match(TokenType.RParen)) {
      if (this.match(TokenType.Dollar)) this.advance();
      params.push(this.expect(TokenType.Identifier).value);
      while (this.match(TokenType.Comma)) {
        this.advance();
        if (this.match(TokenType.Dollar)) this.advance();
        params.push(this.expect(TokenType.Identifier).value);
      }
    }
    this.expect(TokenType.RParen);
    this.expect(TokenType.Eq);
    const body = this.parsePipeExpr();
    if (this.match(TokenType.Newline)) this.advance();
    return { type: 'FuncDef', name, params, body, loc: this.loc(startToken) };
  }

  private parseAssignment(): Assignment {
    const startToken = this.current();
    const hasDollar = this.match(TokenType.Dollar);
    if (hasDollar) this.advance(); // consume optional $
    // $-prefixed variables can use keyword names (e.g. $offset, $scale)
    const nameToken = this.current();
    if (hasDollar && nameToken.type === TokenType.Keyword) {
      this.advance();
    } else {
      this.expect(TokenType.Identifier);
    }
    const name = nameToken.value; // consume name
    this.advance(); // '='
    const value = this.parsePipeExpr();
    if (this.match(TokenType.Newline)) this.advance();
    return { type: 'Assignment', name, value, loc: this.loc(startToken) };
  }

  /**
   * Parse @param annotation options.
   * Supports:
   *   - Range shorthand: 1..100 or 1..100..0.5
   *   - Key:value options: min:1 max:100 step:0.5 desc:"text"
   *   - choices:["a","b"]
   */
  private parseParamAnnotation(): ParamAnnotation {
    const startToken = this.current();
    this.advance(); // consume @param

    const options: Record<string, any> = {};

    // Check for range shorthand: number..number[..number]
    // Range shorthand must come first and starts with a number or minus sign
    if (this.isParamNumberStart()) {
      this.parseParamRangeShorthand(options);
    }

    // Parse key:value options until end of line
    while (!this.isStatementEnd()) {
      if (this.match(TokenType.Identifier) && this.peek(1).type === TokenType.Colon) {
        const key = this.advance().value;
        this.advance(); // ':'
        const value = this.parseParamValue();
        options[key] = value;
      } else {
        break;
      }
    }

    if (this.match(TokenType.Newline)) this.advance();
    return { type: 'ParamAnnotation', options, loc: this.loc(startToken) };
  }

  /** Check if current position starts a number (possibly negative) in @param context */
  private isParamNumberStart(): boolean {
    if (this.match(TokenType.Number)) return true;
    if (this.match(TokenType.Minus) && this.peek(1).type === TokenType.Number) return true;
    return false;
  }

  /** Read a number value in @param context, potentially negative */
  private readParamNumber(): number {
    let neg = false;
    if (this.match(TokenType.Minus)) {
      neg = true;
      this.advance();
    }
    const val = parseFloat(this.expect(TokenType.Number).value);
    return neg ? -val : val;
  }

  /** Parse range shorthand: num..num or num..num..num */
  private parseParamRangeShorthand(options: Record<string, any>): void {
    const min = this.readParamNumber();
    this.expect(TokenType.DotDot);
    const max = this.readParamNumber();
    options.min = min;
    options.max = max;

    // Optional step: ..num
    if (this.match(TokenType.DotDot)) {
      this.advance();
      const step = this.readParamNumber();
      options.step = step;
    }
  }

  /** Parse a value in @param annotation (number, string, boolean, or list) */
  private parseParamValue(): any {
    // String
    if (this.match(TokenType.String)) {
      return this.advance().value;
    }
    // Number (possibly negative)
    if (this.isParamNumberStart()) {
      return this.readParamNumber();
    }
    // Boolean
    if (this.matchKeyword('true')) {
      this.advance();
      return true;
    }
    if (this.matchKeyword('false')) {
      this.advance();
      return false;
    }
    // List: [val, val, ...]
    if (this.match(TokenType.LBracket)) {
      return this.parseParamList();
    }
    throw this.error('Expected value in @param annotation');
  }

  /** Parse a list literal in @param annotation: ["a", "b", 1, 2] */
  private parseParamList(): any[] {
    this.advance(); // '['
    const items: any[] = [];
    if (!this.match(TokenType.RBracket)) {
      items.push(this.parseParamValue());
      while (this.match(TokenType.Comma)) {
        this.advance();
        if (this.match(TokenType.RBracket)) break;
        items.push(this.parseParamValue());
      }
    }
    this.expect(TokenType.RBracket);
    return items;
  }

  // --- Pipeline ---

  private parsePipeExpr(): Expression {
    const startToken = this.current();
    // Try source_expr (command-style) first, then fall back to plain expr
    let source: Expression;

    if (this.isSourceCommand()) {
      source = this.parseSourceExpr();
    } else if (this.match(TokenType.LParen) && this.looksLikePipeParen()) {
      // (pipeline) as source. parseExpr reaches parseParenPipeExpr through
      // parseAtomExpr, and also picks up shape operators chained after the
      // group: `(box 10 10 10) - (cylinder 3 20) | fillet 1`.
      source = this.parseExpr();
    } else if (this.match(TokenType.Identifier) && this.peek(1).type === TokenType.LParen) {
      // name(args) — paren-style function call. Use parseExpr so binary
      // operators chained after the call (e.g. `f(a) + g(b)` in a `def`
      // body) are parsed as part of the source expression.
      source = this.parseExpr();
    } else if (this.match(TokenType.Identifier) && this.canStartFuncCallArg()) {
      // func_call: NAME greedy_arg+
      source = this.parseFuncCallGreedy();
    } else {
      // Plain expression — handles parenthesized arithmetic like (2+3)*4
      source = this.parseExpr();
    }

    // Collect pipe operations
    const ops: PipeOp[] = [];
    while (this.match(TokenType.Pipe)) {
      this.advance(); // '|'
      ops.push(this.parsePipeOp());
    }

    if (ops.length === 0) return source;
    return { type: 'Pipeline', source, ops, loc: this.loc(startToken) } as Pipeline;
  }

  private isSourceCommand(): boolean {
    const token = this.current();
    return token.type === TokenType.Keyword && SOURCE_COMMANDS.has(token.value);
  }


  /**
   * Peek inside (...) to decide if it's a pipe source (command/pipeline)
   * or a plain parenthesized expression like (2+3)*4.
   * Returns true if the first token after ( is a source command keyword.
   */
  private looksLikePipeParen(): boolean {
    const first = this.peek(1); // token after (
    // ( command ... ) -> pipe source
    if (first.type === TokenType.Keyword && SOURCE_COMMANDS.has(first.value)) return true;
    // ( identifier args ) -> could be func call used as pipe source
    // But we only do this when followed by | or at, to avoid breaking (2+3)*4
    // Actually: peek ahead to find matching ) and check what follows
    // Simple heuristic: if the identifier is followed by another token that
    // can start a greedy arg (not , or ) or operator), it's a pipe source
    if (first.type === TokenType.Identifier) {
      const second = this.peek(2);
      // func_call style: name <number|string|identifier|paren|$> ...
      if (second.type === TokenType.Number || second.type === TokenType.String ||
          second.type === TokenType.Dollar || second.type === TokenType.Identifier ||
          (second.type === TokenType.Keyword && SOURCE_COMMANDS.has(second.value))) {
        return true;
      }
      // name:value -> named arg (like polar n:4) -> pipe source
      if (second.type === TokenType.Colon) return true;
      // ( name | op ... ) -> a pipeline whose source is a variable, e.g.
      // `if flag then (body | union divider) else body`. Without this the
      // parenthesis is read as an arithmetic group and fails at the `|`.
      if (second.type === TokenType.Pipe) return true;
    }
    // ( $name | op ... ) -- same thing with a $-prefixed variable
    if (first.type === TokenType.Dollar && this.peek(3).type === TokenType.Pipe) return true;
    return false;
  }

  private parseSourceExpr(): Expression {
    const startToken = this.current();
    const keyword = this.advance().value; // consume the keyword

    // Special handling for sketch [...] syntax
    if (keyword === 'sketch') {
      return this.parseSketchExpr(startToken);
    }

    // Special handling for wire [...] syntax (multi-segment wire)
    if (keyword === 'wire') {
      return this.parseWireLiteral(startToken);
    }

    let nodeType = SOURCE_CMD_TYPE[keyword];
    // Support paren-style: rect(70-2, 50-2) as well as greedy: rect 68 48
    // Paren-style only when '(' is adjacent (no space): rect( vs rect (
    let args: Expression[];
    let namedArgs: NamedArg[];
    const parenToken = this.current();
    if (this.match(TokenType.LParen)
        && parenToken.column === startToken.column + keyword.length) {
      this.advance(); // consume '('
      ({ args, namedArgs } = this.parseCallArgs());
      this.expect(TokenType.RParen);
    } else {
      // workplane: accept bare-word plane name (e.g. workplane XZ)
      if (keyword === 'workplane') {
        ({ args, namedArgs } = this.parseWorkplaneArgs());
      } else {
        ({ args, namedArgs } = this.parseGreedyArgs());
      }
    }

    // arc dispatch: 3 positional args + no named -> ArcPathExpr (3-point arc)
    //               2 positional args + center: or radius: -> CenterArcPathExpr
    if (keyword === 'arc') {
      nodeType = this.resolveArcNodeType(args, namedArgs, startToken);
    }

    return { type: nodeType, args, namedArgs, loc: this.loc(startToken) } as Expression;
  }

  /**
   * Parse workplane arguments, accepting bare-word plane names (XY, XZ, YZ)
   * and their negations (-XY: same plane, normal flipped) as well as normal
   * greedy args (strings, etc.). `-` must touch the name: `workplane - XY`
   * is not a plane. Invalid bare-word identifiers (e.g. workplane ABC, or
   * the reversed spelling ZX) produce a parse error.
   */
  private parseWorkplaneArgs(): { args: Expression[]; namedArgs: NamedArg[] } {
    const token = this.current();
    let nameToken = token;
    let name = token.value;
    if (token.type === TokenType.Minus && this.peek(1).type === TokenType.Identifier
        && this.peek(1).line === token.line && this.peek(1).column === token.column + 1) {
      nameToken = this.peek(1);
      name = `-${nameToken.value}`;
    }
    if (nameToken.type === TokenType.Identifier && this.peek(nameToken === token ? 1 : 2).type !== TokenType.Colon) {
      // Bare-word identifier -- validate it as a plane name
      if (!isPlaneName(name)) throw this.error(invalidPlaneMessage(name));
      if (nameToken !== token) this.advance(); // consume '-'
      this.advance();
      const planeLit: Expression = { type: 'StringLit', value: name, loc: this.loc(token) };
      // Parse remaining named args (e.g. origin:...)
      const { args: restArgs, namedArgs } = this.parseGreedyArgs();
      return { args: [planeLit, ...restArgs], namedArgs };
    }
    // Fall through to normal greedy parsing (handles string literals, no args, etc.)
    return this.parseGreedyArgs();
  }

  /**
   * Resolve arc keyword to ArcPathExpr or CenterArcPathExpr based on arg pattern:
   * - 3 positional args, no named args -> ArcPathExpr (3-point arc)
   * - 2 positional args + center: named arg -> CenterArcPathExpr
   * - 2 positional args + radius: named arg -> CenterArcPathExpr
   * - otherwise -> parse error
   */
  private resolveArcNodeType(args: Expression[], namedArgs: NamedArg[], _startToken: Token): string {
    const hasCenter = namedArgs.some(na => na.key === 'center');
    const hasR = namedArgs.some(na => na.key === 'radius');

    if (args.length === 3 && namedArgs.length === 0) {
      return 'ArcPathExpr';
    }
    if (args.length === 2 && (hasCenter || hasR)) {
      return 'CenterArcPathExpr';
    }

    throw this.error(
      `Invalid arc arguments: expected 3 positional args (3-point arc), ` +
      `or 2 positional args with center: or radius: named arg`
    );
  }

  /**
   * Parse sketch expression:
   *   sketch [ start_point, segment, segment, ... ]
   * Segments can be:
   *   - tuple (line to endpoint)
   *   - arc through_point end_point (arc segment)
   *   - bezier [control_points] (bezier segment)
   */
  private parseSketchExpr(startToken: Token): Expression {
    this.expect(TokenType.LBracket);
    this.skipNewlines();

    // Parse start point (must be a tuple)
    const start = this.parseExpr();
    this.skipNewlines();

    // Parse segments separated by comma/newline
    const segments: Expression[] = [];
    while (this.match(TokenType.Comma) || this.match(TokenType.Newline)) {
      if (this.match(TokenType.Comma)) this.advance();
      this.skipNewlines();
      if (this.match(TokenType.RBracket)) break;

      // Check for arc/bezier keywords
      if (this.matchKeyword('arc')) {
        const segToken = this.current();
        this.advance(); // consume 'arc'
        const { args, namedArgs } = this.parseGreedyArgs();
        const arcType = this.resolveArcNodeType(args, namedArgs, segToken);
        segments.push({ type: arcType, args, namedArgs, loc: this.loc(segToken) } as Expression);
      } else if (this.matchKeyword('bezier')) {
        const segToken = this.current();
        this.advance(); // consume 'bezier'
        const { args, namedArgs } = this.parseGreedyArgs();
        segments.push({ type: 'BezierPathExpr', args, namedArgs, loc: this.loc(segToken) } as Expression);
      } else if (this.matchKeyword('spline')) {
        const segToken = this.current();
        this.advance(); // consume 'spline'
        const { args, namedArgs } = this.parseGreedyArgs();
        segments.push({ type: 'SplinePathExpr', args, namedArgs, loc: this.loc(segToken) } as Expression);
      } else {
        // Plain tuple -> line segment
        segments.push(this.parseExpr());
      }
      this.skipNewlines();
    }

    this.expect(TokenType.RBracket);

    // Parse optional named args after ]  (e.g. sketch [...] at:5 5)
    const namedArgs: NamedArg[] = [];
    while (this.atNamedArgKey()) {
      const naToken = this.current();
      const key = this.advance().value;
      this.advance(); // ':'
      const vals: Expression[] = [];
      while (this.canStartGreedyArg()) {
        if (this.atNamedArgKey()) break;
        vals.push(this.parseGreedyVal());
      }
      if (vals.length === 0) {
        throw this.error(`Expected value after '${key}:'`);
      }
      const value = vals.length === 1 ? vals[0]
        : { type: 'TupleLit', elements: vals, loc: this.loc(naToken) } as Expression;
      namedArgs.push({ key, value, loc: this.loc(naToken) });
    }

    return { type: 'SketchExpr', start, segments, namedArgs, loc: this.loc(startToken) } as Expression;
  }

  /**
   * Parse path literal expression:
   *   path [ segment, segment, ... ]
   * Like sketch but open (no auto-close). Supports:
   *   - tuple (line to endpoint, or start point if first)
   *   - line start end
   *   - arc start through end
   *   - arc start end center:(cx,cy)  OR  arc start end radius:radius
   *   - bezier [control_points]
   *   - spline [points]
   */
  private parseWireLiteral(startToken: Token): Expression {
    this.expect(TokenType.LBracket);
    this.skipNewlines();

    // Determine if the first element is a bare tuple (start point) or a segment keyword.
    // If the first element is a tuple (not preceded by a keyword), it becomes the start point
    // and will be treated as a moveTo (no edge created until the next element).
    let start: Expression | undefined;
    const segments: Expression[] = [];

    // Parse first element
    if (this.match(TokenType.RBracket)) {
      // Empty wire — allowed but probably useless
      this.advance();
      return { type: 'WireLiteralExpr', segments: [], loc: this.loc(startToken) } as Expression;
    }

    const isFirstKeyword = this.matchKeyword('arc') ||
                           this.matchKeyword('bezier') || this.matchKeyword('spline') ||
                           this.matchKeyword('line');

    if (!isFirstKeyword) {
      // First element is a tuple -> start point
      start = this.parseExpr();
      this.skipNewlines();
    }

    // Parse remaining segments separated by comma/newline
    while (this.match(TokenType.Comma) || this.match(TokenType.Newline) || (!start && segments.length === 0)) {
      // Consume separator (except for the first keyword-segment which has no preceding comma)
      if (this.match(TokenType.Comma)) this.advance();
      this.skipNewlines();
      if (this.match(TokenType.RBracket)) break;

      // Check for segment keywords
      if (this.matchKeyword('line')) {
        const segToken = this.current();
        this.advance(); // consume 'line'
        const { args, namedArgs } = this.parseGreedyArgs();
        segments.push({ type: 'LinePathExpr', args, namedArgs, loc: this.loc(segToken) } as Expression);
      } else if (this.matchKeyword('arc')) {
        const segToken = this.current();
        this.advance(); // consume 'arc'
        const { args, namedArgs } = this.parseGreedyArgs();
        const arcType = this.resolveArcNodeType(args, namedArgs, segToken);
        segments.push({ type: arcType, args, namedArgs, loc: this.loc(segToken) } as Expression);
      } else if (this.matchKeyword('bezier')) {
        const segToken = this.current();
        this.advance(); // consume 'bezier'
        const { args, namedArgs } = this.parseGreedyArgs();
        segments.push({ type: 'BezierPathExpr', args, namedArgs, loc: this.loc(segToken) } as Expression);
      } else if (this.matchKeyword('spline')) {
        const segToken = this.current();
        this.advance(); // consume 'spline'
        const { args, namedArgs } = this.parseGreedyArgs();
        segments.push({ type: 'SplinePathExpr', args, namedArgs, loc: this.loc(segToken) } as Expression);
      } else {
        // Plain tuple -> line segment (from previous endpoint to this point)
        segments.push(this.parseExpr());
      }
      this.skipNewlines();
    }

    this.expect(TokenType.RBracket);

    return { type: 'WireLiteralExpr', start, segments, loc: this.loc(startToken) } as Expression;
  }

  private parseParenPipeExpr(): Expression {
    const startToken = this.current();
    this.expect(TokenType.LParen);
    const first = this.parsePipeExpr();
    // Check for tuple: (expr, expr, ...)
    if (this.match(TokenType.Comma)) {
      const elements = [first];
      while (this.match(TokenType.Comma)) {
        this.advance();
        if (this.match(TokenType.RParen)) break;
        elements.push(this.parseExpr());
      }
      this.expect(TokenType.RParen);
      return { type: 'TupleLit', elements, loc: this.loc(startToken) };
    }
    this.expect(TokenType.RParen);
    return first; // just parenthesized expression
  }

  private parseFuncCallGreedy(): Expression {
    const startToken = this.current();
    const name = this.advance().value; // identifier
    const { args, namedArgs } = this.parseGreedyArgs();
    return { type: 'FuncCall', name, args, namedArgs, loc: this.loc(startToken) };
  }

  // --- Pipe operations ---

  private parsePipeOp(): PipeOp {
    const startToken = this.current();
    const token = this.current();

    if (token.type !== TokenType.Keyword) {
      throw this.error(`Expected pipe operation, got '${token.value}'`);
    }

    // as $tag (standalone)
    if (token.value === 'as') {
      this.advance();
      this.expect(TokenType.Dollar);
      const name = this.expect(TokenType.Identifier).value;
      return { type: 'AsTag', name, loc: this.loc(startToken) };
    }

    // revolve — dedicated parsing: revolve axis [deg]
    if (token.value === 'revolve') {
      return this.parseRevolveOp(startToken);
    }

    // 2D primitives as pipe ops -> Implicit2DPrimitive
    if (PIPE_2D_PRIMITIVES[token.value]) {
      // sketch needs special parsing
      if (token.value === 'sketch') {
        this.advance(); // consume 'sketch'
        const primitive = this.parseSketchExpr(startToken);
        return { type: 'Implicit2DPrimitive', primitive, loc: this.loc(startToken) };
      }
      // wire needs special parsing (like sketch)
      if (token.value === 'wire') {
        this.advance(); // consume 'wire'
        const primitive = this.parseWireLiteral(startToken);
        return { type: 'Implicit2DPrimitive', primitive, loc: this.loc(startToken) };
      }
      const keyword = this.advance().value;
      const nodeType = PIPE_2D_PRIMITIVES[keyword];
      const { args, namedArgs } = this.parseGreedyArgs();
      const primitive = { type: nodeType, args, namedArgs, loc: this.loc(startToken) } as Expression;
      return { type: 'Implicit2DPrimitive', primitive, loc: this.loc(startToken) };
    }

    // 3D primitives as pipe ops -> Implicit3DPrimitive
    if (PIPE_3D_PRIMITIVES[token.value]) {
      const keyword = this.advance().value;
      const nodeType = PIPE_3D_PRIMITIVES[keyword];
      const { args, namedArgs } = this.parseGreedyArgs();
      const primitive = { type: nodeType, args, namedArgs, loc: this.loc(startToken) } as Expression;
      return { type: 'Implicit3DPrimitive', primitive, loc: this.loc(startToken) };
    }

    // Standard pipe ops
    const keyword = token.value;
    const nodeType = PIPE_OP_TYPE[keyword];
    if (!nodeType) {
      throw this.error(`Unknown pipe operation '${keyword}'`);
    }

    this.advance(); // consume keyword

    // Boolean ops (diff/union/inter) accept an inline source command as argument
    // e.g. "| diff cylinder r h" -> Diff with args=[CylinderExpr(r, h)]
    if (BOOLEAN_OPS.has(keyword) && this.isSourceCommand()) {
      const sourceExpr = this.parseSourceExpr();
      return { type: nodeType, args: [sourceExpr], namedArgs: [], loc: this.loc(startToken) } as PipeOp;
    }

    // A user-defined shape function gets the same greedy delegation as a
    // built-in one: "| union standoff 4 10 1.5" -> Union with
    // args=[FuncCall(standoff, [4, 10, 1.5])]. This mirrors the pipeline
    // source rule above (Identifier + canStartFuncCallArg) and the Python
    // grammar, where the operand is one expression and NAME arg+ is a call.
    // A bare identifier ("| union holes") still falls through to a variable
    // reference below.
    if (BOOLEAN_OPS.has(keyword) && this.match(TokenType.Identifier) && this.canStartFuncCallArg()) {
      const call = this.parseFuncCallGreedy();
      return { type: nodeType, args: [call], namedArgs: [], loc: this.loc(startToken) } as PipeOp;
    }

    // sweep: profile can be given as a source command inline, without parens
    // e.g. "| sweep circle 5" -> Sweep with args=[CircleExpr(5)]
    if (SOURCE_ARG_OPS.has(keyword) && this.isSourceCommand()) {
      const sourceExpr = this.parseSourceExpr();
      return { type: nodeType, args: [sourceExpr], namedArgs: [], loc: this.loc(startToken) } as PipeOp;
    }

    // points + source command shorthand: points polar 6 20 → points (polar 6 20)
    if (keyword === 'points' && this.isSourceCommand()) {
      const sourceExpr = this.parseSourceExpr();
      let tag: string | undefined;
      if (this.matchKeyword('as')) {
        this.advance();
        this.expect(TokenType.Dollar);
        tag = this.expect(TokenType.Identifier).value;
      }
      return { type: nodeType, args: [sourceExpr], namedArgs: [], tag, loc: this.loc(startToken) } as PipeOp;
    }

    // workplane: accept bare-word plane name (e.g. workplane XZ)
    const { args, namedArgs } = keyword === 'workplane'
      ? this.parseWorkplaneArgs()
      : this.parseGreedyArgs();

    // Selection ops can have "as $tag"
    if (SELECTION_OPS.has(keyword)) {
      let tag: string | undefined;
      if (this.matchKeyword('as')) {
        this.advance();
        this.expect(TokenType.Dollar);
        tag = this.expect(TokenType.Identifier).value;
      }
      return { type: nodeType, args, namedArgs, tag, loc: this.loc(startToken) } as PipeOp;
    }

    return { type: nodeType, args, namedArgs, loc: this.loc(startToken) } as PipeOp;
  }

  // --- Revolve parsing ---

  /**
   * Parse revolve pipe operation with dedicated syntax:
   *   revolve axis [deg]
   * where axis is X, Y, or Z (contextual keyword).
   */
  private parseRevolveOp(startToken: Token): PipeOp {
    this.advance(); // consume 'revolve'

    // Check what comes next
    const next = this.current();

    // No argument at all: revolve at end of line / pipe / EOF
    if (this.isStatementEnd() || this.match(TokenType.Pipe)) {
      throw this.error(
        'revolve requires an axis (X, Y, or Z). Example: revolve Y 180'
      );
    }

    // Number first: revolve 360 -- old syntax, helpful error
    if (next.type === TokenType.Number) {
      throw this.error(
        `revolve expects an axis first. Did you mean \`revolve Y ${next.value}\`?`
      );
    }

    // Identifier: check if it's X, Y, or Z
    if (next.type === TokenType.Identifier) {
      const axisName = next.value.toUpperCase();
      if (axisName === 'X' || axisName === 'Y' || axisName === 'Z') {
        this.advance(); // consume axis

        // Check for named-arg pattern: axis followed by ':'
        // e.g. someone writing `revolve X axis:"Y"` — the colon after X is invalid
        // But we also need to handle: `revolve X` at end-of-line

        // Optional degrees argument
        let degrees: Expression | undefined;
        if (this.canStartGreedyArg() && !this.isStatementEnd() && !this.match(TokenType.Pipe)) {
          // Check for named args (deprecated)
          if (this.match(TokenType.Identifier) && this.peek(1).type === TokenType.Colon) {
            throw this.error(
              `revolve no longer accepts named arguments. Use: revolve ${axisName} [degrees]`
            );
          }
          degrees = this.parseGreedyVal();
        }

        const axisLit: Expression = { type: 'StringLit', value: axisName, loc: this.loc(startToken) };
        const revolveArgs: Expression[] = [axisLit];
        if (degrees) revolveArgs.push(degrees);
        return {
          type: 'Revolve',
          args: revolveArgs,
          namedArgs: [],
          loc: this.loc(startToken),
        } as PipeOp;
      }

      // Identifier but not X/Y/Z
      // Check if it looks like a named-arg: axis:"X" (old syntax)
      if (next.value === 'axis' && this.peek(1).type === TokenType.Colon) {
        throw this.error(
          'revolve no longer accepts named arguments like axis:"X". Use: revolve X'
        );
      }

      throw this.error(
        `revolve requires an axis (X, Y, or Z). Got '${next.value}'`
      );
    }

    // Anything else
    throw this.error(
      'revolve requires an axis (X, Y, or Z). Example: revolve Y 180'
    );
  }

  // --- Greedy argument parsing ---

  /**
   * Parse greedy arguments: collect args until |, newline, EOF, or
   * a keyword that can't be a kwarg key (at, as, structural keywords).
   */
  parseGreedyArgs(): { args: Expression[]; namedArgs: NamedArg[] } {
    const args: Expression[] = [];
    const namedArgs: NamedArg[] = [];

    while (this.canStartGreedyArg()) {
      // Check for named arg: identifier followed by ':'
      if (this.atNamedArgKey()) {
        const startToken = this.current();
        const key = this.advance().value;
        this.advance(); // ':'
        // Greedy value collection: gather multiple values, wrap in TupleLit if >1
        const vals: Expression[] = [];
        while (this.canStartGreedyArg()) {
          // Stop before next named arg (identifier:)
          if (this.atNamedArgKey()) break;
          vals.push(this.parseGreedyVal());
        }
        if (vals.length === 0) {
          throw this.error(`Expected value after '${key}:'`);
        }
        const value = vals.length === 1 ? vals[0]
          : { type: 'TupleLit', elements: vals, loc: this.loc(startToken) } as Expression;
        namedArgs.push({ key, value, loc: this.loc(startToken) });
        continue;
      }

      // Parenthesized sub-expression: ( pipe_expr )
      if (this.match(TokenType.LParen)) {
        args.push(this.parseParenPipeExpr());
        continue;
      }

      // Regular positional arg (greedy_val = product-level expression)
      args.push(this.parseGreedyVal());
    }

    return { args, namedArgs };
  }

  /**
   * Check if the token at the given offset from current position
   * can start a greedy argument.
   */
  /**
   * At the key of a named argument: a name followed by ':'. The name may be
   * a keyword as well as an identifier -- in argument position a keyword
   * directly followed by ':' has no other reading, and it lets an option be
   * called what it is (`thread 8 2 30 chamfer:true`) even when the word is
   * also a pipe operation.
   */
  private atNamedArgKey(): boolean {
    return (this.match(TokenType.Identifier) || this.match(TokenType.Keyword))
      && this.peek(1).type === TokenType.Colon;
  }

  private canStartGreedyArg(offset = 0): boolean {
    const token = this.peek(offset);
    switch (token.type) {
      case TokenType.Number:
      case TokenType.String:
      case TokenType.Dollar:
      case TokenType.LParen:
      case TokenType.LBracket:
      case TokenType.Minus:
      case TokenType.Selector:
        return true;
      case TokenType.Identifier:
        // Non-keyword identifiers can start greedy args
        // Also check for kwarg pattern: name:value
        return true;
      case TokenType.Keyword:
        // pi, true, false can appear as greedy vals; any keyword directly
        // followed by ':' is the key of a named arg (`thread ... chamfer:true`)
        if (token.value === 'pi' || token.value === 'true' || token.value === 'false') return true;
        return this.peek(offset + 1).type === TokenType.Colon;
      default:
        return false;
    }
  }

  /**
   * Check if the token after current Identifier can unambiguously start
   * a greedy function call argument. Excludes Minus (could be subtraction)
   * and Selector (not a function arg).
   */
  private canStartFuncCallArg(): boolean {
    const token = this.peek(1);
    switch (token.type) {
      case TokenType.Number:
      case TokenType.String:
      case TokenType.Dollar:
      case TokenType.LParen:
        return true;
      case TokenType.LBracket:
        // val[k] (adjacent) → index access, not func call
        // func [list] (space) → func call with list arg
        return !this.isNextAdjacent();
      case TokenType.Identifier:
        return true;
      case TokenType.Keyword:
        return token.value === 'pi' || token.value === 'true' || token.value === 'false';
      default:
        return false;
    }
  }

  /**
   * Parse a greedy value — expression up to sum level with binary + and
   * whitespace-aware binary -.
   *
   * Binary `-` is only consumed when the `-` token has whitespace on BOTH
   * sides (e.g. `h - 5`).  When `-` has no trailing space it starts a new
   * greedy argument as unary minus (e.g. `box 10 -5 10`).
   */
  private parseGreedyVal(): Expression {
    const prev = this.inGreedyContext;
    this.inGreedyContext = true;
    try {
      return this.parseGreedySum();
    } finally {
      this.inGreedyContext = prev;
    }
  }

  /**
   * Check whether the current `-` token should be treated as a binary
   * subtraction operator rather than unary minus / new-arg separator.
   *
   * Rule: binary when the `-` has whitespace on BOTH sides (`a - b`).
   *   - `10 -5`  → leading space, NO trailing space → unary (new arg)
   *   - `h - 5`  → leading AND trailing space → binary subtraction
   *   - `f -a`   → leading space, NO trailing space → unary (new arg)
   */
  private isSpacedBinaryMinus(): boolean {
    const minusTok = this.tokens[this.pos];
    const nextTok = this.tokens[this.pos + 1];
    if (!minusTok || !nextTok) return false;
    // Leading space: the token was preceded by whitespace
    if (!minusTok.leadingSpace) return false;
    // Trailing space: next token is not adjacent (column gap)
    return nextTok.column > minusTok.column + minusTok.value.length;
  }

  /**
   * Greedy-specific sum: binary + always, binary - only when whitespace
   * surrounds the operator (see isSpacedBinaryMinus).
   */
  private parseGreedySum(): Expression {
    const startToken = this.current();
    let left = this.parseProduct();
    while (
      this.match(TokenType.Plus) ||
      (this.match(TokenType.Minus) && this.isSpacedBinaryMinus())
    ) {
      const op = this.advance().value;
      const right = this.parseProduct();
      left = { type: 'BinOp', op, left, right, loc: this.loc(startToken) };
    }
    return left;
  }

  // --- Expressions (full precedence chain) ---

  private parseExpr(): Expression {
    return this.parseIfExpr();
  }

  private parseIfExpr(): Expression {
    if (this.matchKeyword('if')) {
      const startToken = this.current();
      this.advance();
      const condition = this.parseOrExpr();
      this.expect(TokenType.Keyword, 'then');
      const thenExpr = this.parseIfBranch();
      this.expect(TokenType.Keyword, 'else');
      const elseExpr = this.parseIfBranch();
      return { type: 'IfExpr', condition, thenExpr, elseExpr, loc: this.loc(startToken) };
    }
    return this.parseOrExpr();
  }

  /**
   * One branch of `if … then … else …`:
   *   if_branch = source_cmd greedy_args | NAME greedy_arg+ | if_expr
   * so `if round then circle 10 else rect 20 15` needs no parentheses.
   * A pipe is not part of a branch: greedy args stop at `else`, and a `|`
   * after the whole expression applies to its result, because `|` binds
   * loosest. A pipe inside a branch needs parentheses: `then (c | op)`.
   */
  private parseIfBranch(): Expression {
    if (this.isSourceCommand()) {
      return this.parseSourceExpr();
    }
    if (this.match(TokenType.Identifier) && this.peek(1).type !== TokenType.LParen
        && this.canStartFuncCallArg()) {
      return this.parseFuncCallGreedy();
    }
    return this.parseIfExpr();
  }

  private parseOrExpr(): Expression {
    let left = this.parseAndExpr();
    while (this.matchKeyword('or')) {
      const startToken = this.current();
      this.advance();
      const right = this.parseAndExpr();
      left = { type: 'BinOp', op: 'or', left, right, loc: this.loc(startToken) };
    }
    return left;
  }

  private parseAndExpr(): Expression {
    let left = this.parseComparison();
    while (this.matchKeyword('and')) {
      const startToken = this.current();
      this.advance();
      const right = this.parseComparison();
      left = { type: 'BinOp', op: 'and', left, right, loc: this.loc(startToken) };
    }
    return left;
  }

  private parseComparison(): Expression {
    let left = this.parseSum();
    const compOps: Record<string, string> = {
      [TokenType.EqEq]: '==', [TokenType.NotEq]: '!=',
      [TokenType.Lt]: '<', [TokenType.Gt]: '>',
      [TokenType.LtEq]: '<=', [TokenType.GtEq]: '>=',
    };
    while (compOps[this.current().type]) {
      const startToken = this.current();
      const op = compOps[this.advance().type];
      const right = this.parseSum();
      left = { type: 'BinOp', op, left, right, loc: this.loc(startToken) };
    }
    return left;
  }

  private parseSum(): Expression {
    let left = this.parseProduct();
    while (this.match(TokenType.Plus) || this.match(TokenType.Minus)) {
      const startToken = this.current();
      const op = this.advance().value;
      const right = this.parseProduct();
      left = { type: 'BinOp', op, left, right, loc: this.loc(startToken) };
    }
    return left;
  }

  private parseProduct(): Expression {
    let left = this.parseUnary();
    while (
      this.match(TokenType.Star) || this.match(TokenType.Slash) ||
      this.match(TokenType.DoubleSlash) || this.match(TokenType.Percent)
    ) {
      const startToken = this.current();
      const op = this.advance().value;
      const right = this.parseUnary();
      left = { type: 'BinOp', op, left, right, loc: this.loc(startToken) };
    }
    return left;
  }

  private parseUnary(): Expression {
    if (this.match(TokenType.Minus)) {
      const startToken = this.current();
      this.advance();
      const operand = this.parseUnary();
      return { type: 'UnaryNeg', operand, loc: this.loc(startToken) };
    }
    return this.parsePower();
  }

  private parsePower(): Expression {
    const startToken = this.current();
    let base = this.parseAtomExpr();

    // Postfix index access: expr[index]
    // In greedy context, only adjacent [ is index access (no whitespace: val[k]).
    // Spaced [ starts a new list-literal greedy arg (e.g. "box $x [1,2,3]").
    while (this.match(TokenType.LBracket)
        && (!this.inGreedyContext || this.isPrevAdjacent())) {
      this.advance(); // consume [
      const index = this.parseExpr();
      this.expect(TokenType.RBracket);
      base = { type: 'IndexAccess', object: base, index, loc: this.loc(startToken) } as Expression;
    }

    if (this.match(TokenType.DoubleStar)) {
      this.advance();
      const exp = this.parseUnary();
      return { type: 'BinOp', op: '**', left: base, right: exp, loc: this.loc(startToken) };
    }
    return base;
  }

  private parseAtomExpr(): Expression {
    const token = this.current();

    // Number
    if (token.type === TokenType.Number) {
      this.advance();
      return { type: 'NumberLit', value: parseFloat(token.value), loc: this.loc(token) };
    }

    // String
    if (token.type === TokenType.String) {
      this.advance();
      return { type: 'StringLit', value: token.value, loc: this.loc(token) };
    }

    // Selector literal: >Z, <X, =Y, +Z, etc.
    if (token.type === TokenType.Selector) {
      this.advance();
      return { type: 'SelectorLit', value: token.value, loc: this.loc(token) };
    }

    // Variable reference: $name
    // Accept Keyword tokens after $ so that $offset, $scale etc. work as VarRef
    if (token.type === TokenType.Dollar) {
      this.advance();
      const nameToken = this.current();
      if (nameToken.type === TokenType.Keyword) {
        this.advance();
      } else {
        this.expect(TokenType.Identifier);
      }
      const name = nameToken.value;
      return { type: 'VarRef', name, loc: this.loc(token) };
    }

    // Constants
    if (token.type === TokenType.Keyword) {
      if (token.value === 'pi') {
        this.advance();
        return { type: 'NumberLit', value: Math.PI, loc: this.loc(token) };
      }
      if (token.value === 'true') {
        this.advance();
        return { type: 'BoolConst', value: true, loc: this.loc(token) };
      }
      if (token.value === 'false') {
        this.advance();
        return { type: 'BoolConst', value: false, loc: this.loc(token) };
      }
    }

    // Keyword used as function call in expression context: e.g. floor(3.7)
    // Some built-in math functions (floor, ceil) share names with pipe operations.
    // In expression context with '(' following, parse them as function calls.
    if (token.type === TokenType.Keyword && !this.inGreedyContext && this.peek(1).type === TokenType.LParen) {
      return this.parseFuncCallExpr();
    }

    // Selector name alias: top, bottom, right, left, front, back
    if (token.type === TokenType.Identifier && token.value in SELECTOR_ALIASES) {
      this.advance();
      return { type: 'SelectorLit', value: SELECTOR_ALIASES[token.value], loc: this.loc(token) };
    }

    // Identifier: func_call_expr NAME(args) or variable reference
    // In greedy context, NAME( should NOT be treated as a function call;
    // the ( starts a new parenthesized greedy argument.
    if (token.type === TokenType.Identifier) {
      if (this.peek(1).type === TokenType.LParen && (!this.inGreedyContext || this.isNextAdjacent())) {
        return this.parseFuncCallExpr();
      }
      this.advance();
      return { type: 'VarRef', name: token.value, loc: this.loc(token) };
    }

    // Parenthesized pipeline used as a value, e.g. the branches of
    // `if flag then (body | union divider) else body`. Same test the
    // pipeline-source path uses, so `(a | op)` means the same thing wherever
    // it appears; plain groups like (2 + 3) * 4 fall through unchanged.
    if (token.type === TokenType.LParen && this.looksLikePipeParen()) {
      return this.parseParenPipeExpr();
    }

    // Parenthesized expression or tuple
    if (token.type === TokenType.LParen) {
      return this.parseTupleOrParen();
    }

    // List literal or list comprehension
    if (token.type === TokenType.LBracket) {
      return this.parseListLitOrComp();
    }

    throw this.error(`Unexpected token '${token.value}'`);
  }

  // --- Composite expressions ---

  private parseFuncCallExpr(): Expression {
    const startToken = this.current();
    const name = this.advance().value;
    this.expect(TokenType.LParen);
    // Inside the parentheses the greedy rules of an enclosing command no
    // longer apply, as in parseTupleOrParen.
    const prev = this.inGreedyContext;
    this.inGreedyContext = false;
    try {
      const { args, namedArgs } = this.parseCallArgs();
      this.expect(TokenType.RParen);
      return { type: 'FuncCall', name, args, namedArgs, loc: this.loc(startToken) };
    } finally {
      this.inGreedyContext = prev;
    }
  }

  private parseCallArgs(): { args: Expression[]; namedArgs: NamedArg[] } {
    const args: Expression[] = [];
    const namedArgs: NamedArg[] = [];

    if (this.match(TokenType.RParen)) return { args, namedArgs };

    this.skipNewlines();
    const firstArg = this.parseCallArg(args, namedArgs);
    if (firstArg === 'done') return { args, namedArgs };

    while (this.match(TokenType.Comma)) {
      this.advance();
      this.skipNewlines();
      if (this.match(TokenType.RParen)) break;
      this.parseCallArg(args, namedArgs);
    }
    this.skipNewlines();
    return { args, namedArgs };
  }

  private parseCallArg(args: Expression[], namedArgs: NamedArg[]): string {
    // Named arg: name:value
    if (this.atNamedArgKey()) {
      const startToken = this.current();
      const key = this.advance().value;
      this.advance(); // ':'
      const value = this.parsePipeExpr();
      namedArgs.push({ key, value, loc: this.loc(startToken) });
      return 'named';
    }
    // A pipeline, as inside plain parentheses: `lift(box 10 10 10 | fillet 1)`.
    args.push(this.parsePipeExpr());
    return 'positional';
  }

  private parseTupleOrParen(): Expression {
    const startToken = this.current();
    this.expect(TokenType.LParen);
    // Inside explicit parens, greedy context no longer applies —
    // function calls like cos(15) must be recognised normally.
    const prev = this.inGreedyContext;
    this.inGreedyContext = false;
    try {
      const first = this.parseExpr();
      if (this.match(TokenType.Comma)) {
        // Tuple
        const elements = [first];
        while (this.match(TokenType.Comma)) {
          this.advance();
          if (this.match(TokenType.RParen)) break;
          elements.push(this.parseExpr());
        }
        this.expect(TokenType.RParen);
        return { type: 'TupleLit', elements, loc: this.loc(startToken) };
      }
      this.expect(TokenType.RParen);
      return first; // just parenthesized expression
    } finally {
      this.inGreedyContext = prev;
    }
  }

  private parseListLitOrComp(): Expression {
    const startToken = this.current();
    this.expect(TokenType.LBracket);
    this.skipNewlines();

    if (this.match(TokenType.RBracket)) {
      this.advance();
      return { type: 'ListLit', elements: [], loc: this.loc(startToken) };
    }

    // Brackets provide an explicit boundary — reset greedy context so that
    // func_call_expr (e.g. cos(1)) works inside bracket expressions.
    const prevGreedy = this.inGreedyContext;
    this.inGreedyContext = false;
    try {
      // Parse first element — use parsePipeExpr so source commands
      // like `rect 50 10` and pipes work inside list literals.
      const first = this.parsePipeExpr();
      this.skipNewlines();
      if (this.matchKeyword('for')) {
        return this.parseListCompRest(first, startToken);
      }

      // Regular list
      const elements = [first];
      while (this.match(TokenType.Comma)) {
        this.advance();
        this.skipNewlines();
        if (this.match(TokenType.RBracket)) break;
        elements.push(this.parsePipeExpr());
      }
      this.skipNewlines();
      this.expect(TokenType.RBracket);
      return { type: 'ListLit', elements, loc: this.loc(startToken) };
    } finally {
      this.inGreedyContext = prevGreedy;
    }
  }

  private parseListCompRest(expr: Expression, startToken: Token): Expression {
    // Inside the brackets a line break may sit around `for` and `in` and
    // before the closing `]`, as in a regular list: the closing bracket on a
    // line of its own is the natural way to write a multi-line comprehension.
    this.expect(TokenType.Keyword, 'for');
    this.skipNewlines();
    if (this.match(TokenType.Dollar)) this.advance(); // optional $
    const variable = this.expect(TokenType.Identifier).value;
    this.skipNewlines();
    this.expect(TokenType.Keyword, 'in');
    this.skipNewlines();
    // Iterable: any expression that yields a list (`range(...)` is an ordinary call).
    const iterable = this.parseExpr();
    this.skipNewlines();
    this.expect(TokenType.RBracket);
    return { type: 'ListComp', expr, variable, iterable, loc: this.loc(startToken) };
  }

}

// --- Public API ---

export function parse(source: string): Program {
  // Strip @profile block before preprocessing/lexing (preserves line numbers)
  const stripped = stripProfileBlock(source);
  const { source: preprocessed, charLineMap } = preprocess(stripped);
  const lexer = new Lexer(preprocessed, charLineMap);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.parseProgram();
}
