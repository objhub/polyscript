/**
 * The operation table (ops.ts): every op has a spec, and a named argument no
 * evaluator reads is refused at validation (`arg.unknown-option`) instead of
 * being dropped on the floor (devel/ai-friendly202609.md D-1, TODO.md).
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { OP_SPECS, unknownNamedArgs } from '../src/ops.js';
import { describeOps, opSignature } from '../src/ops-describe.js';
import { SOURCE_COMMANDS, PIPE_OP_KEYWORDS } from '../src/ast.js';
import { OP_KEYWORD } from '../src/context.js';

const errorsOf = (src: string) => validate(parse(src));

describe('operation table', () => {
  it('covers every source command and pipe op keyword', () => {
    const keywords = new Set(OP_SPECS.map((s) => s.keyword));
    for (const k of [...SOURCE_COMMANDS, ...PIPE_OP_KEYWORDS]) {
      expect(keywords.has(k), k).toBe(true);
    }
  });

  it('covers every AST op type the context model names', () => {
    const types = new Set(OP_SPECS.flatMap((s) => s.nodeTypes));
    for (const t of Object.keys(OP_KEYWORD)) {
      if (t === 'Implicit2DPrimitive' || t === 'Implicit3DPrimitive') continue;
      expect(types.has(t), t).toBe(true);
    }
  });

  it('describes contexts from the validator', () => {
    const fillet = describeOps().find((o) => o.keyword === 'fillet')!;
    expect(fillet.from.map((f) => `${f.context}>${f.to}`)).toContain('EdgeSelection>3D');
    expect(fillet.from.map((f) => `${f.context}>${f.to}`)).toContain('Face>Face');
    const box = describeOps().find((o) => o.keyword === 'box')!;
    expect(box.yields).toBe('3D');
    expect(box.from.some((f) => f.context === 'VertexSelection')).toBe(true);
    expect(opSignature(box)).toBe('box w h d  center: at: angle:');
  });
});

describe('arg.unknown-option', () => {
  it('refuses a key the operation does not read, naming the ones it does', () => {
    const [e] = errorsOf('thread 8 2 30 left:true\n');
    expect(e.code).toBe('arg.unknown-option');
    expect(e.message).toContain("'thread' does not take 'left:'");
    expect(e.message).toContain('chamfer:');
    expect(e.line).toBe(1);
  });

  it('suggests the nearest key for a typo', () => {
    const [e] = errorsOf('thread 8 2 30 chamfar:true\n');
    expect(e.hint).toBe("did you mean 'chamfer:'?");
  });

  it('catches a key that belongs to another primitive, and on pipe ops', () => {
    expect(errorsOf('box 10 10 10 dir:(1,0,0)\n')[0].code).toBe('arg.unknown-option');
    expect(errorsOf('cylinder 5 10 dir:(1,0,0)\n')).toEqual([]);
    expect(errorsOf('rect 10 10 | extrude 5 drft:3\n')[0].hint).toBe("did you mean 'draft:'?");
    expect(errorsOf('box 10 10 10 | faces >Z | rect 5 5 foo:1 | cut\n')[0].message).toContain("'rect' does not take 'foo:'");
    expect(errorsOf('box 10 10 10 | fillet 1 r:2\n')[0].message).toContain('takes no named arguments');
  });

  it('leaves user function calls alone', () => {
    expect(errorsOf('def f(a, b) = box a b 1\nf 1 b:2\nf(1, b:2)\n')).toEqual([]);
  });

  it('accepts every documented key', () => {
    const ok = [
      'box 1 1 1 center:false at:(1,2,3) angle:45',
      'cylinder 1 2 dir:(1,0,0) pnt:(0,0,0)',
      'thread 8 2 30 land:0.2 depth:1 chamfer:(1, 1)',
      'rect 1 1 center:(true,false) at:(1,2) angle:30 origin:"world"',
      'text "a" size:5',
      'arc (0,0) (10,0) radius:7',
      'arc (0,0) (10,0) center:(5,5)',
      'helix pitch:5 height:30 radius:10',
      'box 1 1 1 | faces >Z | workplane origin:(1,1,1) | circle 1 | cut',
      'box 1 1 1 | faces >Z | polar 6 3 orient:true | circle 0.2 | cut',
      'box 1 1 1 | faces >Z | grid 2 2 pitch:3 | hole 0.2 depth:0.5',
      'rect 10 10 | offset 1 join:"miter" cap:"square"',
      'box 1 1 1 | color "red" alpha:0.5',
      'rect 1 1 | extrude 1 draft:5',
      'rect 1 1 | loft [rect 2 2] 5 ruled:true',
      'box 1 1 1 | rotate 0 0 45 origin:"local"',
      'box 1 1 1 | mirror "X" keep:true',
      'rect 1 1 | move 1 1 origin:"world" | moveto 0 0 origin:"world"',
    ];
    for (const src of ok) expect(errorsOf(`${src}\n`), src).toEqual([]);
    expect(unknownNamedArgs(parse('box 1 1 1\n').statements[0] as never)).toEqual([]);
  });
});
