# PolyScript language: Primitives

> GENERATED from docs/content/en/language.md (Primitives > 3D) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Primitives

### 3D

```
box width height depth
cylinder radius height
sphere radius
cone r1 r2 height
torus r1 r2
wedge dx dy dz ltx
thread r pitch h
```

`cone r1 r2 h` creates a frustum. `r1` is the bottom radius, `r2` is the top radius, `h` is the height. Setting `r2` to 0 produces a full cone.

```
cone 10 5 20       # frustum (bottom R10, top R5, height 20)
cone 10 0 20       # full cone
```

`torus r1 r2` creates a donut shape. `r1` is the major radius (center to tube center), `r2` is the minor (tube) radius.

```
torus 20 5          # major radius 20, tube radius 5
```

`wedge dx dy dz ltx` creates a wedge (tapered box). The base is `dx` x `dz`, the top narrows to `ltx` x `dz`, and `dy` is the height.

```
wedge 20 10 15 5    # base 20x15, top 5x15, height 10
```

`thread r pitch h` creates an external thread, right-handed about Z. `r` is the major radius (an M16 has d = 16, so r = 8), `pitch` the pitch and `h` the length along the axis; it is centred on the origin like `cylinder`.
The groove is a V with a flat crest and a sharp root.

| option | default | meaning |
|---|---|---|
| `land:` | pitch/8 | width of the flat crest along the axis (the ISO crest truncation); 0 gives a sharp crest |
| `depth:` | (pitch - land) / 2 x sqrt(3) | groove depth from crest to root; the default gives 60-degree flanks |
| `chamfer:` | none | 45-degree chamfer. One value chamfers the **top end only** (the tip; the bottom is where a bolt head joins): `true` cuts down to the root (the ISO 4753 lead-in a nut needs), a number sets the size. `(bottom, top)` sets each end: `chamfer:(true, true)` for both |

It is built directly as a B-Rep with one face per turn, several times faster than sweeping a groove along a helix and subtracting it from a cylinder.
An `h` shorter than the pitch gives less than one turn and warns `thread.short`, since swapping `pitch` and `h` is the usual cause.

```
thread 8 2 30 chamfer:true    # M16 x P2, fully threaded, 30 long, tip chamfered to the root
thread 8.25 2 20              # a plug to cut a nut's thread with (fit +0.25)
```

