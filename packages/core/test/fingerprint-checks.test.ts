/**
 * Tests for the shape fingerprint and the post-build checks -- the two pieces
 * of the report that answer "did this change?" and "is this what was meant?"
 * without anyone looking at the geometry.
 */
import { describe, it, expect } from 'vitest';
import { fingerprint, FINGERPRINT_PRECISION } from '../src/fingerprint.js';
import { runChecks } from '../src/checks.js';
import type { ShapeInfo } from '../src/ocp-kernel/analysis.js';
import type { TraceStep } from '../src/trace.js';

const facts = (over: Partial<ShapeInfo> = {}): ShapeInfo => ({
  bbox: { min: [0, 0, 0], max: [80, 60, 25] },
  volume: 15552,
  area: 12000,
  solids: 1,
  is_valid: true,
  topology: { faces: 11, edges: 24, vertices: 16 },
  ...over,
});

describe('fingerprint', () => {
  it('is stable for the same facts', () => {
    expect(fingerprint(facts())).toBe(fingerprint(facts()));
  });

  it('is 12 hex characters', () => {
    expect(fingerprint(facts())).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes when any fact changes', () => {
    const base = fingerprint(facts());
    expect(fingerprint(facts({ volume: 15553 }))).not.toBe(base);
    expect(fingerprint(facts({ solids: 2 }))).not.toBe(base);
    expect(fingerprint(facts({ topology: { faces: 12, edges: 24, vertices: 16 } }))).not.toBe(base);
    expect(fingerprint(facts({ bbox: { min: [0, 0, 0], max: [80, 60, 25.5] } }))).not.toBe(base);
  });

  it('ignores movement below the rounding precision', () => {
    // OCCT's own figures move in the last digits between kernel patch versions
    // and CPU architectures; a digest that tracked them would be noise.
    const base = fingerprint(facts());
    const eps = 15552 * 10 ** -(FINGERPRINT_PRECISION + 2);
    expect(fingerprint(facts({ volume: 15552 + eps }))).toBe(base);
  });

  it('sees material that moved without changing any other figure', () => {
    // box 60 40 10 with a 10 x 10 x 4 pocket at x = -15, then at x = +15:
    // volume, area, bbox and counts are equal; only the centre moved.
    const at = (x: number) => facts({ mass: { center: [x, 0, 4.8], inertia: [1e5, 0, 0, 0, 2e5, 0, 0, 0, 2.5e5] } });
    expect(fingerprint(at(0.2542))).not.toBe(fingerprint(at(-0.2542)));
    expect(fingerprint(at(0.2542))).not.toBe(fingerprint(facts()));
  });

  it('reads a centre or a product of inertia that is zero up to noise as zero', () => {
    const m = (c: number, p: number) => facts({ mass: { center: [c, -c, 12.5], inertia: [1e5, p, 0, p, 2e5, 0, 0, 0, 2.5e5] } });
    expect(fingerprint(m(1e-12, 3e-9))).toBe(fingerprint(m(-3e-13, -2e-9)));
  });

  it('does not confuse a zero with a negative zero', () => {
    expect(fingerprint(facts({ bbox: { min: [-0, 0, 0], max: [80, 60, 25] } })))
      .toBe(fingerprint(facts()));
  });
});

const step = (over: Partial<TraceStep> = {}): TraceStep => ({
  index: 1, op: 'box 10 10 10', context: '3D', depth: 0, volume: 1000, solids: 1, faces: 6, ...over,
});

describe('checks', () => {
  it('reports more than one solid', () => {
    const [c] = runChecks([], facts({ solids: 3 }));
    expect(c.code).toBe('check.multiple-solids');
    expect(c.severity).toBe('info');   // several shipped examples are deliberately multi-solid
    expect(c.message).toContain('3 solids');
  });

  it('says nothing about a single valid solid', () => {
    expect(runChecks([], facts())).toEqual([]);
  });

  it('reports an invalid B-Rep', () => {
    expect(runChecks([], facts({ is_valid: false })).map(c => c.code))
      .toContain('check.brep-invalid');
  });

  it('catches a material-removing op that removed nothing', () => {
    const trace = [
      step(),
      step({ index: 2, op: 'faces >Z', context: 'FaceSelection', selected: 1, total: 6 }),
      step({ index: 3, op: 'hole 3', line: 7 }),
    ];
    const [c] = runChecks(trace, facts());
    expect(c.code).toBe('check.no-effect');
    expect(c.message).toContain("'hole 3'");
    expect(c.line).toBe(7);
  });

  it('accepts a hole that did remove material', () => {
    const trace = [step(), step({ index: 2, op: 'hole 3', volume: 900 })];
    expect(runChecks(trace, facts())).toEqual([]);
  });

  it('catches a fillet that changed neither faces nor volume', () => {
    const trace = [step(), step({ index: 2, op: 'fillet 1' })];
    expect(runChecks(trace, facts()).map(c => c.code)).toContain('check.no-effect');
  });

  it('accepts a fillet that added faces', () => {
    const trace = [step(), step({ index: 2, op: 'fillet 1', faces: 14, volume: 999 })];
    expect(runChecks(trace, facts())).toEqual([]);
  });

  it('does not compare across pipeline depths', () => {
    // A nested pipeline builds a tool, not this shape: its volume has no
    // bearing on whether the outer op did anything.
    const trace = [step(), step({ index: 2, op: 'diff [2]', depth: 1 })];
    expect(runChecks(trace, facts())).toEqual([]);
  });
});
