/**
 * The fit rules of one machine, as Vex programs. Each program evaluates at the key of a machine in the tree of a
 * design. It reads the parts of the machine through the axis `children`, and it gives `true` when the parts fit.
 * A program that cannot read a part gives an error value, and the check then has no verdict for that rule.
 */
import { app, each, let_, lit, ref, v, type Expr } from "@mark1russell7/vex";
import { MEMORY, POWER_DRAW, POWER_LIMIT, POWERED_CLASSES } from "./formulas.ts";
import type { PartClass } from "./parts.ts";
import { contains, countOf, every, isClass, linesOf, linesOfAny, linesWhere, STRICT, the, total } from "./program.ts";

/** This record is one fit rule: its id, the sentence that it holds, the classes that it reads, and its program. */
export interface FitRule {
  readonly id: string;
  readonly sentence: string;
  readonly classes: readonly PartClass[];
  readonly program: Expr;
}

const exactlyOne = (name: PartClass, label: string): FitRule => ({
  id: `one-${name}`,
  sentence: `A machine has one ${label}.`,
  classes: [name],
  program: app("eq", countOf(name), lit(1)),
});

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
    program: app("lte", MEMORY, the("board", "maxMemory")),
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
    id: "fan-slots",
    sentence: "The fans fit in the fan slots of the case.",
    classes: ["fan", "case"],
    program: app("lte", countOf("fan"), the("case", "fanSlots")),
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
    id: "idle-power",
    sentence: "Each part takes less power at idle than its most power, or the same power.",
    classes: POWERED_CLASSES,
    program: app("all", each(linesOfAny(POWERED_CLASSES), app("lte", ref("idlePower"), ref("power"))), STRICT),
  },
  {
    id: "psu-efficiency",
    sentence: "The efficiencies of the power supply are more than 0 percent and not more than 100 percent.",
    classes: ["psu"],
    program: every(
      "psu",
      app(
        "and",
        app("gt", ref("efficiency"), lit(0)),
        app("lte", ref("efficiency"), lit(100)),
        app("gt", ref("idleEfficiency"), lit(0)),
        app("lte", ref("idleEfficiency"), lit(100)),
      ),
    ),
  },
  {
    id: "psu-load",
    sentence: "The most power of the parts is not more than the load limit of the power supply.",
    classes: [...POWERED_CLASSES, "psu"],
    program: app("lte", POWER_DRAW, POWER_LIMIT),
  },
];
