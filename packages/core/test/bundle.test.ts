import { describe, it, expect } from 'vitest';
import { bundleImports, BundleError } from '../src/bundle.js';
import { parse } from '../src/parser.js';

const LIB = [
  '# lib header',
  '@param 1..10',
  'w = 4',
  '',
  'def peg(h) =',
  '  cylinder w h',
  '   | fillet 0.5',
  '',
  '# a demo of the lib',
  'peg(10)',
  '',
  'import "other"',
  'x = 2',
].join('\n');

const files: Record<string, string> = { lib: LIB, 'lib2.poly': 'def two() = 2\n' };
// As the CLI resolves: the extension is optional.
const resolve = (p: string) => files[p] ?? files[`${p}.poly`] ?? null;

describe('bundleImports', () => {
  it('leaves a file without imports untouched', () => {
    const src = 'box 1 1 1\n# c\n';
    expect(bundleImports(src, resolve)).toEqual({ source: src, imported: [] });
  });

  it("inlines an import's defs and assignments, as written", () => {
    const { source, imported } = bundleImports('# main\nimport "lib"\npeg(5)\n', resolve);
    expect(imported).toEqual(['lib']);
    expect(source).toBe([
      '# main',
      '# --- import "lib" (inlined) ---',
      '# lib header',
      '@param 1..10',
      'w = 4',
      '',
      'def peg(h) =',
      '  cylinder w h',
      '   | fillet 0.5',
      '',
      'x = 2',
      '# --- end of "lib" ---',
      'peg(5)',
      '',
    ].join('\n'));
  });

  it("drops the import's shapes with their comments, and its own imports", () => {
    const { source } = bundleImports('import "lib"\n', resolve);
    expect(source).not.toContain('a demo of the lib');
    expect(source).not.toContain('peg(10)');
    expect(source).not.toContain('import "other"');
  });

  it('gives the statements evaluation would take from the import', () => {
    const types = parse(bundleImports('import "lib"\npeg(5)\n', resolve).source).statements.map((s) => s.type);
    expect(types).toEqual(['Assignment', 'FuncDef', 'Assignment', 'FuncCall']);
  });

  it('inlines a path once, however it is spelled', () => {
    const { source, imported } = bundleImports('import "lib2"\nimport "lib2.poly"\ntwo()\n', resolve);
    expect(imported).toEqual(['lib2']);
    expect(source.match(/def two/g)).toHaveLength(1);
    expect(source).toContain('# import "lib2.poly": already inlined above');
  });

  it('reports an import it cannot find, with its line', () => {
    try {
      bundleImports('box 1 1 1\nimport "nope"\n', resolve);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BundleError);
      expect(e).toMatchObject({ path: 'nope', line: 2 });
    }
  });
});
