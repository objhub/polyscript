/**
 * Tests for the agent-facing surface: `verify` (one call, one report),
 * `diff` (did the edit change the geometry), `explain` (the long form of a
 * code), and the structured diagnostics all of them emit.
 *
 * These spawn the real CLI (dist build) because exit codes, stream separation
 * and the JSON payload are the contract.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(import.meta.dirname, '..', 'dist', 'index.js');

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf-8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? 1 };
}

let dir: string;
const f = (name: string) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'poly-cli-verify-'));
  writeFileSync(f('good.poly'), 'box 60 40 30\n  | faces ">Z"\n  | shell 2\n');
  // Same shape, written differently: the fingerprint must not notice.
  writeFileSync(f('same.poly'), 'w = 60\nbox w 40 30 | faces ">Z" | shell 2\n');
  writeFileSync(f('bigger.poly'), 'box 60 40 32\n  | faces ">Z"\n  | shell 2\n');
  writeFileSync(f('warn.poly'), 'box 60 40 30 | faces "Z" | shell 2\n');
  writeFileSync(f('empty-sel.poly'), 'box 10 10 10\n  | edges ">Z and =Z"\n  | fillet 1\n');
  writeFileSync(f('ctx.poly'), 'box 10 10 10\n  | extrude 5\n');
  writeFileSync(f('syntax.poly'), 'box 10 |\n');
  writeFileSync(f('two-parts.poly'), 'box 10 10 10\nbox 10 10 10 | translate 50 0 0\n');
  writeFileSync(f('lib-only.poly'), 'def cube(s) = box s s s\n');
}, 30000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('verify', () => {
  it('reports trace, shape facts, fingerprint and checks in one JSON call', () => {
    const r = run(['verify', f('good.poly'), '--json']);
    expect(r.code).toBe(0);
    const d = JSON.parse(r.stdout);
    expect(d.ok).toBe(true);
    expect(d.shape.solids).toBe(1);
    expect(d.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(Array.isArray(d.trace)).toBe(true);
    expect(Array.isArray(d.checks)).toBe(true);
    expect(d.diagnostics).toEqual([]);
  }, 120000);

  it('carries the source line and the geometry of each selection', () => {
    // The count alone cannot tell `>Z` (the top) from `+Z` (the sides); the
    // normal can, without rendering anything.
    const r = run(['verify', f('good.poly'), '--json']);
    const sel = JSON.parse(r.stdout).trace.find((s: any) => s.op.startsWith('faces'));
    expect(sel.line).toBe(2);
    expect(sel.selected).toBe(1);
    expect(sel.selection.kind).toBe('face');
    expect(sel.selection.normal).toEqual([0, 0, 1]);
    expect(sel.selection.centroid[2]).toBeCloseTo(15, 6);
    expect(sel.selection.area).toBeCloseTo(2400, 3);
  }, 120000);

  it('is strict by default and exits 3 on a warning', () => {
    const r = run(['verify', f('warn.poly'), '--json']);
    expect(r.code).toBe(3);
    const d = JSON.parse(r.stdout);
    expect(d.ok).toBe(false);
    expect(d.diagnostics[0].code).toBe('selector.unknown');
  }, 120000);

  it('--no-strict reports the same warning and exits 0', () => {
    const r = run(['verify', f('warn.poly'), '--no-strict', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).diagnostics[0].code).toBe('selector.unknown');
  }, 120000);

  it('flags a result that is more than one solid, without failing', () => {
    const r = run(['verify', f('two-parts.poly'), '--json']);
    expect(r.code).toBe(0);
    const checks = JSON.parse(r.stdout).checks;
    expect(checks.map((c: any) => c.code)).toContain('check.multiple-solids');
    expect(checks.every((c: any) => c.severity === 'info')).toBe(true);
  }, 120000);

  it('reports a library-only file as having no shape, not as a failure', () => {
    const r = run(['verify', f('lib-only.poly'), '-o', f('lib.stl'), '--json']);
    expect(r.code).toBe(0);
    const d = JSON.parse(r.stdout);
    expect(d.shape).toBeNull();
    expect(d.fingerprint).toBeUndefined();
    expect(existsSync(f('lib.stl'))).toBe(false);
  }, 120000);

  it('writes no file unless -o is given', () => {
    run(['verify', f('good.poly')]);
    expect(existsSync(f('good.stl'))).toBe(false);
    const r = run(['verify', f('good.poly'), '-o', f('good.stl')]);
    expect(r.code).toBe(0);
    expect(existsSync(f('good.stl'))).toBe(true);
  }, 120000);
});

describe('diagnostics', () => {
  it('an empty selector is an error with a code, a position and a fix', () => {
    const r = run(['verify', f('empty-sel.poly'), '--json']);
    expect(r.code).toBe(4);
    const [d] = JSON.parse(r.stdout).diagnostics;
    expect(d.code).toBe('selector.empty');
    expect(d.severity).toBe('error');
    expect(d.line).toBe(2);
    expect(d.hint).toBeTruthy();
    // Reported in the notation it was written in, not the kernel's internal
    // form (`=Z` normalises to `|Z` on the way in).
    expect(d.message).toContain('=Z');
    expect(d.message).not.toContain('|Z');
  }, 120000);

  it('a context error is reported by check --json without touching the kernel', () => {
    const r = run(['check', f('ctx.poly'), '--json']);
    expect(r.code).toBe(3);
    const [d] = JSON.parse(r.stdout).diagnostics;
    expect(d.code).toBe('context.invalid-op');
    expect(d.line).toBe(2);
    expect(d.hint).toContain('faces');
  });

  it('a parse error carries its position', () => {
    const r = run(['check', f('syntax.poly'), '--json']);
    expect(r.code).toBe(2);
    const [d] = JSON.parse(r.stdout).diagnostics;
    expect(d.code).toBe('syntax.parse');
    expect(d.line).toBe(1);
  });

  it('every emitted code has an explanation', () => {
    const codes = run(['explain']).stdout.match(/^ {2}(\S+)$/gm)!.map((s) => s.trim());
    expect(codes.length).toBeGreaterThan(5);
    for (const c of codes) {
      const r = run(['explain', c]);
      expect(r.code, c).toBe(0);
      expect(r.stdout, c).toContain('Fix');
    }
  });

  it('an unknown code is refused with the list of known ones', () => {
    const r = run(['explain', 'nope.nope']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Known codes');
  });
});

describe('diff', () => {
  it('calls a rewrite that keeps the geometry identical', () => {
    const r = run(['diff', f('good.poly'), f('same.poly'), '--json']);
    expect(r.code).toBe(0);
    const d = JSON.parse(r.stdout);
    expect(d.same).toBe(true);
    expect(d.changes).toEqual([]);
  }, 120000);

  it('names the fields that moved', () => {
    const r = run(['diff', f('good.poly'), f('bigger.poly'), '--json']);
    const d = JSON.parse(r.stdout);
    expect(d.same).toBe(false);
    const fields = d.changes.map((c: any) => c.field);
    expect(fields).toContain('volume');
    expect(fields).toContain('bbox.max.z');
    const vol = d.changes.find((c: any) => c.field === 'volume');
    expect(vol.to).toBeGreaterThan(vol.from);
    expect(vol.delta).toMatch(/^\+/);
  }, 120000);
});

describe('assert and measure', () => {
  const src = '$b = box 60 40 30 | faces ">Z" | shell 2\n';
  beforeAll(() => {
    writeFileSync(f('asserted.poly'), src + 'assert $b.solids == 1\nassert $b.bbox.z ~ 30\n$b\n');
    writeFileSync(f('contradicted.poly'), src + 'assert $b.solids == 2\nprint "vol" $b.volume\n$b\n');
  });

  it('verify passes a model whose assertions hold, with the asserts in the trace', () => {
    const r = run(['verify', f('asserted.poly'), '--json']);
    expect(r.code).toBe(0);
    const d = JSON.parse(r.stdout);
    expect(d.ok).toBe(true);
    const rows = d.trace.filter((s: { op: string }) => s.op.startsWith('assert'));
    expect(rows.map((s: { context: string }) => s.context)).toEqual(['pass', 'pass']);
  });

  it('verify reports a failed assertion with both sides, still shows the trace, and exits 3', () => {
    const r = run(['verify', f('contradicted.poly'), '--json']);
    expect(r.code).toBe(3);
    const d = JSON.parse(r.stdout);
    expect(d.ok).toBe(false);
    expect(d.phase).toBe('assert');
    // faces, shell, and the assert itself as a row.
    expect(d.trace.map((s: { op: string; context: string }) => s.context)).toEqual(['FaceSelection', '3D', 'FAIL']);
    expect(d.shape.solids).toBe(1);
    const failed = d.diagnostics.find((x: { code: string }) => x.code === 'assert.failed');
    expect(failed.severity).toBe('error');
    expect(failed.message).toBe('assert $b.solids == 2 failed (left: 1, right: 2)');
    expect(failed.line).toBe(2);
    const printed = d.diagnostics.find((x: { code: string }) => x.code === 'print');
    expect(printed.severity).toBe('info');
    expect(printed.message).toMatch(/^vol \d/);
  });

  it('build writes nothing when an assertion fails', () => {
    const out = f('contradicted.stl');
    const r = run(['build', f('contradicted.poly'), '-o', out]);
    expect(r.code).toBe(3);
    expect(existsSync(out)).toBe(false);
    expect(r.stderr).toContain('assert.failed');
  });

  it('measure answers a query against the built model', () => {
    expect(run(['measure', f('asserted.poly'), '$b.bbox.z']).stdout.trim()).toBe('30');
    expect(run(['measure', f('asserted.poly'), '$b.solids == 1']).stdout.trim()).toBe('true');
    const r = run(['measure', f('asserted.poly'), '($b | faces ">Z").solids', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).value).toBe(1);
  });

  it('measure refuses an unknown property with the list that applies', () => {
    const r = run(['measure', f('asserted.poly'), '$b.weight', '--json']);
    expect(r.code).toBe(4);
    const [d] = JSON.parse(r.stdout).diagnostics;
    expect(d.code).toBe('attr.unknown');
    expect(d.hint).toContain('.volume');
  });
});

describe('ops', () => {
  it('lists every operation with its signature', () => {
    const r = run(['ops']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^thread r pitch h +center: at: angle: land: depth: chamfer: +external thread/m);
  });

  it('prints one operation in full, and as JSON', () => {
    const r = run(['ops', 'hole']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('depth:');
    expect(r.stdout).toContain('FaceSelection');
    const j = JSON.parse(run(['ops', 'extrude', '--json']).stdout);
    expect(j.ops[0].named[0].key).toBe('draft');
    expect(j.ops[0].from.find((f: { context: string }) => f.context === 'Face').to).toBe('3D');
  });

  it('refuses an unknown operation with the list of known ones', () => {
    const r = run(['ops', 'nope']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Known:');
  });

  it('check reports a named argument the operation does not read', () => {
    writeFileSync(f('typo.poly'), 'thread 8 2 30 chamfar:true\n');
    const r = run(['check', f('typo.poly'), '--json']);
    expect(r.code).toBe(3);
    const [d] = JSON.parse(r.stdout).diagnostics;
    expect(d.code).toBe('arg.unknown-option');
    expect(d.hint).toBe("did you mean 'chamfer:'?");
  });
});
