/**
 * The check of a design: each fit rule at each machine. Each finding has a verdict. A rule that cannot read its
 * parts has the verdict `unread`. It does not get the verdict `fits`.
 */
import type { Result } from "@mark1russell7/vex";
import { evaluateDesign, type DesignOptions } from "./evaluate.ts";
import type { Machine } from "./machine.ts";
import type { Part } from "./parts.ts";
import { FIT_RULES, type FitRule } from "./rules.ts";

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
export interface CheckOptions extends DesignOptions {
  /** The rules of the check. The default is `FIT_RULES`. */
  readonly rules?: readonly FitRule[];
}

/** This record is the findings of a check, or the problems of its input. */
export type CheckResult =
  | { readonly ok: true; readonly findings: readonly Finding[] }
  | { readonly ok: false; readonly problems: readonly string[] };

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
  const evaluated = evaluateDesign(machines, catalog, options.rules ?? FIT_RULES, options);
  if (!evaluated.ok) return evaluated;
  const findings = evaluated.evaluations.map(({ machine, item, result }) => ({ machine, rule: item.id, sentence: item.sentence, ...verdictOf(result) }));
  return { ok: true, findings };
}

/**
 * This function gives one verdict for a list of findings. A break comes first, then a finding with no read.
 * Thus a machine fits only when each of its findings fits. The function reads only the verdicts, so it also takes the
 * findings of a site.
 */
export function overall(findings: readonly Pick<Finding, "verdict">[]): Verdict {
  if (findings.some((finding) => finding.verdict === "breaks")) return "breaks";
  if (findings.some((finding) => finding.verdict === "unread")) return "unread";
  return "fits";
}
