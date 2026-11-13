# cluster-design

The design of a computer cluster as formulas with units. A design is data: the machines, the parts of each machine, and the site that holds them.

The first package has the part classes and the fit rules. [`docs/ROADMAP.md`](docs/ROADMAP.md) has the plan.

## The model

- A **part** has a class and its attributes. The classes are the processor, the board, the memory, the drive, the power supply, the case, the cooler and the graphics card.
- A **fit rule** tells which parts go together: the socket, the memory type, the size of the board, the power of the supply.
- A **machine** is a set of parts that fit.
- A **site** is input data: the circuits and their amps, the outlets, the space, the limits of heat and noise, and the price of electricity.
- A **design** is a set of machines at a site.
- The formulas give the capacity of a design, its watts, its heat, its noise, the load of each circuit and its cost.

This repository has no prices and no site of its own. They are input data.

## The packages

| Package | What it has |
| --- | --- |
| [`@mark1russell7/cluster-design`](packages/cluster-design) | The part classes and the fit rules. The formulas of a machine, a site and a design come next. |

Other packages give the general parts:

- `@mark1russell7/quantity` gives the amounts with units.
- `@mark1russell7/vex` gives the roll-ups over the parts of a design.
- `@mark1russell7/strategy-space` gives the space of the designs, so a search can go through them.
- `@mark1russell7/market` gives the part records and their prices.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm lint:ste
```

The license is MIT.
