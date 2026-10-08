# PolyScript language reference -- index

> GENERATED from docs/content/en/language.md -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

The full specification, one file per topic. `references/cheatsheet.md` lists
what exists; read the one file below that covers what you need instead of the
whole reference (~11k tokens together). Tokens are approximate.

| File | Covers | Tokens | Starts with |
|---|---|---|---|
| `basics.md` | Overview<br>Variables<br>Import<br>Comments | ~200 | PolyScript is a pipe-based language for parametric CAD modeling. Shapes are created with primitives and tra... |
| `primitives-3d.md` | Primitives > 3D | ~500 | `cone r1 r2 h` creates a frustum. `r1` is the bottom radius, `r2` is the top radius, `h` is the height. Set... |
| `primitives-position-convention.md` | Primitives > Position Convention | ~300 | 3D primitives and `extrude` follow different placement rules along the Z axis. Mixing them without care is ... |
| `primitives-2d.md` | Primitives > 2D | ~1000 | 2D primitives produce **faces**. Use `\| extrude`, `\| cut`, `\| revolve`, or `\| loft` to create solids. |
| `primitives-paths.md` | Primitives > Paths | ~300 | `spline` creates a smooth B-spline curve that **passes through** the specified points. It can be used as th... |
| `pipe-operations-modifiers.md` | Pipe Operations > Modifiers | ~300 | Operations are chained with `\|`: |
| `pipe-operations-color.md` | Pipe Operations > Color | ~400 | Apply color to a shape. Colors are reflected per-part on export (glTF/GLB/STEP/OFF). |
| `pipe-operations-boolean.md` | Pipe Operations > Boolean<br>Pipe Operations > Shape operators `+` `-` `*` | ~500 | Shapes can be placed with `at:`: |
| `pipe-operations-place.md` | Pipe Operations > Place | ~200 | Place a 2D shape stored in a variable into the pipeline. Like `diff`/`union`/`inter`, it accepts variable r... |
| `pipe-operations-extrude-revolve-sweep-loft.md` | Pipe Operations > Extrude / Revolve / Sweep / Loft | ~1300 | `draft:` specifies a draft angle (taper) in degrees. A positive value widens outward in the extrusion direc... |
| `pipe-operations-cut-hole.md` | Pipe Operations > Cut / Hole | ~300 | `hole` can be used from both FaceSelection and PointSelection. |
| `pipe-operations-face-edge-vertex-selection.md` | Pipe Operations > Face / Edge / Vertex Selection | ~700 | Selectors use short symbols or name aliases: |
| `pipe-operations-workplane-points.md` | Pipe Operations > Workplane / Points | ~600 | Face selection implicitly creates a workplane for 2D operations. Use explicit `workplane` only when you nee... |
| `pipe-operations-transform.md` | Pipe Operations > Transform | ~1700 | `mirror` reflects across the plane perpendicular to the specified axis. `"X"` mirrors across the YZ plane, ... |
| `param-annotation.md` | @param Annotation (Basic syntax, Range shorthand, Option reference, Choices (dropdown), Practical example, CLI Override) | ~800 | Adding `@param` to a variable turns it into a parameter that can be controlled via a GUI customizer as a sl... |
| `profile-annotation.md` | @profile Annotation | ~300 | Defines **presets** that switch several top-level variables at once; the GUI customizer shows them as a "Pr... |
| `functions.md` | Functions | ~200 | Single-expression functions with `def`: |
| `expressions.md` | Expressions (Arithmetic, Comparison and Logic, Conditional, List Comprehension, Math Functions, Tuples and Lists) | ~600 | `if`/`then`/`else` is an expression, so it can be used inline: |
| `boolean-operations-source-commands.md` | Boolean Operations (Source Commands) | ~200 | `union`, `diff`, and `inter` can be used as source commands (without a pipe) to combine multiple shapes: |
| `placement.md` | Placement | ~300 | `at:` is a named argument that places a shape at the specified position. Write it with a colon `:` immediat... |
