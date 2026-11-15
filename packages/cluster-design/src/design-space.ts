/**
 * The design space. A design adds copies of one new machine to the fixed machines of a site. Each design is a config of
 * a strategy space of `@mark1russell7/strategy-space`, so a search can go through the designs.
 *
 * Each slot of a part class is one stage. The options of a stage are the parts of its class in the catalog, and the
 * param `count` gives the count of the part. The stage `copies` gives the count of the new machines. The stage
 * `placement` gives the rule that puts them on the site. The fit rules and the site rules are the hard constraints:
 * `checkDesignConfig` gives one verdict for a config.
 *
 * The constraints of the space come from the fit rules, and each one has its reason. A rule of one class removes a part
 * that breaks it at each count. A rule of two classes forbids a pair of parts that breaks it at each pair of counts.
 * The derivation uses only the classes with one slot, because there the lines of the rule are the same in each machine.
 * Thus a constraint removes only the configs that the check also refuses.
 */
import {
  canonicalConfig,
  checkConfig,
  checkSpace,
  configId,
  STRATEGY_SPACE_SCHEMA,
  type ParamValue,
  type SpaceConstraint,
  type SpaceParam,
  type SpaceStage,
  type StrategyConfig,
  type StrategySpace,
} from "@mark1russell7/strategy-space";
import { checkDesign, overall, verdictOf, type Finding, type Verdict } from "./check.ts";
import { evaluateDesign, type DesignOptions } from "./evaluate.ts";
import type { Machine, PartLine } from "./machine.ts";
import type { Part, PartClass } from "./parts.ts";
import { FIT_RULES, type FitRule } from "./rules.ts";
import { checkSite, type SiteFinding, type SiteOptions } from "./site-check.ts";
import type { SiteRule } from "./site-formulas.ts";
import type { Place, Site } from "./site.ts";

/** The name of the design space. A config names the space with this value. */
export const DESIGN_ENGINE = "cluster-design";

/** The version of the form of the space. A change of the stages or the params gives a new version. */
export const DESIGN_SPACE_VERSION = "1";

/** The name of the stage of the count of the new machines. */
export const COPIES_STAGE = "copies";

/** The name of the stage of the rule that puts the new machines on the site. */
export const PLACEMENT_STAGE = "placement";

/** The name of the param of a count, in a stage of a part and in the stage `copies`. */
export const COUNT_PARAM = "count";

/**
 * The rules that put a new machine on the site. The rule `fill` takes the first room with a free place and the first
 * circuit with a free socket. The rule `spread` takes the room with the most free places and the circuit with the most
 * free sockets. When no room or circuit is free, both rules take the first one, and the site rules then refuse the design.
 */
export const PLACEMENTS = ["fill", "spread"] as const;

/** This type is one rule of the placement. */
export type Placement = (typeof PLACEMENTS)[number];

/** This record is a range of whole numbers, from `min` to `max`. */
export interface CountRange {
  readonly min: number;
  readonly max: number;
}

/** This record is one slot of a machine: a part class, the range of its count, and if the machine can leave it empty. */
export interface Slot extends CountRange {
  readonly class: PartClass;
  readonly optional?: boolean;
}

/**
 * The slots of a new machine. A machine has one part of each class, and two kinds of drive. The fans and the graphics
 * card are optional.
 */
export const DEFAULT_SLOTS: readonly Slot[] = [
  { class: "cpu", min: 1, max: 1 },
  { class: "board", min: 1, max: 1 },
  { class: "memory", min: 1, max: 4 },
  { class: "storage", min: 1, max: 4 },
  { class: "storage", min: 1, max: 4, optional: true },
  { class: "psu", min: 1, max: 1 },
  { class: "case", min: 1, max: 1 },
  { class: "cooler", min: 1, max: 1 },
  { class: "fan", min: 1, max: 4, optional: true },
  { class: "gpu", min: 1, max: 1, optional: true },
];

/** The default range of the count of the new machines. */
export const DEFAULT_COPIES: CountRange = { min: 1, max: 4 };

/** These options change the design space. */
export interface DesignSpaceOptions extends DesignOptions {
  /** The slots of the new machine. The default is `DEFAULT_SLOTS`. */
  readonly slots?: readonly Slot[];
  /** The range of the count of the new machines. The default is `DEFAULT_COPIES`. */
  readonly copies?: CountRange;
  /** The fit rules that give the constraints. The default is `FIT_RULES`. */
  readonly rules?: readonly FitRule[];
  /** With `false`, the fit rules give no constraint and remove no part. The rule of the order of two slots stays. The default is `true`. */
  readonly derive?: boolean;
}

/** This record is a slot and the name of its stage. The first slot of a class has the name of the class. */
export interface StageSlot extends Slot {
  readonly stage: string;
}

/** This record is a part that a fit rule removes from a stage, because the part breaks the rule at each count. */
export interface Exclusion {
  readonly stage: string;
  readonly part: string;
  readonly rule: string;
}

/**
 * This record is one constraint of the space and its reason. The reason is the id of a fit rule, or `order`. The rule
 * `order` keeps the parts of two slots of one class in the order of the catalog.
 */
export interface DerivedConstraint {
  readonly constraint: SpaceConstraint;
  readonly reason: string;
}

/** This record is a design space: the strategy space, its slots, its range of copies, and the reasons of its constraints. */
export interface DesignSpace {
  readonly space: StrategySpace;
  readonly slots: readonly StageSlot[];
  readonly copies: CountRange;
  readonly excluded: readonly Exclusion[];
  readonly derived: readonly DerivedConstraint[];
}

/** This record is a value, or the problems of the input. */
export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problems: readonly string[] };

const rangeProblem = (label: string, range: CountRange, least: number): string | undefined =>
  Number.isInteger(range.min) && Number.isInteger(range.max) && range.min >= least && range.max >= range.min
    ? undefined
    : `The range of ${label} is not whole numbers from ${String(least)} or more, with a max of the min or more.`;

const countsOf = (range: CountRange): number[] => Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i);

const countParams = (range: CountRange): SpaceParam[] =>
  range.max > range.min ? [{ name: COUNT_PARAM, kind: "int", min: range.min, max: range.max, default: range.min }] : [];

/** This function names the stage of each slot: the class for the first slot of a class, and `<class>-<n>` for the next ones. */
function stageSlots(slots: readonly Slot[]): StageSlot[] {
  const seen = new Map<PartClass, number>();
  return slots.map((slot) => {
    const n = (seen.get(slot.class) ?? 0) + 1;
    seen.set(slot.class, n);
    return { ...slot, stage: n === 1 ? slot.class : `${slot.class}-${String(n)}` };
  });
}

/**
 * This function gives the verdicts of one rule at each machine. The machines hold only the lines that the rule reads.
 * An input problem gives no verdicts, so the caller derives nothing from it.
 */
function verdictsOf(machines: readonly Machine[], catalog: ReadonlyMap<string, Part>, rule: FitRule, options: DesignOptions): Map<string, Verdict> {
  const evaluated = evaluateDesign(machines, catalog, [rule], options);
  const verdicts = new Map<string, Verdict>();
  if (!evaluated.ok) return verdicts;
  for (const { machine, result } of evaluated.evaluations) verdicts.set(machine, verdictOf(result).verdict);
  return verdicts;
}

/** This function tells if each machine of a group breaks the rule. A group with a missing verdict does not break it. */
const allBreak = (verdicts: ReadonlyMap<string, Verdict>, ids: readonly string[]): boolean => ids.length > 0 && ids.every((id) => verdicts.get(id) === "breaks");

/**
 * This function makes the design space of a catalog. A bad range and a slot with no part that is not optional are problems. A
 * space that the checks of `@mark1russell7/strategy-space` refuse is a problem too. An optional slot with no part is
 * not a stage of the space.
 *
 * @param catalog - The parts by their ids
 * @param options - The slots, the range of the copies, the fit rules and the options of the evaluation
 * @returns The design space, or the problems
 */
export function designSpace(catalog: ReadonlyMap<string, Part>, options: DesignSpaceOptions = {}): Outcome<DesignSpace> {
  const slots = stageSlots(options.slots ?? DEFAULT_SLOTS);
  const copies = options.copies ?? DEFAULT_COPIES;
  const rules = options.derive === false ? [] : (options.rules ?? FIT_RULES);
  const problems: string[] = [];
  for (const slot of slots) {
    const problem = rangeProblem(`the slot ${slot.stage}`, slot, 1);
    if (problem !== undefined) problems.push(problem);
  }
  const copiesProblem = rangeProblem("the copies", copies, 1);
  if (copiesProblem !== undefined) problems.push(copiesProblem);
  if (problems.length > 0) return { ok: false, problems };

  const slotCount = new Map<PartClass, number>();
  for (const slot of slots) slotCount.set(slot.class, (slotCount.get(slot.class) ?? 0) + 1);
  const single = (name: PartClass): boolean => slotCount.get(name) === 1;
  const options_ = new Map<string, Part[]>(slots.map((slot) => [slot.stage, [...catalog.values()].filter((part) => part.class === slot.class)]));

  const excluded: Exclusion[] = [];
  for (const rule of rules) {
    if (rule.classes.length !== 1) continue;
    const slot = slots.find((s) => s.class === rule.classes[0]);
    if (slot === undefined || !single(slot.class)) continue;
    const parts = options_.get(slot.stage) ?? [];
    const groups = parts.map((part) => ({ part, ids: countsOf(slot).map((count) => `${part.id}#${String(count)}`) }));
    const machines = parts.flatMap((part) => countsOf(slot).map((count) => ({ id: `${part.id}#${String(count)}`, lines: [{ part: part.id, count }] })));
    const verdicts = verdictsOf(machines, catalog, rule, options);
    const out = new Set(groups.filter((g) => allBreak(verdicts, g.ids)).map((g) => g.part.id));
    for (const id of out) excluded.push({ stage: slot.stage, part: id, rule: rule.id });
    options_.set(slot.stage, parts.filter((part) => !out.has(part.id)));
  }

  const used = slots.filter((slot) => (options_.get(slot.stage) ?? []).length > 0);
  for (const slot of slots) {
    if (slot.optional !== true && !used.includes(slot)) problems.push(`The slot ${slot.stage} has no part of the class ${slot.class} that can fit.`);
  }
  if (problems.length > 0) return { ok: false, problems };

  const derived: DerivedConstraint[] = [];
  for (const rule of rules) {
    if (rule.classes.length !== 2) continue;
    const [a, b] = rule.classes.map((name) => used.find((s) => s.class === name));
    if (a === undefined || b === undefined || !single(a.class) || !single(b.class)) continue;
    const machines: Machine[] = [];
    const pairs: { readonly p: Part; readonly q: Part; readonly ids: string[] }[] = [];
    for (const p of options_.get(a.stage) ?? []) {
      for (const q of options_.get(b.stage) ?? []) {
        const ids: string[] = [];
        for (const m of countsOf(a)) {
          for (const n of countsOf(b)) {
            const id = `${p.id}#${String(m)}|${q.id}#${String(n)}`;
            ids.push(id);
            machines.push({ id, lines: [{ part: p.id, count: m }, { part: q.id, count: n }] });
          }
        }
        pairs.push({ p, q, ids });
      }
    }
    const verdicts = verdictsOf(machines, catalog, rule, options);
    for (const { p, q, ids } of pairs) {
      if (allBreak(verdicts, ids)) derived.push({ constraint: { if: { stage: a.stage, option: p.id }, then: { not: { stage: b.stage, option: q.id } } }, reason: rule.id });
    }
  }

  for (const [i, first] of used.entries()) {
    for (const later of used.slice(i + 1)) {
      // Two full slots are a swap of each other only when they have the same class and the same range.
      if (later.class !== first.class || later.min !== first.min || later.max !== first.max) continue;
      const parts = options_.get(first.stage) ?? [];
      if (first.optional !== true && later.optional !== true && parts.length < 2) {
        problems.push(`The slots ${first.stage} and ${later.stage} need two parts of the class ${first.class} or more, because each slot takes a different part.`);
        continue;
      }
      if (first.optional === true && later.optional === true) derived.push({ constraint: { if: { stage: first.stage, option: null }, then: { stage: later.stage, option: null } }, reason: "order" });
      parts.forEach((p, pi) => {
        for (const q of parts.slice(0, pi + 1)) derived.push({ constraint: { if: { stage: first.stage, option: p.id }, then: { not: { stage: later.stage, option: q.id } } }, reason: "order" });
      });
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  const stages: SpaceStage[] = [
    ...used.map((slot) => ({
      name: slot.stage,
      ...(slot.optional === true ? { optional: true } : {}),
      options: (options_.get(slot.stage) ?? []).map((part) => ({ id: part.id, params: countParams(slot) })),
    })),
    { name: COPIES_STAGE, options: [{ id: COPIES_STAGE, params: countParams(copies) }] },
    { name: PLACEMENT_STAGE, options: PLACEMENTS.map((id) => ({ id, params: [] })) },
  ];
  const space: StrategySpace = {
    schema: STRATEGY_SPACE_SCHEMA,
    engine: DESIGN_ENGINE,
    version: DESIGN_SPACE_VERSION,
    stages,
    constraints: derived.map((d) => d.constraint),
  };
  const breaks = checkSpace(space);
  if (breaks.length > 0) return { ok: false, problems: breaks.map((b) => `The space breaks the claim ${b.claim}: ${b.detail}`) };
  return { ok: true, value: { space, slots: used, copies, excluded, derived } };
}

/** This record is the input of a design: the catalog, the site, and the machines that the site already has. */
export interface DesignInput {
  readonly catalog: ReadonlyMap<string, Part>;
  /** The site. Its places hold the fixed machines. */
  readonly site: Site;
  /** The machines that the site already has. The default is no machine. */
  readonly fixed?: readonly Machine[];
  /** The start of the id of each new machine. The default is `new-`, and the first new machine is `new-1`. */
  readonly prefix?: string;
}

/** This record is a design: each machine, the site with the place of each new machine, and the new machines. */
export interface Design {
  readonly machines: readonly Machine[];
  readonly site: Site;
  readonly added: readonly Machine[];
}

const countIn = (params: Readonly<Record<string, ParamValue>> | undefined, range: CountRange): number => {
  const value = params?.[COUNT_PARAM];
  return typeof value === "number" ? value : range.min;
};

const plugsOf = (machine: Machine, catalog: ReadonlyMap<string, Part>): number =>
  machine.lines.reduce((n, line) => n + (catalog.get(line.part)?.class === "psu" ? line.count : 0), 0);

/** This function gives the id that a rule of the placement takes from the free counts. A map with no id gives `undefined`. */
function pick(free: ReadonlyMap<string, number>, placement: Placement): string | undefined {
  const ids = [...free.keys()];
  if (placement === "fill") return ids.find((id) => (free.get(id) ?? 0) > 0) ?? ids[0];
  return ids.reduce<string | undefined>((best, id) => (best === undefined || (free.get(id) ?? 0) > (free.get(best) ?? 0) ? id : best), undefined);
}

/**
 * This function gives the places of the new machines on a site, by a rule of the placement. A room has its places
 * less its machines free. A circuit has its sockets less the power supplies of its machines free.
 *
 * @param site - The site, with the places of the fixed machines
 * @param fixed - The fixed machines
 * @param added - The new machines
 * @param catalog - The parts by their ids
 * @param placement - The rule of the placement
 * @returns The places of the new machines, or the problems
 */
export function placeMachines(
  site: Site,
  fixed: readonly Machine[],
  added: readonly Machine[],
  catalog: ReadonlyMap<string, Part>,
  placement: Placement,
): Outcome<readonly Place[]> {
  const problems: string[] = [];
  if (site.rooms.length === 0) problems.push("The site has no room for the new machines.");
  if (site.circuits.length === 0) problems.push("The site has no circuit for the new machines.");
  if (problems.length > 0) return { ok: false, problems };
  const byId = new Map(fixed.map((machine) => [machine.id, machine]));
  const rooms = new Map(site.rooms.map((room) => [room.id, room.places - site.places.filter((p) => p.room === room.id).length]));
  const circuits = new Map(
    site.circuits.map((circuit) => {
      const plugs = site.places.filter((p) => p.circuit === circuit.id).reduce((n, p) => n + plugsOf(byId.get(p.machine) ?? { id: p.machine, lines: [] }, catalog), 0);
      return [circuit.id, circuit.sockets - plugs];
    }),
  );
  const places: Place[] = [];
  for (const machine of added) {
    const room = pick(rooms, placement);
    const circuit = pick(circuits, placement);
    if (room === undefined || circuit === undefined) return { ok: false, problems: ["The site has no room or no circuit for the new machines."] };
    rooms.set(room, (rooms.get(room) ?? 0) - 1);
    circuits.set(circuit, (circuits.get(circuit) ?? 0) - plugsOf(machine, catalog));
    places.push({ machine: machine.id, circuit, room });
  }
  return { ok: true, value: places };
}

/**
 * This function gives the design of a config: the new machine, its copies and their places on the site.
 *
 * @param design - The design space
 * @param config - A config of the space
 * @param input - The catalog, the site and the fixed machines
 * @returns The design, or the problems of the config and the input
 */
export function designOf(design: DesignSpace, config: StrategyConfig, input: DesignInput): Outcome<Design> {
  const breaks = checkConfig(design.space, config);
  if (breaks.length > 0) return { ok: false, problems: breaks.map((b) => `The config breaks the claim ${b.claim}: ${b.detail}`) };
  const canonical = canonicalConfig(design.space, config);
  const lines: PartLine[] = [];
  for (const slot of design.slots) {
    const choice = canonical.stages[slot.stage];
    if (choice !== null && choice !== undefined) lines.push({ part: choice.option, count: countIn(choice.params, slot) });
  }
  const copies = countIn(canonical.stages[COPIES_STAGE]?.params, design.copies);
  const placement = (canonical.stages[PLACEMENT_STAGE]?.option ?? "fill") as Placement;
  const fixed = input.fixed ?? [];
  const prefix = input.prefix ?? "new-";
  const added = Array.from({ length: copies }, (_, i) => ({ id: `${prefix}${String(i + 1)}`, lines }));
  const taken = new Set(fixed.map((machine) => machine.id));
  const clash = added.filter((machine) => taken.has(machine.id));
  if (clash.length > 0) return { ok: false, problems: clash.map((machine) => `The id ${machine.id} of a new machine is the id of a fixed machine.`) };
  const places = placeMachines(input.site, fixed, added, input.catalog, placement);
  if (!places.ok) return places;
  return { ok: true, value: { machines: [...fixed, ...added], site: { ...input.site, places: [...input.site.places, ...places.value] }, added } };
}

/** These options change the check of a config. */
export interface DesignCheckOptions extends DesignOptions, SiteOptions {
  /** The fit rules of the new machine. The default is `FIT_RULES`. */
  readonly fitRules?: readonly FitRule[];
  /** The rules of the site. The default is `SITE_RULES`. */
  readonly siteRules?: readonly SiteRule[];
}

/** This record is the verdict of a config: its id, one verdict, the findings of the new machine and of the site, and the design. */
export interface DesignVerdict {
  readonly id: string;
  readonly verdict: Verdict;
  readonly machine: readonly Finding[];
  readonly site: readonly SiteFinding[];
  readonly design: Design;
}

/**
 * This function examines a config with the hard constraints. The fit rules examine one copy of the new machine, because
 * each copy has the same parts. The site rules examine the site with each machine. The verdict is `fits` only when each
 * finding fits, and a finding with no read gives `unread`, not `fits`.
 *
 * @param design - The design space
 * @param config - A config of the space
 * @param input - The catalog, the site and the fixed machines
 * @param options - The options of the evaluation and the rules
 * @returns The verdict, or the problems of the config and the input
 */
export function checkDesignConfig(design: DesignSpace, config: StrategyConfig, input: DesignInput, options: DesignCheckOptions = {}): Outcome<DesignVerdict> {
  const made = designOf(design, config, input);
  if (!made.ok) return made;
  const { fitRules, siteRules, ...rest } = options;
  const machine = checkDesign(made.value.added.slice(0, 1), input.catalog, { ...rest, ...(fitRules === undefined ? {} : { rules: fitRules }) });
  if (!machine.ok) return machine;
  const site = checkSite(made.value.site, made.value.machines, input.catalog, { ...rest, ...(siteRules === undefined ? {} : { rules: siteRules }) });
  if (!site.ok) return site;
  const verdict = overall([...machine.findings, ...site.findings]);
  return { ok: true, value: { id: configId(design.space, config), verdict, machine: machine.findings, site: site.findings, design: made.value } };
}
