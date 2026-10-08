# PolyScript language: Functions

> GENERATED from docs/content/en/language.md (Functions) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Functions

Single-expression functions with `def`:

```
def standoff($r, $h, $hole_r) = cylinder $r $h | diff cylinder $hole_r $h

box 80 60 3
 | union standoff 4 10 1.5 at:10 10
```

In a call with parentheses an argument can be a shape command or a whole pipeline; arguments are separated by `,`:

```
def lift($s, $h) = $s | translate 0 0 $h

lift(box 10 10 10 | fillet 1, 5)
```

To call a function inside a command's arguments, write the `(` **right after the name, with no space**.
With a space the name and the parenthesised expression become two arguments (`poly check` stops it as `arg.function-value`):

```
def r($k) = $k * 2

cylinder r(3) 10      # radius 6, height 10
cylinder r (3) 10     # ✗ arg.function-value
```

