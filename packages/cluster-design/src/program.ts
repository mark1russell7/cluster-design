/**
 * The parts of the Vex programs of a machine. Each program evaluates at the key of a machine in the tree of a
 * design. It reads the part lines of the machine through the axis `children`. The fit rules and the formulas
 * use these parts. The entry of the package does not export this module.
 */
import { app, axes, each, lit, ref, v, type Axis, type Expr } from "@mark1russell7/vex";
import type { PartClass } from "./parts.ts";

/** This option of a reduction gives the first error of a list, so a part with no value is not skipped. */
export const STRICT: Expr = lit({ strict: true });

/** This axis gives the part lines of the machine that pass the test. */
export const linesWhere = (test: Expr): Axis => axes.where(axes.children, test);

/** This expression tells if the line at the focus has the class `name`. */
export const isClass = (name: PartClass): Expr => app("eq", ref("class"), lit(name));

/** This axis gives the part lines of one class. */
export const linesOf = (name: PartClass): Axis => linesWhere(isClass(name));

/** This axis gives the part lines of each class of the list. */
export const linesOfAny = (names: readonly PartClass[]): Axis => linesWhere(app("or", ...names.map(isClass)));

/** This expression gives the sum of `body` over the lines of the axis. */
export const total = (axis: Axis, body: Expr): Expr => app("sum", each(axis, body), STRICT);

/** This expression gives the sum of the count times `body` over the lines of the axis. */
export const totalOfCount = (axis: Axis, body: Expr): Expr => total(axis, app("multiply", ref("count"), body));

/** This expression gives the count of the parts of one class: the sum of the counts of its lines. */
export const countOf = (name: PartClass): Expr => total(linesOf(name), ref("count"));

/** This expression gives a field of the part of a class. The machine has one part of that class. */
export const the = (name: PartClass, field: string): Expr => app("first", each(linesOf(name), ref(field)));

/** This expression tells if `test` holds for each line of a class. */
export const every = (name: PartClass, test: Expr): Expr => app("all", each(linesOf(name), test), STRICT);

/** This expression tells if the list `list` has the text `value`. */
export const contains = (list: Expr, value: Expr): Expr =>
  app("any", each(axes.list(list), app("eq", v("item"), value), undefined, ["item"]), STRICT);
