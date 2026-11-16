/**
 * The model of the view of the design space. The view draws a seeded sample of designs from the parts of the demo.
 * Each design has 1 to 4 copies of a new machine on the site of the demo. Each design gets the fit rules, the rules of
 * the site and the measures of the site. The page shows two goals at a time, and the front of those two goals.
 *
 * This module has no DOM. The tests use it, and the worker of the page starts `sweepView` away from the main thread.
 */
import {
  designOf,
  designSpace,
  FIT_RULES,
  SITE_RULES,
  sweepDesigns,
  type DesignObjective,
  type Machine,
  type Site,
} from "@mark1russell7/cluster-design";
import { SAMPLE_PRICES } from "@mark1russell7/cluster-design/sample";
import { paretoRanks } from "@mark1russell7/strategy-search";
import { CATALOG, hashOf, type DemoState } from "./demo.ts";
import { CIRCUITS, COST_MONTHS, formatUsd, ROOMS, siteHashOf, siteOf, type CopyPlace, type SiteState } from "./site-demo.ts";

/** The ids of the goals that the view can show on an axis. Each id is the id of a measure of the site. */
export const AXIS_IDS = ["total-cost", "slot-cost", "runner-slots", "power", "idle-cost", "noise"] as const;

/** The id of a goal of the view. */
export type AxisId = (typeof AXIS_IDS)[number];

/** This record is one goal of the view: its measure, its label, its unit, its goal and the text of a value. */
export interface Axis {
  readonly id: AxisId;
  readonly label: string;
  readonly unit: string;
  readonly goal: "min" | "max";
  readonly format: (value: number) => string;
}

const years = `${String(COST_MONTHS / 12)} years`;

/** The goals of the view. The two costs and the noise use the worst room or the whole site, as the sweep gives them. */
export const AXES: readonly Axis[] = [
  { id: "total-cost", label: `Total for ${years}`, unit: "USD", goal: "min", format: formatUsd },
  { id: "slot-cost", label: `One CI slot for ${years}`, unit: "USD", goal: "min", format: formatUsd },
  { id: "runner-slots", label: "CI runner slots", unit: "slots", goal: "max", format: (value) => String(Math.round(value)) },
  { id: "power", label: "Power from the wall", unit: "W", goal: "min", format: (value) => `${String(Math.round(value))} W` },
  { id: "idle-cost", label: "A month at idle", unit: "USD", goal: "min", format: formatUsd },
  { id: "noise", label: "Noise of the loudest room", unit: "dBA", goal: "min", format: (value) => `${value.toFixed(1)} dBA` },
];

/** This function gives the goal of an id. */
export function axisOf(id: AxisId): Axis {
  const axis = AXES.find((entry) => entry.id === id);
  if (axis === undefined) throw new Error(`The view has no goal ${id}.`);
  return axis;
}

/** The objectives of the sweep of the view: one objective for each goal, with the measure of the same id. */
export const VIEW_OBJECTIVES: readonly DesignObjective[] = AXES.map((axis) => ({ name: axis.id, goal: axis.goal, measure: axis.id }));

/** The counts of designs that a visitor can choose. A count of 1000 takes some seconds in the worker. */
export const SAMPLE_SIZES: readonly number[] = [250, 500, 1000];

/** The largest seed of the view. */
export const MAX_SEED = 999_999;

/** This record is the state of the view: the goal across, the goal up, the count of designs and the seed. */
export interface ViewState {
  readonly x: AxisId;
  readonly y: AxisId;
  readonly n: number;
  readonly seed: number;
}

/** The first state of the view: the total cost across, the CI runner slots up, 500 designs and the seed 1. */
export const DEFAULT_VIEW: ViewState = { x: "total-cost", y: "runner-slots", n: 500, seed: 1 };

/**
 * This record is the input of one sweep. It holds the site with no machine, the load limit of a power supply and the
 * busy share. It also holds the count of designs and the seed. The worker gets it as a message, so it holds only plain data.
 */
export interface ViewInput {
  readonly site: Site;
  readonly psuLoad: number;
  readonly busy: number;
  readonly n: number;
  readonly seed: number;
}

/** This function gives the input of a sweep from the site of the demo, the load limit of the machine demo and the view. */
export function viewInputOf(site: SiteState, psuLoad: number, view: ViewState): ViewInput {
  return { site: siteOf({ ...site, places: [] }), psuLoad, busy: site.busy, n: view.n, seed: view.seed };
}

/** The verdict of a design: it fits, it breaks a rule, or a rule has no read. */
export type PointStatus = "fits" | "breaks" | "unread";

/** This record is one design of the sweep: its config id, its verdict, its values, the rules that break, its parts and its places. */
export interface ViewPoint {
  readonly id: string;
  readonly status: PointStatus;
  readonly values: Readonly<Partial<Record<AxisId, number>>>;
  /** The ids of the rules that break, each one time. */
  readonly breaks: readonly string[];
  /** The part lines of each new machine. Each copy has the same parts. */
  readonly lines: Machine["lines"];
  /** The circuit and the room of each copy. */
  readonly places: readonly CopyPlace[];
}

/** This record is the result of a sweep of the view: the designs and the counts of the run, or the problems of the input. */
export type ViewResult =
  | { readonly ok: true; readonly points: readonly ViewPoint[]; readonly draws: number; readonly repeats: number }
  | { readonly ok: false; readonly problems: readonly string[] };

const STATUS: Readonly<Record<string, PointStatus>> = { feasible: "fits", breaks: "breaks", unread: "unread" };
const ruleOf = (entry: string): string => entry.slice(entry.indexOf(":") + 1);
const indexIn = (list: readonly { readonly id: string }[], id: string): 0 | 1 => (list.findIndex((entry) => entry.id === id) === 1 ? 1 : 0);

/** This function keeps the value of each goal that is a finite number. A goal with no read has no value. */
export function valuesOf(row: Readonly<Record<string, unknown>>): Partial<Record<AxisId, number>> {
  const values: Partial<Record<AxisId, number>> = {};
  for (const id of AXIS_IDS) {
    const value = row[id];
    if (typeof value === "number" && Number.isFinite(value)) values[id] = value;
  }
  return values;
}

/**
 * This function sweeps a seeded sample of the design space of the demo. A design is a new machine of the parts of the
 * demo, its count of copies and its placement. The sweep checks each design and measures its site with the sample prices.
 *
 * @param input - The site with no machine, the load limit, the busy share, the count and the seed
 * @returns Each design with its values and its place, or the problems of the input
 */
export function sweepView(input: ViewInput): ViewResult {
  const design = { catalog: CATALOG, site: input.site, fixed: [] };
  const space = designSpace(CATALOG, { site: design, psuLoad: input.psuLoad });
  if (!space.ok) return space;
  const swept = sweepDesigns(space.value, design, {
    enumerate: { mode: "sample", n: input.n, seed: input.seed },
    objectives: VIEW_OBJECTIVES,
    psuLoad: input.psuLoad,
    cost: { prices: SAMPLE_PRICES, busy: input.busy },
  });
  if (!swept.ok) return swept;
  const { run } = swept.value;
  const points = run.rows.flatMap((row): ViewPoint[] => {
    const config = run.configs[row.config];
    if (config === undefined) return [];
    const made = designOf(space.value, config, design);
    if (!made.ok) return [];
    const values = valuesOf(row.values);
    const added = new Set(made.value.added.map((machine) => machine.id));
    const places = made.value.site.places
      .filter((place) => added.has(place.machine))
      .map((place) => ({ circuit: indexIn(CIRCUITS, place.circuit), room: indexIn(ROOMS, place.room) }));
    return [
      {
        id: row.config,
        status: STATUS[row.status] ?? "unread",
        values,
        breaks: [...new Set(row.breaks.map(ruleOf))],
        lines: made.value.added[0]?.lines ?? [],
        places,
      },
    ];
  });
  return { ok: true, points, draws: run.draws, repeats: run.repeats };
}

/**
 * This function gives the ids of the designs on the front of two goals. A design of the front fits, and no other design
 * that fits is as good on both goals and better on one. The ranks come from `paretoRanks` of strategy-search.
 */
export function frontOn(points: readonly ViewPoint[], x: Axis, y: Axis): ReadonlySet<string> {
  const fits = points.filter((point) => point.status === "fits");
  const ranks = paretoRanks(
    fits.map((point) => [point.values[x.id] ?? Number.NaN, point.values[y.id] ?? Number.NaN]),
    [x.goal, y.goal],
  );
  return new Set(fits.filter((_, index) => ranks[index] === 1).map((point) => point.id));
}

/**
 * This function gives the corners of the line of the front, in the order of the goal across. Between two designs of the
 * front, the line goes through the point with the worse value of each goal. Thus the line is the edge of the area that
 * the front beats.
 */
export function frontLine(points: readonly ViewPoint[], x: Axis, y: Axis): readonly (readonly [number, number])[] {
  const worse = (axis: Axis, a: number, b: number): number => (axis.goal === "min" ? Math.max(a, b) : Math.min(a, b));
  const front = points
    .map((point) => [point.values[x.id], point.values[y.id]] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const line: (readonly [number, number])[] = [];
  front.forEach((point, index) => {
    const before = front[index - 1];
    if (before !== undefined) line.push([worse(x, before[0], point[0]), worse(y, before[1], point[1])]);
    line.push(point);
  });
  return line;
}

/** This function gives the design that the view chooses first: the design that fits with the least cost of one CI slot. */
export function firstChoice(points: readonly ViewPoint[]): ViewPoint | undefined {
  const key = (point: ViewPoint): readonly [number, number] => [point.values["slot-cost"] ?? Infinity, point.values["total-cost"] ?? Infinity];
  return points
    .filter((point) => point.status === "fits")
    .reduce<ViewPoint | undefined>((best, point) => {
      if (best === undefined) return point;
      const [a, b] = [key(point), key(best)];
      return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? point : best;
    }, undefined);
}

/** This record is the count of each verdict in a result. */
export interface ViewCounts {
  readonly fits: number;
  readonly breaks: number;
  readonly unread: number;
}

/** This function counts the designs of each verdict. */
export function countsOf(points: readonly ViewPoint[]): ViewCounts {
  const count = (status: PointStatus): number => points.filter((point) => point.status === status).length;
  return { fits: count("fits"), breaks: count("breaks"), unread: count("unread") };
}

/** This function gives the rules that break, with the count of designs where each one breaks, the most first. */
export function breakCounts(points: readonly ViewPoint[]): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const point of points) for (const rule of point.breaks) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const sentences = new Map([...FIT_RULES, ...SITE_RULES].map((rule) => [rule.id, rule.sentence]));

/** This function gives the sentence of a rule, or its id when the rule is not in the package. */
export const ruleSentence = (rule: string): string => sentences.get(rule) ?? rule;

/** This function gives a short name of a design: its count of machines and its processor. */
export function nameOf(point: ViewPoint): string {
  const cpu = point.lines.map((line) => CATALOG.get(line.part)).find((part) => part?.class === "cpu");
  const count = point.places.length;
  return `${String(count)} ${count === 1 ? "machine" : "machines"} with ${cpu?.name ?? "no processor"}`;
}

/** This function gives the count of copies on each circuit and in each room, for example "Circuit A: 2 · Room B: 2". */
export function whereOf(point: ViewPoint): string {
  const tally = (labels: readonly { readonly label: string }[], key: keyof CopyPlace): string =>
    labels
      .map((entry, index) => [entry.label, point.places.filter((place) => place[key] === index).length] as const)
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${label}: ${String(count)}`)
      .join(", ");
  return `${tally(CIRCUITS, "circuit")} · ${tally(ROOMS, "room")}`;
}

/** This function writes a view state as pairs of the hash of the address. The machine and the site ignore these pairs. */
export function viewHashOf(view: ViewState): string {
  return [`vx=${view.x}`, `vy=${view.y}`, `vn=${String(view.n)}`, `vs=${String(view.seed)}`].join("&");
}

/** This function reads a view state from the hash of the address. Each pair that is missing or bad gets its default. */
export function viewStateOf(hash: string): ViewState {
  const pairs = new Map(
    hash
      .replace(/^#/, "")
      .split("&")
      .map((pair) => pair.split("=") as [string, string | undefined]),
  );
  const axis = (key: string, fallback: AxisId): AxisId => {
    const value = pairs.get(key);
    return AXIS_IDS.find((id) => id === value) ?? fallback;
  };
  const n = Number.parseInt(pairs.get("vn") ?? "", 10);
  const seed = Number.parseInt(pairs.get("vs") ?? "", 10);
  return {
    x: axis("vx", DEFAULT_VIEW.x),
    y: axis("vy", DEFAULT_VIEW.y),
    n: SAMPLE_SIZES.includes(n) ? n : DEFAULT_VIEW.n,
    seed: Number.isInteger(seed) && seed >= 1 && seed <= MAX_SEED ? seed : DEFAULT_VIEW.seed,
  };
}

/**
 * This function gives the hash of the address that opens a design in the builder. The hash holds the parts of its
 * machine and the load limit of the machine demo. It also holds the site with a copy at each place of the design, and the view.
 */
export function builderHashOf(point: ViewPoint, demo: DemoState, site: SiteState, view: ViewState): string {
  const counts = new Map(point.lines.map((line) => [line.part, line.count]));
  return `${hashOf({ counts, psuLoad: demo.psuLoad, work: demo.work })}&${siteHashOf({ ...site, places: point.places })}&${viewHashOf(view)}`;
}
