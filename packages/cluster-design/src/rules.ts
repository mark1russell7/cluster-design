/**
 * The fit rules of one machine, as Vex programs. Each program evaluates at the key of a machine in the tree of a
 * design. It reads the parts of the machine through the axis `children`, and it gives `true` when the parts fit.
 * A program that cannot read a part gives an error value, and the check then has no verdict for that rule.
 */
import { app, axes, each, let_, lit, ref, v, type Axis, type Expr } from "@mark1russell7/vex";
import { PART_CLASS_NAMES, PART_CLASSES, type PartClass } from "./parts.ts";

/** This record is one fit rule: its id, the sentence that it holds, the classes that it reads, and its program. */
export interface FitRule {
  readonly id: string;
  readonly sentence: string;
  readonly classes: readonly PartClass[];
  readonly program: Expr;
}

/** This option of a reduction gives the first error of a list, so a part with no value is not skipped. */
const STRICT: Expr = lit({ strict: true });

/** This axis gives the part lines of the machine that pass the test. */
const linesWhere = (test: Expr): Axis => axes.where(axes.children, test);

/** This expression tells if the line at the focus has the class `name`. */
const isClass = (name: PartClass): Expr => app("eq", ref("class"), lit(name));

/** This axis gives the part lines of one class. */
const linesOf = (name: PartClass): Axis => linesWhere(isClass(name));

/** This expression gives the sum of `body` over the lines of the axis. */
const total = (axis: Axis, body: Expr): Expr => app("sum", each(axis, body), STRICT);

/** This expression gives the count of the parts of one class: the sum of the counts of its lines. */
const countOf = (name: PartClass): Expr => total(linesOf(name), ref("count"));

/** This expression gives a field of the part of a class. The machine has one part of that class. */
const the = (name: PartClass, field: string): Expr => app("first", each(linesOf(name), ref(field)));

/** This expression tells if `test` holds for each line of a class. */
const every = (name: PartClass, test: Expr): Expr => app("all", each(linesOf(name), test), STRICT);

/** This expression tells if the list `list` has the text `value`. */
const contains = (list: Expr, value: Expr): Expr =>
  app("any", each(axes.list(list), app("eq", v("item"), value), undefined, ["item"]), STRICT);

/** These classes have the field `power`. The load of the power supply is the sum of their power. */
export const POWERED_CLASSES: readonly PartClass[] = PART_CLASS_NAMES.filter((name) => "power" in PART_CLASSES[name]);

const powered: Axis = linesWhere(app("or", ...POWERED_CLASSES.map(isClass)));

const exactlyOne = (name: PartClass, label: string): FitRule => ({
  id: `one-${name}`,
  sentence: `A machine has one ${label}.`,
  classes: [name],
  program: app("eq", countOf(name), lit(1)),
});

/** The name of the variable that holds the load limit of the power supply, as a ratio of its output. */
export const PSU_LOAD = "psuLoad";

/** This program gives the most power of the parts of a machine in watts: the sum of the count times the power of each line. */
export const POWER_DRAW: Expr = total(powered, app("multiply", ref("count"), ref("power")));

/** This program gives the output of the power supply of a machine in watts. */
export const POWER_OUTPUT: Expr = the("psu", "output");

/** This program gives the load limit of the power supply of a machine in watts: its output times the variable `psuLoad`. */
export const POWER_LIMIT: Expr = app("multiply", POWER_OUTPUT, v(PSU_LOAD));

/** These are the fit rules of a machine, in the order of the check. */
export const FIT_RULES: readonly FitRule[] = [
  exactlyOne("board", "board"),
  exactlyOne("case", "case"),
  exactlyOne("psu", "power supply"),
  {
    id: "cpu-count",
    sentence: "A machine has a processor, and not more processors than the sockets of its board.",
    classes: ["cpu", "board"],
    program: let_({ n: countOf("cpu") }, app("and", app("gte", v("n"), lit(1)), app("lte", v("n"), the("board", "sockets")))),
  },
  {
    id: "cpu-socket",
    sentence: "Each processor fits the socket of the board.",
    classes: ["cpu", "board"],
    program: let_({ socket: the("board", "socket") }, every("cpu", app("eq", ref("socket"), v("socket")))),
  },
  {
    id: "cooler-count",
    sentence: "Each processor has one cooler.",
    classes: ["cooler", "cpu"],
    program: app("eq", countOf("cooler"), countOf("cpu")),
  },
  {
    id: "cooler-socket",
    sentence: "Each cooler fits the socket of the board.",
    classes: ["cooler", "board"],
    program: let_({ socket: the("board", "socket") }, every("cooler", contains(ref("sockets"), v("socket")))),
  },
  {
    id: "cooler-rating",
    sentence: "Each cooler takes the thermal design power of the hottest processor.",
    classes: ["cooler", "cpu"],
    program: let_({ hottest: app("max", each(linesOf("cpu"), ref("tdp")), STRICT) }, every("cooler", app("gte", ref("rating"), v("hottest")))),
  },
  {
    id: "cooler-height",
    sentence: "Each cooler fits in the height of the case.",
    classes: ["cooler", "case"],
    program: let_({ room: the("case", "coolerHeight") }, every("cooler", app("lte", ref("height"), v("room")))),
  },
  {
    id: "memory-count",
    sentence: "A machine has a memory kit.",
    classes: ["memory"],
    program: app("gte", countOf("memory"), lit(1)),
  },
  {
    id: "memory-type",
    sentence: "Each memory kit has the memory type of the board.",
    classes: ["memory", "board"],
    program: let_({ type: the("board", "memoryType") }, every("memory", app("eq", ref("memoryType"), v("type")))),
  },
  {
    id: "memory-slots",
    sentence: "The memory modules fit in the memory slots of the board.",
    classes: ["memory", "board"],
    program: app("lte", total(linesOf("memory"), app("multiply", ref("count"), ref("modules"))), the("board", "memorySlots")),
  },
  {
    id: "memory-size",
    sentence: "The memory is not more than the most memory of the board.",
    classes: ["memory", "board"],
    program: app(
      "lte",
      total(linesOf("memory"), app("multiply", app("multiply", ref("count"), ref("modules")), ref("moduleSize"))),
      the("board", "maxMemory"),
    ),
  },
  {
    id: "board-in-case",
    sentence: "The case takes the form factor of the board.",
    classes: ["board", "case"],
    program: let_({ form: the("board", "formFactor") }, contains(the("case", "boardFormFactors"), v("form"))),
  },
  {
    id: "psu-in-case",
    sentence: "The case takes the form factor of the power supply.",
    classes: ["psu", "case"],
    program: let_({ form: the("psu", "formFactor") }, contains(the("case", "psuFormFactors"), v("form"))),
  },
  {
    id: "gpu-length",
    sentence: "Each graphics card fits in the length of the case.",
    classes: ["gpu", "case"],
    program: let_({ room: the("case", "gpuLength") }, every("gpu", app("lte", ref("length"), v("room")))),
  },
  {
    id: "m2-slots",
    sentence: "The M.2 drives fit in the M.2 slots of the board.",
    classes: ["storage", "board"],
    program: app(
      "lte",
      total(linesWhere(app("and", isClass("storage"), app("eq", ref("interface"), lit("m.2")))), ref("count")),
      the("board", "m2Slots"),
    ),
  },
  {
    id: "sata-ports",
    sentence: "The SATA drives fit in the SATA ports of the board.",
    classes: ["storage", "board"],
    program: app(
      "lte",
      total(linesWhere(app("and", isClass("storage"), app("eq", ref("interface"), lit("sata")))), ref("count")),
      the("board", "sataPorts"),
    ),
  },
  {
    id: "psu-load",
    sentence: "The most power of the parts is not more than the load limit of the power supply.",
    classes: [...POWERED_CLASSES, "psu"],
    program: app("lte", POWER_DRAW, POWER_LIMIT),
  },
];
