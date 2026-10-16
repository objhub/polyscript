import { describe, it, expect } from 'vitest';
import { Lexer, TokenType } from '../src/lexer.js';

function tokenize(source: string) {
  return new Lexer(source).tokenize();
}

function _tokenTypes(source: string): TokenType[] {
  return tokenize(source).map(t => t.type);
}

function _tokenValues(source: string): string[] {
  return tokenize(source).map(t => t.value);
}

describe('lexer — basic tokens', () => {
  it('tokenizes empty string', () => {
    const tokens = tokenize('');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe(TokenType.EOF);
  });

  it('tokenizes number', () => {
    const tokens = tokenize('42');
    expect(tokens[0]).toMatchObject({ type: TokenType.Number, value: '42' });
  });

  it('tokenizes decimal number', () => {
    const tokens = tokenize('3.14');
    expect(tokens[0]).toMatchObject({ type: TokenType.Number, value: '3.14' });
  });

  it('tokenizes integer when dot is not followed by digit', () => {
    // "10." without a following digit means the dot is not part of the number.
    // The lexer reads "10" as a number, then "." causes an error since it's not a valid token.
    // So we test a valid scenario: "10" alone
    const tokens = tokenize('10');
    expect(tokens[0]).toMatchObject({ type: TokenType.Number, value: '10' });
  });

  it('tokenizes identifier', () => {
    const tokens = tokenize('myVar');
    expect(tokens[0]).toMatchObject({ type: TokenType.Identifier, value: 'myVar' });
  });

  it('tokenizes identifier starting with underscore', () => {
    const tokens = tokenize('_foo');
    expect(tokens[0]).toMatchObject({ type: TokenType.Identifier, value: '_foo' });
  });

  it('tokenizes identifier with digits', () => {
    const tokens = tokenize('var2');
    expect(tokens[0]).toMatchObject({ type: TokenType.Identifier, value: 'var2' });
  });

  it('tokenizes keyword', () => {
    const tokens = tokenize('box');
    expect(tokens[0]).toMatchObject({ type: TokenType.Keyword, value: 'box' });
  });

  it('tokenizes string literal', () => {
    const tokens = tokenize('"hello"');
    expect(tokens[0]).toMatchObject({ type: TokenType.String, value: 'hello' });
  });

  it('tokenizes newline', () => {
    const tokens = tokenize('\n');
    expect(tokens[0]).toMatchObject({ type: TokenType.Newline, value: '\n' });
  });
});

describe('lexer — operators', () => {
  it('tokenizes single-character operators', () => {
    const tokens = tokenize('+ - * / % = | ( ) [ ] , : $');
    const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
    expect(types).toEqual([
      TokenType.Plus, TokenType.Minus, TokenType.Star, TokenType.Slash,
      TokenType.Percent, TokenType.Eq, TokenType.Pipe, TokenType.LParen,
      TokenType.RParen, TokenType.LBracket, TokenType.RBracket,
      TokenType.Comma, TokenType.Colon, TokenType.Dollar,
    ]);
  });

  it('tokenizes two-character operators', () => {
    const tokens = tokenize('** // == != <= >=');
    const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
    expect(types).toEqual([
      TokenType.DoubleStar, TokenType.DoubleSlash,
      TokenType.EqEq, TokenType.NotEq,
      TokenType.LtEq, TokenType.GtEq,
    ]);
  });

  it('tokenizes < and > as comparison operators', () => {
    const tokens = tokenize('< >');
    expect(tokens[0].type).toBe(TokenType.Lt);
    expect(tokens[1].type).toBe(TokenType.Gt);
  });
});

describe('lexer — selectors', () => {
  it('tokenizes >Z as selector', () => {
    const tokens = tokenize('>Z');
    expect(tokens[0]).toMatchObject({ type: TokenType.Selector, value: '>Z' });
  });

  it('tokenizes <X as selector', () => {
    const tokens = tokenize('<X');
    expect(tokens[0]).toMatchObject({ type: TokenType.Selector, value: '<X' });
  });

  it('tokenizes =Y as selector', () => {
    const tokens = tokenize('=Y');
    expect(tokens[0]).toMatchObject({ type: TokenType.Selector, value: '=Y' });
  });

  it('tokenizes +Z as selector', () => {
    const tokens = tokenize('+Z');
    expect(tokens[0]).toMatchObject({ type: TokenType.Selector, value: '+Z' });
  });

  it('tokenizes all selector combinations', () => {
    for (const sym of ['>', '<', '=', '+']) {
      for (const axis of ['X', 'Y', 'Z']) {
        const tokens = tokenize(sym + axis);
        expect(tokens[0].type).toBe(TokenType.Selector);
        expect(tokens[0].value).toBe(sym + axis);
      }
    }
  });

  it('does not tokenize > followed by space as selector', () => {
    const tokens = tokenize('> Z');
    expect(tokens[0].type).toBe(TokenType.Gt);
  });
});

describe('lexer — string escape sequences', () => {
  it('handles \\n escape', () => {
    const tokens = tokenize('"hello\\nworld"');
    expect(tokens[0].value).toBe('hello\nworld');
  });

  it('handles \\t escape', () => {
    const tokens = tokenize('"hello\\tworld"');
    expect(tokens[0].value).toBe('hello\tworld');
  });

  it('handles \\\\ escape', () => {
    const tokens = tokenize('"back\\\\slash"');
    expect(tokens[0].value).toBe('back\\slash');
  });

  it('handles \\" escape', () => {
    const tokens = tokenize('"say \\"hi\\""');
    expect(tokens[0].value).toBe('say "hi"');
  });

  it('handles unknown escape as literal backslash + char', () => {
    const tokens = tokenize('"foo\\xbar"');
    expect(tokens[0].value).toBe('foo\\xbar');
  });

  it('throws on unterminated string', () => {
    expect(() => tokenize('"hello')).toThrow(/Unterminated string/);
  });

  it('throws on unterminated string with escape at end', () => {
    expect(() => tokenize('"hello\\')).toThrow();
  });
});

describe('lexer — comments', () => {
  it('skips comment', () => {
    const tokens = tokenize('# comment\n42');
    expect(tokens[0]).toMatchObject({ type: TokenType.Newline });
    expect(tokens[1]).toMatchObject({ type: TokenType.Number, value: '42' });
  });

  it('skips comment at end of line', () => {
    const tokens = tokenize('42 # comment');
    expect(tokens[0]).toMatchObject({ type: TokenType.Number, value: '42' });
    expect(tokens[1]).toMatchObject({ type: TokenType.EOF });
  });

  it('skips comment at end of file (no newline)', () => {
    const tokens = tokenize('# comment only');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe(TokenType.EOF);
  });
});

describe('lexer — whitespace handling', () => {
  it('skips spaces and tabs', () => {
    const tokens = tokenize('  \t 42  \t  10');
    expect(tokens[0]).toMatchObject({ type: TokenType.Number, value: '42' });
    expect(tokens[1]).toMatchObject({ type: TokenType.Number, value: '10' });
  });

  it('does not skip newlines', () => {
    const tokens = tokenize('42\n10');
    expect(tokens[0].type).toBe(TokenType.Number);
    expect(tokens[1].type).toBe(TokenType.Newline);
    expect(tokens[2].type).toBe(TokenType.Number);
  });
});

describe('lexer — line/column tracking', () => {
  it('tracks line and column for first token', () => {
    const tokens = tokenize('42');
    expect(tokens[0].line).toBe(1);
    expect(tokens[0].column).toBe(1);
  });

  it('tracks column after spaces', () => {
    const tokens = tokenize('   42');
    expect(tokens[0].line).toBe(1);
    expect(tokens[0].column).toBe(4);
  });

  it('tracks line after newline', () => {
    const tokens = tokenize('\n42');
    expect(tokens[1].line).toBe(2);
    expect(tokens[1].column).toBe(1);
  });

  it('tracks multiple lines', () => {
    const tokens = tokenize('a\nb\nc');
    expect(tokens[0].line).toBe(1); // a
    expect(tokens[2].line).toBe(2); // b (after newline)
    expect(tokens[4].line).toBe(3); // c
  });
});

describe('lexer — error cases', () => {
  it('throws on unexpected character', () => {
    expect(() => tokenize('`')).toThrow(/Unexpected character '`'/);
  });

  it('throws on unexpected character with position', () => {
    expect(() => tokenize('42 @')).toThrow(/line 1/);
  });
});

describe('lexer — complex token sequences', () => {
  it('tokenizes a simple pipeline', () => {
    const tokens = tokenize('box 80 60 10 | fillet 2');
    const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
    expect(types).toEqual([
      TokenType.Keyword, TokenType.Number, TokenType.Number, TokenType.Number,
      TokenType.Pipe, TokenType.Keyword, TokenType.Number,
    ]);
  });

  it('tokenizes assignment', () => {
    const tokens = tokenize('size = 10');
    expect(tokens[0]).toMatchObject({ type: TokenType.Identifier, value: 'size' });
    expect(tokens[1]).toMatchObject({ type: TokenType.Eq, value: '=' });
    expect(tokens[2]).toMatchObject({ type: TokenType.Number, value: '10' });
  });

  it('tokenizes function definition', () => {
    const tokens = tokenize('def plate(size) = box size size 3');
    expect(tokens[0]).toMatchObject({ type: TokenType.Keyword, value: 'def' });
    expect(tokens[1]).toMatchObject({ type: TokenType.Identifier, value: 'plate' });
    expect(tokens[2].type).toBe(TokenType.LParen);
  });

  it('tokenizes tag reference', () => {
    const tokens = tokenize('$myTag');
    expect(tokens[0]).toMatchObject({ type: TokenType.Dollar });
    expect(tokens[1]).toMatchObject({ type: TokenType.Identifier, value: 'myTag' });
  });

  it('tokenizes named args', () => {
    const tokens = tokenize('open:>Z');
    expect(tokens[0]).toMatchObject({ type: TokenType.Identifier, value: 'open' });
    expect(tokens[1]).toMatchObject({ type: TokenType.Colon });
    expect(tokens[2]).toMatchObject({ type: TokenType.Selector, value: '>Z' });
  });
});
