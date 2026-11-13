/**
 * The check and the measures of a site: each rule and each measure at each key of its level. A rule that cannot
 * read its values has the verdict `unread`. It does not get the verdict `fits`.
 */
import { evaluate, type Expr, type Result } from "@mark1russell7/vex";
import { BoolDomain, NumDomain, TextDomain } from "@mark1russell7/vex-domains";
import { verdictOf, type Verdict } from "./check.ts";
import type { Machine } from "./machine.ts";
import { amountOf } from "./measure.ts";
import type { Part } from "./parts.ts";
import { siteTree, SITE_KEY, type Site } from "./site.ts";
import { CONTINUOUS_LOAD, SITE_MEASURES, SITE_RULES, type SiteLevel, type SiteMeasure, type SiteRule } from "./site-formulas.ts";

/** The default continuous load limit of a circuit: 80 percent of its rating, as the electrical codes ask for a continuous load. */
export const DEFAULT_CONTINUOUS_LOAD = 0.8;

/** These options change the evaluation of a site. */
export interface SiteOptions {
  /** The continuous load limit of a circuit, as a ratio of its rating. The default is 0.8. */
  readonly continuousLoad?: number;
}

/** This record is the result of the program of one item at one key of a site: the site, a circuit or a room. */
export interface SiteEvaluation<T> {
  readonly level: SiteLevel;
  /** The id of the circuit or the room. At the level `site`, it is `site`. */
  readonly id: string;
  readonly item: T;
  readonly result: Result<unknown>;
}

/** This record is the evaluations of a site, or the problems of its input. */
export type SiteEvaluationResult<T> =
  | { readonly ok: true; readonly evaluations: readonly SiteEvaluation<T>[] }
  | { readonly ok: false; readonly problems: readonly string[] };

const DOMAINS = [NumDomain, BoolDomain, TextDomain];

/**
 * This function evaluates the program of each item at each key of its level in the tree of a site.
 *
 * @param site - The site
 * @param machines - The machines of the design
 * @param catalog - The parts by their ids
 * @param items - The items, each with a level and a Vex program
 * @param options - The continuous load limit of a circuit
 * @returns The evaluations in the order of the items and the keys, or the problems of the input
 */
export function evaluateSite<T extends { readonly level: SiteLevel; readonly program: Expr }>(
  site: Site,
  machines: readonly Machine[],
  catalog: ReadonlyMap<string, Part>,
  items: readonly T[],
  options: SiteOptions = {},
): SiteEvaluationResult<T> {
  const continuousLoad = options.continuousLoad ?? DEFAULT_CONTINUOUS_LOAD;
  if (!(continuousLoad > 0 && continuousLoad <= 1)) {
    return { ok: false, problems: [`The continuous load limit ${String(continuousLoad)} is not more than 0 and not more than 1.`] };
  }
  const tree = siteTree(site, machines, catalog);
  if (!tree.ok) return tree;
  const keys: Readonly<Record<SiteLevel, ReadonlyMap<string, string>>> = {
    site: new Map([[SITE_KEY, SITE_KEY]]),
    circuit: tree.value.circuits,
    room: tree.value.rooms,
  };
  const vars = { [CONTINUOUS_LOAD]: continuousLoad };
  const evaluations: SiteEvaluation<T>[] = [];
  for (const item of items) {
    for (const [id, origin] of keys[item.level]) {
      const result = evaluate(item.program, { space: tree.value.space, origin, domains: DOMAINS, vars });
      evaluations.push({ level: item.level, id, item, result });
    }
  }
  return { ok: true, evaluations };
}

/** This record is the verdict of one rule at one key of a site. An `unread` verdict has the reason in `detail`. */
export interface SiteFinding {
  readonly level: SiteLevel;
  readonly id: string;
  readonly rule: string;
  readonly sentence: string;
  readonly verdict: Verdict;
  readonly detail?: string;
}

/** These options change the check of a site. */
export interface SiteCheckOptions extends SiteOptions {
  /** The rules of the check. The default is `SITE_RULES`. */
  readonly rules?: readonly SiteRule[];
}

/** This record is the findings of the check of a site, or the problems of its input. */
export type SiteCheckResult = { readonly ok: true; readonly findings: readonly SiteFinding[] } | { readonly ok: false; readonly problems: readonly string[] };

/**
 * This function examines each circuit and each room of a site with each rule of its level.
 *
 * @param site - The site
 * @param machines - The machines of the design
 * @param catalog - The parts by their ids
 * @param options - The continuous load limit of a circuit and the rules
 * @returns The findings in the order of the rules and the keys, or the problems of the input
 */
export function checkSite(site: Site, machines: readonly Machine[], catalog: ReadonlyMap<string, Part>, options: SiteCheckOptions = {}): SiteCheckResult {
  const evaluated = evaluateSite(site, machines, catalog, options.rules ?? SITE_RULES, options);
  if (!evaluated.ok) return evaluated;
  const findings = evaluated.evaluations.map(({ level, id, item, result }) => ({ level, id, rule: item.id, sentence: item.sentence, ...verdictOf(result) }));
  return { ok: true, findings };
}

/** This record is the value of one measure at one key of a site. A value that the program cannot give has the reason in `detail`. */
export interface SiteMeasureValue {
  readonly level: SiteLevel;
  readonly id: string;
  readonly measure: string;
  readonly unit: string;
  readonly value?: number;
  readonly detail?: string;
}

/** These options change the measures of a site. */
export interface SiteMeasureOptions extends SiteOptions {
  /** The measures. The default is `SITE_MEASURES`. */
  readonly measures?: readonly SiteMeasure[];
}

/** This record is the values of the measures of a site, or the problems of its input. */
export type SiteMeasureResult = { readonly ok: true; readonly values: readonly SiteMeasureValue[] } | { readonly ok: false; readonly problems: readonly string[] };

/**
 * This function gives the value of each measure at each key of its level in a site.
 *
 * @param site - The site
 * @param machines - The machines of the design
 * @param catalog - The parts by their ids
 * @param options - The continuous load limit of a circuit and the measures
 * @returns The values in the order of the measures and the keys, or the problems of the input
 */
export function measureSite(site: Site, machines: readonly Machine[], catalog: ReadonlyMap<string, Part>, options: SiteMeasureOptions = {}): SiteMeasureResult {
  const evaluated = evaluateSite(site, machines, catalog, options.measures ?? SITE_MEASURES, options);
  if (!evaluated.ok) return evaluated;
  const values = evaluated.evaluations.map(({ level, id, item, result }) => ({ level, id, measure: item.id, unit: item.unit, ...amountOf(result) }));
  return { ok: true, values };
}
