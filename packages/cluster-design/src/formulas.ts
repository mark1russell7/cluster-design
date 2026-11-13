/**
 * The formulas of a machine, as Vex programs: its power at idle and under load, its power from the wall, its
 * noise and its capacity. Each program evaluates at the key of a machine in the tree of a design. The measures and
 * the fit rules read the same programs, so a measure and a rule always agree.
 */
import { app, lit, ref, v, type Expr } from "@mark1russell7/vex";
import { PART_CLASS_NAMES, PART_CLASSES, type PartClass } from "./parts.ts";
import { linesOf, linesOfAny, the, totalOfCount } from "./program.ts";

/** The name of the variable that holds the load limit of the power supply, as a ratio of its output. */
export const PSU_LOAD = "psuLoad";

/** The name of the variable that holds the threads of one CI job. */
export const JOB_THREADS = "jobThreads";

/** The name of the variable that holds the memory of one CI job, in GiB. */
export const JOB_MEMORY = "jobMemory";

/** The name of the variable that holds the threads that the system of a machine keeps for itself. */
export const RESERVE_THREADS = "reserveThreads";

/** The name of the variable that holds the memory that the system of a machine keeps for itself, in GiB. */
export const RESERVE_MEMORY = "reserveMemory";

/** These classes have the field `power`. The load of the power supply is the sum of their power. */
export const POWERED_CLASSES: readonly PartClass[] = PART_CLASS_NAMES.filter((name) => "power" in PART_CLASSES[name]);

/** These classes have the field `noise`. The noise of a machine is the sum of their sound energy. */
export const NOISY_CLASSES: readonly PartClass[] = PART_CLASS_NAMES.filter((name) => "noise" in PART_CLASSES[name]);

const powered = linesOfAny(POWERED_CLASSES);

/** This program gives the most power of the parts of a machine in watts: the sum of the count times the power of each line. */
export const POWER_DRAW: Expr = totalOfCount(powered, ref("power"));

/** This program gives the power of the parts of a machine at idle, in watts. */
export const IDLE_DRAW: Expr = totalOfCount(powered, ref("idlePower"));

/** This program gives the output of the power supply of a machine in watts. */
export const POWER_OUTPUT: Expr = the("psu", "output");

/** This program gives the load limit of the power supply of a machine in watts: its output times the variable `psuLoad`. */
export const POWER_LIMIT: Expr = app("multiply", POWER_OUTPUT, v(PSU_LOAD));

/** This expression gives the power from the wall for a power of the parts. It divides the power by an efficiency of the power supply, in percent. */
const fromWall = (draw: Expr, efficiency: "efficiency" | "idleEfficiency"): Expr => app("divide", draw, app("divide", the("psu", efficiency), lit(100)));

/** This program gives the most power of a machine from the wall, in watts. Each watt from the wall becomes heat in the room. */
export const WALL_POWER: Expr = fromWall(POWER_DRAW, "efficiency");

/** This program gives the power of a machine from the wall at idle, in watts. It divides the power at idle by the idle efficiency. */
export const WALL_IDLE_POWER: Expr = fromWall(IDLE_DRAW, "idleEfficiency");

/**
 * This program gives the sound level of all the parts of a machine, in dBA. It is 10 log10 of the sum, for each part,
 * of the count times 10 to the power of the level over 10. Two equal sources give 3 dB more than one source.
 */
export const NOISE: Expr = app(
  "multiply",
  lit(10),
  app("log10", totalOfCount(linesOfAny(NOISY_CLASSES), app("pow", lit(10), app("divide", ref("noise"), lit(10))))),
);

/** This program gives the cores of the processors of a machine. */
export const CORES: Expr = totalOfCount(linesOf("cpu"), ref("cores"));

/** This program gives the threads of the processors of a machine. */
export const THREADS: Expr = totalOfCount(linesOf("cpu"), ref("threads"));

/** This program gives the memory of a machine in GiB: the sum of the count times the modules times the size of a module. */
export const MEMORY: Expr = totalOfCount(linesOf("memory"), app("multiply", ref("modules"), ref("moduleSize")));

/** This program gives the storage of a machine in GB. */
export const STORAGE: Expr = totalOfCount(linesOf("storage"), ref("capacity"));

/** This expression gives the jobs that fit in a resource: the resource less the reserve, divided by the size of a job. */
const jobsIn = (resource: Expr, reserve: string, job: string): Expr => app("divide", app("subtract", resource, v(reserve)), v(job));

/**
 * This program gives the CI jobs that a machine runs at one time. The system keeps `reserveThreads` and
 * `reserveMemory`. Each job takes `jobThreads` and `jobMemory`. The count is the smaller quotient, rounded down, and not less than 0.
 */
export const RUNNER_SLOTS: Expr = app(
  "floor",
  app("max", lit(0), app("min", jobsIn(THREADS, RESERVE_THREADS, JOB_THREADS), jobsIn(MEMORY, RESERVE_MEMORY, JOB_MEMORY))),
);
