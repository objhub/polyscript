# PolyScript language: Primitives

> GENERATED from docs/content/en/language.md (Primitives > 2D) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Primitives

### 2D

```
rect width height
circle radius
ellipse rx ry
polygon n r
polyline points
text content size
sketch [segments]
```

2D primitives produce **faces**. Use `| extrude`, `| cut`, `| revolve`, or `| loft` to create solids.

2D shapes come in two types:

| Type | Produced by | Meaning |
|---|---|---|
| **Face** | `rect` `circle` `ellipse` `polygon` `polyline` `text` `sketch [...]`, the result of a 2D boolean or `offset` | A region with area. May contain holes |
| **Wire** | `wire [...]` `line` `arc` `bezier` `spline` `helix` | A curve. Has no area even when closed |

The type is fixed by the command and never changes afterwards. `extrude`, `cut`, `revolve`, `loft` and the 2D booleans (`diff` `union` `inter`) require a Face and raise an error on a Wire. The only way to turn a Wire into a Face is `offset d`, which gives the line a thickness of `2|d|`. Conversely, wherever a curve is needed -- the spine or profile of `sweep` -- a Face stands in for its outline.

`text` converts a text string into 2D faces; the inner contours of glyphs such as "O" and "A" become holes. The CLI picks up a system font (DejaVu Sans, Liberation Sans, Noto Sans, Roboto or Arial, in that order); in the browser the host supplies the font. Without one, `text` falls back to a rectangular placeholder.

`polygon n r` creates a regular n-gon inscribed in a circle of radius `r`. `polyline points` creates a closed wire from a vertex list.

```
polygon 6 10            # regular hexagon (inscribed circle radius 10)
polyline [(0,0), (10,0), (5,10)]   # closed wire from vertices
```

#### sketch -- Composite wire

Combine lines, arcs, and Bezier curves to create a closed 2D profile of any shape. Useful for shapes that `rect` or `circle` cannot express.

```
sketch [
  (5, 0),                              # start point (tuple)
  arc (5, 0) (0, -5) (-5, 0),          # arc: start → through → end
  (0, 7),                              # line (tuple only)
  (5, 0)                               # line (returns to start, auto-close)
]
```

Segment types:

| Syntax | Meaning |
|---|---|
| `(x, y)` | Line from the previous point |
| `arc (sx, sy) (mx, my) (ex, ey)` | 3-point arc (start, through, end) |
| `arc (sx, sy) (ex, ey) center:(cx, cy)` | Center arc (start, end, center) |
| `arc (sx, sy) (ex, ey) radius:radius` | Radius arc (start, end, radius; center is computed automatically) |
| `bezier [(x1,y1), ...]` | Bezier curve (control point list; start point is implicit from the preceding segment, last element is the end point) |

The first element must be a tuple (the start point). If the last segment returns to the start point, the wire closes automatically. When the start point of an `arc` does not match the end point of the preceding segment, a straight line is automatically inserted to bridge the gap. The result can be turned into a solid with extrude or cut.

**Which arc should I use?**

| Goal | Recommended |
|---|---|
| Specify three points (start, through, end) | `arc start through end` |
| Draw a precise arc given center and end point | `arc start end center:(cx,cy)` |
| Round a corner with just radius and end point | `arc start end radius:radius` |

```
# Extrude a teardrop shape
sketch [
  (5, 0),
  arc (5, 0) (0, -5) (-5, 0),
  (0, 7),
  (5, 0)
] | extrude 10

# D-shaped hole
r = 3
sketch [
  (-r, r),
  (-r, -r),
  arc (-r, -r) (0, -r - 1) (r, -r),
  (r, r),
  (-r, r)
]

# True quarter arc (center specified)
sketch [
  (r, 0),
  arc (r, 0) (0, r) center:(0, 0),
  (0, 0),
  (r, 0)
]

# Rounded rectangle (radius form is the most concise)
w = 20
h = 10
cr = 2
sketch [
  (w/2 - cr, -h/2),
  arc (w/2 - cr, -h/2) (w/2, -h/2 + cr) radius:cr,
  (w/2, h/2 - cr),
  arc (w/2, h/2 - cr) (w/2 - cr, h/2) radius:cr,
  (-w/2 + cr, h/2),
  arc (-w/2 + cr, h/2) (-w/2, h/2 - cr) radius:cr,
  (-w/2, -h/2 + cr),
  arc (-w/2, -h/2 + cr) (-w/2 + cr, -h/2) radius:cr
] | extrude 5
```

