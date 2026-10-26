# PolyScript language: Pipe Operations

> GENERATED from docs/content/en/language.md (Pipe Operations > Extrude / Revolve / Sweep / Loft) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Pipe Operations

### Extrude / Revolve / Sweep / Loft

```
| extrude height draft:angle
| revolve axis [deg]         # axis: X/Y/Z, deg defaults to 360
| sweep profile              # pipeline subject is the spine (a wire); argument is the profile (a wire)
| loft [sections] height
| loft [sections] [offsets]
| loft [sections] height ruled:true
```

```
rect 60 40 | extrude 15
rect 10 30 at:(15, 0) | revolve Y
circle 5 | loft [rect 8 8] 10
circle 5 | loft [rect 8 8, circle 3] [5, 15]
```

`draft:` specifies a draft angle (taper) in degrees. A positive value narrows the shape toward the far end of the extrusion, as a moulded part tapers for release; a negative value widens it. The base keeps the size you drew: `rect 20 20 | extrude 10 draft:10` is 20 across at the bottom and 16.47 at the top (20 - 2 x 10 x tan 10deg).

`ruled:true` interpolates between sections with straight lines (the default is a smooth surface).

#### revolve -- Solid of revolution

Revolves a 2D profile around the specified axis to create a solid.

```
| revolve axis         # full 360° revolution (axis: X, Y, or Z)
| revolve axis deg     # revolve by specified angle
```

**The profile must be placed entirely on one side of the rotation axis.** A profile that straddles the axis (e.g., `circle 20` centered at the origin) will produce a degenerate shape error. Use `at:(x, y)` to offset the profile from the origin, or draw a wire on one side of the axis with `sketch`.

```
# Ring (torus-like)
rect 10 30 at:(15, 0) | revolve Y

# Vase / bowl (half revolution)
sketch [(0, 0), (15, 0), (15, 3), (3, 20), (0, 20)]
  | revolve Y 180

# Revolution around the X axis
circle 5 at:(0, 20) | revolve X
```

#### sweep -- Path sweep

Sweeps the argument profile (cross-section) along the pipeline spine (trajectory) to create a 3D shape. The spine is a **Wire** (open or closed); the profile may be a **Face** (closed cross-section) or a **Wire** (open cross-section). When a Face is given, its outline is used (a face with holes is not accepted). "Spine" and "profile" name the *role* a shape plays; there is no `path` type.

Syntax: `spine | sweep profile`

- **Open wires**: `line`, `arc`, `bezier`, `spline`, `helix`, `wire [...]`
- **Closed outlines (Faces)**: `circle`, `rect`, `ellipse`, `polygon`, `polyline`, `sketch [...]`

The open/closed combination of spine and profile determines the resulting shape:

| spine | profile | Result |
|---|---|---|
| open | closed | Tubular solid (primary use case) |
| closed | closed | Closed-loop tube (torus-like) |
| open | open | Strip surface (thread grooves, etc.) |

```
# Tubular solid: sweep a circle along a curved path
arc (0, -25) (25, 0) center:(0, 0) | sweep (circle 5)

# Torus: major radius 50, minor radius 10
circle 50 | sweep (circle 10)

# Pipe along a spline
spline [(0,0,0), (10,5,5), (20,0,10)] | sweep (circle 3)
```

> **Note**: `sketch [...]` always auto-closes (it produces a closed wire), so it **cannot be used as an open spine** for sweep. When you need an open multi-segment wire, use the `wire [...]` literal or path primitives such as `line`/`arc`/`spline`.

#### wire -- Open wire literal

The open counterpart to `sketch [...]`. Joins multiple segments into an **open wire** (no auto-close). Perfect for building a complex sweep spine in a single expression.

```
wire [
  segment1,
  segment2,
  ...
]
```

Segments use the same syntax as `sketch` (except `tarc`). Both 2D and 3D coordinates are supported.

| Syntax | Meaning |
|---|---|
| `(x, y)` or `(x, y, z)` | Line from the previous point |
| `line (start) (end)` | Line segment |
| `arc (start) (through) (end)` | 3-point arc |
| `arc (start) (end) center:(cx,cy)` | Center arc |
| `arc (start) (end) radius:radius` | Radius arc |
| `bezier [...]` | Bezier curve (start point is implicit from the preceding segment; list contains control points and the end point) |
| `spline [...]` | B-spline curve (start point is implicit from the preceding segment; list contains through-points and the end point) |

**How wire differs from sketch:**

| | sketch | wire |
|---|---|---|
| Auto-close | yes | **no** |
| Type | **Face** | **Wire** (curve) |
| Output | A face; can be extruded/cut | An open curve; never a face even when closed |
| Coordinates | 2D | 2D/3D |
| Primary use | extrude/revolve/cut | sweep spine |

```
# Basic: line + arc combined into a path
wire [
  (0, 0),
  (10, 0),
  arc (10, 0) (15, 5) radius:5,
  (15, 20)
]

# Combined with sweep: L-shaped pipe (wire is the spine, circle is the profile)
wire [
  (0, 0),
  (10, 0),
  arc (10, 0) (15, 5) radius:5
] | sweep (circle 5)

# 3D wire -- just use 3D tuples
wire [(0, 0, 0), (10, 0, 5), (20, 10, 10)]

# Workplane + wire: draw a wire on the XZ plane, then sweep with a circle profile
workplane XZ | wire [(0,0),(10,0),(10,10),(0,10),(0,0)] | sweep (circle 2)
```

Like `sketch`, `wire` can receive a workplane via pipe. This lets you draw wires on any plane, not just the default XY.

#### Sweep usage guide

| Purpose | Recommended |
|---|---|
| Spine, single segment | `line`/`arc`/`helix`/`spline` (path primitives) |
| Spine, multiple segments | `wire [...]` literal |
| Profile (closed cross-section) | `circle`/`rect`/... or `sketch [...]` |
| Profile (open cross-section) | `wire [...]` |

