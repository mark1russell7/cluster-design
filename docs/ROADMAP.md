# Roadmap

This file is the plan of cluster-design. The Status page of the site reads it, and the tracker of the project mirrors it.

| ID | Item | Status | Summary |
| --- | --- | --- | --- |
| R1 | The first package: parts and fit rules | in progress | Part 1: `@mark1russell7/cluster-design` has the part classes as data (`PART_CLASSES`), the machines of a design, and 19 fit rules as Vex programs. A rule that cannot read a part gives `unread`, not a pass. Part 2: replace the first site with a demo. |
| R2 | The formulas of a machine | open | The watts at idle and under load, the heat, the noise and the capacity of one machine. Each formula has units from `@mark1russell7/quantity`. |
| R3 | The site and its limits | open | A site as data: the circuits, the outlets, the space, the limits of heat and noise, the price of electricity. The formulas give the load of each circuit against its limit. |
| R4 | The design space | open | A design as a configuration of `@mark1russell7/strategy-space`, so a search can go through the designs. The rules of R1 and the limits of R3 are its hard constraints. |
| R5 | The cost of a design | open | The purchase cost from the part records of `@mark1russell7/market`, and the cost of the electricity over time. |
| R6 | An interactive view | open | A page shows the space of the designs and the values of one design. |
