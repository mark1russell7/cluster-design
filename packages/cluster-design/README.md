# @mark1russell7/cluster-design

The design of a computer cluster as math. This package has the records of the parts, the machines of a design, and the fit rules that tell which parts fit in one machine.

The package is private. It is not on npm.

## The model

- A **part** has a class and the fields of its class. `PART_CLASSES` is the table of the classes: `cpu`, `board`, `memory`, `storage`, `psu`, `case`, `cooler` and `gpu`.
- A field is a text, a list of texts, a count, a choice, or an **amount** with a unit from `@mark1russell7/quantity`.
- A **machine** has an id and part lines. A part line is the id of a part and its count.
- A **fit rule** is a Vex program as data. It evaluates at one machine and reads the part lines of the machine.

## Check a design

```ts
import { checkDesign, overall, readCatalog } from "@mark1russell7/cluster-design";

const catalog = readCatalog(parts); // the parts as data, from a file or a market
if (!catalog.ok) throw new Error(catalog.problems.join("\n"));

const result = checkDesign([{ id: "node-1", lines: [{ part: "cpu-a", count: 1 } /* ... */] }], catalog.value);
if (result.ok) console.log(overall(result.findings)); // "fits", "breaks" or "unread"
```

Each finding has a machine, a rule, the sentence of the rule and a verdict:

| Verdict | Meaning |
| --- | --- |
| `fits` | The program of the rule gave `true`. |
| `breaks` | The program gave `false`. |
| `unread` | The program gave an error value, or a value that is not `true` or `false`. The field `detail` has the reason. |

A rule that cannot read a part gives `unread`, and not `fits`. For example, a machine with no case gives `unread` for the rule `board-in-case`, and `breaks` for the rule `one-case`.

The option `psuLoad` sets the load limit of a power supply, as a ratio of its output. The default is 0.8.

## The fit rules

| Rule | The sentence that it holds |
| --- | --- |
| `one-board` | A machine has one board. |
| `one-case` | A machine has one case. |
| `one-psu` | A machine has one power supply. |
| `cpu-count` | A machine has a processor, and not more processors than the sockets of its board. |
| `cpu-socket` | Each processor fits the socket of the board. |
| `cooler-count` | Each processor has one cooler. |
| `cooler-socket` | Each cooler fits the socket of the board. |
| `cooler-rating` | Each cooler takes the thermal design power of the hottest processor. |
| `cooler-height` | Each cooler fits in the height of the case. |
| `memory-count` | A machine has a memory kit. |
| `memory-type` | Each memory kit has the memory type of the board. |
| `memory-slots` | The memory modules fit in the memory slots of the board. |
| `memory-size` | The memory is not more than the most memory of the board. |
| `board-in-case` | The case takes the form factor of the board. |
| `psu-in-case` | The case takes the form factor of the power supply. |
| `gpu-length` | Each graphics card fits in the length of the case. |
| `m2-slots` | The M.2 drives fit in the M.2 slots of the board. |
| `sata-ports` | The SATA drives fit in the SATA ports of the board. |
| `psu-load` | The most power of the parts is not more than the load limit of the power supply. |

## Units

Each amount field of `PART_CLASSES` names the unit that the rules read. `designTree` converts each amount to that unit with `valueIn` of `@mark1russell7/quantity`, before the evaluation. Thus a case with a cooler height of 16 cm and a cooler of 155 mm fit.

Vex has no domain of amounts with units yet. When it gets one, the rules can read the amounts directly.

## Development

```sh
pnpm typecheck
pnpm test
```

The tests use the parts of `src/sample.ts`. The parts are generic, and no part names a maker.
