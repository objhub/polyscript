# PolyScript language: Pipe Operations

> GENERATED from docs/content/en/language.md (Pipe Operations > Place) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Pipe Operations

### Place

Place a 2D shape stored in a variable into the pipeline. Like `diff`/`union`/`inter`, it accepts variable references or inline 2D primitives as arguments.

```
| place shape                # place a 2D shape from a variable
| place (circle 3)            # inline 2D primitive
```

After selecting a face, you can place a predefined profile for cutting or extruding. Useful when reusing the same shape multiple times.

```
s = sketch [(5,0), arc (5,0) (0,-5) (-5,0), (0,7), (5,0)]
box 10 10 10 | faces >Z | place s | cut
box 10 10 10 | faces >Z | place s | extrude 5

profile = rect 5 5
box 10 10 10 | faces >Z | place profile | cut

box 10 10 10 | faces >Z | place (circle 3) | cut
```

