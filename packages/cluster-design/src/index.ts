/**
 * The design of a computer cluster as math. This package has the records of the parts and the machines of a design.
 * It also has the fit rules, which tell which parts fit in one machine. Its formulas give the measures of a machine:
 * its power, its heat, its noise and its capacity.
 */
export * from "./parts.ts";
export * from "./machine.ts";
export * from "./formulas.ts";
export * from "./rules.ts";
export * from "./evaluate.ts";
export * from "./check.ts";
export * from "./measure.ts";
