/**
 * The evaluation of Vex programs at each machine of a design. The check of the fit rules and the measures use it.
 */
import { evaluate, type Expr, type Result } from "@mark1russell7/vex";
import { BoolDomain, NumDomain, TextDomain } from "@mark1russell7/vex-domains";
import { designTree, type Machine } from "./machine.ts";
import type { Part } from "./parts.ts";
import { PSU_LOAD } from "./rules.ts";

/** The default load limit of a power supply: 80 percent of its output. */
export const DEFAULT_PSU_LOAD = 0.8;

/** These options change the evaluation of a design. */
export interface DesignOptions {
  /** The load limit of a power supply, as a ratio of its output. The default is 0.8. */
  readonly psuLoad?: number;
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
 * @param options - The load limit of a power supply
 * @returns The evaluations in the order of the machines and the items, or the problems of the input
 */
export function evaluateDesign<T extends { readonly program: Expr }>(
  machines: readonly Machine[],
  catalog: ReadonlyMap<string, Part>,
  items: readonly T[],
  options: DesignOptions = {},
): DesignEvaluation<T> {
  const psuLoad = options.psuLoad ?? DEFAULT_PSU_LOAD;
  if (!(psuLoad > 0 && psuLoad <= 1)) return { ok: false, problems: [`The load limit ${String(psuLoad)} is not more than 0 and not more than 1.`] };
  const tree = designTree(machines, catalog);
  if (!tree.ok) return tree;
  const evaluations: Evaluation<T>[] = [];
  for (const machine of machines) {
    const origin = tree.value.keys.get(machine.id);
    if (origin === undefined) continue;
    for (const item of items) {
      const result = evaluate(item.program, { space: tree.value.space, origin, domains: DOMAINS, vars: { [PSU_LOAD]: psuLoad } });
      evaluations.push({ machine: machine.id, item, result });
    }
  }
  return { ok: true, evaluations };
}
