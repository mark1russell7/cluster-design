/**
 * The evaluation of Vex programs at each machine of a design. The check of the fit rules and the measures use it.
 */
import { evaluate, type Expr, type Result } from "@mark1russell7/vex";
import { BoolDomain, NumDomain, TextDomain } from "@mark1russell7/vex-domains";
import { designTree, type Machine } from "./machine.ts";
import type { Part } from "./parts.ts";
import { variablesOf, type DesignOptions } from "./variables.ts";

export { DEFAULT_JOB, DEFAULT_PSU_LOAD, DEFAULT_RESERVE, type DesignOptions, type Share } from "./variables.ts";

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
