/**
 * PolyScript lexer / tokenizer.
 */

import { KEYWORDS } from './ast.js';

export enum TokenType {
  Number = 'Number',
  String = 'String',
  Identifier = 'Identifier',
  Keyword = 'Keyword',
  Selector = 'Selector',

  Plus = '+',
  Minus = '-',
  Star = '*',
  Slash = '/',
  DoubleSlash = '//',
  Percent = '%',
  DoubleStar = '**',

  EqEq = '==',
  NotEq = '!=',
  Lt = '<',
  Gt = '>',
  LtEq = '<=',
  GtEq = '>=',

  Eq = '=',
  Pipe = '|',
  LParen = '(',
  RParen = ')',
  LBracket = '[',
  RBracket = ']',
  Comma = ',',
  Colon = ':',
  Dollar = '$',
  DotDot = '..',
  /** Property access: `$g.volume`. A lone `.` never starts a number here
   *  (numbers begin with a digit), so it is unambiguous. */
  Dot = '.',
  /** Approximate equality (`a ~ b`, see assert). */
  Tilde = '~',
  AtParam = '@param',

  Newline = 'Newline',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  /** True when whitespace (space/tab) preceded this token on the same line. */
  leadingSpace?: boolean;
}

// Single-character token lookup (module-level constant to avoid per-call allocation)
const SINGLE_TOKEN_MAP: Record<string, TokenType> = {
  '+': TokenType.Plus,
  '-': TokenType.Minus,
  '*': TokenType.Star,
  '/': TokenType.Slash,
  '%': TokenType.Percent,
  '=': TokenType.Eq,
  '|': TokenType.Pipe,
  '(': TokenType.LParen,
  ')': TokenType.RParen,
  '[': TokenType.LBracket,
  ']': TokenType.RBracket,
  ',': TokenType.Comma,
  '.': TokenType.Dot,
  '~': TokenType.Tilde,
  ':': TokenType.Colon,
  '$': TokenType.Dollar,
  '<': TokenType.Lt,
  '>': TokenType.Gt,
};

export class Lexer {
  private source: string;
  private pos = 0;
  private line = 1;
  private column = 1;
  private charLineMap: ArrayLike<number> | null;
  /** Whether the most recent whitespace-skip consumed at least one space/tab. */
  private skippedSpace = false;

  constructor(source: string, charLineMap?: ArrayLike<number>) {
    this.source = source;
    this.charLineMap = charLineMap ?? null;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.source.length) {
      const token = this.nextToken();
      if (token) tokens.push(token);
    }
    tokens.push(this.makeToken(TokenType.EOF, ''));
    return tokens;
  }

  private peek(offset = 0): string {
    return this.source[this.pos + offset] ?? '';
  }

  private advance(): string {
    const ch = this.source[this.pos];
    this.pos++;
    if (ch === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private makeToken(type: TokenType, value: string): Token {
    // Use character-level line map for original line numbers
    const line = this.charLineMap ? (this.charLineMap[this.pos] ?? this.line) : this.line;
    const token: Token = { type, value, line, column: this.column };
    if (this.skippedSpace) token.leadingSpace = true;
    return token;
  }

  private nextToken(): Token | null {
    // Skip spaces and tabs (not newlines), tracking whether any were skipped
    this.skippedSpace = false;
    while (this.pos < this.source.length && (this.peek() === ' ' || this.peek() === '\t')) {
      this.advance();
      this.skippedSpace = true;
    }

    if (this.pos >= this.source.length) return null;

    const ch = this.peek();

    // Comments
    if (ch === '#') {
      while (this.pos < this.source.length && this.peek() !== '\n') {
        this.advance();
      }
      return null;
    }

    // Newline
    if (ch === '\n') {
      const token = this.makeToken(TokenType.Newline, '\n');
      this.advance();
      return token;
    }

    // @param annotation
    if (ch === '@') {
      // Check if followed by "param"
      if (this.source.substring(this.pos + 1, this.pos + 6) === 'param' &&
          !this.isIdentPart(this.source[this.pos + 6] ?? '')) {
        const token = this.makeToken(TokenType.AtParam, '@param');
        for (let i = 0; i < 6; i++) this.advance(); // skip @param
        return token;
      }
    }

    // DotDot (..)
    if (ch === '.' && this.peek(1) === '.') {
      const token = this.makeToken(TokenType.DotDot, '..');
      this.advance();
      this.advance();
      return token;
    }

    // String literal
    if (ch === '"') {
      return this.readString();
    }

    // Number
    if (ch >= '0' && ch <= '9') {
      return this.readNumber();
    }

    // Identifier / Keyword
    if (this.isIdentStart(ch)) {
      return this.readIdentifier();
    }

    // Selector: an operator (> < = + -) immediately followed by an axis
    // (X Y Z) or a plane (XY YZ XZ, either order), and then by nothing that
    // could continue a word. `>Z` selects; `> Z` compares; `>Zoom` is neither.
    const ch2 = this.peek(1);
    const isAxis = (c: string) => c === 'X' || c === 'Y' || c === 'Z';
    if ((ch === '>' || ch === '<' || ch === '=' || ch === '+' || ch === '-') && isAxis(ch2)) {
      const ch3 = this.peek(2);
      // Planes are spelt as workplane spells them: XY, YZ, XZ.
      const axes = ['XY', 'YZ', 'XZ'].includes(ch2 + ch3) ? ch2 + ch3 : ch2;
      const after = this.peek(1 + axes.length);
      if (!this.isIdentPart(after)) {
        const token = this.makeToken(TokenType.Selector, ch + axes);
        for (let i = 0; i <= axes.length; i++) this.advance();
        return token;
      }
    }

    // Two-character operators
    const twoChar = ch + ch2;
    if (twoChar === '**') { const t = this.makeToken(TokenType.DoubleStar, '**'); this.advance(); this.advance(); return t; }
    if (twoChar === '//') { const t = this.makeToken(TokenType.DoubleSlash, '//'); this.advance(); this.advance(); return t; }
    if (twoChar === '==') { const t = this.makeToken(TokenType.EqEq, '=='); this.advance(); this.advance(); return t; }
    if (twoChar === '!=') { const t = this.makeToken(TokenType.NotEq, '!='); this.advance(); this.advance(); return t; }
    if (twoChar === '<=') { const t = this.makeToken(TokenType.LtEq, '<='); this.advance(); this.advance(); return t; }
    if (twoChar === '>=') { const t = this.makeToken(TokenType.GtEq, '>='); this.advance(); this.advance(); return t; }

    // Single-character tokens
    if (SINGLE_TOKEN_MAP[ch]) {
      const token = this.makeToken(SINGLE_TOKEN_MAP[ch], ch);
      this.advance();
      return token;
    }

    throw new Error(`Unexpected character '${ch}' at line ${this.line}, column ${this.column}`);
  }

  private readString(): Token {
    const token = this.makeToken(TokenType.String, '');
    this.advance(); // opening "
    let value = '';
    while (this.pos < this.source.length && this.peek() !== '"') {
      if (this.peek() === '\\') {
        this.advance();
        const esc = this.advance();
        switch (esc) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case '\\': value += '\\'; break;
          case '"': value += '"'; break;
          default: value += `\\${esc}`;
        }
      } else {
        value += this.advance();
      }
    }
    if (this.pos >= this.source.length) {
      throw new Error(`Unterminated string at line ${token.line}, column ${token.column}`);
    }
    this.advance(); // closing "
    token.value = value;
    return token;
  }

  private readNumber(): Token {
    const token = this.makeToken(TokenType.Number, '');
    let value = '';
    while (this.pos < this.source.length && this.peek() >= '0' && this.peek() <= '9') {
      value += this.advance();
    }
    if (this.peek() === '.' && this.peek(1) >= '0' && this.peek(1) <= '9') {
      value += this.advance(); // .
      while (this.pos < this.source.length && this.peek() >= '0' && this.peek() <= '9') {
        value += this.advance();
      }
    }
    token.value = value;
    return token;
  }

  private readIdentifier(): Token {
    const token = this.makeToken(TokenType.Identifier, '');
    let value = '';
    while (this.pos < this.source.length && this.isIdentPart(this.peek())) {
      value += this.advance();
    }
    token.value = value;
    token.type = KEYWORDS.has(value) ? TokenType.Keyword : TokenType.Identifier;
    return token;
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isIdentPart(ch: string): boolean {
    return this.isIdentStart(ch) || (ch >= '0' && ch <= '9');
  }
}
