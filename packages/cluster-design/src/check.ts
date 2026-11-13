/**
 * The check of a design: each fit rule at each machine. Each finding has a verdict. A rule that cannot read its
 * parts has the verdict `unread`. It does not get the verdict `fits`.
 */
import { evaluate, type Result } from "@mark1russell7/vex";
import { BoolDomain, NumDomain, TextDomain } from "@mark1russell7/vex-domains";
import { designTree, type Machine } from "./machine.ts";
import type { Part } from "./parts.ts";
import { FIT_RULES, PSU_LOAD, type FitRule } from "./rules.ts";

/** This type is the verdict of a rule at a machine: the parts fit, the parts break the rule, or no read. */
export type Verdict = "fits" | "breaks" | "unread";

/** This record is the verdict of one rule at one machine. An `unread` verdict has the reason in `detail`. */
export interface Finding {
  readonly machine: string;
  readonly rule: string;
  readonly sentence: string;
  readonly verdict: Verdict;
  readonly detail?: string;
}

/** These options change the check. */
export interface CheckOptions {
  /** The load limit of a power supply, as a ratio of its output. The default is 0.8. */
  readonly psuLoad?: number;
  /** The rules of the check. The default is `FIT_RULES`. */
  readonly rules?: readonly FitRule[];
}

/** The default load limit of a power supply: 80 percent of its output. */
export const DEFAULT_PSU_LOAD = 0.8;

/** This record is the findings of a check, or the problems of its input. */
export type CheckResult =
  | { readonly ok: true; readonly findings: readonly Finding[] }
  | { readonly ok: false; readonly problems: readonly string[] };

const DOMAINS = [NumDomain, BoolDomain, TextDomain];

/** This function gives the verdict of the result of a rule program. */
export function verdictOf(result: Result<unknown>): { readonly verdict: Verdict; readonly detail?: string } {
  if (!result.ok) return { verdict: "unread", detail: `${result.error.code} ${result.error.message}` };
  if (result.value === true) return { verdict: "fits" };
  if (result.value === false) return { verdict: "breaks" };
  return { verdict: "unread", detail: `The program gave ${JSON.stringify(result.value)}, not true or false.` };
}

/**
 * This function examines each machine of a design with each fit rule.
 *
 * @param machines - The machines of the design
 * @param catalog - The parts by their ids
 * @param options - The load limit of a power supply and the rules
 * @returns The findings in the order of the machines and the rules, or the problems of the input
 */
export function checkDesign(machines: readonly Machine[], catalog: ReadonlyMap<string, Part>, options: CheckOptions = {}): CheckResult {
  const psuLoad = options.psuLoad ?? DEFAULT_PSU_LOAD;
  if (!(psuLoad > 0 && psuLoad <= 1)) return { ok: false, problems: [`The load limit ${String(psuLoad)} is not more than 0 and not more than 1.`] };
  const tree = designTree(machines, catalog);
  if (!tree.ok) return tree;
  const rules = options.rules ?? FIT_RULES;
  const findings: Finding[] = [];
  for (const machine of machines) {
    const origin = tree.value.keys.get(machine.id);
    if (origin === undefined) continue;
    for (const rule of rules) {
      const result = evaluate(rule.program, { space: tree.value.space, origin, domains: DOMAINS, vars: { [PSU_LOAD]: psuLoad } });
      findings.push({ machine: machine.id, rule: rule.id, sentence: rule.sentence, ...verdictOf(result) });
    }
  }
  return { ok: true, findings };
}

/**
 * This function gives one verdict for a list of findings. A break comes first, then a finding with no read.
 * Thus a machine fits only when each of its findings fits.
 */
export function overall(findings: readonly Finding[]): Verdict {
  if (findings.some((finding) => finding.verdict === "breaks")) return "breaks";
  if (findings.some((finding) => finding.verdict === "unread")) return "unread";
  return "fits";
}
