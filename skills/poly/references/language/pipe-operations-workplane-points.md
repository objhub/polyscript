# PolyScript language: Pipe Operations

> GENERATED from docs/content/en/language.md (Pipe Operations > Workplane / Points) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Pipe Operations

### Workplane / Points

Face selection implicitly creates a workplane for 2D operations. Use explicit `workplane` only when you need a specific orientation:

```
| workplane XZ              # explicit workplane with axis
| points (polar 6 20)       # arrange points in circle
| points (grid nx ny 20)    # arrange points in grid (3rd arg = pitch)
```

As a source command, `workplane` sets the initial plane for 2D primitives, `sketch`, and `wire`:

```
workplane XZ | circle 10 | extrude 10       # circle on the XZ plane
workplane XZ | sketch [...] | extrude 5     # sketch on the XZ plane
workplane XZ | wire [...] | sweep (circle 2) # wire (spine) on the XZ plane
```

The plane names are `XY` `XZ` `YZ` and their negations `-XY` `-XZ` `-YZ`. `AB` reads "local x is world A, local y is world B"; `-AB` is the same plane with the same local axes and the normal flipped. The drawing lands in the same place; only `extrude`/`cut`/`hole` go the other way, so use the negated name to extrude toward the negative side of an axis. The `-` must touch the name (`workplane - XY` is a subtraction). The reversed spellings (`ZX` etc.) are errors that point to the signed name.

| name | local x | local y | normal (`extrude` direction) |
|---|---|---|---|
| `XY` (default) | +X | +Y | +Z |
| `-XY` | +X | +Y | −Z |
| `XZ` | +X | +Z | +Y |
| `-XZ` | +X | +Z | −Y |
| `YZ` | +Y | +Z | +X |
| `-YZ` | +Y | +Z | −X |

```
workplane XZ | circle 10 | extrude 10    # extrudes toward +Y
workplane -XZ | circle 10 | extrude 10   # extrudes toward -Y (same drawing, normal flipped)
```

There is no syntax for a named plane with an arbitrary normal. To draw on a tilted surface, select a face of a solid (`faces` hands the face normal to the workplane).

```
# hole from face selection (hole at face center)
cylinder 30 5 | faces top | hole 3

# hole from point selection (hole at each point)
cylinder 30 5
 | faces top
 | points (polar 4 10)
 | hole 3
```

#### polar / grid shorthand

In a FaceSelection or PointSelection context, you can pipe `polar` / `grid` directly, omitting `points`.

```
# shorthand (usable after face selection)
cylinder 30 5 | faces top | polar 4 10 | hole 3
box 80 60 10 | faces top | grid 3 2 15 | circle 2 | cut
```

The above is equivalent to:

```
cylinder 30 5 | faces top | points (polar 4 10) | hole 3
box 80 60 10 | faces top | points (grid 3 2 15) | circle 2 | cut
```

In a 3D context, `polar` / `grid` behave as array duplication as before. Note that the meaning changes depending on the context.

By default `polar` only translates the copies and leaves their direction alone. With `orient:true` each copy is also turned about the Z axis to face the centre. To repeat a shape that was built away from the origin by turning it in place, write `polar n 0 orient:true`. Radius 0 without `orient:true` puts every copy in the same spot and is reported as a `check.no-effect` warning.

