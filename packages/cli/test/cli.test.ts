import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(import.meta.dirname, '..', 'dist', 'index.js');

function run(args: string[]): { stdout: string; code: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout, code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? '', code: err.status ?? 1 };
  }
}

const tmpFile = join(tmpdir(), 'polyscript-cli-test.poly');

describe('CLI', () => {
  it('check — valid file', () => {
    writeFileSync(tmpFile, 'box 10 10 10 | fillet 2');
    const { stdout, code } = run(['check', tmpFile]);
    expect(code).toBe(0);
    expect(stdout).toContain('OK');
    unlinkSync(tmpFile);
  });

  it('check — syntax error', () => {
    writeFileSync(tmpFile, 'box | | |');
    const { code } = run(['check', tmpFile]);
    expect(code).toBe(2);
    unlinkSync(tmpFile);
  });

  it('dump-ast — outputs JSON', () => {
    writeFileSync(tmpFile, 'sphere 10');
    const { stdout, code } = run(['dump-ast', tmpFile]);
    expect(code).toBe(0);
    const ast = JSON.parse(stdout);
    expect(ast.type).toBe('Program');
    expect(ast.statements[0].type).toBe('SphereExpr');
    unlinkSync(tmpFile);
  });

  it('dump-ast --pretty — formatted JSON', () => {
    writeFileSync(tmpFile, 'box 1 2 3');
    const { stdout, code } = run(['dump-ast', tmpFile, '--pretty']);
    expect(code).toBe(0);
    expect(stdout).toContain('\n'); // formatted
    unlinkSync(tmpFile);
  });

  it('build -o .svg — a line drawing, not an STL', () => {
    writeFileSync(tmpFile, 'box 100 60 40');
    const out = join(tmpdir(), 'polyscript-cli-test.svg');
    const { code } = run(['build', tmpFile, '-o', out]);
    expect(code).toBe(0);
    const svg = readFileSync(out, 'utf-8');
    expect(svg.startsWith('<svg')).toBe(true);
    // Four panels by default, and the footer carries the modelled size.
    for (const label of ['Front', 'Top', 'Right', 'Iso']) expect(svg).toContain(`>${label}</text>`);
    expect(svg).toContain('100 × 60 × 40 (X×Y×Z)');
    unlinkSync(out);
    unlinkSync(tmpFile);
  });

  it('build --view — one named panel', () => {
    writeFileSync(tmpFile, 'box 100 60 40');
    const out = join(tmpdir(), 'polyscript-cli-test-one.svg');
    const { code } = run(['build', tmpFile, '-o', out, '--view', 'iso']);
    expect(code).toBe(0);
    const svg = readFileSync(out, 'utf-8');
    // A single view carries no panel label, no size footer and, by default,
    // no gnomon.
    expect(svg).not.toContain('>Iso</text>');
    expect(svg).not.toContain('(X×Y×Z)');
    expect(svg).not.toContain('>Z</text>');
    unlinkSync(out);
    unlinkSync(tmpFile);
  });

  it('build --axes draws the XYZ gnomon', () => {
    writeFileSync(tmpFile, 'box 100 60 40');
    const out = join(tmpdir(), 'polyscript-cli-test-axes.svg');
    const { code } = run(['build', tmpFile, '-o', out, '--view', 'iso', '--axes']);
    expect(code).toBe(0);
    const svg = readFileSync(out, 'utf-8');
    for (const axis of ['X', 'Y', 'Z']) expect(svg).toContain(`>${axis}</text>`);
    unlinkSync(out);
    unlinkSync(tmpFile);
  });

  it('build --view — an unknown name is refused', () => {
    writeFileSync(tmpFile, 'box 10 10 10');
    const out = join(tmpdir(), 'polyscript-cli-test-bad.svg');
    const { code } = run(['build', tmpFile, '-o', out, '--view', 'oblique']);
    expect(code).toBe(1);
    unlinkSync(tmpFile);
  });

  it('check — missing file', () => {
    const { code } = run(['check', join(tmpdir(), 'nonexistent.poly')]);
    expect(code).toBe(1);
  });
});

describe('live', () => {
  function live(source: string, extra: string[] = []) {
    const f = join(tmpdir(), 'polyscript-cli-live.poly');
    writeFileSync(f, source);
    const r = spawnSync('node', [CLI, 'live', f, '--print', ...extra], { encoding: 'utf-8' });
    unlinkSync(f);
    return { stdout: r.stdout.trim(), stderr: r.stderr, code: r.status };
  }

  it('prints the editor URL with the source in ?code=', () => {
    const src = 'box 30 20 10 | fillet 2\n# 角 & ?\n';
    const { stdout, stderr, code } = live(src);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const url = new URL(stdout);
    expect(url.origin).toBe('https://live.objhub.org');
    expect(url.searchParams.get('code')).toBe(src);
  });

  it("inlines imports, since the editor cannot read the disk", () => {
    const lib = join(tmpdir(), 'polyscript-cli-live-lib.poly');
    writeFileSync(lib, 'def peg($h) = cylinder 2 $h\npeg(1)\n');
    const { stdout, stderr, code } = live('import "polyscript-cli-live-lib"\npeg(10)\n');
    unlinkSync(lib);
    expect(code).toBe(0);
    expect(stderr).toContain('inlined "polyscript-cli-live-lib"');
    const src = new URL(stdout).searchParams.get('code')!;
    expect(src).toContain('def peg($h) = cylinder 2 $h');
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toContain('peg(1)\n');
  });

  it('stops when an import cannot be found', () => {
    const { stdout, stderr, code } = live('import "no-such-lib"\nbox 1 1 1\n');
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('live.import');
    expect(stderr).toContain(':1:1');
  });

  it('warns when the URL exceeds the server limit', () => {
    const { stderr, code } = live(`box 1 1 1\n# ${'x'.repeat(17000)}\n`);
    expect(code).toBe(0);
    expect(stderr).toContain('live.too-long');
  });

  it('--json reports the URL, what was inlined and the diagnostics as one object', () => {
    const lib = join(tmpdir(), 'polyscript-cli-live-lib2.poly');
    writeFileSync(lib, 'w = 3\n');
    const { stdout, code } = live('import "polyscript-cli-live-lib2"\nbox w w w\n', ['--json']);
    unlinkSync(lib);
    expect(code).toBe(0);
    const r = JSON.parse(stdout);
    expect(r).toMatchObject({ ok: true, phase: 'live', inlined: ['polyscript-cli-live-lib2'], diagnostics: [] });
    expect(new URL(r.url).searchParams.get('code')).toContain('w = 3');
  });
});
