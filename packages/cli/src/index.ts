#!/usr/bin/env node
/**
 * PolyScript CLI — poly command
 *
 * Every failure leaves through one channel: a `Diagnostic` with a stable code,
 * a source position when one is known, and a fix in `hint`. `--json` prints
 * them verbatim, the human path renders them one per line. Nothing is reported
 * as bare prose that a caller then has to pattern-match.
 */

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname, resolve, extname, relative } from 'node:path';
import { Command } from 'commander';
import {
  parse, ParseError, validate, evaluate, resultShape, resultColorParts,
  extractParams, unknownParamOptions, PARAM_OPTIONS, Trace, drainDiagnostics, makeDiagnostic, formatDiagnostic, explain,
  DIAGNOSTIC_CODES, asDiagnosticCode, fingerprint, runChecks, bundleImports, BundleError,
} from '@polyscript/core';
import type { Value, Diagnostic, ValidationError, Program, EvalError } from '@polyscript/core';
import { buildOverrides, unknownParams, checkOverrideTypes, commentedParamLines } from './params.js';
// package.json is the single source of truth for the version. The import
// attribute is required by Node's and Deno's ESM loaders and permitted by
// tsconfig's `module: NodeNext`; bun build --compile inlines it, so the
// compiled binary reports the version without reading any file at runtime.
import pkg from '../package.json' with { type: 'json' };

const VERSION = pkg.version;
export { parseCliValue, buildOverrides, unknownParams, checkOverrideTypes, commentedParamLines } from './params.js';

const EXIT_OK = 0;
const EXIT_IO = 1;
const EXIT_SYNTAX = 2;
const EXIT_SEMANTIC = 3;
const EXIT_EXPORT = 4;

// ---------------------------------------------------------------------------
// Diagnostics plumbing
// ---------------------------------------------------------------------------

function parseDiagnostic(e: ParseError): Diagnostic {
  return makeDiagnostic('syntax.parse', 'error', e.message, {
    loc: { line: e.line, column: e.column },
  });
}

function validationDiagnostics(errors: ValidationError[]): Diagnostic[] {
  return errors.map((e) => makeDiagnostic('context.invalid-op', 'error', e.message, {
    hint: e.hint,
    loc: e.line !== undefined ? { line: e.line, column: e.column ?? 0 } : undefined,
  })).map((d, i) => ({ ...d, code: errors[i].code }));
}

/** Kernel-level throws: the code and the fix ride along on the error. */
function evalDiagnostic(e: Error): Diagnostic {
  const c = e as EvalError;
  return makeDiagnostic(asDiagnosticCode(c.code) ?? 'eval.error', 'error', c.rawMessage ?? e.message, {
    hint: c.hint,
    loc: c.loc,
  });
}

function printDiagnostics(diags: Diagnostic[], file: string): void {
  for (const d of diags) console.error(formatDiagnostic(d, file));
}

/** Print the machine-readable payload (--json) or the human lines. Mirrors
 *  the Python CLI's _emit so the two implementations' output stays
 *  interchangeable for tooling. */
function emit(asJson: boolean, payload: Record<string, unknown>, lines: string[]): void {
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const l of lines) console.log(l);
  }
}

// Several top-level shapes mean their union (see resultShape in core). This
// used to build a compound here instead, so `poly info`/`build -v` disagreed
// with both the regression harness and the browser bundle.
/** Extensions that already name each format, so `-o out.stp --format step`
 *  does not become `out.stp.step`. */
const FORMAT_EXTENSIONS: Record<string, string[]> = {
  stl: ['.stl'],
  step: ['.step', '.stp'],
  glb: ['.glb'],
  // Listed so `-o x.gltf` keeps its name and reaches exportShape, which
  // explains that OCCT writes the binary container and .glb is the extension.
  // Without this the unknown extension fell back to STL and silently produced
  // x.gltf.stl.
  gltf: ['.gltf'],
  // A line drawing, not a solid: OCCT hidden-line removal per view. Listed
  // here so `-o x.svg` renders one instead of falling back to STL.
  svg: ['.svg'],
  // The same drawing rasterised, for readers that take no SVG. Shares every
  // --view / --view-size / --no-hidden option with it.
  png: ['.png'],
};

function formatFromExtension(file: string): string {
  const f = file.toLowerCase();
  for (const [fmt, exts] of Object.entries(FORMAT_EXTENSIONS)) {
    if (exts.some((e) => f.endsWith(e))) return fmt;
  }
  return 'stl';
}

function formatShapeInfo(info: ShapeInfoLike | null): string[] {
  if (!info) return [];
  return [
    `bbox: [${info.bbox.min.join(', ')}] - [${info.bbox.max.join(', ')}]`,
    `volume: ${info.volume.toFixed(2)}`,
    `area: ${info.area.toFixed(2)}`,
    `solids: ${info.solids}   valid: ${info.is_valid ? 'True' : 'False'}`,
    `topology: ${info.topology.faces} faces, ${info.topology.edges} edges, ${info.topology.vertices} vertices`,
  ];
}

interface ShapeInfoLike {
  bbox: { min: [number, number, number]; max: [number, number, number] };
  volume: number;
  area: number;
  solids: number;
  is_valid: boolean;
  topology: { faces: number; edges: number; vertices: number };
}

function readInput(file: string): string {
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    console.error(formatDiagnostic(
      makeDiagnostic('io.read', 'error', `cannot read file '${file}'`),
    ));
    return process.exit(EXIT_IO);
  }
}

/** Import resolver — loads .poly files relative to source directory. */
function makeImportResolver(sourceDir: string): (path: string) => string | null {
  const resolvedSourceDir = resolve(sourceDir);

  return (importPath: string) => {
    // Reject absolute paths
    if (importPath.startsWith('/') || importPath.startsWith('\\')) {
      throw new Error(`Absolute import path not allowed: "${importPath}"`);
    }
    // Reject parent directory traversal
    if (importPath.includes('..')) {
      throw new Error(`Parent directory traversal not allowed in import: "${importPath}"`);
    }

    const name = importPath.endsWith('.poly') ? importPath : `${importPath}.poly`;
    const fullPath = resolve(resolvedSourceDir, name);

    // Verify resolved path stays within source directory
    const rel = relative(resolvedSourceDir, fullPath);
    if (rel.startsWith('..') || rel.startsWith('/')) {
      throw new Error(`Import path escapes source directory: "${importPath}"`);
    }

    try {
      return readFileSync(fullPath, 'utf-8');
    } catch {
      return null;
    }
  };
}

// ---------------------------------------------------------------------------
// Shared load-and-evaluate path
// ---------------------------------------------------------------------------

interface LoadOptions {
  define?: string[];
  paramsFile?: string;
  trace?: boolean;
  timing?: boolean;
  json?: boolean;
}

interface LoadedModel {
  oc: any;
  result: Value;
  shape: any | null;
  info: ShapeInfoLike | null;
  fingerprint?: string;
  /** Warnings and infos gathered so far. Errors never come back here -- they
   *  leave through `fail`. */
  diagnostics: Diagnostic[];
  trace?: Trace;
  timing: Record<string, number>;
}

/**
 * Parse, validate, evaluate, and measure — the part every subcommand needs.
 *
 * On failure it emits the report and exits with the phase's code, so callers
 * only ever see a model that built.
 */
async function loadModel(file: string, opts: LoadOptions): Promise<LoadedModel> {
  const asJson = !!opts.json;
  const name = basename(file);
  const timing: Record<string, number> = {};
  let mark = performance.now();
  const lap = (stage: string) => {
    const now = performance.now();
    timing[stage] = Math.round((now - mark) * 10) / 10;
    mark = now;
  };

  const diagnostics: Diagnostic[] = [];
  const fail = (phase: string, errors: Diagnostic[], code: number): never => {
    const all = [...diagnostics, ...errors];
    printDiagnostics(all, name);
    emit(asJson, { ok: false, phase, file: name, diagnostics: all }, []);
    return process.exit(code) as never;
  };

  const source = readInput(file);
  const overrides = buildOverrides(opts.define ?? [], opts.paramsFile, (msg) => {
    console.error(msg);
    return process.exit(EXIT_IO) as never;
  });
  if (Object.keys(overrides).length > 0) {
    let declared: Parameters<typeof checkOverrideTypes>[2] = [];
    try {
      declared = extractParams(source).params;
    } catch {
      // a parse error is reported by the parse phase below
    }
    const found = checkOverrideTypes(opts.define ?? [], overrides, declared);
    const toDiag = (e: (typeof found)[number]) =>
      makeDiagnostic(e.code, e.code === 'param.range' ? 'warning' : 'error', e.message, { hint: e.hint });
    diagnostics.push(...found.filter(e => e.code === 'param.range').map(toDiag));
    const typeErrors = found.filter(e => e.code !== 'param.range');
    if (typeErrors.length > 0) {
      fail('params', typeErrors.map(toDiag), EXIT_IO);
    }
  }
  diagnostics.push(...commentedParamDiagnostics(source));
  for (const p of unknownParams(source, overrides, extractParams)) {
    diagnostics.push(makeDiagnostic('param.unknown', 'warning',
      `-D ${p}: no top-level assignment found in input`,
      { hint: 'declare it as a parameter, or check the spelling against the file' }));
  }

  let ast: Program;
  try {
    ast = parse(source);
  } catch (e) {
    if (e instanceof ParseError) fail('parse', [parseDiagnostic(e)], EXIT_SYNTAX);
    throw e;
  }
  const errors = validate(ast);
  lap('parse');
  if (errors.length > 0) {
    fail('validate', validationDiagnostics(errors), EXIT_SEMANTIC);
  }

  const { initOC, shapeInfo } = await import('@polyscript/core/ocp-kernel');
  let oc: any;
  try {
    oc = await initOC();
    lap('init');
  } catch (err) {
    fail('evaluate', [makeDiagnostic('eval.error', 'error',
      `failed to initialize OpenCascade: ${err}`)], EXIT_EXPORT);
  }

  const trace = opts.trace ? new Trace({ timing: !!opts.timing }) : undefined;
  let result: Value;
  try {
    result = evaluate(ast, oc, {
      importResolver: makeImportResolver(dirname(resolve(file))),
      parseFn: parse,
      overrides,
      trace,
    });
    lap('evaluate');
  } catch (e) {
    diagnostics.push(...drainDiagnostics());
    if (e instanceof ParseError) fail('parse', [parseDiagnostic(e)], EXIT_SYNTAX);
    if (e instanceof Error) fail('evaluate', [evalDiagnostic(e)], EXIT_EXPORT);
    throw e;
  }
  diagnostics.push(...drainDiagnostics());

  const shape = resultShape(oc, result);
  let info: ShapeInfoLike | null = null;
  if (shape) {
    try { info = shapeInfo(oc, shape); } catch { /* best-effort */ }
  }

  return {
    oc, result, shape, info,
    fingerprint: info ? fingerprint(info) : undefined,
    diagnostics, trace, timing,
  };
}

/** `1 solid  bbox 80x60x25  volume 15552.0  faces 11  fp 3f2a91b0c4d1` */
function summaryLine(m: LoadedModel): string {
  if (!m.info) return 'evaluated (no shape)';
  const size = m.info.bbox.max.map((v, i) => round2(v - m.info!.bbox.min[i])).join('x');
  return [
    `${m.info.solids} solid${m.info.solids === 1 ? '' : 's'}`,
    `bbox ${size}`,
    `volume ${m.info.volume.toFixed(1)}`,
    `faces ${m.info.topology.faces}`,
    `valid ${m.info.is_valid}`,
    `fp ${m.fingerprint}`,
  ].join('  ');
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Warnings fail the build under --strict; infos never do. */
function strictFailure(diags: Diagnostic[]): Diagnostic[] {
  return diags.filter((d) => d.severity === 'warning');
}

const program = new Command();

program
  .name('poly')
  .description('PolyScript — Parametric CAD DSL')
  .version(VERSION);

/** `# @param` above an assignment (a comment, not an annotation), and
 *  @param option keys the annotation does not have. */
function commentedParamDiagnostics(source: string): Diagnostic[] {
  const out = commentedParamLines(source).map(line => makeDiagnostic('param.commented', 'warning',
    "'# @param' is a comment, so the next variable is not a parameter",
    { hint: "drop the '#': '@param 1..10 desc:\"...\"' on the line above the assignment", loc: { line, column: 1 } }));
  let unknown: { key: string; line: number }[] = [];
  try {
    unknown = unknownParamOptions(source);
  } catch {
    // a parse error is reported by the parse phase
  }
  for (const u of unknown) {
    out.push(makeDiagnostic('param.unknown-option', 'warning',
      `@param has no option '${u.key}'; it is ignored`,
      { hint: `options: ${PARAM_OPTIONS.join(' ')}`, loc: { line: u.line, column: 1 } }));
  }
  return out;
}

// check subcommand
program
  .command('check <file>')
  .description('Parse and validate a .poly file (no geometry kernel)')
  .option('--json', 'Machine-readable JSON report on stdout')
  .action((file: string, opts: { json?: boolean }) => {
    const source = readInput(file);
    const name = basename(file);
    const asJson = !!opts.json;
    try {
      const ast = parse(source);
      const errors = validate(ast);
      if (errors.length > 0) {
        const diags = validationDiagnostics(errors);
        printDiagnostics(diags, name);
        console.error(`✗ ${name}: ${errors.length} validation error(s)`);
        emit(asJson, { ok: false, phase: 'validate', file: name, diagnostics: diags }, []);
        process.exit(EXIT_SEMANTIC);
      }
      const warnings = commentedParamDiagnostics(source);
      if (!asJson) printDiagnostics(warnings, name);
      emit(asJson, { ok: true, phase: 'validate', file: name, diagnostics: warnings },
        [`✓ ${name}: OK`]);
      process.exit(EXIT_OK);
    } catch (e) {
      if (e instanceof ParseError) {
        const d = parseDiagnostic(e);
        printDiagnostics([d], name);
        emit(asJson, { ok: false, phase: 'parse', file: name, diagnostics: [d] }, []);
        process.exit(EXIT_SYNTAX);
      }
      throw e;
    }
  });

// dump-ast subcommand
program
  .command('dump-ast <file>')
  .description('Dump AST as JSON')
  .option('--pretty', 'Pretty-print JSON output')
  .action((file: string, opts: { pretty?: boolean }) => {
    const source = readInput(file);
    try {
      const ast = parse(source);
      const indent = opts.pretty ? 2 : undefined;
      console.log(JSON.stringify(ast, null, indent));
      process.exit(EXIT_OK);
    } catch (e) {
      if (e instanceof ParseError) {
        printDiagnostics([parseDiagnostic(e)], basename(file));
        process.exit(EXIT_SYNTAX);
      }
      throw e;
    }
  });

// build (default) subcommand
program
  .command('build <file>', { isDefault: true })
  .description('Build a .poly file to STL/STEP/glTF/SVG')
  .option('-o <output>', 'Output file path')
  .option('--format <fmt>', 'Output format (stl|step|glb|svg|png)')
  .option(
    '-D, --define <value>',
    'Override parameter (repeatable: -D width=100 -D height=50)',
    (v: string, prev: string[] = []) => [...prev, v],
    [] as string[],
  )
  .option('--params-file <path>', 'JSON file with parameter overrides (merged with -D; -D takes precedence)')
  .option('--trace', 'Print per-step metrics (source line, selection, volume, solids)')
  .option('--timing', 'Print stage timings (init/parse/evaluate/export) to stderr; adds an ms column to --trace')
  .option('--strict', 'Treat warnings as errors (exit 3)')
  .option('--json', 'Machine-readable JSON report on stdout')
  .option('--mesh-deflection <value>', 'STL/glTF mesh precision (default 0.1; larger = coarser)', parseFloat)
  .option('--ascii-stl', 'Write ASCII STL instead of binary (about 6x larger; diff-friendly)')
  .option(
    '--view <names>',
    'SVG/PNG viewpoints, comma-separated (front|back|top|bottom|left|right|iso). '
    + 'One name draws a single panel; the default is front,top,right,iso',
  )
  .option('--view-size <px>', 'SVG/PNG panel size in px (default 240)', parseFloat)
  .option('--no-hidden', 'SVG/PNG: omit occluded edges instead of dashing them')
  .option('--axes', 'SVG/PNG: draw an XYZ axis gnomon in each panel (off by default; a PNG without it is greyscale)')
  .option(
    '--png-scale <n>',
    'PNG supersampling, 1-4 (default 2). Sharpens lines; does not change the image size',
    parseFloat,
  )
  .option('-v, --verbose', 'Print B-Rep facts about the result')
  .action(async (file: string, opts: {
    o?: string; format?: string; define?: string[]; paramsFile?: string;
    trace?: boolean; timing?: boolean; strict?: boolean; json?: boolean; meshDeflection?: number; verbose?: boolean;
    asciiStl?: boolean; view?: string; viewSize?: number; hidden?: boolean; axes?: boolean; pngScale?: number;
  }) => {
    const name = basename(file);
    const m = await loadModel(file, opts);
    const { exportShape, SVG_VIEWS } = await import('@polyscript/core/ocp-kernel');

    // Determine output path
    const inputBase = basename(file, extname(file));
    const outputFile = opts.o ?? `${inputBase}.stl`;
    const fmt = opts.format ?? formatFromExtension(outputFile);
    const outputPath = FORMAT_EXTENSIONS[fmt]?.some((e) => outputFile.toLowerCase().endsWith(e))
      ? outputFile
      : `${outputFile}.${fmt}`;

    const lines: string[] = [];
    const payload: Record<string, unknown> = {
      ok: true, phase: 'export', file: name, diagnostics: m.diagnostics,
    };

    if (m.shape) {
      if (m.info) {
        payload.shape = m.info;
        payload.fingerprint = m.fingerprint;
      }
      if (opts.verbose) lines.push(...formatShapeInfo(m.info));
      const t0 = performance.now();
      // Colour only reaches glTF; collecting parts for STL/STEP would be
      // wasted kernel work on every build.
      const parts = fmt === 'glb' ? resultColorParts(m.oc, m.result) : undefined;
      // --view names the SVG panels. An unknown name is rejected here: the
      // renderer would fall back to its default and the mistake would be
      // invisible in the output. Usage error, so it is not a diagnostic.
      type View = (typeof SVG_VIEWS)[number];
      let views: View[] | undefined;
      if (opts.view !== undefined) {
        const names = opts.view.split(',').map((v) => v.trim()).filter(Boolean);
        const bad = names.filter((v) => !(SVG_VIEWS as readonly string[]).includes(v));
        if (bad.length) {
          console.error(
            `poly: unknown view ${bad.map((b) => `'${b}'`).join(', ')} `
            + `-- expected one of ${SVG_VIEWS.join(', ')}`,
          );
          process.exit(1);
        }
        views = names as View[];
      }
      try {
        await exportShape(m.oc, m.shape, outputPath, {
          linearDeflection: opts.meshDeflection,
          asciiStl: opts.asciiStl,
          parts,
          svg: {
            views,
            width: opts.viewSize,
            height: opts.viewSize,
            showHidden: opts.hidden,
            showAxes: opts.axes,
            supersample: opts.pngScale,
          },
        });
      } catch (e) {
        const d = evalDiagnostic(e as Error);
        printDiagnostics([d], name);
        emit(!!opts.json, { ok: false, phase: 'export', file: name, diagnostics: [...m.diagnostics, d] }, []);
        process.exit(EXIT_EXPORT);
      }
      m.timing.export = Math.round((performance.now() - t0) * 10) / 10;
      payload.artifacts = { [fmt]: outputPath };
      lines.push(`✓ ${name} → ${outputPath}`);
    } else {
      lines.push(`✓ ${name}: evaluated (no shape to export)`);
      payload.shape = null;
    }

    if (opts.timing) {
      // `evaluate` includes the trace's own per-step measuring when --trace
      // is on (volume and sub-shape counts are not free), so compare runs
      // with the same flags.
      m.timing.total = Math.round(Object.values(m.timing).reduce((a, b) => a + b, 0) * 10) / 10;
      payload.timing = m.timing;
      const order = ['parse', 'init', 'evaluate', 'export', 'total'];
      console.error(
        `timing: ${order.filter((k) => k in m.timing).map((k) => `${k}=${m.timing[k].toFixed(1)}ms`).join(' ')}`,
      );
    }

    if (m.trace) {
      payload.trace = m.trace.toList();
      if (!opts.json) {
        lines.push('');
        lines.push(m.trace.render());
      }
    }

    if (!opts.json) printDiagnostics(m.diagnostics, name);
    const warned = strictFailure(m.diagnostics);
    if (opts.strict && warned.length > 0) {
      payload.ok = false;
      emit(!!opts.json, payload, lines);
      console.error(`Error: ${warned.length} warning(s) with --strict`);
      process.exit(EXIT_SEMANTIC);
    }

    emit(!!opts.json, payload, lines);
    process.exit(EXIT_OK);
  });

// verify subcommand — the whole check in one call.
program
  .command('verify <file>')
  .description('Build and report everything needed to judge the result: diagnostics, per-step trace, B-Rep facts, fingerprint, checks')
  .option(
    '-D, --define <value>',
    'Override parameter (repeatable)',
    (v: string, prev: string[] = []) => [...prev, v],
    [] as string[],
  )
  .option('--params-file <path>', 'JSON file with parameter overrides')
  .option('-o <output>', 'Also export the result (STL/STEP/GLB by extension)')
  .option('--no-strict', 'Report warnings without failing (default: any warning exits 3)')
  .option('--timing', 'Add stage and per-step timings')
  .option('--json', 'Machine-readable JSON report on stdout')
  .action(async (file: string, opts: {
    define?: string[]; paramsFile?: string; o?: string; strict?: boolean; timing?: boolean; json?: boolean;
  }) => {
    const name = basename(file);
    const m = await loadModel(file, { ...opts, trace: true });
    const checks = runChecks(m.trace?.toList() as never, m.info as never);

    const lines: string[] = [];
    const payload: Record<string, unknown> = {
      ok: true, phase: 'verify', file: name,
      diagnostics: m.diagnostics,
      checks,
      shape: m.info,
      fingerprint: m.fingerprint,
      trace: m.trace?.toList(),
    };

    if (opts.o && !m.shape) {
      // A library-only file (defs and no geometry) has nothing to write; that
      // is not a failure, so say it rather than letting the exporter throw.
      lines.push(`- ${name}: no shape to export`);
    } else if (opts.o) {
      const { exportShape } = await import('@polyscript/core/ocp-kernel');
      const fmt = formatFromExtension(opts.o);
      try {
        await exportShape(m.oc, m.shape, opts.o, {
          parts: fmt === 'glb' ? resultColorParts(m.oc, m.result) : undefined,
        });
        payload.artifacts = { [fmt]: opts.o };
        lines.push(`✓ ${name} → ${opts.o}`);
      } catch (e) {
        const d = evalDiagnostic(e as Error);
        printDiagnostics([d], name);
        emit(!!opts.json, { ...payload, ok: false, phase: 'export', diagnostics: [...m.diagnostics, d] }, []);
        process.exit(EXIT_EXPORT);
      }
    }

    if (opts.timing) payload.timing = m.timing;

    if (m.trace) {
      lines.push(m.trace.render());
      lines.push('');
    }
    if (!opts.json) {
      printDiagnostics(m.diagnostics, name);
      printDiagnostics(checks, name);
    }
    lines.push(`${strictFailure(m.diagnostics).length && opts.strict ? '✗' : '✓'} ${name}: ${summaryLine(m)}`);

    const warned = strictFailure(m.diagnostics);
    if (opts.strict && warned.length > 0) {
      payload.ok = false;
      emit(!!opts.json, payload, lines);
      console.error(`Error: ${warned.length} warning(s) -- verify is strict by default (--no-strict to allow)`);
      process.exit(EXIT_SEMANTIC);
    }
    emit(!!opts.json, payload, lines);
    process.exit(EXIT_OK);
  });

// diff subcommand — did the edit change the geometry?
program
  .command('diff <a> <b>')
  .description('Compare the B-Rep facts of two .poly files (fingerprint, volume, bbox, topology)')
  .option(
    '-D, --define <value>',
    'Override parameter in both files (repeatable)',
    (v: string, prev: string[] = []) => [...prev, v],
    [] as string[],
  )
  .option('--json', 'Machine-readable JSON report on stdout')
  .action(async (a: string, b: string, opts: { define?: string[]; json?: boolean }) => {
    const [ma, mb] = [
      await loadModel(a, { define: opts.define, json: opts.json }),
      await loadModel(b, { define: opts.define, json: opts.json }),
    ];
    const same = ma.fingerprint === mb.fingerprint;
    const changes = compareShapes(ma.info, mb.info);
    const lines = same
      ? [`= identical  ${basename(a)} ${basename(b)}  fp ${ma.fingerprint}`]
      : [
        `≠ changed  ${basename(a)} → ${basename(b)}`,
        ...changes.map((c) => `  ${c.field}: ${c.from} → ${c.to}${c.delta ? `  (${c.delta})` : ''}`),
      ];
    emit(!!opts.json, {
      ok: true, phase: 'diff', same,
      a: { file: basename(a), shape: ma.info, fingerprint: ma.fingerprint },
      b: { file: basename(b), shape: mb.info, fingerprint: mb.fingerprint },
      changes,
      diagnostics: [...ma.diagnostics, ...mb.diagnostics],
    }, lines);
    process.exit(EXIT_OK);
  });

interface ShapeChange { field: string; from: string | number; to: string | number; delta?: string }

/** Field-by-field comparison, changed fields only. */
function compareShapes(a: ShapeInfoLike | null, b: ShapeInfoLike | null): ShapeChange[] {
  if (!a || !b) {
    return a === b ? [] : [{ field: 'shape', from: a ? 'shape' : 'none', to: b ? 'shape' : 'none' }];
  }
  const out: ShapeChange[] = [];
  const num = (field: string, x: number, y: number, digits = 4) => {
    if (Number(x.toPrecision(7)) === Number(y.toPrecision(7))) return;
    const pct = x !== 0 ? ((y - x) / Math.abs(x)) * 100 : Number.NaN;
    out.push({
      field,
      from: Number(x.toFixed(digits)),
      to: Number(y.toFixed(digits)),
      delta: Number.isNaN(pct)
        ? `${y - x > 0 ? '+' : ''}${Number((y - x).toFixed(digits))}`
        : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
    });
  };
  num('volume', a.volume, b.volume);
  num('area', a.area, b.area);
  for (const [i, axis] of ['x', 'y', 'z'].entries()) {
    num(`bbox.min.${axis}`, a.bbox.min[i], b.bbox.min[i]);
    num(`bbox.max.${axis}`, a.bbox.max[i], b.bbox.max[i]);
  }
  const count = (field: string, x: number, y: number) => {
    if (x !== y) out.push({ field, from: x, to: y, delta: `${y - x > 0 ? '+' : ''}${y - x}` });
  };
  count('solids', a.solids, b.solids);
  count('faces', a.topology.faces, b.topology.faces);
  count('edges', a.topology.edges, b.topology.edges);
  count('vertices', a.topology.vertices, b.topology.vertices);
  if (a.is_valid !== b.is_valid) {
    out.push({ field: 'is_valid', from: String(a.is_valid), to: String(b.is_valid) });
  }
  return out;
}

// explain subcommand — the long form of a diagnostic code.
program
  .command('explain [code]')
  .description('Explain a diagnostic code: why it happens and how to fix it')
  .action((code?: string) => {
    if (!code) {
      console.log('Diagnostic codes:');
      for (const c of DIAGNOSTIC_CODES) console.log(`  ${c}`);
      console.log('\nRun `poly explain <code>` for the long form.');
      process.exit(EXIT_OK);
    }
    const text = explain(code);
    if (!text) {
      console.error(`Unknown diagnostic code: ${code}`);
      console.error(`Known codes: ${DIAGNOSTIC_CODES.join(', ')}`);
      process.exit(EXIT_IO);
    }
    console.log(text);
    process.exit(EXIT_OK);
  });

// info subcommand — B-Rep facts without exporting. Mirrors the Python CLI.
program
  .command('info <file>')
  .description('Report B-Rep facts about the result (bbox, volume, solids, validity)')
  .option(
    '-D, --define <value>',
    'Override parameter (repeatable)',
    (v: string, prev: string[] = []) => [...prev, v],
    [] as string[],
  )
  .option('--params-file <path>', 'JSON file with parameter overrides')
  .option('--json', 'Machine-readable JSON report on stdout')
  .action(async (file: string, opts: { define?: string[]; paramsFile?: string; json?: boolean }) => {
    const m = await loadModel(file, opts);
    if (!m.info) {
      emit(!!opts.json, {
        ok: true, phase: 'evaluate', file: basename(file), diagnostics: m.diagnostics, shape: null,
      }, ['No geometry (library-only file)']);
      process.exit(EXIT_OK);
    }
    if (!opts.json) printDiagnostics(m.diagnostics, basename(file));
    emit(!!opts.json, {
      ok: true, phase: 'evaluate', file: basename(file), diagnostics: m.diagnostics,
      shape: m.info, fingerprint: m.fingerprint,
    }, formatShapeInfo(m.info));
    process.exit(EXIT_OK);
  });

program
  .command('skill <action>')
  .description(
    'Install the modelling skill for an AI coding agent, so it can write and '
    + 'verify PolyScript. Actions: install, list',
  )
  .option(
    '--target <name>',
    'Which agent\'s directory to write: claude (.claude/skills, also read by '
    + 'Copilot), codex (.agents/skills, also read by Copilot), copilot '
    + '(.github/skills)',
    'claude',
  )
  .option('--global', 'Install for every project, not just this one')
  .option(
    '--locale <lang>',
    'Language for the vocabulary the agent maps a request through '
    + '(default: from $LANG, else en)',
  )
  .action(async (action: string, opts: { target: string; global?: boolean; locale?: string }) => {
    const { install, list, locales, defaultLocale } = await import('./skill.js');

    if (action === 'list') {
      const found = list(process.cwd());
      if (found.length === 0) {
        console.log('No skill installed here. Run: poly skill install');
        return;
      }
      for (const e of found) {
        console.log(`${e.current ? 'ok    ' : 'STALE '} ${e.version.padEnd(8)} ${e.path}`);
      }
      if (found.some((e) => !e.current)) {
        console.log(`\nThis poly is ${VERSION}. Re-run \`poly skill install\` to update.`);
        process.exit(EXIT_SEMANTIC);
      }
      return;
    }

    if (action !== 'install') {
      console.error(`Unknown action '${action}'. Expected: install, list`);
      process.exit(EXIT_IO);
    }

    const targets = ['claude', 'codex', 'copilot'] as const;
    type Target = (typeof targets)[number];
    if (!targets.includes(opts.target as Target)) {
      console.error(`Unknown target '${opts.target}'. Expected: ${targets.join(', ')}`);
      process.exit(EXIT_IO);
    }

    const locale = opts.locale ?? defaultLocale();
    if (!locales().includes(locale)) {
      console.error(`No vocabulary for '${locale}'. Carried: ${locales().join(', ')}`);
      process.exit(EXIT_IO);
    }

    const res = install(opts.target as Target, !!opts.global, process.cwd(), locale);
    console.log(`${res.files.length} files (vocabulary: ${res.locale}) -> ${res.root}`);
    if (res.alsoRead.length > 0) {
      console.log(`Also read by: ${res.alsoRead.join(', ')}`);
    }
    console.log(`\nThe agent finds these on its own. Nothing else to configure.`);
  });

program
  .command('section <file>')
  .description('Cut the model with a plane and report the contours (mm)')
  .option(
    '--plane <spec>',
    'Cutting planes, comma-separated: xy, xz, yz, or an axis value like Z=10. '
    + 'A plane without a value cuts through the centre of the bounding box',
    'xz,yz',
  )
  .option('-o <output>', 'Also write the contours as SVG (path data is in mm)')
  .option('--deflection <mm>', 'Curve sampling for the drawn path (default 0.001)', parseFloat)
  .option(
    '-D, --define <value>',
    'Override parameter (repeatable)',
    (v: string, prev: string[] = []) => [...prev, v],
    [] as string[],
  )
  .option('--params-file <path>', 'JSON file with parameter overrides')
  .option('--json', 'Machine-readable JSON report on stdout')
  .action(async (file: string, opts: {
    plane: string; o?: string; deflection?: number;
    define?: string[]; paramsFile?: string; json?: boolean;
  }) => {
    const name = basename(file);
    const m = await loadModel(file, opts);
    const {
      sectionShape, sectionSVG, formatSectionReport, parseSectionSpecs,
    } = await import('@polyscript/core/ocp-kernel');

    if (!m.shape) {
      emit(!!opts.json, {
        ok: true, phase: 'section', file: name, diagnostics: m.diagnostics, sections: [],
      }, ['No geometry (library-only file)']);
      process.exit(EXIT_OK);
    }
    if (!opts.json) printDiagnostics(m.diagnostics, name);

    let specs: ReturnType<typeof parseSectionSpecs> = [];
    try {
      specs = parseSectionSpecs(opts.plane);
    } catch (e) {
      console.error(`poly: ${(e as Error).message}`);
      process.exit(1);
    }

    const results = specs.map((spec) => sectionShape(m.oc, m.shape!, spec, {
      deflection: opts.deflection,
    }));

    if (opts.o) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(opts.o, sectionSVG(results), 'utf-8');
    }

    const lines = formatSectionReport(results);
    if (opts.o) lines.push(`wrote ${opts.o}`);
    emit(!!opts.json, {
      ok: true, phase: 'section', file: name, diagnostics: m.diagnostics,
      sections: results.map((r) => ({
        axis: r.axis, value: r.value, uAxis: r.uAxis, vAxis: r.vAxis,
        loops: r.loops.map((l) => ({
          closed: l.closed, area: l.area, areaExact: l.areaExact, length: l.length,
          bbox: l.bbox, points: l.points.length,
        })),
      })),
    }, lines);
    process.exit(EXIT_OK);
  });

const LIVE_URL = 'https://live.objhub.org/';
const LIVE_URL_MAX = 16 * 1024;

function openInBrowser(url: string): Promise<boolean> {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : ['xdg-open', [url]];
  return new Promise((done) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => done(false));
    child.on('spawn', () => { child.unref(); done(true); });
  });
}

program
  .command('live <file>')
  .description('Open the file in the PolyScript Live editor (live.objhub.org)')
  .option('--print', 'Print the URL instead of opening a browser')
  .option('--json', 'Machine-readable JSON report on stdout')
  .action(async (file: string, opts: { print?: boolean; json?: boolean }) => {
    const name = basename(file);
    // The editor holds one file and cannot read the disk, so imports are
    // inlined first. A file that does not parse goes as it is: the editor
    // shows the syntax error itself.
    let source = readInput(file);
    let inlined: string[] = [];
    try {
      ({ source, imported: inlined } = bundleImports(source, makeImportResolver(dirname(resolve(file)))));
    } catch (e) {
      if (!(e instanceof ParseError)) {
        const d = makeDiagnostic('live.import', 'error', (e as Error).message, {
          hint: 'the import is resolved next to the file, as poly build does',
          ...(e instanceof BundleError && e.line ? { loc: { line: e.line, column: 1 } } : {}),
        });
        if (!opts.json) printDiagnostics([d], name);
        emit(!!opts.json, { ok: false, phase: 'live', file: name, diagnostics: [d] }, []);
        process.exit(EXIT_IO);
      }
    }
    const url = `${LIVE_URL}?code=${encodeURIComponent(source)}`;
    const diags: Diagnostic[] = [];
    if (inlined.length > 0 && !opts.json) {
      console.error(`${name}: inlined ${inlined.map((p) => `"${p}"`).join(', ')}`);
    }
    if (url.length > LIVE_URL_MAX) {
      diags.push(makeDiagnostic('live.too-long', 'warning',
        `the URL is ${url.length} characters; the server accepts up to ${LIVE_URL_MAX}`,
        { hint: 'shorten the source, or paste it into the editor' }));
    }
    if (!opts.print && !(await openInBrowser(url))) {
      diags.push(makeDiagnostic('live.no-browser', 'error',
        'could not start a browser', { hint: 'open the URL yourself' }));
    }
    const ok = !diags.some((d) => d.severity === 'error');
    if (!opts.json) printDiagnostics(diags, name);
    emit(!!opts.json, { ok, phase: 'live', file: name, diagnostics: diags, inlined, url }, [url]);
    process.exit(ok ? EXIT_OK : EXIT_IO);
  });

program.parse();
