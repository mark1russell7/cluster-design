/**
 * The search of the design space. Each config of a grid or of a seeded sample of the space is one design. A genetic
 * search also proposes designs. The search package `@mark1russell7/strategy-search` evaluates each design, and gives one
 * row for each design with its Pareto rank. The sweep and the genetic search use one evaluation of a design.
 *
 * The hard constraints are the fit rules of the new machine and the rules of the site. `checkDesignConfig` gives them.
 * The objectives are measures of the site, as Vex programs. A rule without a read gives no value to each objective.
 * Thus the row is `unread`, and it gets no rank. A measure without a value, for example a cost with a part that has no
 * price, also makes the row `unread`.
 *
 * The fixed machines stand on the site already. Thus a cost measure buys no part for them, unless the option
 * `cost.owned` names other machines.
 *
 * The id of the run holds a hash of the input. Thus another site or another catalog gives another run.
 */
import { canonicalHash } from "@mark1russell7/rigor-generators";
import {
  evolve,
  objectiveProblems,
  sweep,
  type EvolveRun,
  type EvolveSample,
  type Goal,
  type Measure,
  type Objective,
  type SweepRun,
  type SweepSample,
} from "@mark1russell7/strategy-search";
import type { GridOptions, StrategyConfig } from "@mark1russell7/strategy-space";
import { checkDesignConfig, withSpaceWork, type DesignCheckOptions, type DesignInput, type DesignSpace, type Outcome } from "./design-space.ts";
import { measureSite, type SiteMeasureValue } from "./site-check.ts";
import { SITE_MEASURES, siteWorkMeasures, type SiteMeasure } from "./site-formulas.ts";
import type { WorkClass } from "./variables.ts";
import { SITE_COST_MEASURES } from "./cost.ts";

/** The name and the version of the evaluation of a design, in a sweep and in a genetic search. A change of the evaluation gives a new version. */
export const DESIGN_SWEEP_EVALUATOR = "cluster-design-sweep/1";

/**
 * This record is one objective of a sweep: its name, its goal and the id of a measure of the site. A measure of the
 * level `site` gives its value. A measure of a circuit or a room gives the worst value of its keys. The worst value is
 * the max for the goal `min`, and the min for the goal `max`.
 */
export interface DesignObjective {
  readonly name: string;
  readonly goal: Goal;
  readonly measure: string;
}

/**
 * The default objectives of a sweep. Two objectives are the most CI jobs at one time and the least power from the wall.
 * The other two are the least cost of the electricity for a month at idle, and the least noise of the loudest room.
 */
export const DESIGN_OBJECTIVES: readonly DesignObjective[] = [
  { name: "runner-slots", goal: "max", measure: "runner-slots" },
  { name: "power", goal: "min", measure: "power" },
  { name: "idle-cost", goal: "min", measure: "idle-cost" },
  { name: "noise", goal: "min", measure: "noise" },
];

/**
 * This function gives one objective for each work class: the most units of the class on the site. With the objective
 * `runner-slots`, a search of a split gives the front of the work classes and the CI jobs.
 * @param classes - The work classes
 * @returns The objective `work-<id>` of each class, with the goal `max`
 */
export function workObjectives(classes: readonly WorkClass[]): readonly DesignObjective[] {
  return classes.map((work): DesignObjective => ({ name: `work-${work.id}`, goal: "max", measure: `work-${work.id}` }));
}

/** These options change each search of the design space: the objectives, the measures, and the options of the check. */
export interface DesignSearchOptions extends DesignCheckOptions {
  /** The objectives. The default is `DESIGN_OBJECTIVES`. */
  readonly objectives?: readonly DesignObjective[];
  /**
   * The measures of the site that the objectives read. The default is `SITE_MEASURES`, `SITE_COST_MEASURES` and the
   * measures of the work classes from `siteWorkMeasures`.
   */
  readonly measures?: readonly SiteMeasure[];
}

/** These options change a sweep of the design space. */
export interface DesignSweepOptions extends DesignSearchOptions {
  /** The configs to evaluate: a grid or a seeded sample of the space. */
  readonly enumerate: GridOptions | SweepSample;
}

/** These options change a genetic search of the design space. The defaults are the defaults of `evolve`. */
export interface DesignEvolveOptions extends DesignSearchOptions {
  /** The seed of the run: a whole number, or a name. */
  readonly seed: number | string;
  /** The most evaluations of the run, a whole number of 1 or more. A repeat of a design costs no evaluation. */
  readonly evaluations: number;
  /** The count of the designs of a generation, a whole number of 2 or more. The default is 40. */
  readonly population?: number;
  /** The chance that a child takes a new choice at a stage, from 0 to 1. The default is 1 over the count of the stages. */
  readonly mutation?: number;
  /** The chance that two parents mix their stages, from 0 to 1. The default is 0.9. */
  readonly crossover?: number;
  /** The options of the samples of the first population and of the new choices. */
  readonly sample?: EvolveSample;
}

/** This record is a sweep of the design space: the record of the run, and the rules without a read of each config. */
export interface DesignSweep {
  readonly run: SweepRun;
  /**
   * The rules and the measures without a read, by the id of the config. A rule of the new machine has the form
   * `<machine>:<rule>`, and a rule of the site has the form `<key>:<rule>`. A measure of an objective without a value
   * has the form `<key>:<measure>`. A config with a read of each rule and a value of each measure has no entry.
   */
  readonly unread: Readonly<Record<string, readonly string[]>>;
}

/**
 * This record is a genetic search of the design space: the record of the run, and the rules without a read of each
 * config. The field `unread` has the form of the field of `DesignSweep`.
 */
export interface DesignEvolution {
  readonly run: EvolveRun;
  readonly unread: Readonly<Record<string, readonly string[]>>;
}

/** This error stops a search at a problem of the input. The search gives its problems. */
class InputProblem extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(problems.join(" "));
    this.problems = problems;
  }
}

/** This function gives the problems of the objectives: the problems of `objectiveProblems`, and a measure that is not in the list. */
function designObjectiveProblems(objectives: readonly DesignObjective[], measures: ReadonlyMap<string, SiteMeasure>): string[] {
  const problems = objectiveProblems(objectives);
  for (const objective of Array.isArray(objectives) ? objectives : []) {
    if (!measures.has(objective?.measure)) {
      problems.push(`The objective ${String(objective?.name)} reads the measure ${String(objective?.measure)}, and the measures have no measure with this id.`);
    }
  }
  return problems;
}

/** This function gives the value of an objective: the worst value of its measure over the keys. A key without a value gives `NaN`. */
function valueOf(objective: DesignObjective, values: readonly SiteMeasureValue[]): number {
  const numbers = values.filter((value) => value.measure === objective.measure).map((value) => value.value ?? Number.NaN);
  if (numbers.length === 0) return Number.NaN;
  return objective.goal === "min" ? Math.max(...numbers) : Math.min(...numbers);
}

/** This function gives the parts of a catalog in the order of their ids, for the hash of the input. */
const partsOf = (catalog: DesignInput["catalog"]): unknown[] => [...catalog.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** This record is the part that each method of search shares. It has the objectives, the evaluation of a design, its name and the missing reads. */
interface DesignEvaluation {
  readonly goals: readonly Objective[];
  readonly evaluate: (config: StrategyConfig) => Measure;
  readonly evaluator: string;
  readonly unread: Record<string, readonly string[]>;
}

/**
 * This function gives the evaluation of the designs of one search. The evaluation checks a design, measures its site and
 * gives the value of each objective. Its name holds a hash of the input. The search fills `unread` while it evaluates.
 * Without the option `work`, the evaluation reads the work classes of the space.
 */
function designEvaluation(design: DesignSpace, input: DesignInput, options: DesignSearchOptions): Outcome<DesignEvaluation> {
  const withWork = withSpaceWork(design, options);
  const { objectives = DESIGN_OBJECTIVES, measures = [...SITE_MEASURES, ...SITE_COST_MEASURES, ...siteWorkMeasures(withWork.work ?? [])], ...check } = withWork;
  const withOwned = { ...check, cost: { owned: (input.fixed ?? []).map((machine) => machine.id), ...check.cost } };
  const byId = new Map(measures.map((measure) => [measure.id, measure]));
  const problems = designObjectiveProblems(objectives, byId);
  if (problems.length > 0) return { ok: false, problems };
  const read = new Set(objectives.map((objective) => objective.measure));
  const used = measures.filter((measure) => read.has(measure.id));
  const goals: Objective[] = objectives.map((objective) => ({ name: objective.name, goal: objective.goal, unit: byId.get(objective.measure)?.unit ?? "" }));
  const unread: Record<string, readonly string[]> = {};

  const evaluate = (config: StrategyConfig): Measure => {
    const checked = checkDesignConfig(design, config, input, withOwned);
    if (!checked.ok) throw new InputProblem(checked.problems);
    const { id, machine, site, design: made } = checked.value;
    const name = (finding: { readonly verdict: string; readonly rule: string }, key: string): string => `${key}:${finding.rule}`;
    const breaks = [
      ...machine.filter((finding) => finding.verdict === "breaks").map((finding) => name(finding, finding.machine)),
      ...site.filter((finding) => finding.verdict === "breaks").map((finding) => name(finding, finding.id)),
    ];
    const missing = [
      ...machine.filter((finding) => finding.verdict === "unread").map((finding) => name(finding, finding.machine)),
      ...site.filter((finding) => finding.verdict === "unread").map((finding) => name(finding, finding.id)),
    ];
    if (missing.length > 0) {
      unread[id] = missing;
      return { breaks, values: Object.fromEntries(objectives.map((objective) => [objective.name, Number.NaN])) };
    }
    const measured = measureSite(made.site, made.machines, input.catalog, { ...withOwned, measures: used });
    if (!measured.ok) throw new InputProblem(measured.problems);
    const empty = measured.values.filter((value) => value.value === undefined).map((value) => `${value.id}:${value.measure}`);
    if (empty.length > 0) unread[id] = empty;
    return { breaks, values: Object.fromEntries(objectives.map((objective) => [objective.name, valueOf(objective, measured.values)])) };
  };

  let hash: string;
  try {
    hash = canonicalHash({ catalog: partsOf(input.catalog), site: input.site, fixed: input.fixed ?? [], prefix: input.prefix ?? null, check, measures: used });
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) return { ok: false, problems: [`The input has a value that JSON cannot hold: ${error.message}`] };
    throw error;
  }
  return { ok: true, value: { goals, evaluate, evaluator: `${DESIGN_SWEEP_EVALUATOR} input ${hash.slice(0, 16)}`, unread } };
}

/** This function runs a search with an evaluation. It gives the record of the run and the missing reads, or the problems of the input. */
function searched<R>(evaluation: DesignEvaluation, search: () => R): Outcome<{ readonly run: R; readonly unread: Readonly<Record<string, readonly string[]>> }> {
  try {
    const run = search();
    return { ok: true, value: { run, unread: evaluation.unread } };
  } catch (error) {
    if (error instanceof InputProblem) return { ok: false, problems: error.problems };
    if (error instanceof RangeError) return { ok: false, problems: [error.message] };
    throw error;
  }
}

/**
 * This function sweeps the design space. It evaluates each config of a grid or of a seeded sample, and gives one row
 * for each design.
 *
 * - A design that breaks a fit rule of the new machine or a rule of the site has the status `breaks`, with each rule.
 * - A design with a rule without a read has the status `unread`, unless it breaks a rule. The field `unread` names each rule without a read.
 * - The Pareto rank is over the designs that keep each rule. The rows of the front have the rank 1.
 * - The result is deterministic: one space, one input, one enumeration and one seed give one record.
 *
 * @param design - The design space
 * @param input - The catalog, the site and the fixed machines
 * @param options - The enumeration, the objectives, the measures, and the options of the check
 * @returns The sweep, or the problems of the objectives, the enumeration and the input
 */
export function sweepDesigns(design: DesignSpace, input: DesignInput, options: DesignSweepOptions): Outcome<DesignSweep> {
  const { enumerate, ...search } = options;
  const made = designEvaluation(design, input, search);
  if (!made.ok) return made;
  const { goals, evaluate, evaluator } = made.value;
  return searched(made.value, () => sweep(design.space, { objectives: goals, evaluate, enumerate, evaluator }));
}

/**
 * This function searches the design space with the genetic search `evolve` of `@mark1russell7/strategy-search`. It
 * gives one row for each design that the run evaluated.
 *
 * - Each design gets the evaluation of `sweepDesigns`: the same check, the same measures and the same objectives.
 *   Thus a sweep and a genetic search of one input have the same `evaluator`, and their rows compare.
 * - A design that breaks a rule comes after the designs that keep each rule. A design with fewer breaks comes first.
 * - The run stops when it used each evaluation, or when 20 generations in a row made no new design.
 * - The Pareto ranks are over all the designs of the run that keep each rule.
 * - The result is deterministic: one space, one input and one set of options give one record.
 *
 * @param design - The design space
 * @param input - The catalog, the site and the fixed machines
 * @param options - The seed, the count of the evaluations, the options of the algorithm, the objectives, the measures, and the options of the check
 * @returns The record of the run, or the problems of the objectives, the options and the input
 */
export function evolveDesigns(design: DesignSpace, input: DesignInput, options: DesignEvolveOptions): Outcome<DesignEvolution> {
  const { seed, evaluations, population, mutation, crossover, sample, ...search } = options;
  const made = designEvaluation(design, input, search);
  if (!made.ok) return made;
  const { goals, evaluate, evaluator } = made.value;
  return searched(made.value, () =>
    evolve(design.space, {
      objectives: goals,
      evaluate,
      evaluator,
      seed,
      evaluations,
      ...(population === undefined ? {} : { population }),
      ...(mutation === undefined ? {} : { mutation }),
      ...(crossover === undefined ? {} : { crossover }),
      ...(sample === undefined ? {} : { sample }),
    }),
  );
}
