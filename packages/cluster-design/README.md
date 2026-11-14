# @mark1russell7/cluster-design

The design of a computer cluster as math. This package has the records of the parts, the machines of a design, and the fit rules that tell which parts fit in one machine. It also has the formulas of a machine: its power, its heat, its noise and its capacity. A site holds the machines. Its rules and measures give the load of each circuit, the heat and the noise of each room, and the cost of the electricity.

The package is private. It is not on npm.

## The model

- A **part** has a class and the fields of its class. `PART_CLASSES` is the table of the classes: `cpu`, `board`, `memory`, `storage`, `psu`, `case`, `cooler`, `fan` and `gpu`.
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
| `fan-slots` | The fans fit in the fan slots of the case. |
| `gpu-length` | Each graphics card fits in the length of the case. |
| `m2-slots` | The M.2 drives fit in the M.2 slots of the board. |
| `sata-ports` | The SATA drives fit in the SATA ports of the board. |
| `idle-power` | Each part takes less power at idle than its most power, or the same power. |
| `psu-efficiency` | The efficiencies of the power supply are more than 0 percent and not more than 100 percent. |
| `psu-load` | The most power of the parts is not more than the load limit of the power supply. |

## The measures of a machine

`measureDesign` gives the value of each measure at each machine, with its unit. Each measure is a Vex program too.

| Measure | Unit | Value |
| --- | --- | --- |
| `power` | W | The most power of the parts: the sum of the count times the power of each line. |
| `power-limit` | W | The load limit of the power supply: its output times `psuLoad`. |
| `power-output` | W | The output of the power supply. |
| `idle-power` | W | The power of the parts at idle: the sum of the count times the `idlePower` of each line. |
| `wall-power` | W | The most power from the wall: `power` divided by the `efficiency` of the power supply. |
| `wall-idle-power` | W | The power from the wall at idle: `idle-power` divided by the `idleEfficiency` of the power supply. |
| `noise` | dBA | The most sound level of the parts together, at 1 m. |
| `cores` | count | The sum of the cores of the processors. |
| `threads` | count | The sum of the threads of the processors. |
| `memory` | GiB | The sum of the count times the modules times the module size of each memory kit. |
| `storage` | GB | The sum of the capacity of the drives. |
| `runner-slots` | count | The CI jobs that the machine runs at one time. |

The rule `psu-load` reads the programs of `power` and `power-limit`. Thus the measures and the rule always agree. A test with random designs holds this. The rule `memory-size` reads the program of `memory` in the same way.

`src/formulas.ts` has each program, and the entry exports them: `POWER_DRAW`, `IDLE_DRAW`, `WALL_POWER`, `NOISE`, `RUNNER_SLOTS` and the others.

### Heat

Each watt from the wall becomes heat in the room. Thus `wall-power` is also the most heat of the machine, and `wall-idle-power` is its heat at idle. The efficiency of a power supply is at a half load. Its idle efficiency is at a load of 10 percent.

### Noise

The program `noise` adds the sound energy of the parts, and not their levels in dBA. It gives 10 log10 of the sum of the count times 10^(L/10) of each line. Two equal sources give 3 dB more than one source. Ten equal sources give 10 dB more.

Each level is the level of one part at 1 m, as a data sheet gives it. The classes with the field `noise` are `storage`, `psu`, `cooler`, `fan` and `gpu`.

### Runner slots

The program `runner-slots` gives the CI jobs that fit in the threads and the memory of a machine. The system of the machine keeps a reserve. The value is the smaller quotient, rounded down, and not less than 0:

```text
floor(max(0, min((threads - reserve threads) / job threads, (memory - reserve memory) / job memory)))
```

The option `job` sets the size of one job. The default `DEFAULT_JOB` is 4 threads and 16 GiB, the size of a standard hosted runner of GitHub for a public repository. The option `reserve` sets the reserve of the system. The default `DEFAULT_RESERVE` is no thread and 2 GiB.

```ts
const result = measureDesign(machines, catalog, { job: { threads: 2, memory: 7 }, reserve: { threads: 1, memory: 4 } });
```

`evaluateDesign` evaluates other programs at each machine of a design, with the same tree and the same variables.

## A site

A **site** holds the machines of a design. It is input data: the price of electricity, the circuits, the rooms and the place of each machine. This package has no site of its own.

| Record | Fields |
| --- | --- |
| site | `format` (`site/1`), `price` (a price of energy, for example `USD/kWh`), `circuits`, `rooms` and `places` |
| circuit | `id`, `voltage` (V), `breaker` (A, the rating of the breaker), `sockets` (the free sockets) and `otherLoad` (W, the power of the other loads) |
| room | `id`, `places` (the places for machines), `heatLimit` (W, the heat that the cooling of the room takes away) and `noiseLimit` (dBA) |
| place | `machine`, `circuit` and `room`: the circuit that the machine plugs into, and the room that it stands in |

`readSite` reads a site from data. An amount with a unit of a different kind is a problem, for example a breaker in watts.

```ts
import { checkSite, measureSite, readSite } from "@mark1russell7/cluster-design";

const site = readSite(data); // the site as data, from a private file
if (!site.ok) throw new Error(site.problems.join("\n"));

const check = checkSite(site.value, machines, catalog); // the findings of each circuit and each room
const measures = measureSite(site.value, machines, catalog); // the value of each measure, with its unit
```

`siteTree` makes the tree of the evaluation. The root is the site, and its children are the circuits and the rooms. The machines are the children of their circuits, and each machine has the id of its room. Each machine of the design has one place. A place that names a machine, a circuit or a room that is not in the input is a problem. A machine with no place is a problem too.

The option `continuousLoad` sets the continuous load limit of a circuit, as a ratio of the rating of its breaker. The default is 0.8, the limit that the electrical code of the United States sets for a continuous load. A machine that runs CI jobs for hours is a continuous load.

### The rules of a site

| Rule | Level | The sentence that it holds |
| --- | --- | --- |
| `circuit-load` | circuit | The most power of a circuit is not more than its continuous load limit. |
| `circuit-plugs` | circuit | The power supplies on a circuit are not more than its free sockets. |
| `room-heat` | room | The most heat of the machines in a room is not more than the heat limit of the room. |
| `room-noise` | room | The most sound level of the machines in a room is not more than the noise limit of the room. |
| `room-places` | room | The machines in a room are not more than the places of the room. |

A rule gives the verdict `unread` when it cannot read a value. For example, a machine with no power supply has no power from the wall. Thus its circuit and its room get `unread`, and not `fits`.

### The measures of a site

| Measure | Level | Unit | Value |
| --- | --- | --- | --- |
| `power` | site | W | The sum of the `wall-power` of the machines. |
| `idle-power` | site | W | The sum of the `wall-idle-power` of the machines. |
| `cost` | site | USD | The cost of a month when each machine takes its most power: `power` in kW, times 730.485 hours, times `price`. |
| `idle-cost` | site | USD | The cost of a month when each machine is idle. |
| `load` | circuit | W | The `wall-power` of the machines on the circuit, plus its `otherLoad`. |
| `idle-load` | circuit | W | The `wall-idle-power` of the machines on the circuit, plus its `otherLoad`. |
| `current` | circuit | A | `load` divided by `voltage`. |
| `limit` | circuit | W | `voltage` times `breaker` times `continuousLoad`. |
| `plugs` | circuit | count | The power supplies of the machines on the circuit. |
| `heat` | room | W | The `wall-power` of the machines in the room. |
| `idle-heat` | room | W | The `wall-idle-power` of the machines in the room. |
| `noise` | room | dBA | The sound level of the machines in the room together, at 1 m from each machine. A room with no machine gives 0. |
| `machines` | room | count | The machines in the room. |

The programs of a site use the programs of a machine. Thus a site and its machines always agree. The rule `circuit-load` reads the programs of `load` and `limit`, and a property test holds that the rule and the measures agree. A month is a mean month of the Gregorian calendar: 730.485 hours, from the unit `mo` of `@mark1russell7/quantity`.

## Units

Each amount field of `PART_CLASSES` names the unit that the rules read. `designTree` converts each amount to that unit with `valueIn` of `@mark1russell7/quantity`, before the evaluation. Thus a case with a cooler height of 16 cm and a cooler of 155 mm fit.

Vex has no domain of amounts with units yet. When it gets one, the rules can read the amounts directly.

## Development

```sh
pnpm typecheck
pnpm test
```

The tests use the parts of `src/sample.ts`. The parts are generic, and no part names a maker. Property tests with `fast-check` hold three laws of the formulas. These are the noise of equal sources, the order of the runner slots and the power from the wall. The entry `@mark1russell7/cluster-design/sample` gives them to the demo of the site.
