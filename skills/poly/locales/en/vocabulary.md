# vocabulary

> GENERATED from docs/content/en/vocabulary.md -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

"Round the corners", "hollow it out" -- a table from the words in your head to
the operation that does it. The syntax itself is in the
`references/cheatsheet.md`.

## Changing a shape

| You say | Operation | Example |
|---|---|---|
| round the corners, radius, fillet | `fillet r` | `edges =Z \| fillet 3` |
| bevel, chamfer, break the edge | `chamfer c` | `edges >Z \| chamfer 1` |
| hollow out, make it a box/cup, wall it | `faces` + `shell t` | `faces >Z \| shell 2` |
| cut away, subtract, remove | `diff` | `\| diff (cylinder 5 30)` |
| add, join, stick on | `union` | `\| union boss` |
| keep only the overlap | `inter` | `\| inter (sphere 20)` |
| hole, drill, bore | `hole r` | `faces >Z \| hole 3` |
| counterbore, countersink | two `hole`s, stepped | `hole 3.4`, then a shallow `hole 6` |
| through hole | `hole r` with no depth | omit the depth and it goes through |
| slot, groove, channel | a thin `box`, then `diff` | `\| diff (slot)` |
| offset, clearance, relief | `offset d` | `\| offset -1` (inward) |
| make the plate thicker | the `extrude` value | — |

## Making a solid

| You say | Operation | Example |
|---|---|---|
| extrude, pull up | `extrude h` | `rect 50 30 \| extrude 10` |
| turned, lathe, vase, cup, bowl | `sketch` + `revolve` | `sketch [...] \| revolve Y` |
| draw the cross-section | `sketch [...]` | a closed profile |
| follow a path, pipe, tube | `wire`/`helix` + `sweep` | `wire [...] \| sweep (circle 3)` |
| spring, the path of a thread | `helix` + `sweep` | `helix 5 30 10 \| sweep (circle 2)` |
| loft between two shapes | `loft [sections] h` | `loft [rect 8 8] 10` |
| taper, draft | `extrude h draft:5` | positive narrows toward the top, negative widens |
| wedge, ramp | `wedge` | `wedge 20 10 15 5` |

## Position and orientation

| You say | Operation | Note |
|---|---|---|
| move, shift | `translate x y z` | |
| rotate, tilt | `rotate rx ry rz` | `origin:"local"` turns about its own centre |
| scale, resize | `scale s` | |
| mirror, flip | `mirror "X"` | |
| sit it on the bed, put z=0 at the bottom | `floor` | **primitives are centred on the origin, so this is needed more often than you expect** |
| array, grid | `grid nx ny pitch` | |
| arrange in a circle | `polar n r` | |
| put it on that face | `faces` + `place` | |

## Names for parts

| You say | How to build it |
|---|---|
| boss (a post for a screw) | `union` a `cylinder`, then `hole` at the pilot diameter |
| rib (a stiffener) | `union` a thin `box` |
| flange | `union` a wide, thin `cylinder` |
| foot ring (on the base of a vessel) | `union` a ring of `cylinder` underneath, `diff` the inside |
| drainage | `grid` + `hole`, or a row of ribs |
| clip, hook | `union` an L-shaped `box` |
| lid | `extrude` the same outline, then `offset -clearance` for the part that fits inside |
| press fit, clearance fit | the clearance to use is in the dimensions table |

## Ways of saying which face

| You say | Selector |
|---|---|
| top | `>Z` or `top` |
| bottom | `<Z` or `bottom` |
| the sides | `=Z` (faces that contain the Z direction) |
| right / left | `>X` / `<X` |
| front / back | `<Y` (front) / `>Y` (back) |
| the vertical edges (corners) | `edges =Z` |
| the top rim | `edges >Z` |
| all of them | leave the selector out |

`=Z` is the sides, not the top (top + bottom is `=XY`). `front` is the **minus** side. Both are easy to
get backwards.
