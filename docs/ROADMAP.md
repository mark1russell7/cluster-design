# Roadmap

This file is the plan of cluster-design. The Status page of the site reads it, and the tracker of the project mirrors it.

| ID | Item | Status | Summary |
| --- | --- | --- | --- |
| R1 | The first package: parts and fit rules | done | Part 1: `@mark1russell7/cluster-design` has the part classes as data (`PART_CLASSES`), the machines of a design, and 19 fit rules as Vex programs. A rule that cannot read a part gives `unread`, not a pass. Part 2: the site is a live demo of the check, with the power measures of a machine as Vex programs. |
| R2 | The formulas of a machine | in progress | The watts at idle and under load, the heat, the noise and the capacity of one machine. Each formula has units from `@mark1russell7/quantity`. Part 1: 9 new measures as Vex programs in `src/formulas.ts`, the class `fan`, 3 new fit rules, and tiles of the measures in the demo. |
| R3 | The site and its limits | done | A site as data: the circuits, the outlets, the space, the limits of heat and noise, the price of electricity. The formulas give the load of each circuit against its limit. Part 1: the record `site/1`, with volts, amperes and `USD/kWh` from `@mark1russell7/quantity` 0.4.0. A site has 5 rules and 13 measures as Vex programs, at the levels site, circuit and room. Part 2: the demo puts copies of its machine on a site of two circuits and two rooms. It shows the load, the heat and the noise against each limit, the cost for a month and each rule of the site. The address keeps the site. |
| R4 | The design space | open | A design as a configuration of `@mark1russell7/strategy-space`, so a search can go through the designs. The rules of R1 and the limits of R3 are its hard constraints. |
| R5 | The cost of a design | open | The purchase cost from the part records of `@mark1russell7/market`, and the cost of the electricity over time. |
| R6 | An interactive view | open | A page shows the space of the designs and the values of one design. |
