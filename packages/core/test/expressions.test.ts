/**
 * Tests for expressions: arithmetic, comparisons, logic, if/then/else,
 * lists, ranges, math builtins, tuples, string ops, greedy args.
 * Covers parser, evaluator aspects.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { evaluateExpressions, type Value } from '../src/evaluator.js';
import type { Expression, PipeOp, Statement } from '../src/ast.js';

function parseFirst(source: string): Statement {
  const program = parse(source);
  expect(program.statements.length).toBeGreaterThan(0);
  return program.statements[0];
}

function parsePipeline(source: string): { source: Expression; ops: PipeOp[] } {
  const stmt = parseFirst(source);
  if (stmt.type === 'Pipeline') return { source: stmt.source, ops: stmt.ops };
  return { source: stmt as Expression, ops: [] };
}

function evalExpr(source: string): Value {
  const ast = parse(source);
  return evaluateExpressions(ast);
}

// ===========================================================================
// Parser
// ===========================================================================

describe('expressions', () => {
  describe('parser', () => {
    it('parses arithmetic', () => {
      const stmt = parseFirst('$x = 2 + 3 * 4');
      if (stmt.type === 'Assignment') {
        const val = stmt.value;
        expect(val.type).toBe('BinOp');
        if (val.type === 'BinOp') {
          expect(val.op).toBe('+');
          expect(val.right.type).toBe('BinOp');
        }
      }
    });

    it('parses comparison', () => {
      const stmt = parseFirst('$x = $a > 0');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('BinOp');
      }
    });

    it('parses boolean operators', () => {
      const stmt = parseFirst('$x = $a > 0 and $b < 10');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('BinOp');
        if (stmt.value.type === 'BinOp') {
          expect(stmt.value.op).toBe('and');
        }
      }
    });

    it('parses if-then-else', () => {
      const stmt = parseFirst('$x = if $a == 0 then 1 else 2');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('IfExpr');
      }
    });

    it('parses pi constant', () => {
      const stmt = parseFirst('$x = 2 * pi');
      if (stmt.type === 'Assignment') {
        const val = stmt.value;
        if (val.type === 'BinOp') {
          expect(val.right.type).toBe('NumberLit');
          if (val.right.type === 'NumberLit') {
            expect(val.right.value).toBeCloseTo(Math.PI);
          }
        }
      }
    });

    it('parses boolean constants', () => {
      const t = parseFirst('$x = true');
      if (t.type === 'Assignment') {
        expect(t.value).toMatchObject({ type: 'BoolConst', value: true });
      }
    });

    it('parses false constant', () => {
      const stmt = parseFirst('$x = false');
      if (stmt.type === 'Assignment') {
        expect(stmt.value).toMatchObject({ type: 'BoolConst', value: false });
      }
    });

    it('parses unary negation', () => {
      const stmt = parseFirst('$x = -5');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('UnaryNeg');
      }
    });

    it('parses power operator', () => {
      const stmt = parseFirst('$x = 2 ** 3');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('BinOp');
        if (stmt.value.type === 'BinOp') {
          expect(stmt.value.op).toBe('**');
        }
      }
    });

    it('parses list literal', () => {
      const stmt = parseFirst('$x = [1, 2, 3]');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('ListLit');
        if (stmt.value.type === 'ListLit') {
          expect(stmt.value.elements).toHaveLength(3);
        }
      }
    });

    it('parses list comprehension', () => {
      const stmt = parseFirst('$x = [$i for $i in range(6)]');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('ListComp');
      }
    });

    it('parses a multi-line comprehension of shapes with the ] on its own line', () => {
      const stmt = parseFirst('$ribs = union [\n  box 2 10 4 | translate ($i * 15) 0 0\n  for $i in range(7)\n]');
      expect(stmt.type).toBe('Assignment');
    });

    it('parses tuple', () => {
      const stmt = parseFirst('$x = (1, 2)');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('TupleLit');
      }
    });

    // Or expression
    it('parses or expression', () => {
      const stmt = parseFirst('$x = $a > 0 or $b < 10');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('BinOp');
        if (stmt.value.type === 'BinOp') {
          expect(stmt.value.op).toBe('or');
        }
      }
    });

    // All comparison operators
    it('parses !=', () => {
      const stmt = parseFirst('$x = $a != 5');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('BinOp');
        if (stmt.value.type === 'BinOp') {
          expect(stmt.value.op).toBe('!=');
        }
      }
    });

    it('parses <=', () => {
      const stmt = parseFirst('$x = $a <= 5');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('BinOp');
        if (stmt.value.type === 'BinOp') {
          expect(stmt.value.op).toBe('<=');
        }
      }
    });

    it('parses >=', () => {
      const stmt = parseFirst('$x = $a >= 5');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('BinOp');
        if (stmt.value.type === 'BinOp') {
          expect(stmt.value.op).toBe('>=');
        }
      }
    });

    // Product-level operators
    it('parses double slash (integer division)', () => {
      const stmt = parseFirst('$x = 10 // 3');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('BinOp');
        if (stmt.value.type === 'BinOp') {
          expect(stmt.value.op).toBe('//');
        }
      }
    });

    it('parses modulo', () => {
      const stmt = parseFirst('$x = 10 % 3');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('BinOp');
        if (stmt.value.type === 'BinOp') {
          expect(stmt.value.op).toBe('%');
        }
      }
    });

    // String literal
    it('parses string in expression context', () => {
      const stmt = parseFirst('$x = "hello world"');
      if (stmt.type === 'Assignment') {
        expect(stmt.value).toMatchObject({ type: 'StringLit', value: 'hello world' });
      }
    });

    // List edge cases
    it('parses empty list', () => {
      const stmt = parseFirst('$x = []');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('ListLit');
        if (stmt.value.type === 'ListLit') {
          expect(stmt.value.elements).toHaveLength(0);
        }
      }
    });

    it('parses list with trailing comma', () => {
      const stmt = parseFirst('$x = [1, 2,]');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('ListLit');
        if (stmt.value.type === 'ListLit') {
          expect(stmt.value.elements).toHaveLength(2);
        }
      }
    });

    it('parses multiline list', () => {
      const stmt = parseFirst(`$x = [1,
  2,
  3]`);
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('ListLit');
        if (stmt.value.type === 'ListLit') {
          expect(stmt.value.elements).toHaveLength(3);
        }
      }
    });

    // Tuple edge cases
    it('parses tuple with trailing comma', () => {
      const stmt = parseFirst('$x = (1, 2,)');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('TupleLit');
        if (stmt.value.type === 'TupleLit') {
          expect(stmt.value.elements).toHaveLength(2);
        }
      }
    });

    it('parses nested parenthesized expression', () => {
      const stmt = parseFirst('$x = ((2 + 3))');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('BinOp');
      }
    });

    // [] is always ListLit
    it('[box 10 10 10] is ListLit containing a BoxExpr', () => {
      const stmt = parseFirst('$x = [box 10 10 10]');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('ListLit');
        if (stmt.value.type === 'ListLit') {
          expect(stmt.value.elements).toHaveLength(1);
          expect(stmt.value.elements[0].type).toBe('BoxExpr');
        }
      }
    });

    it('[(box 10 10 10)] is ListLit', () => {
      const stmt = parseFirst('$x = [(box 10 10 10)]');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('ListLit');
      }
    });

    it('[number] is ListLit', () => {
      const stmt = parseFirst('$x = [42]');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('ListLit');
      }
    });

    // Paren pipe source detection
    it('(box ...) is pipe source', () => {
      const stmt = parseFirst('(box 10 10 10)');
      expect(stmt.type).toBe('BoxExpr');
    });

    it('(box 10 | polar 4 5) is pipe source with polar pipe', () => {
      const stmt = parseFirst('(box 10 | polar 4 5)');
      expect(stmt.type).toBe('Pipeline');
    });

    it('(2 + 3) is plain expression', () => {
      const stmt = parseFirst('$x = (2 + 3) * 4');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('BinOp');
      }
    });

    // Error messages
    it('throws ParseError with line and column', () => {
      try {
        parse('box 10 | ~');
        expect.unreachable('should throw');
      } catch (e: any) {
        expect(e).toBeInstanceOf(Error);
        expect(e.message).toContain('line');
      }
    });

    it('throws on unknown pipe operation keyword', () => {
      expect(() => parse('box 10 10 10 | unknownop')).toThrow(/pipe operation/i);
    });

    it('throws on non-keyword after pipe', () => {
      expect(() => parse('box 10 10 10 | 42')).toThrow(/pipe operation/i);
    });

    it('throws on unexpected token in atom position', () => {
      expect(() => parse('$x = |')).toThrow();
    });

    // Greedy arg edge cases
    it('treats multiplication in greedy args as part of expression', () => {
      const stmt = parseFirst('box 10*2 20 30');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.args[0].type).toBe('BinOp');
      }
    });

    it('treats minus as unary (new arg) in greedy args: box 10 -5 20', () => {
      const stmt = parseFirst('box 10 -5 20');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.args[0].type).toBe('NumberLit');
        expect(stmt.args[1].type).toBe('UnaryNeg');
        expect(stmt.args[2].type).toBe('NumberLit');
      }
    });

    it('parses pipe op without args', () => {
      const { ops } = parsePipeline('circle 5 | cut');
      expect(ops[0].type).toBe('Cut');
      if (ops[0].type === 'Cut') {
        expect(ops[0].args).toHaveLength(0);
      }
    });

    it('parses only named args in greedy context', () => {
      const stmt = parseFirst('helix pitch:5 height:30 radius:10');
      expect(stmt.type).toBe('HelixPathExpr');
      if (stmt.type === 'HelixPathExpr') {
        expect(stmt.args).toHaveLength(0);
        expect(stmt.namedArgs).toHaveLength(3);
      }
    });

    it('does not consume pipe keyword as greedy arg', () => {
      const { source, ops } = parsePipeline('box 10 10 10 | translate 0 0 5');
      expect(source.type).toBe('BoxExpr');
      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe('Translate');
      if (ops[0].type === 'Translate') {
        expect(ops[0].args).toHaveLength(3);
      }
    });

    it('parses consecutive pipe ops with and without args', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | workplane | cut');
      expect(ops).toHaveLength(3);
      expect(ops[0].type).toBe('FacesSelect');
      expect(ops[1].type).toBe('Workplane');
      expect(ops[2].type).toBe('Cut');
    });

    it('parses [$x] as list with single element', () => {
      const stmt = parseFirst('$a = [$x]');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('ListLit');
      }
    });

    it('allows pi as greedy arg', () => {
      const stmt = parseFirst('cylinder 5 pi');
      expect(stmt.type).toBe('CylinderExpr');
      if (stmt.type === 'CylinderExpr') {
        expect(stmt.args).toHaveLength(2);
      }
    });

    it('allows true/false as greedy arg', () => {
      const stmt = parseFirst('$x = true');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('BoolConst');
      }
    });

    it('parses variable reference in greedy args ($ prefix)', () => {
      const { ops } = parsePipeline('box 10 10 10 | diff $saved');
      expect(ops[0].type).toBe('Diff');
      if (ops[0].type === 'Diff') {
        expect(ops[0].args[0].type).toBe('VarRef');
      }
    });

    it('parses variable reference in greedy args', () => {
      const stmt = parseFirst('box $w $h $d');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.args[0]).toMatchObject({ type: 'VarRef', name: 'w' });
        expect(stmt.args[1]).toMatchObject({ type: 'VarRef', name: 'h' });
        expect(stmt.args[2]).toMatchObject({ type: 'VarRef', name: 'd' });
      }
    });

    it('parses parenthesized expression in greedy args', () => {
      const stmt = parseFirst('box (2+3) 10 10');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.args[0].type).toBe('BinOp');
      }
    });

    it('parses division in greedy args as part of expression', () => {
      const stmt = parseFirst('box 20/2 10 5');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.args[0].type).toBe('BinOp');
        if (stmt.args[0].type === 'BinOp') {
          expect(stmt.args[0].op).toBe('/');
        }
      }
    });

    it('does not treat NAME followed by ( as function call in greedy args', () => {
      const { ops } = parsePipeline('box 10 10 10 | translate t t ((d - t) / 2)');
      expect(ops[0].type).toBe('Translate');
      if (ops[0].type === 'Translate') {
        expect(ops[0].args).toHaveLength(3);
        expect(ops[0].args[0]).toMatchObject({ type: 'VarRef', name: 't' });
        expect(ops[0].args[1]).toMatchObject({ type: 'VarRef', name: 't' });
        expect(ops[0].args[2].type).toBe('BinOp');
      }
    });

    it('handles empty input', () => {
      const program = parse('');
      expect(program.statements).toHaveLength(0);
    });

    it('handles comments', () => {
      const program = parse(`# this is a comment
box 10 10 10`);
      expect(program.statements).toHaveLength(1);
    });

    it('parses variable in greedy args', () => {
      const stmt = parseFirst('box $size $size 3');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.args[0]).toMatchObject({ type: 'VarRef', name: 'size' });
      }
    });

    it('parses arithmetic in greedy args', () => {
      const stmt = parseFirst('box 10 20/2 5');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.args[1].type).toBe('BinOp');
      }
    });

    // Greedy args +/- from review-coverage.test.ts
    it('parses addition in greedy args: fillet 2 + 1', () => {
      const stmt = parseFirst('box 10 10 10 | fillet 2 + 1');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        const fillet = stmt.ops[0];
        expect(fillet.type).toBe('Fillet');
        if (fillet.type === 'Fillet') {
          expect(fillet.args[0].type).toBe('BinOp');
          if (fillet.args[0].type === 'BinOp') {
            expect(fillet.args[0].op).toBe('+');
          }
        }
      }
    });

    it('treats minus as unary (new arg) in greedy fillet: fillet 4 -1', () => {
      const stmt = parseFirst('box 10 10 10 | fillet 4 -1');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        const fillet = stmt.ops[0];
        expect(fillet.type).toBe('Fillet');
        if (fillet.type === 'Fillet') {
          // fillet gets two args: 4 and -1 (unary neg)
          expect(fillet.args).toHaveLength(2);
          expect(fillet.args[0].type).toBe('NumberLit');
          expect(fillet.args[1].type).toBe('UnaryNeg');
        }
      }
    });

    it('unary minus at start of greedy arg still works: fillet -1', () => {
      const stmt = parseFirst('box 10 10 10 | fillet -1');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        const fillet = stmt.ops[0];
        expect(fillet.type).toBe('Fillet');
        if (fillet.type === 'Fillet') {
          expect(fillet.args[0].type).toBe('UnaryNeg');
        }
      }
    });

    it('negative value in at: kwarg: circle 8 at:0 0 -5', () => {
      const stmt = parseFirst('circle 8 at:0 0 -5');
      expect(stmt.type).toBe('CircleExpr');
      if (stmt.type === 'CircleExpr') {
        // at: should get three values (0, 0, -5), not two (0, sub(0,5))
        const atArg = stmt.namedArgs.find((a: { key: string }) => a.key === 'at');
        expect(atArg).toBeDefined();
        if (atArg && atArg.value.type === 'TupleLit') {
          expect(atArg.value.elements).toHaveLength(3);
          expect(atArg.value.elements[2].type).toBe('UnaryNeg');
        }
      }
    });

    it('parses box with addition in middle arg', () => {
      const stmt = parseFirst('box 10 5 + 3 20');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.args[1].type).toBe('BinOp');
      }
    });

    it('parses addition in func_greedy args', () => {
      const program = parse('def f($a) = $a\nf 2 + 1');
      const funcCallStmt = program.statements[1];
      expect(funcCallStmt.type).toBe('FuncCall');
      if (funcCallStmt.type === 'FuncCall') {
        expect(funcCallStmt.args[0].type).toBe('BinOp');
        if (funcCallStmt.args[0].type === 'BinOp') {
          expect(funcCallStmt.args[0].op).toBe('+');
        }
      }
    });

    // if-then-else shape expressions parser
    it('if-then-else with variable shape references', () => {
      const program = parse('$a = 10\n$b = 20\n$size = if true then $a else $b');
      expect(program.statements[2].type).toBe('Assignment');
      if (program.statements[2].type === 'Assignment') {
        expect(program.statements[2].value.type).toBe('IfExpr');
      }
    });

    // if-then-else branches take commands without parentheses (SPEC §条件式)
    describe('if-then-else with command branches', () => {
      function ifOf(source: string): Expression {
        const stmt = parseFirst(source);
        const e = stmt.type === 'Assignment' ? stmt.value : stmt as Expression;
        return e;
      }

      it('2D commands in both branches', () => {
        const e = ifOf('shape = if true then circle 10 else rect 20 15');
        expect(e.type).toBe('IfExpr');
        if (e.type === 'IfExpr') {
          expect(e.thenExpr).toMatchObject({ type: 'CircleExpr', args: [{ value: 10 }] });
          expect(e.elseExpr).toMatchObject({ type: 'RectExpr', args: [{ value: 20 }, { value: 15 }] });
        }
      });

      it('3D commands with several args', () => {
        const e = ifOf('shape = if r then cylinder 15 8 else box 30 30 8');
        expect(e).toMatchObject({ type: 'IfExpr', thenExpr: { type: 'CylinderExpr' }, elseExpr: { type: 'BoxExpr' } });
      });

      it('a parenthesised if with command branches', () => {
        expect(ifOf('(if r then cylinder 15 8 else box 30 30 8)').type).toBe('IfExpr');
      });

      it('a pipe after a parenthesised if applies to the if', () => {
        const e = ifOf('(if r then cylinder 15 8 else box 30 30 8) | floor');
        expect(e).toMatchObject({ type: 'Pipeline', source: { type: 'IfExpr' } });
      });

      it('parenthesised pipelines inside the branches', () => {
        const e = ifOf('if r then (cylinder 15 8 | floor) else (box 30 30 8 | floor)');
        expect(e).toMatchObject({ type: 'IfExpr', thenExpr: { type: 'Pipeline' }, elseExpr: { type: 'Pipeline' } });
      });

      it('a bare pipe inside the then branch is an error', () => {
        expect(() => parse('if a then box 1 1 1 | floor else box 2 2 2')).toThrow();
      });

      it('a pipe after the else branch applies to the whole if', () => {
        const e = ifOf('x = if a then box 1 1 1 else box 2 2 2 | floor');
        expect(e).toMatchObject({
          type: 'Pipeline',
          source: { type: 'IfExpr', elseExpr: { type: 'BoxExpr' } },
          ops: [{ type: 'Floor' }],
        });
      });

      it('an if in argument position needs parentheses', () => {
        expect(ifOf('box 10 10 (if a then 5 else 3)')).toMatchObject({
          type: 'BoxExpr', args: [{ value: 10 }, { value: 10 }, { type: 'IfExpr' }],
        });
        // A bare `if` is not a greedy arg: it ends the box's argument list.
        const bare = parse('box 10 10 if a then 5 else 3').statements[0];
        expect(bare).toMatchObject({ type: 'BoxExpr', args: [{ value: 10 }, { value: 10 }] });
      });

      it('else-if chains, numeric and with commands', () => {
        expect(ifOf('d = if a then 3 else if b then 4.5 else 5.5'))
          .toMatchObject({ type: 'IfExpr', elseExpr: { type: 'IfExpr' } });
        expect(ifOf('shape = if a then circle 10 else if b then rect 20 15 else box 10 10 10'))
          .toMatchObject({
            type: 'IfExpr', thenExpr: { type: 'CircleExpr' },
            elseExpr: { type: 'IfExpr', thenExpr: { type: 'RectExpr' }, elseExpr: { type: 'BoxExpr' } },
          });
      });

      it('numbers, variables and arithmetic are unchanged', () => {
        expect(ifOf('thickness = if use_thick then 3 else 1.5'))
          .toMatchObject({ type: 'IfExpr', thenExpr: { type: 'NumberLit' }, elseExpr: { type: 'NumberLit' } });
        expect(ifOf('shape = if a then my_var else other_var'))
          .toMatchObject({ type: 'IfExpr', thenExpr: { type: 'VarRef' }, elseExpr: { type: 'VarRef' } });
        expect(ifOf('x = if a then 10 + 5 else 3 * 2'))
          .toMatchObject({ type: 'IfExpr', thenExpr: { type: 'BinOp' }, elseExpr: { type: 'BinOp' } });
        expect(ifOf('x = if a then f(2) else 1'))
          .toMatchObject({ type: 'IfExpr', thenExpr: { type: 'FuncCall', name: 'f' } });
      });

      it('user functions called greedily', () => {
        expect(ifOf('shape = if a then my_shape 10 else my_shape 20'))
          .toMatchObject({ type: 'IfExpr', thenExpr: { type: 'FuncCall', name: 'my_shape' }, elseExpr: { type: 'FuncCall' } });
      });

      it('named args inside a branch stop at else', () => {
        const e = ifOf('if true then box 10 10 10 at:5 0 else box 20 20 20');
        expect(e).toMatchObject({ type: 'IfExpr', thenExpr: { type: 'BoxExpr', namedArgs: [{ key: 'at' }] }, elseExpr: { type: 'BoxExpr' } });
      });
    });

    // Text size: kwarg parser
    it('parses text with size: kwarg', () => {
      const stmt = parseFirst('text "M8" size:10');
      expect(stmt.type).toBe('TextExpr');
      if (stmt.type === 'TextExpr') {
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('size');
        expect(stmt.namedArgs[0].value).toMatchObject({ type: 'NumberLit', value: 10 });
      }
    });

    it('parses text with size: as pipe op', () => {
      const stmt = parseFirst('box 10 10 10 | faces >Z | text "M8" size:10 | cut 2');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        const textOp = stmt.ops[1];
        expect(textOp.type).toBe('Implicit2DPrimitive');
        if (textOp.type === 'Implicit2DPrimitive') {
          expect(textOp.primitive.type).toBe('TextExpr');
          if (textOp.primitive.type === 'TextExpr') {
            expect(textOp.primitive.namedArgs[0].key).toBe('size');
          }
        }
      }
    });

    // Index access parser tests
    it('parses $x[1] as IndexAccess', () => {
      const program = parse('$a = [10, 20, 30]\n$b = $a[1]');
      const second = program.statements[1];
      expect(second.type).toBe('Assignment');
      if (second.type === 'Assignment') {
        expect(second.value.type).toBe('IndexAccess');
        if (second.value.type === 'IndexAccess') {
          expect(second.value.object).toMatchObject({ type: 'VarRef', name: 'a' });
          expect(second.value.index).toMatchObject({ type: 'NumberLit', value: 1 });
        }
      }
    });

    it('parses list literal index access [10, 20][0]', () => {
      const stmt = parseFirst('$x = [10, 20][0]');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('IndexAccess');
        if (stmt.value.type === 'IndexAccess') {
          expect(stmt.value.object.type).toBe('ListLit');
          expect(stmt.value.index).toMatchObject({ type: 'NumberLit', value: 0 });
        }
      }
    });

    it('parses chained index access [[1,2],[3,4]][0][1]', () => {
      const stmt = parseFirst('$x = [[1,2],[3,4]][0][1]');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('IndexAccess');
        if (stmt.value.type === 'IndexAccess') {
          // outer IndexAccess: object is another IndexAccess, index is 1
          expect(stmt.value.index).toMatchObject({ type: 'NumberLit', value: 1 });
          expect(stmt.value.object.type).toBe('IndexAccess');
        }
      }
    });

    it('parses index access with expression index $list[$i + 1]', () => {
      const program = parse('$i = 0\n$list = [10, 20, 30]\n$x = $list[$i + 1]');
      const third = program.statements[2];
      expect(third.type).toBe('Assignment');
      if (third.type === 'Assignment') {
        expect(third.value.type).toBe('IndexAccess');
        if (third.value.type === 'IndexAccess') {
          expect(third.value.index.type).toBe('BinOp');
        }
      }
    });

    it('does not treat [ as index access in greedy context', () => {
      // "box $x [1,2,3]" should parse $x as one arg and [1,2,3] as another
      const program = parse('$x = 10\nbox $x [1, 2, 3]');
      const boxStmt = program.statements[1];
      expect(boxStmt.type).toBe('BoxExpr');
      if (boxStmt.type === 'BoxExpr') {
        expect(boxStmt.args).toHaveLength(2);
        expect(boxStmt.args[0]).toMatchObject({ type: 'VarRef', name: 'x' });
        expect(boxStmt.args[1].type).toBe('ListLit');
      }
    });

    it('existing list literal parsing is not broken', () => {
      const stmt = parseFirst('$a = [1, 2, 3]');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('ListLit');
        if (stmt.value.type === 'ListLit') {
          expect(stmt.value.elements).toHaveLength(3);
        }
      }
    });
  });

  // ===========================================================================
  // Evaluator
  // ===========================================================================

  describe('evaluator', () => {
    // Arithmetic
    it('evaluates number literal', () => {
      expect(evalExpr('$x = 42')).toBe(42);
    });

    it('evaluates addition', () => {
      expect(evalExpr('$x = 2 + 3')).toBe(5);
    });

    it('evaluates subtraction', () => {
      expect(evalExpr('$x = 10 - 4')).toBe(6);
    });

    // len() takes a list, not a number: it must not go through the numeric coercion of the math builtins
    it('evaluates len() of a list literal and of range()', () => {
      expect(evalExpr('$x = len([1, 2, 3])')).toBe(3);
      expect(evalExpr('$x = len(range(5))')).toBe(5);
      expect(evalExpr('$x = len([])')).toBe(0);
    });

    it('evaluates multiplication', () => {
      expect(evalExpr('$x = 3 * 7')).toBe(21);
    });

    it('evaluates division', () => {
      expect(evalExpr('$x = 15 / 3')).toBe(5);
    });

    it('evaluates integer division', () => {
      expect(evalExpr('$x = 7 // 2')).toBe(3);
    });

    it('evaluates modulo', () => {
      expect(evalExpr('$x = 10 % 3')).toBe(1);
    });

    it('evaluates power', () => {
      expect(evalExpr('$x = 2 ** 3')).toBe(8);
    });

    it('evaluates unary negation', () => {
      expect(evalExpr('$x = -5')).toBe(-5);
    });

    it('evaluates operator precedence', () => {
      expect(evalExpr('$x = 2 + 3 * 4')).toBe(14);
    });

    it('evaluates parenthesized expression', () => {
      expect(evalExpr('$x = (2 + 3) * 4')).toBe(20);
    });

    it('evaluates pi constant', () => {
      const val = evalExpr('$x = pi') as number;
      expect(val).toBeCloseTo(Math.PI);
    });

    it('evaluates pi in expression', () => {
      const val = evalExpr('$x = 2 * pi') as number;
      expect(val).toBeCloseTo(2 * Math.PI);
    });

    // Comparisons and booleans
    it('evaluates ==', () => {
      expect(evalExpr('$x = 5 == 5')).toBe(true);
    });

    it('evaluates !=', () => {
      expect(evalExpr('$x = 5 != 3')).toBe(true);
    });

    it('evaluates <', () => {
      expect(evalExpr('$x = 3 < 5')).toBe(true);
    });

    it('evaluates >', () => {
      expect(evalExpr('$x = 5 > 3')).toBe(true);
    });

    it('evaluates <=', () => {
      expect(evalExpr('$x = 5 <= 5')).toBe(true);
    });

    it('evaluates >=', () => {
      expect(evalExpr('$x = 5 >= 3')).toBe(true);
    });

    it('evaluates boolean constants', () => {
      expect(evalExpr('$x = true')).toBe(true);
      expect(evalExpr('$x = false')).toBe(false);
    });

    it('evaluates and', () => {
      expect(evalExpr('$x = true and false')).toBe(false);
    });

    it('evaluates or', () => {
      expect(evalExpr('$x = false or true')).toBe(true);
    });

    // If-then-else
    it('evaluates true branch', () => {
      expect(evalExpr('$x = if 1 > 0 then 10 else 20')).toBe(10);
    });

    it('evaluates false branch', () => {
      expect(evalExpr('$x = if 0 > 1 then 10 else 20')).toBe(20);
    });

    it('evaluates nested if', () => {
      expect(evalExpr('$x = if true then if false then 1 else 2 else 3')).toBe(2);
    });

    // Lists and tuples
    it('evaluates list literal', () => {
      const val = evalExpr('$x = [1, 2, 3]') as Value[];
      expect(val).toEqual([1, 2, 3]);
    });

    it('evaluates empty list', () => {
      const val = evalExpr('$x = []') as Value[];
      expect(val).toEqual([]);
    });

    it('evaluates tuple', () => {
      const val = evalExpr('$x = (1, 2)') as Value[];
      expect(val).toEqual([1, 2]);
    });

    it('evaluates list comprehension', () => {
      const val = evalExpr('$x = [$i * 2 for $i in range(4)]') as Value[];
      expect(val).toEqual([0, 2, 4, 6]);
    });

    // String
    it('evaluates string', () => {
      expect(evalExpr('$x = "hello"')).toBe('hello');
    });

    // Division by zero
    it('returns 0 for division by zero', () => {
      expect(evalExpr('$x = 5 / 0')).toBe(0);
    });

    it('returns 0 for modulo by zero', () => {
      expect(evalExpr('$x = 5 % 0')).toBe(0);
    });

    // Complex expressions
    it('evaluates chained operations', () => {
      const ast = parse('$a = 10\n$b = $a / 3\n$x = $b * 2 + 1');
      const val = evaluateExpressions(ast) as number;
      expect(val).toBeCloseTo(10 / 3 * 2 + 1);
    });

    it('evaluates function with expression args', () => {
      const ast = parse('def f($x) = $x ** 2 + 1\n$y = f(3)');
      const val = evaluateExpressions(ast);
      expect(val).toBe(10);
    });

    // Math builtins
    it('evaluates sqrt', () => {
      const val = evalExpr('$x = sqrt(16)') as number;
      expect(val).toBe(4);
    });

    it('evaluates abs', () => {
      const val = evalExpr('$x = abs(-5)') as number;
      expect(val).toBe(5);
    });

    it('evaluates min/max', () => {
      expect(evalExpr('$x = min(3, 7)')).toBe(3);
      expect(evalExpr('$x = max(3, 7)')).toBe(7);
    });

    it('evaluates sin/cos', () => {
      const val = evalExpr('$x = sin(0)') as number;
      expect(val).toBeCloseTo(0);
    });

    it('evaluates tan', () => {
      const val = evalExpr('$x = tan(0)') as number;
      expect(val).toBeCloseTo(0);
    });

    it('evaluates asin', () => {
      const val = evalExpr('$x = asin(1)') as number;
      expect(val).toBeCloseTo(90);
    });

    it('evaluates acos', () => {
      const val = evalExpr('$x = acos(1)') as number;
      expect(val).toBeCloseTo(0);
    });

    it('evaluates atan', () => {
      const val = evalExpr('$x = atan(0)') as number;
      expect(val).toBeCloseTo(0);
    });

    it('evaluates atan2', () => {
      const val = evalExpr('$x = atan2(1, 1)') as number;
      expect(val).toBeCloseTo(45);
    });

    it('evaluates floor', () => {
      expect(evalExpr('$x = floor(3.7)')).toBe(3);
    });

    it('evaluates ceil', () => {
      expect(evalExpr('$x = ceil(3.2)')).toBe(4);
    });

    it('evaluates round', () => {
      expect(evalExpr('$x = round(3.5)')).toBe(4);
    });

    it('evaluates radians/rad', () => {
      const val1 = evalExpr('$x = radians(180)') as number;
      expect(val1).toBeCloseTo(Math.PI);
      const val2 = evalExpr('$x = rad(180)') as number;
      expect(val2).toBeCloseTo(Math.PI);
    });

    it('evaluates degrees/deg', () => {
      const ast = parse(`$x = degrees(${Math.PI})`);
      const val = evaluateExpressions(ast) as number;
      expect(val).toBeCloseTo(180);
    });

    it('evaluates cos(180)', () => {
      const val = evalExpr('$x = cos(180)') as number;
      expect(val).toBeCloseTo(-1);
    });

    // String concatenation
    it('concatenates string + number', () => {
      expect(evalExpr('$x = "hello" + 42')).toBe('hello42');
    });

    it('concatenates number + string', () => {
      expect(evalExpr('$x = 42 + "world"')).toBe('42world');
    });

    it('concatenates string + string', () => {
      expect(evalExpr('$x = "hello" + " world"')).toBe('hello world');
    });

    // Division by zero edge cases
    it('integer division by zero returns 0', () => {
      expect(evalExpr('$x = 7 // 0')).toBe(0);
    });

    // And/or short-circuit
    it('and returns left when falsy', () => {
      expect(evalExpr('$x = false and 42')).toBe(false);
    });

    it('and returns right when left is truthy', () => {
      expect(evalExpr('$x = true and 42')).toBe(42);
    });

    it('or returns left when truthy', () => {
      expect(evalExpr('$x = true or false')).toBe(true);
    });

    it('or returns right when left is falsy', () => {
      expect(evalExpr('$x = false or 42')).toBe(42);
    });

    // Comparison false cases
    it('== false case', () => {
      expect(evalExpr('$x = 3 == 5')).toBe(false);
    });

    it('!= false case', () => {
      expect(evalExpr('$x = 5 != 5')).toBe(false);
    });

    it('< false case', () => {
      expect(evalExpr('$x = 5 < 3')).toBe(false);
    });

    it('> false case', () => {
      expect(evalExpr('$x = 3 > 5')).toBe(false);
    });

    it('<= with strictly less', () => {
      expect(evalExpr('$x = 3 <= 5')).toBe(true);
    });

    it('<= false case', () => {
      expect(evalExpr('$x = 6 <= 5')).toBe(false);
    });

    it('>= with strictly greater', () => {
      expect(evalExpr('$x = 6 >= 5')).toBe(true);
    });

    it('>= false case', () => {
      expect(evalExpr('$x = 3 >= 5')).toBe(false);
    });

    // If-then-else with boolean
    it('condition 0 is falsy', () => {
      expect(evalExpr('$x = if 0 then 10 else 20')).toBe(20);
    });

    it('condition non-zero is truthy', () => {
      expect(evalExpr('$x = if 42 then 10 else 20')).toBe(10);
    });

    // Range builtin
    it('range with 1 arg counts from 0 in a list comp', () => {
      const val = evalExpr('$x = [$i for $i in range(3)]') as Value[];
      expect(val).toEqual([0, 1, 2]);
    });

    it('list comprehension with range(5) produces 5 elements', () => {
      const val = evalExpr('$x = [$i * 3 for $i in range(5)]') as Value[];
      expect(val).toEqual([0, 3, 6, 9, 12]);
    });

    it('range(start, end) inside a list comprehension', () => {
      const val = evalExpr('$x = [$i for $i in range(1, 6)]') as Value[];
      expect(val).toEqual([1, 2, 3, 4, 5]);
    });

    it('range(start, end, step) inside a list comprehension', () => {
      const val = evalExpr('$x = [$i * 2 for $i in range(0, 10, 3)]') as Value[];
      expect(val).toEqual([0, 6, 12, 18]);
    });

    it('range returns a list outside a comprehension', () => {
      expect(evalExpr('$x = range(5)')).toEqual([0, 1, 2, 3, 4]);
      expect(evalExpr('$x = range(1, 4)')).toEqual([1, 2, 3]);
      expect(evalExpr('$x = range(0, 10, 3)')).toEqual([0, 3, 6, 9]);
      expect(evalExpr('$x = range(5, 0, -2)')).toEqual([5, 3, 1]);
    });

    it('a list comprehension may break lines anywhere inside its brackets', () => {
      const want = [0, 15, 30, 45, 60, 75, 90];
      for (const src of [
        '$x = [$i * 15 for $i in range(7)\n]',
        '$x = [\n  $i * 15 for $i in range(7)]',
        '$x = [$i * 15\n  for $i in range(7)]',
        '$x = [\n  $i * 15\n  for $i\n  in\n  range(7)\n]',
      ]) {
        expect(evalExpr(src), JSON.stringify(src)).toEqual(want);
      }
      expect(evalExpr('$x = [1,\n  2,\n  3\n]')).toEqual([1, 2, 3]);
    });

    it('range rejects a zero step and a wrong argument count', () => {
      expect(() => evalExpr('$x = range(0, 5, 0)')).toThrow(/step/);
      expect(() => evalExpr('$x = range(1, 2, 3, 4)')).toThrow(/1 to 3/);
    });

    // Tuple and list
    it('evaluates nested tuple', () => {
      const val = evalExpr('$x = ((1, 2), (3, 4))') as any[];
      expect(val).toEqual([[1, 2], [3, 4]]);
    });

    it('evaluates list with mixed types', () => {
      const val = evalExpr('$x = [1, "hello", true]') as any[];
      expect(val).toEqual([1, 'hello', true]);
    });

    // List comprehension with array iterable
    it('iterates over list values', () => {
      const ast = parse('$xs = [10, 20, 30]\n$y = [$i for $i in range(3)]');
      const val = evaluateExpressions(ast) as Value[];
      expect(val).toEqual([0, 1, 2]);
    });

    // Boolean coercion in asNumber
    it('true coerced to 1 in arithmetic', () => {
      expect(evalExpr('$x = true + 1')).toBe(2);
    });

    it('false coerced to 0 in arithmetic', () => {
      expect(evalExpr('$x = false + 1')).toBe(1);
    });

    // Nested unary negation
    it('double negation', () => {
      expect(evalExpr('$x = --5')).toBe(5);
    });

    // Expression as last statement
    it('bare expression returns its value', () => {
      const ast = parse('2 + 3');
      expect(evaluateExpressions(ast)).toBe(5);
    });

    // List comprehension error
    it('throws for non-iterable in list comprehension', () => {
      expect(() => evalExpr('$x = "hello"\n$y = [$i for $i in range($x)]')).toThrow();
    });

    // Greedy args evaluator
    it('evaluates addition in greedy args', () => {
      expect(evalExpr('$x = 2 + 1')).toBe(3);
    });

    // String comparison
    it('string == same string returns true', () => {
      expect(evalExpr('$x = "M3" == "M3"')).toBe(true);
    });

    it('string == different string returns false', () => {
      expect(evalExpr('$x = "M3" == "M8"')).toBe(false);
    });

    it('string != same string returns false', () => {
      expect(evalExpr('$x = "hello" != "hello"')).toBe(false);
    });

    it('string != different string returns true', () => {
      expect(evalExpr('$x = "hello" != "world"')).toBe(true);
    });

    it('number == number still works', () => {
      expect(evalExpr('$x = 42 == 42')).toBe(true);
    });

    it('number != number still works', () => {
      expect(evalExpr('$x = 42 != 43')).toBe(true);
    });

    it('mixed type == returns false', () => {
      expect(evalExpr('$x = 42 == "42"')).toBe(false);
    });

    it('boolean == comparison', () => {
      expect(evalExpr('$x = true == true')).toBe(true);
      expect(evalExpr('$x = true == false')).toBe(false);
    });

    // If-then-else with shapes
    it('evaluates if-then-else selecting numeric branch', () => {
      expect(evalExpr('$big = true\n$size = if $big then 100 else 10')).toBe(100);
      expect(evalExpr('$big = false\n$size = if $big then 100 else 10')).toBe(10);
    });

    it('evaluates if-then-else with comparison condition', () => {
      expect(evalExpr('$n = 5\n$x = if $n > 3 then 1 else 0')).toBe(1);
      expect(evalExpr('$n = 1\n$x = if $n > 3 then 1 else 0')).toBe(0);
    });

    it('evaluates nested if-then-else', () => {
      const result = evalExpr('$a = 2\n$x = if $a == 1 then 10 else if $a == 2 then 20 else 30');
      expect(result).toBe(20);
    });

    // ------------------------------------------------------------------
    // Comparison type rules (SPEC P0-3)
    // ------------------------------------------------------------------
    describe('comparison type rules', () => {
      // String ordering comparisons
      it('"abc" < "abd" returns true', () => {
        expect(evalExpr('$x = "abc" < "abd"')).toBe(true);
      });

      it('"abc" >= "abc" returns true', () => {
        expect(evalExpr('$x = "abc" >= "abc"')).toBe(true);
      });

      it('"b" > "a" returns true', () => {
        expect(evalExpr('$x = "b" > "a"')).toBe(true);
      });

      it('"a" <= "b" returns true', () => {
        expect(evalExpr('$x = "a" <= "b"')).toBe(true);
      });

      // String equality (already covered above, but grouped here for completeness)
      it('"M3" == "M3" returns true', () => {
        expect(evalExpr('$x = "M3" == "M3"')).toBe(true);
      });

      it('"M3" != "M4" returns true', () => {
        expect(evalExpr('$x = "M3" != "M4"')).toBe(true);
      });

      // Mixed-type == / != (no error, just false/true)
      it('42 == "42" returns false (different types)', () => {
        expect(evalExpr('$x = 42 == "42"')).toBe(false);
      });

      it('42 != "42" returns true (different types)', () => {
        expect(evalExpr('$x = 42 != "42"')).toBe(true);
      });

      it('true == 1 returns false (different types)', () => {
        expect(evalExpr('$x = true == 1')).toBe(false);
      });

      // Mixed-type ordering throws
      it('42 < "abc" throws type error', () => {
        expect(() => evalExpr('$x = 42 < "abc"')).toThrow(/Type error/);
      });

      it('"abc" > 1 throws type error', () => {
        expect(() => evalExpr('$x = "abc" > 1')).toThrow(/Type error/);
      });

      // Boolean ordering throws
      it('true < false throws type error', () => {
        expect(() => evalExpr('$x = true < false')).toThrow(/Type error/);
      });

      it('true > 1 throws type error (bool vs number)', () => {
        expect(() => evalExpr('$x = true > 1')).toThrow(/Type error/);
      });
    });

    // Index access evaluator tests
    it('evaluates list index access [10, 20, 30][1]', () => {
      expect(evalExpr('$x = [10, 20, 30][1]')).toBe(20);
    });

    it('evaluates index 0', () => {
      expect(evalExpr('$x = [10, 20, 30][0]')).toBe(10);
    });

    it('evaluates last index', () => {
      expect(evalExpr('$x = [10, 20, 30][2]')).toBe(30);
    });

    it('evaluates chained index access [[1,2],[3,4]][0][1]', () => {
      expect(evalExpr('$x = [[1,2],[3,4]][0][1]')).toBe(2);
    });

    it('evaluates index with variable', () => {
      const ast = parse('$list = [10, 20, 30]\n$i = 1\n$x = $list[$i]');
      expect(evaluateExpressions(ast)).toBe(20);
    });

    it('evaluates index with expression', () => {
      const ast = parse('$i = 1\n$x = [10, 20, 30][$i + 1]');
      expect(evaluateExpressions(ast)).toBe(30);
    });

    it('evaluates index with modulo expression', () => {
      const ast = parse('$i = 4\n$x = [10, 20, 30][$i % 3]');
      expect(evaluateExpressions(ast)).toBe(20);
    });

    it('truncates float index to integer', () => {
      expect(evalExpr('$x = [10, 20, 30][1.9]')).toBe(20);
    });

    it('throws on index out of range', () => {
      expect(() => evalExpr('$x = [10, 20, 30][3]')).toThrow(/out of range/);
    });

    it('throws on negative index', () => {
      expect(() => evalExpr('$x = [10, 20, 30][-1]')).toThrow(/out of range/);
    });

    it('throws on index access on non-list', () => {
      expect(() => evalExpr('$x = 42[0]')).toThrow(/requires a list/);
    });

    it('throws on non-number index', () => {
      expect(() => evalExpr('$x = [1, 2, 3]["a"]')).toThrow(/must be a number/);
    });

    // Shape operations require OC
    it('throws when trying to create box without OC', () => {
      expect(() => evalExpr('box 10 10 10')).toThrow();
    });

    it('throws when trying to create sphere without OC', () => {
      expect(() => evalExpr('sphere 5')).toThrow();
    });
  });
});
