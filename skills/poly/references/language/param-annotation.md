# PolyScript language: @param Annotation

> GENERATED from docs/content/en/language.md (@param Annotation (Basic syntax, Range shorthand, Option reference, Choices (dropdown), Practical example, CLI Override)) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## @param Annotation

Adding `@param` to a variable turns it into a parameter that can be controlled via a GUI customizer as a slider or dropdown. Write it on the line immediately before the variable declaration.

```
@param 10..200 step:5 desc:"Box width"
width = 80

box width 60 10
```

This alone displays a slider in the GUI ranging from 10 to 200 in increments of 5.

### Basic syntax

```
@param options...
variable_name = default_value
```

### Range shorthand

A concise way to write common min/max/step patterns:

| Notation | Meaning |
|---|---|
| `@param 1..100` | min:1 max:100 |
| `@param 1..100..0.5` | min:1 max:100 step:0.5 |
| `@param -10..10..1` | min:-10 max:10 step:1 |

You can also append options after the shorthand:

```
@param 1..100 desc:"Height"
```

### Option reference

| Key | Type | Description |
|---|---|---|
| `min` | number | Minimum value (slider lower bound) |
| `max` | number | Maximum value (slider upper bound) |
| `step` | number | Step size (slider increment) |
| `label` | string | Display label (defaults to variable name if omitted) |
| `desc` | string | Description text (tooltip) |
| `choices` | list | Choice list (dropdown) |
| `group` | string | GUI group name (default: `"General"`) |
| `type` | string | Type hint: `"int"`, `"float"`, `"string"`, `"bool"` |
| `hidden` | boolean | `true` to hide from GUI |

If `type` is omitted, it is inferred from the default value (`42` → int, `2.5` → float, `"PLA"` → string, `true` → bool).

### Choices (dropdown)

Use `choices` to display a dropdown menu:

```
@param choices:["M3", "M4", "M5", "M6"] desc:"Bolt size"
bolt = "M4"
```

### Practical example

```
@param 40..200 step:5 group:"Dimensions" desc:"Case width"
case_w = 100

@param 30..150 step:5 group:"Dimensions" desc:"Case depth"
case_d = 60

@param 1..5 step:0.5 group:"Wall" desc:"Wall thickness"
wall = 2

@param type:"bool" group:"Features" desc:"Add ventilation holes"
vents = true

box case_w case_d 40
 | color "steel"
 | faces >Z | shell wall
```

### CLI Override

The `poly build` command's `-D key=value` option lets you override parameters at build time. Use `--params-file` to load values from a JSON file.

```bash
poly build model.poly -D width=100 -D height=50
poly build model.poly --params-file presets/large.json
```

`-D` values are type-inferred (`100` -> int, `1.5` -> float, `true` -> bool, `PLA` -> string). When the same key is specified in multiple sources, the precedence order is:

1. CLI `-D`
2. `--params-file` (flat key-value JSON)
3. `@param` default values

Passing an unknown parameter name via `-D` produces a warning but does not stop execution.

Values are checked against the annotation. A value that is not one of `choices` is an error (`param.choice`). A number outside the `min..max` range is a warning (`param.range`): the range is the GUI slider's, and going past it on purpose is allowed, but `poly verify` (strict by default) and `--strict` stop on it.

See Getting Started for a hands-on walkthrough.

