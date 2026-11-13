/**
 * The measures of a machine: amounts with a unit, as Vex programs. The fit rules read the same programs, so a
 * measure and a rule always agree.
 */
import type { Expr, Result } from "@mark1russell7/vex";
import { evaluateDesign, type DesignOptions } from "./evaluate.ts";
import type { Machine } from "./machine.ts";
import type { Part } from "./parts.ts";
import {
  CORES,
  IDLE_DRAW,
  MEMORY,
  NOISE,
  POWER_DRAW,
  POWER_LIMIT,
  POWER_OUTPUT,
  RUNNER_SLOTS,
  STORAGE,
  THREADS,
  WALL_IDLE_POWER,
  WALL_POWER,
} from "./formulas.ts";

/** This record is one measure of a machine: its id, the sentence that tells it, its unit and its program. */
export interface Measure {
  readonly id: string;
  readonly sentence: string;
  readonly unit: string;
  readonly program: Expr;
}

/**
 * These are the measures of a machine. The rule `psu-load` compares the power and the load limit. Each watt from
 * the wall becomes heat in the room, so the power from the wall is also the heat of the machine.
 */
export const MACHINE_MEASURES: readonly Measure[] = [
  { id: "power", sentence: "The most power of the parts.", unit: "W", program: POWER_DRAW },
  { id: "power-limit", sentence: "The load limit of the power supply.", unit: "W", program: POWER_LIMIT },
  { id: "power-output", sentence: "The output of the power supply.", unit: "W", program: POWER_OUTPUT },
  { id: "idle-power", sentence: "The power of the parts at idle.", unit: "W", program: IDLE_DRAW },
  { id: "wall-power", sentence: "The most power from the wall, and the most heat in the room.", unit: "W", program: WALL_POWER },
  { id: "wall-idle-power", sentence: "The power from the wall at idle, and the heat in the room at idle.", unit: "W", program: WALL_IDLE_POWER },
  { id: "noise", sentence: "The most sound level of the parts together, at 1 m.", unit: "dBA", program: NOISE },
  { id: "cores", sentence: "The cores of the processors.", unit: "count", program: CORES },
  { id: "threads", sentence: "The threads of the processors.", unit: "count", program: THREADS },
  { id: "memory", sentence: "The memory of the machine.", unit: "GiB", program: MEMORY },
  { id: "storage", sentence: "The storage of the drives.", unit: "GB", program: STORAGE },
  { id: "runner-slots", sentence: "The CI jobs that the machine runs at one time.", unit: "count", program: RUNNER_SLOTS },
];

/** This record is the value of one measure at one machine. A value that the program cannot give has the reason in `detail`. */
export interface MeasureValue {
  readonly machine: string;
  readonly measure: string;
  readonly unit: string;
  readonly value?: number;
  readonly detail?: string;
}

/** These options change the measures of a design. */
export interface MeasureOptions extends DesignOptions {
  /** The measures. The default is `MACHINE_MEASURES`. */
  readonly measures?: readonly Measure[];
}

/** This record is the values of the measures of a design, or the problems of its input. */
export type MeasureResult =
  | { readonly ok: true; readonly values: readonly MeasureValue[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/** This function gives the number of the result of a measure program, or the reason that it has no number. */
export function amountOf(result: Result<unknown>): { readonly value?: number; readonly detail?: string } {
  if (!result.ok) return { detail: `${result.error.code} ${result.error.message}` };
  if (typeof result.value === "number" && Number.isFinite(result.value)) return { value: result.value };
  return { detail: `The program gave ${JSON.stringify(result.value)}, not a number.` };
}

/**
 * This function gives the value of each measure at each machine of a design.
 *
 * @param machines - The machines of the design
 * @param catalog - The parts by their ids
 * @param options - The load limit of a power supply, the size of a job, the reserve of a machine and the measures
 * @returns The values in the order of the machines and the measures, or the problems of the input
 */
export function measureDesign(machines: readonly Machine[], catalog: ReadonlyMap<string, Part>, options: MeasureOptions = {}): MeasureResult {
  const evaluated = evaluateDesign(machines, catalog, options.measures ?? MACHINE_MEASURES, options);
  if (!evaluated.ok) return evaluated;
  const values = evaluated.evaluations.map(({ machine, item, result }) => ({ machine, measure: item.id, unit: item.unit, ...amountOf(result) }));
  return { ok: true, values };
}
