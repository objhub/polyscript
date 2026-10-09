/**
 * PolyScript preprocessor — handles line continuation.
 * Joins lines at logical boundaries before parsing.
 * Returns a character-level line map so the lexer can report original line numbers.
 */

export interface PreprocessResult {
  /** Preprocessed source with lines joined. */
  source: string;
  /** For each character in the output, the original 1-based line number. */
  charLineMap: ArrayLike<number>;
}

export function preprocess(source: string): PreprocessResult {
  // Normalize line endings
  let text = source.replace(/\r\n/g, '\n');

  // For each character of `text`, the line it came from.
  let lineOf = new Int32Array(text.length);
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    lineOf[i] = line;
    if (text.charCodeAt(i) === 10) line++;
  }

  /**
   * Apply a regex replacement to `text`, carrying the line map along.
   *
   * Most rules match nothing in most files, so a rule with no match costs one
   * scan and nothing else. Unchanged stretches are copied as slices (string)
   * and typed-array copies (lines), never character by character: this runs
   * ten times per parse, and the old per-character rebuild was most of the
   * parser's time.
   */
  function applyReplace(pattern: RegExp, replaceFn: (m: string) => string) {
    pattern.lastIndex = 0;
    if (!pattern.test(text)) return;
    pattern.lastIndex = 0;

    const pieces: string[] = [];
    // [from, to) of `text` to keep, or a replacement starting at `at`.
    const segments: ({ from: number; to: number } | { rep: string; at: number; len: number })[] = [];
    let last = 0;
    let length = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index!;
      if (start > last) {
        pieces.push(text.slice(last, start));
        segments.push({ from: last, to: start });
        length += start - last;
      }
      const rep = replaceFn(match[0]);
      pieces.push(rep);
      segments.push({ rep, at: start, len: match[0].length });
      length += rep.length;
      last = start + match[0].length;
    }
    if (last < text.length) {
      pieces.push(text.slice(last));
      segments.push({ from: last, to: text.length });
      length += text.length - last;
    }

    const next = new Int32Array(length);
    let o = 0;
    for (const s of segments) {
      if ('from' in s) {
        next.set(lineOf.subarray(s.from, s.to), o);
        o += s.to - s.from;
      } else {
        // A replacement character standing where a matched one was keeps
        // that one's line; any beyond the match take the match's first line.
        for (let i = 0; i < s.rep.length; i++) {
          next[o++] = lineOf[s.at + (i < s.len ? i : 0)];
        }
      }
    }
    text = pieces.join('');
    lineOf = next;
  }

  // Strip comments (preserve strings).
  applyReplace(/"(?:[^"\\]|\\.)*"|#[^\n]*/g, (m) => m[0] === '"' ? m : '');

  // Join lines: line ending with | continues to next line
  applyReplace(/\|\s*\n\s*/g, () => '| ');

  // Join lines: next line starting with | continues from previous
  applyReplace(/\n\s*\|/g, () => ' |');

  // Join lines: line ending with = (but not ==, !=, <=, >=) continues
  applyReplace(/(?<![=!<>])=\s*\n\s*/g, () => '= ');

  // Join lines: line ending with , continues
  applyReplace(/,\s*\n\s*/g, () => ', ');

  // Join lines: next line starting with else continues
  applyReplace(/\n\s*else\b/g, () => ' else');

  // Join lines: next line starting with + continues
  applyReplace(/\n\s*\+/g, () => ' +');

  // Join lines: next line starting with * / - continues, as + already does.
  // No statement can start with * or /, and one starting with a unary minus
  // only computes a number and throws it away. The spacing is kept, so
  // `$a\n  - $b` is a subtraction and `$a\n  -$b` reads like `$a -$b` does on
  // one line (a new argument in a command's argument list).
  applyReplace(/\n\s*(?=[*\/-])/g, () => ' ');

  // Join lines: a line ending with an arithmetic or shape operator continues.
  applyReplace(/[-+*\/][ \t]*\n\s*/g, (m) => `${m[0]} `);

  // Join lines: next line starting with for continues (list comprehension)
  applyReplace(/\n\s*for\b/g, () => ' for');

  return {
    source: text,
    charLineMap: lineOf,
  };
}
