/**
 * The variables of the Vex programs: the load limit of a power supply, the size of a CI job and the reserve of a
 * machine. The programs of a machine and of a site read the same variables. The entry of the package does not export
 * this module. The module `evaluate.ts` exports its public names.
 */
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
export function variablesOf(options: DesignOptions): { readonly problems: readonly string[]; readonly vars: Readonly<Record<string, number>> } {
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
