# PolyScript language: Pipe Operations

> GENERATED from docs/content/en/language.md (Pipe Operations > Boolean; Pipe Operations > Shape operators `+` `-` `*`) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Pipe Operations

### Boolean

```
| diff shape               # subtract shape
| union shape              # add shape
| inter shape              # intersect with shape
```

Shapes can be placed with `at:`:

```
box 50 50 10
 | diff cylinder 3 10 at:15 15
```

### Shape operators `+` `-` `*`

Inside an expression, shapes can be combined with `+` (union), `-` (diff) and `*` (inter). They mean exactly what the pipe operations `union`/`diff`/`inter` mean (a list on the right is applied in order; two Faces give a 2D boolean). Both operands must be solids, or both Faces; mixing them, as in `(rect 10 10) + (box 5 5 5)`, is a type error in every spelling. Precedence follows arithmetic -- `*` first -- and all three bind tighter than the pipe `|`. Set-operation precedence differs between tools, and `a - (b * c)` is a different shape from `(a - b) * c`, so **parenthesise whenever `*` is mixed with `+`/`-`.**

```
base = box 80 60 10
holes = [cylinder 3 20 at:(20, 15), cylinder 3 20 at:(-20, 15)]
base - holes | edges >Z | fillet 2                 # (base - holes) | fillet 2

lid = (body | faces >Z | offset -2 | extrude 3) - pins
plate = (rect 40 20) - ((circle 4) * (rect 10 10))  # rect minus (circle ∩ rect)
```

**The operators only work between variables and parenthesised expressions.** They cannot follow a command's arguments: `box 10 10 10 - x` is argument arithmetic, `box 10 10 (10 - x)`. Right after a command, use the pipe form.

```
box 10 10 10 - cylinder 3 20         # ✗ parse error
(box 10 10 10) - (cylinder 3 20)     # ✓
box 10 10 10 | diff (cylinder 3 20)  # ✓ reads better
```

A long expression can break at an operator, which may end one line or start the next.
A leading `-` is read by its spacing just as on one line, so leave a space after it for a subtraction: `- $b`.

```
body = $outer
  - $cavity
  - $hole
grip = $handle *
  $mask
```

