/**
 * `poly ops`: the operation table (ops.ts) joined with the context model
 * (validator CONTEXT_OPS, context nextContext), as data. The hand-written
 * reference tables used to drift from the implementation; this is what they
 * are generated from and checked against.
 */

import { OP_SPECS, type OpSpec } from './ops.js';
import { CONTEXT_OPS, type Context } from './validator.js';
import { nextContext, type PipelineContext } from './context.js';

export interface OpDescription extends OpSpec {
  /** Contexts a pipe op may follow, and what each becomes. Empty for a
   *  source-only command. */
  from: { context: Context; to: string }[];
  /** What the command yields when it starts a pipeline. */
  yields?: string;
}

const PRIM3D_TYPES = new Set(['BoxExpr', 'CylinderExpr', 'SphereExpr', 'ConeExpr', 'TorusExpr', 'WedgeExpr', 'ThreadExpr']);
const FACE_TYPES = new Set(['RectExpr', 'CircleExpr', 'EllipseExpr', 'PolylineExpr', 'PolygonExpr', 'TextExpr', 'SketchExpr']);
const WIRE_TYPES = new Set(['WireLiteralExpr', 'LinePathExpr', 'ArcPathExpr', 'CenterArcPathExpr', 'BezierPathExpr', 'SplinePathExpr', 'HelixPathExpr']);

/** The validator's name for an op when it sits after a pipe. */
function pipeTypes(spec: OpSpec): string[] {
  const t = spec.nodeTypes[0];
  if (PRIM3D_TYPES.has(t)) return ['Implicit3DPrimitive'];
  if (FACE_TYPES.has(t) || WIRE_TYPES.has(t)) return ['Implicit2DPrimitive'];
  return spec.nodeTypes;
}

function yieldsOf(spec: OpSpec): string | undefined {
  if (spec.kind === 'pipe') return undefined;
  const t = spec.nodeTypes[0];
  if (PRIM3D_TYPES.has(t)) return '3D';
  if (FACE_TYPES.has(t)) return 'Face';
  if (WIRE_TYPES.has(t)) return 'Wire';
  switch (spec.keyword) {
    case 'workplane': return 'Workplane';
    case 'union': case 'diff': case 'inter': return '3D (Face for 2D operands)';
    case 'grid': case 'polar': return 'points';
    default: return undefined;
  }
}

export function describeOps(): OpDescription[] {
  return OP_SPECS.map((spec) => {
    const from: OpDescription['from'] = [];
    if (spec.kind !== 'source') {
      const types = pipeTypes(spec);
      for (const ctx of Object.keys(CONTEXT_OPS) as Context[]) {
        if (!types.some((t) => CONTEXT_OPS[ctx].has(t))) continue;
        // A 2D primitive's target depends on what is drawn; name the family.
        const to = types[0] === 'Implicit2DPrimitive'
          ? (WIRE_TYPES.has(spec.nodeTypes[0]) ? 'Wire' : 'Face')
          : String(nextContext(ctx as PipelineContext, types[0]));
        from.push({ context: ctx, to });
      }
    }
    const d: OpDescription = { ...spec, from };
    const y = yieldsOf(spec);
    if (y) d.yields = y;
    return d;
  });
}

/** `box w h d [center: at: angle:]  -> 3D`, one line, for the table. */
export function opSignature(d: OpDescription): string {
  const args = d.args.map((a) => (a.optional ? `[${a.name}]` : a.name)).join(' ');
  const named = d.named.length ? `  ${d.named.map((n) => `${n.key}:`).join(' ')}` : '';
  return `${d.keyword}${args ? ` ${args}` : ''}${named}`;
}

/** The long form for one op (`poly ops thread`). */
export function opDetail(d: OpDescription): string[] {
  const out = [`${d.keyword} -- ${d.desc}`, `  ${opSignature(d)}`, `  e.g. ${d.example}`];
  if (d.args.length) {
    out.push('', '  arguments');
    for (const a of d.args) out.push(`    ${a.name.padEnd(10)} ${a.type.padEnd(22)} ${a.optional ? '(optional) ' : ''}${a.desc}`);
  }
  if (d.named.length) {
    out.push('', '  named arguments');
    for (const n of d.named) out.push(`    ${`${n.key}:`.padEnd(10)} ${n.type.padEnd(22)} ${n.desc}`);
  } else {
    out.push('', '  named arguments: none');
  }
  if (d.yields) out.push('', `  as a source: yields ${d.yields}`);
  if (d.from.length) {
    out.push('', '  after a pipe');
    for (const f of d.from) out.push(`    ${f.context.padEnd(16)} -> ${f.to}`);
  }
  return out;
}
