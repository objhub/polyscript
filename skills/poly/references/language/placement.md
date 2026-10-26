# PolyScript language: Placement

> GENERATED from docs/content/en/language.md (Placement) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Placement

`at:` is a named argument that places a shape at the specified position. Write it with a colon `:` immediately after `at`.

**Parentheses rules**:

- Simple coordinates (literals/variables): parentheses can be omitted (recommended). `at:20 0 0`
- With expressions: parentheses required. `at:(x+1, y+1)`
- Coordinate list: brackets required. `at:[(0,0), (10,0)]`
- Parenthesized `at:(x, y)` is always valid.
- For array duplication, use the `| grid` or `| polar` pipe operations.

```
sphere 5 at:20 0 0                      # simple position (omit parentheses)
sphere 5 at:x y                       # variables are fine too
sphere 5 at:(x+1, y+1)               # expressions require parentheses
sphere 5 at:[(0,0), (10,0), (20,0)]    # multiple positions (brackets required)
sphere 5 | polar 6 20                   # circular array (pipe operation)
sphere 5 | grid 3 3 20                  # grid array (pipe operation)
```

Similarly, the `angle:` named argument can be used to rotate a shape:

```
rect 10 5 angle:45                      # rectangle rotated 45 degrees
```

