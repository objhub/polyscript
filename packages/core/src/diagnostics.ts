/**
 * Structured diagnostics — the machine-readable channel for everything that
 * went wrong.
 *
 * Every diagnostic carries a **stable code**, so a caller can key off it
 * instead of matching prose: docs anchor on it, `poly explain <code>` prints
 * the long form, and an agent driving the CLI can look up the fix without
 * re-reading a reference file. The prose in `message` may be reworded at any
 * time; the code may not.
 *
 * This module is also the process-wide sink for kernel-level warnings. The
 * selector engine has no channel back to the CLI (Python uses the stdlib
 * `warnings` module for the same purpose); the CLI drains the sink after a run
 * and turns entries into report diagnostics, and into failures under --strict.
 */

import type { SourceLocation } from './ast.js';

export type Severity = 'error' | 'warning' | 'info';

/**
 * The closed set of diagnostic codes.
 *
 * Namespaced by phase so the prefix alone says where the run died:
 * `syntax.` parse, `context.`/`arg.`/`def.`/`call.` validation, `selector.`/`eval.` runtime,
 * `check.` post-build observations (informational -- never fail a build --
 * except `check.sweep-distorted`, a kernel warning that fails under --strict),
 * `param.`/`io.`/`live.` the CLI's own surface.
 */
export const DIAGNOSTIC_CODES = [
  'syntax.parse',
  'context.invalid-op',
  'arg.missing',
  'arg.count',
  'arg.function-value',
  'def.shadows-builtin',
  'call.arity',
  'selector.empty',
  'selector.unknown',
  'eval.error',
  'check.multiple-solids',
  'check.no-effect',
  'check.brep-invalid',
  'check.sweep-distorted',
  'thread.short',
  'param.unknown',
  'param.type',
  'param.choice',
  'param.range',
  'param.commented',
  'param.unknown-option',
  'io.read',
  'live.import',
  'live.too-long',
  'live.no-browser',
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  /** One line, no position and no fix -- those are separate fields. */
  message: string;
  /** What to do about it. Imperative, one line. */
  hint?: string;
  line?: number;
  column?: number;
}

/**
 * Narrow an arbitrary `code` property to this module's set.
 *
 * Errors thrown by occt-wasm carry codes of their own (`CONSTRUCTION_FAILED`,
 * `StdFail_NotDone`, ...). They are useful text, but they are not diagnostic
 * codes: nothing documents them, `poly explain` has no entry, and letting them
 * through would break the promise that `code` comes from a closed set.
 */
export function asDiagnosticCode(code: unknown): DiagnosticCode | undefined {
  return (DIAGNOSTIC_CODES as readonly string[]).includes(code as string)
    ? (code as DiagnosticCode)
    : undefined;
}

export function makeDiagnostic(
  code: DiagnosticCode,
  severity: Severity,
  message: string,
  opts: { hint?: string; loc?: SourceLocation } = {},
): Diagnostic {
  const d: Diagnostic = { code, severity, message };
  if (opts.hint) d.hint = opts.hint;
  if (opts.loc) {
    d.line = opts.loc.line;
    d.column = opts.loc.column;
  }
  return d;
}

/** `file:line:col error code: message -- hint`, one line, gcc-ish so an
 *  editor and a human reader both find the spot. */
export function formatDiagnostic(d: Diagnostic, file?: string): string {
  const where = d.line !== undefined
    ? `${file ? `${file}:` : ''}${d.line}:${d.column ?? 0} `
    : file ? `${file}: ` : '';
  const hint = d.hint ? ` -- ${d.hint}` : '';
  return `${where}${d.severity} ${d.code}: ${d.message}${hint}`;
}

/** An Error that carries a diagnostic code and a fix.
 *
 * The kernel throws these from deep inside OCCT-facing code, where the AST
 * node is out of reach; the evaluator adds the source position on the way out
 * and the CLI turns the whole thing into one diagnostic. */
export interface CodedError extends Error {
  code?: DiagnosticCode;
  hint?: string;
}

export function codedError(code: DiagnosticCode, message: string, hint?: string): CodedError {
  const e = new Error(message) as CodedError;
  e.code = code;
  if (hint) e.hint = hint;
  return e;
}

// --- Process-wide sink -------------------------------------------------------

const _sink: Diagnostic[] = [];

export function pushDiagnostic(d: Diagnostic): void {
  _sink.push(d);
}

/** Record a kernel-level warning. The code defaults to nothing useful on
 *  purpose: every call site should name its own. */
export function pushWarning(
  message: string,
  opts: { code?: DiagnosticCode; hint?: string; loc?: SourceLocation } = {},
): void {
  _sink.push(makeDiagnostic(opts.code ?? 'eval.error', 'warning', message, opts));
}

/** Return everything recorded and clear the sink. */
export function drainDiagnostics(): Diagnostic[] {
  return _sink.splice(0, _sink.length);
}

// --- Long-form explanations (`poly explain <code>`) --------------------------

interface Explanation {
  title: string;
  /** Why this happens, and what the failure looks like if unnoticed. */
  why: string;
  /** A wrong/right pair, or the concrete steps out. */
  fix: string;
}

const EXPLANATIONS: Record<DiagnosticCode, Explanation> = {
  'syntax.parse': {
    title: 'The file is not valid PolyScript',
    why: 'The parser stopped at the reported line and column. Common causes: a\n'
      + 'pipe with nothing after it, an unclosed bracket or quote, and\n'
      + 'subtraction written without spaces (`10 -5` parses as two arguments).',
    fix: 'Arithmetic minus needs a space on both sides; a negative literal needs\n'
      + 'none:\n'
      + '  a = 10 - 5      # subtraction\n'
      + '  b = -5          # negative literal\n'
      + '  c = 10 -5       # ambiguous, and read as two arguments',
  },
  'context.invalid-op': {
    title: 'This operation is not legal on what the pipeline is holding',
    why: 'A pipeline moves through contexts: a solid (3D), a selection of faces\n'
      + 'or edges, a 2D region (Face) or curve (Wire). Each operation accepts\n'
      + 'only some of them -- `extrude` needs a Face, `shell` needs a face\n'
      + 'selection, `fillet` needs an edge selection.',
    fix: 'Insert the step that produces the context the operation wants:\n'
      + '  box 10 10 10 | faces >Z | shell 2          # select before shelling\n'
      + '  rect 50 30 | extrude 5                     # extrude a region\n'
      + '  wire [(0,0), (10,0)] | offset 1 | extrude 5 # a curve has no area\n'
      + 'The message lists the contexts the operation is allowed in.',
  },
  'arg.missing': {
    title: 'A required argument was not given',
    why: 'The operation has no default for that argument, so there is nothing\n'
      + 'sensible to assume.',
    fix: 'Supply it: `fillet 2`, `shell 1.5`, `extrude 10`, `hole 3`.',
  },
  'arg.function-value': {
    title: "A function's name was used as a value instead of being called",
    why: 'Inside a command\'s arguments a call needs its parentheses right after\n'
      + 'the name. With a space, `cylinder r (3) 10` reads as three arguments:\n'
      + 'the function `r` itself, then `(3)`, then `10` -- and a function is not\n'
      + 'a number, so the build would fail far from the cause.',
    fix: 'Write the arguments right after the name, with no space:\n'
      + '  def r($k) = $k * 2\n'
      + '  cylinder r(3) 10',
  },
  'arg.count': {
    title: 'An operation got the wrong number of arguments for what it acts on',
    why: '`rotate` takes three angles on a solid (about the world X, Y, Z axes)\n'
      + 'and one angle on a 2D shape (about its workplane normal). A 2D shape\n'
      + 'cannot leave its workplane, so `arc ... | rotate 90 0 0` does not\n'
      + 'stand a path up; nothing is padded or ignored either.',
    fix: 'Solid: all three angles, `rotate 0 0 45`. 2D shape: one angle,\n'
      + '`rotate 45`. To draw in a vertical plane, start there or use 3D points:\n'
      + '  workplane XZ | wire [arc (0,-25) (25,0) center:(0,0)] | sweep (circle 5)\n'
      + '  arc (0,0,-25) (25,0,0) center:(0,0,0) | sweep (circle 5)',
  },
  'def.shadows-builtin': {
    title: 'A def has the name of a built-in function',
    why: 'Calls resolve to the built-in first, so the def is never reached.\n'
      + 'Nothing else would tell you: `def rad($R, $k, $t) = ...` followed by\n'
      + '`rad($R, $k, $t)` calls the degrees-to-radians built-in, drops the\n'
      + 'extra arguments, and builds a part a hundred times too small with\n'
      + 'exit 0.',
    fix: 'Rename the def:\n'
      + '  def rad($R, $k) = ...          # never called\n'
      + '  def radius_at($R, $k) = ...    # called\n'
      + 'The built-ins are sin cos tan asin acos atan atan2 sqrt abs floor\n'
      + 'ceil round min max radians degrees rad deg len range.',
  },
  'call.arity': {
    title: 'A built-in function was called with the wrong number of arguments',
    why: 'Built-ins take a fixed number of arguments (min and max take one or\n'
      + 'more, range one to three). Extra arguments used to be dropped\n'
      + 'silently, which usually means the call was meant for a def of the\n'
      + 'same name.',
    fix: 'Pass the arguments the built-in takes: `sin(30)`, `atan2(y, x)`,\n'
      + '`range(0, 10, 2)`. If you meant your own function, give it a name\n'
      + 'that is not a built-in (see def.shadows-builtin).',
  },
  'selector.empty': {
    title: 'A selector matched nothing',
    why: 'This is the most damaging silent failure in the language, which is why\n'
      + 'it is an error and not a warning. With an empty selection the next\n'
      + 'operation either does nothing (`hole`, `workplane`) or widens to\n'
      + 'everything (`fillet`, `chamfer`): a box asked for a rounded top edge\n'
      + 'comes out rounded all over, with a plausible volume, a valid B-Rep and\n'
      + 'exit 0.',
    fix: 'Read the selector symbols:\n'
      + '  >Z <Z   the topmost / bottommost faces or edges (by position)\n'
      + '  =Z      parallel to the Z axis: the upright edges, the side faces\n'
      + '  =XY     parallel to the XY plane: horizontal edges, top and bottom faces\n'
      + '  +Z -Z   the faces that face up / down (by normal)\n'
      + '`>Z =Z` is the classic empty match: the top edges of a box all lie\n'
      + 'flat, none runs along Z. Use `poly verify --trace` to see what each\n'
      + 'step selected, including the centroid and normal of the selection.',
  },
  'selector.unknown': {
    title: 'The selector string was not recognised, so nothing was filtered',
    why: 'An unparsable selector applies no filter at all, which reads as\n'
      + 'success: `faces "Z"` keeps all six faces of a box and the following\n'
      + '`shell` hollows the whole thing.',
    fix: 'A selector is an operator plus an axis or plane: `>Z`, `<X`, `=Z`,\n'
      + '`=XY`, `+Y`, `-Z`. The operator is not optional. Write it without quotes: `faces >Z`. A quoted\n'
      + 'string (`faces ">Z"`) still works but is deprecated, and a typo in a\n'
      + 'string is only caught here, at build time; `faces Z` fails as an\n'
      + 'undefined variable.',
  },
  'eval.error': {
    title: 'The geometry kernel refused the operation',
    why: 'The pipeline was legal but the shape was not buildable: a degenerate\n'
      + 'radius, a fillet larger than the material, a boolean between a solid\n'
      + 'and a 2D region, an OCCT limit (`shell` after `fillet`).',
    fix: 'Bisect the pipeline: build it up to the failing step and inspect it\n'
      + 'with `poly verify --trace`, which reports volume, solid count and face\n'
      + 'count after every step. Order matters: `fillet` before `shell`.',
  },
  'check.multiple-solids': {
    title: 'The result is more than one solid',
    why: 'Two parts that only touch do not fuse: a boss sitting exactly on a\n'
      + 'floor, a cylinder tangent to a plane, or a part that floats because a\n'
      + 'wall came out thinner than assumed. Nothing errors, the volume looks\n'
      + 'right, and the piece prints as loose fragments.',
    fix: 'If it should be one piece, overlap the parts by 0.5-1mm and union\n'
      + 'again. Face-to-face contact does fuse; line contact (a curved surface\n'
      + 'meeting a flat one) does not. Several shipped examples are deliberately\n'
      + 'multi-solid, so this is informational -- compare it against intent.',
  },
  'check.no-effect': {
    title: 'An operation did not change the shape',
    why: 'A `hole` on an empty face selection, a `fillet` whose radius rounded\n'
      + 'nothing, a `diff` whose tool missed the material. The build succeeds\n'
      + 'and the feature is simply absent.',
    fix: 'Check the step before it in the trace: what it selected, and whether\n'
      + 'the tool actually overlaps the material. A tool that exactly touches a\n'
      + 'surface is the usual cause -- make it overlap or clear the surface,\n'
      + 'never exactly tangent.',
  },
  'check.brep-invalid': {
    title: 'OCCT reports the resulting B-Rep as invalid',
    why: 'Self-intersecting faces, degenerate edges or debris solids left by a\n'
      + 'boolean between tangent surfaces. Exports may still succeed and produce\n'
      + 'a mesh no slicer can print.',
    fix: 'Find the step that broke it with `poly verify --trace`: a jump in the\n'
      + 'face count or a solid count above 1 usually marks it. Avoid booleans\n'
      + 'whose tool exactly touches the material surface.',
  },
  'thread.short': {
    title: 'A thread shorter than one pitch',
    why: 'thread r pitch h makes h of thread along the axis; with h below the\n'
      + 'pitch that is less than one turn. It builds, but it is rarely what was\n'
      + 'meant: the arguments are r, pitch, h in that order, and swapping the\n'
      + 'last two is the usual cause (thread 8 30 2 for an M16 x 2 of length 30).',
    fix: 'Check the argument order. If a thread shorter than one turn really is\n'
      + 'intended, ignore the warning.',
  },
  'check.sweep-distorted': {
    title: 'A sweep came out far from profile area x path length',
    why: 'A swept solid has about the volume of its profile area times the\n'
      + 'path length. Far less means the profile folded or flipped along the\n'
      + 'way; the result is still one valid solid, with exit 0. A path in a\n'
      + 'vertical plane used to do this: a half-circle handle came out at 42%\n'
      + 'of its volume, or at 0 where the tangent ran along Z.',
    fix: 'Keep the profile smaller than the tightest bend radius of the path.\n'
      + 'Look at the result with `poly section` across the path. If the path is\n'
      + 'smooth and the profile small, the sweep itself is at fault: report it\n'
      + 'with the file.',
  },
  'param.unknown': {
    title: '-D named a parameter the file does not declare',
    why: 'The override was ignored, so the model was built with its own defaults\n'
      + 'and the reported dimensions are not the ones asked for.',
    fix: 'Declare it with an @param annotation above the assignment:\n'
      + '  @param 60..120 desc:"width (mm)"\n'
      + '  width = 80',
  },
  'param.type': {
    title: 'A -D value does not fit the parameter\'s declared type',
    why: 'A value is only guessed from its text, so without this check\n'
      + '`-D engrave=no` became the string "no", which counts as true: a bool\n'
      + 'parameter meant as false was built as true, silently.',
    fix: 'bool: exactly true or false (`-D engrave=true`). int / float: a number.\n'
      + 'The type comes from the default value, or from @param type:"...".',
  },
  'param.choice': {
    title: 'A -D value is not one of the parameter\'s choices',
    why: 'A model picks its variant with if/else, so a value outside the list\n'
      + 'falls through to the last else: `-D bolt=M8` built the M6 size and\n'
      + 'reported success. A typo (`m4`, `M-4`) went the same way.',
    fix: 'Give one of the listed values exactly (case matters):\n'
      + '  @param choices:["M3", "M4", "M5"] desc:"bolt size"\n'
      + '  poly verify bolt.poly -D bolt=M4',
  },
  'param.range': {
    title: 'A -D value lies outside the parameter\'s @param range',
    why: 'The GUI slider cannot leave the range, but -D can, so a slip\n'
      + '(`width=1000` for 100) built and reported success. A warning, not an\n'
      + 'error: going past the range on purpose is legitimate. It fails under\n'
      + '--strict (the default of poly verify).',
    fix: 'Give a value inside the range, or widen the range if the model is\n'
      + 'meant to work there:\n'
      + '  @param 30..200 desc:"width (mm)"\n'
      + 'Pass --no-strict to build out of range once without changing the file.',
  },
  'param.commented': {
    title: "'# @param' is a comment, not a parameter annotation",
    why: 'The annotation is `@param ...` on its own line. With a `#` in front\n'
      + 'the line is a comment: the variable below is an ordinary variable, the\n'
      + 'GUI shows no control for it, and -D values are not type-checked.',
    fix: 'Drop the `#`:\n'
      + '  @param 60..120 desc:"width (mm)"\n'
      + '  width = 80',
  },
  'param.unknown-option': {
    title: 'An @param option the annotation does not have',
    why: 'Any key:value parses, so a misspelt option is dropped without a word:\n'
      + '`choice:[...]` for `choices:[...]` shows no dropdown and takes any -D.',
    fix: 'The options are min max step label desc choices group type hidden:\n'
      + '  @param choices:["M3", "M4", "M5"] desc:"bolt size"\n'
      + '  bolt = "M4"',
  },
  'io.read': {
    title: 'The file could not be read',
    why: 'Wrong path, or no permission.',
    fix: 'Check the path. `-` reads the source from stdin.',
  },
  'live.import': {
    title: 'An import could not be inlined for the Live editor',
    why: 'The editor holds one file and cannot read your disk, so poly live copies\n'
      + "each imported file's defs and assignments in place of its import line.\n"
      + 'This one could not be found or read, next to the file being opened.',
    fix: 'Check the import path: it is relative to the file, `.poly` optional,\n'
      + 'and may not leave its directory. `poly check` reports the same import.',
  },
  'live.too-long': {
    title: 'The URL is longer than the Live editor\'s server accepts',
    why: 'The source travels URL-encoded in the query string, and the server\n'
      + 'refuses request URLs over 16 KB, so the page may not load at all.',
    fix: 'Shorten the source (comments count too), or copy and paste it into\n'
      + 'the editor at https://live.objhub.org instead.',
  },
  'live.no-browser': {
    title: 'No browser could be started',
    why: 'poly live opens the URL with `open` (macOS), `xdg-open` (Linux) or the\n'
      + 'Windows URL handler. Over SSH or in a container there is usually none.',
    fix: 'Open the printed URL yourself, or pass --print to only print it.',
  },
};

export function explain(code: string): string | null {
  const e = EXPLANATIONS[code as DiagnosticCode];
  if (!e) return null;
  return `${code} -- ${e.title}\n\nWhy\n${e.why}\n\nFix\n${e.fix}`;
}
