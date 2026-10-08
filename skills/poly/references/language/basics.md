# PolyScript language: Overview

> GENERATED from docs/content/en/language.md (Overview; Variables; Import; Comments) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Overview

PolyScript is a pipe-based language for parametric CAD modeling. Shapes are created with primitives and transformed through a chain of pipe operations.

```
box 80 60 10 | fillet 2 | diff cylinder 10 10
```

When you write multiple shapes on separate lines, they are automatically combined (unioned) into a single shape.

```
box 10 10 10
sphere 8
# → the two shapes are automatically unioned
```

To combine shapes explicitly, use `union [...]`.

## Variables

The `$` prefix on variable names is optional. Both `$w = 80` and `w = 80` work. Reserved words (`box`, `cylinder`, `if`, `for`, etc.) cannot be used as variable names.

```
w = 80
h = 60
box w h 10

# $-prefixed form also works (backward compatible)
$w = 80
box $w $h 10
```

## Import

Load function definitions from another `.poly` file:

```
import "gear"

spur_gear 12 2 | extrude 8
```

Imports are resolved relative to the importing file's directory. Only the file's `def`s and assignments are brought in; its shapes and its own imports are ignored.

Where a model can be only one file -- opened in the Live editor with `poly live`, or uploaded to objhub -- exactly that part is inlined in place of the `import` line.

## Comments

```
# This is a comment
```

