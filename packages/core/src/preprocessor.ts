/**
 * PolyScript preprocessor — handles line continuation.
 * Joins lines at logical boundaries before parsing.
 * Returns a character-level line map so the lexer can report original line numbers.
 */

export interface PreprocessResult {
  /** Preprocessed source with lines joined. */
  source: string;
  /** For each character in the output, the original 1-based line number. */
  charLineMap: number[];
}

export function preprocess(source: string): PreprocessResult {
  // Normalize line endings
  source = source.replace(/\r\n/g, '\n');

  // Build character-to-original-line mapping for the input.
  const inputLineOf = new Int32Array(source.length);
  let line = 1;
  for (let i = 0; i < source.length; i++) {
    inputLineOf[i] = line;
    if (source[i] === '\n') line++;
  }

  // Track which characters survive preprocessing.
  // Start with all characters surviving (identity mapping).
  const chars: string[] = [];
  const lineNums: number[] = [];
  for (let i = 0; i < source.length; i++) {
    chars.push(source[i]);
    lineNums.push(inputLineOf[i]);
  }

  // Helper: apply a regex replacement, updating chars/lineNums.
  function applyReplace(pattern: RegExp, replaceFn: (m: string) => string) {
    const text = chars.join('');
    const newChars: string[] = [];
    const newLines: number[] = [];
    let lastIndex = 0;

    for (const match of text.matchAll(pattern)) {
      const start = match.index!;
      const end = start + match[0].length;

      // Copy characters before the match
      for (let i = lastIndex; i < start; i++) {
        newChars.push(chars[i]);
        newLines.push(lineNums[i]);
      }

      // Generate replacement
      const replacement = replaceFn(match[0]);
      // Map replacement characters to the line of the match start
      const matchLine = lineNums[start];
      for (let i = 0; i < replacement.length; i++) {
        newChars.push(replacement[i]);
        // For replacement chars that correspond to positions in the original match,
        // try to use the original line number; otherwise use match start line.
        if (i < match[0].length) {
          newLines.push(lineNums[start + i]);
        } else {
          newLines.push(matchLine);
        }
      }

      lastIndex = end;
    }

    // Copy remaining characters
    for (let i = lastIndex; i < chars.length; i++) {
      newChars.push(chars[i]);
      newLines.push(lineNums[i]);
    }

    chars.length = 0;
    lineNums.length = 0;
    for (let i = 0; i < newChars.length; i++) {
      chars.push(newChars[i]);
      lineNums.push(newLines[i]);
    }
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
    source: chars.join(''),
    charLineMap: lineNums,
  };
}
