/**
 * Inline `import`s, for places that hold a single file: the Live editor (its
 * URL carries one source) and objhub (one source per object).
 *
 * The result means what the original does because an import only ever
 * contributes its top-level `def`s and assignments (Evaluator.evalImport); its
 * shapes and its own imports are skipped. Exactly those statements are copied,
 * as written, where the `import` line was. Everything else in the main file is
 * kept byte for byte.
 */
import { parse } from './parser.js';
import type { Statement } from './ast.js';

export interface BundleResult {
  source: string;
  /** Import paths as written, in the order they were inlined. */
  imported: string[];
}

export class BundleError extends Error {
  constructor(message: string, readonly path: string, readonly line?: number) {
    super(message);
  }
}

/** First line of a statement, counting an @param annotation above it. */
function startLine(s: Statement): number {
  const own = s.loc?.line ?? 1;
  const ann = s.type === 'Assignment' ? s.annotation?.loc?.line : undefined;
  return ann !== undefined ? Math.min(own, ann) : own;
}

const isCommentOrBlank = (line: string) => /^\s*(#.*)?$/.test(line);

/**
 * Each top-level statement's lines, 0-based [from, to). A run of comment and
 * blank lines directly above a statement belongs to it, so a comment goes
 * wherever its statement goes.
 */
function statementSpans(lines: string[], statements: Statement[]): [number, number][] {
  const starts = statements.map((s) => {
    let from = startLine(s) - 1;
    while (from > 0 && isCommentOrBlank(lines[from - 1])) from--;
    return from;
  });
  // Blank lines go back to the gap between statements, not into one.
  return starts.map((from, i) => {
    let to = i + 1 < starts.length ? starts[i + 1] : lines.length;
    while (to > from && lines[to - 1].trim() === '') to--;
    while (from < to && lines[from].trim() === '') from++;
    return [from, to];
  });
}

/** The `def`s and assignments of an imported file, as written. */
function importedText(path: string, source: string): string {
  let statements: Statement[];
  try {
    statements = parse(source).statements;
  } catch (e) {
    throw new BundleError(`cannot parse import "${path}": ${(e as Error).message}`, path);
  }
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const spans = statementSpans(lines, statements);
  return statements
    .flatMap((s, i) => (s.type === 'FuncDef' || s.type === 'Assignment'
      ? [lines.slice(spans[i][0], spans[i][1]).join('\n')]
      : []))
    .join('\n\n');
}

/**
 * Replace each top-level `import "x"` with the definitions it brings in.
 *
 * `resolve` returns the imported file's source, or null when there is none.
 * A path imported twice is inlined once, at its first import. Imports inside
 * an imported file are dropped, as evaluation ignores them.
 */
export function bundleImports(
  source: string,
  resolve: (path: string) => string | null,
): BundleResult {
  const program = parse(source);
  const imports = program.statements.filter((s) => s.type === 'Import');
  if (imports.length === 0) return { source, imported: [] };

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const seen = new Set<string>();
  const imported: string[] = [];
  // Bottom-up, so earlier line numbers stay valid while splicing.
  const ordered = [...imports].sort((a, b) => (b.loc?.line ?? 0) - (a.loc?.line ?? 0));
  const replacement = new Map<number, string[]>();
  for (const stmt of [...ordered].reverse()) {
    if (stmt.type !== 'Import') continue;
    const line = stmt.loc?.line ?? 1;
    const key = stmt.path.replace(/\.poly$/, '');
    if (seen.has(key)) {
      replacement.set(line, [`# import "${stmt.path}": already inlined above`]);
      continue;
    }
    seen.add(key);
    const text = resolve(stmt.path);
    if (text === null) throw new BundleError(`cannot find import "${stmt.path}"`, stmt.path, line);
    imported.push(stmt.path);
    replacement.set(line, [
      `# --- import "${stmt.path}" (inlined) ---`,
      importedText(stmt.path, text),
      `# --- end of "${stmt.path}" ---`,
    ]);
  }
  for (const stmt of ordered) {
    const line = stmt.loc?.line ?? 1;
    lines.splice(line - 1, 1, ...replacement.get(line)!);
  }
  return { source: lines.join('\n'), imported };
}
