/**
 * The evaluation of Vex programs at each machine of a design. The check of the fit rules and the measures use it.
 */
import { evaluate, type Expr, type Result } from "@mark1russell7/vex";
import { BoolDomain, NumDomain, TextDomain } from "@mark1russell7/vex-domains";
import { designTree, type Machine } from "./machine.ts";
import type { Part } from "./parts.ts";
import { JOB_MEMORY, JOB_THREADS, PSU_LOAD, RESERVE_MEMORY, RESERVE_THREADS } from "./formulas.ts";

/** The default load limit of a power supply: 80 percent of its output. */
export const DEFAULT_PSU_LOAD = 0.8;

/** This record is an amount of threads and memory: the size of one CI job, or the reserve of the system of a machine. */
export interface Share {
  readonly threads: number;
  /** The memory in GiB. */
  readonly memory: number;
}

/** The default size of a CI job: 4 threads and 16 GiB, the size of a standard hosted runner of GitHub for a public repository. */
export const DEFAULT_JOB: Share = { threads: 4, memory: 16 };

/** The default reserve of the system of a machine: no thread and 2 GiB. */
export const DEFAULT_RESERVE: Share = { threads: 0, memory: 2 };

/** These options change the evaluation of a design. */
export interface DesignOptions {
  /** The load limit of a power supply, as a ratio of its output. The default is 0.8. */
  readonly psuLoad?: number;
  /** The size of one CI job. The default is `DEFAULT_JOB`. */
  readonly job?: Share;
  /** The threads and the memory that the system of a machine keeps. The default is `DEFAULT_RESERVE`. */
  readonly reserve?: Share;
}

const isAmount = (value: number, least: number, open: boolean): boolean => Number.isFinite(value) && (open ? value > least : value >= least);

/** This function gives the problems of the options of a design, and the variables of its programs. */
function variablesOf(options: DesignOptions): { readonly problems: readonly string[]; readonly vars: Readonly<Record<string, number>> } {
  const psuLoad = options.psuLoad ?? DEFAULT_PSU_LOAD;
  const job = options.job ?? DEFAULT_JOB;
  const reserve = options.reserve ?? DEFAULT_RESERVE;
  const problems: string[] = [];
  if (!(psuLoad > 0 && psuLoad <= 1)) problems.push(`The load limit ${String(psuLoad)} is not more than 0 and not more than 1.`);
  if (!isAmount(job.threads, 0, true) || !isAmount(job.memory, 0, true)) problems.push("The threads and the memory of a job are not more than 0.");
  if (!isAmount(reserve.threads, 0, false) || !isAmount(reserve.memory, 0, false)) problems.push("The threads and the memory of the reserve are less than 0.");
  const vars = {
    [PSU_LOAD]: psuLoad,
    [JOB_THREADS]: job.threads,
    [JOB_MEMORY]: job.memory,
    [RESERVE_THREADS]: reserve.threads,
    [RESERVE_MEMORY]: reserve.memory,
  };
  return { problems, vars };
}

/** This record is the result of the program of one item at one machine. */
export interface Evaluation<T> {
  readonly machine: string;
  readonly item: T;
  readonly result: Result<unknown>;
}

/** This record is the evaluations of a design, or the problems of its input. */
export type DesignEvaluation<T> =
  | { readonly ok: true; readonly evaluations: readonly Evaluation<T>[] }
  | { readonly ok: false; readonly problems: readonly string[] };

const DOMAINS = [NumDomain, BoolDomain, TextDomain];

/**
 * This function evaluates the program of each item at each machine of a design.
 *
 * @param machines - The machines of the design
 * @param catalog - The parts by their ids
 * @param items - The items, each with a Vex program
 * @param options - The load limit of a power supply, the size of a job and the reserve of a machine
 * @returns The evaluations in the order of the machines and the items, or the problems of the input
 */
export function evaluateDesign<T extends { readonly program: Expr }>(
  machines: readonly Machine[],
  catalog: ReadonlyMap<string, Part>,
  items: readonly T[],
  options: DesignOptions = {},
): DesignEvaluation<T> {
  const { problems, vars } = variablesOf(options);
  if (problems.length > 0) return { ok: false, problems };
  const tree = designTree(machines, catalog);
  if (!tree.ok) return tree;
  const evaluations: Evaluation<T>[] = [];
  for (const machine of machines) {
    const origin = tree.value.keys.get(machine.id);
    if (origin === undefined) continue;
    for (const item of items) {
      const result = evaluate(item.program, { space: tree.value.space, origin, domains: DOMAINS, vars });
      evaluations.push({ machine: machine.id, item, result });
    }
  }
  return { ok: true, evaluations };
}
