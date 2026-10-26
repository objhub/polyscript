# PolyScript language: Variables

> GENERATED from docs/content/en/language.md (Variables) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Variables

A variable is a plain name: give it a value with `=`, then use it wherever a value goes. `def` parameters and loop variables are plain names too.

```
w = 80
h = 60
box w h 10

def plate(size, t) = box size size t
pins = [cylinder 2 10 at:(x, 0) for x in [-20, 20]]
```

Reserved words (`box`, `shell`, `offset`, `for`, ...) cannot be variable names.

A `$` in front of a name (`$w`) is accepted for compatibility with older files and means the same variable as `w`; do not use it in new files. It is still the only way to use a reserved word as a variable name (`$shell = 2`). Assigning one name both ways (`bore = 5`, then `$bore = cylinder 3 10`) overwrites the value, and `poly check` warns `var.dollar-alias`.

