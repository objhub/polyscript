# PolyScript language: Variables

> GENERATED from docs/content/en/language.md (Variables) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

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

`w` and `$w` are **the same variable**, so a number and a shape cannot share a name. `bore = 5` followed by `$bore = cylinder 3 10` overwrites the number, and the error appears later, wherever `bore` is used as a number. `poly check` warns `var.dollar-alias` when one name is assigned in both spellings; give the shape its own name (`$bore_cut`).

