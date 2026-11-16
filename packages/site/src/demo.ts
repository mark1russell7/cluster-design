/**
 * The model of the demo: the counts of the sample parts, the machine that they make, and the result of the check.
 * The page code in `index.ts` draws this model. This module has no DOM code, so the tests run it in Node.js.
 */
import {
  checkDesign,
  DEFAULT_JOB,
  DEFAULT_PSU_LOAD,
  MACHINE_COST_MEASURES,
  MACHINE_MEASURES,
  measureDesign,
  overall,
  PART_CLASSES,
  PART_CLASS_NAMES,
  readCatalog,
  type Finding,
  type Machine,
  type MeasureValue,
  type Part,
  type PartClass,
  type Verdict,
  type WorkClass,
  workMeasures,
} from "@mark1russell7/cluster-design";
import { SAMPLE_MACHINE, SAMPLE_PARTS, SAMPLE_PRICES } from "@mark1russell7/cluster-design/sample";

const read = readCatalog(SAMPLE_PARTS);
if (!read.ok) throw new Error(read.problems.join(" "));

/** The catalog of the demo: the sample parts by their ids. */
export const CATALOG: ReadonlyMap<string, Part> = read.value;

/** The id of the machine of the demo. */
export const MACHINE_ID = "node-1";

/** The labels of the part classes, in the order of the table. */
export const CLASS_LABELS: Readonly<Record<PartClass, string>> = {
  cpu: "Processors",
  board: "Boards",
  memory: "Memory kits",
  storage: "Drives",
  psu: "Power supplies",
  case: "Cases",
  cooler: "Coolers",
  fan: "Case fans",
  gpu: "Graphics cards",
};

/** The short labels of the measures that the tiles of the demo show, in the order of the tiles. */
export const TILE_LABELS: Readonly<Record<string, string>> = {
  "idle-power": "Parts at idle",
  "wall-power": "Heat at full load",
  "wall-idle-power": "Heat at idle",
  noise: "Noise at 1 m",
  threads: "Threads",
  memory: "Memory",
  storage: "Storage",
  "runner-slots": `CI jobs of ${String(DEFAULT_JOB.threads)} threads and ${String(DEFAULT_JOB.memory)} GiB`,
  price: "Price of the parts",
};

/** This function gives the text of the value of a measure, with its unit, or a dash for a value with no read. */
export function formatMeasure(value: MeasureValue): string {
  if (value.value === undefined) return "–";
  if (value.unit === "dBA") return `${value.value.toFixed(1)} dBA`;
  if (value.unit === "GB" && value.value >= 1000) return `${String(Math.round(value.value / 100) / 10)} TB`;
  if (value.unit === "count") return String(Math.round(value.value));
  if (value.unit === "USD") return `$${String(Math.round(value.value))}`;
  return `${String(Math.round(value.value))} ${value.unit}`;
}

/** This record is the state of the demo. It holds the count of each part, the load limit of the power supply and the units of the work. */
export interface DemoState {
  readonly counts: ReadonlyMap<string, number>;
  readonly psuLoad: number;
  readonly work: ReadonlyMap<string, number>;
}

/** The most parts of one kind in the demo. */
export const MAX_COUNT = 8;

/** The classes of work of the demo. A unit of a class takes its threads and its memory before the CI jobs. */
export const WORK_CLASSES: readonly WorkClass[] = [
  { id: "session", threads: 1, memory: 4 },
  { id: "service", threads: 2, memory: 8 },
];

/** The names of the classes of work, for one unit and for more units. */
export const WORK_NAMES: Readonly<Record<string, readonly [string, string]>> = { session: ["session", "sessions"], service: ["service", "services"] };

/** The most units of one class of work in the demo. */
export const MAX_WORK = 16;

const NO_WORK: ReadonlyMap<string, number> = new Map();

const countsOf = (lines: Machine["lines"]): ReadonlyMap<string, number> => new Map(lines.map((line) => [line.part, line.count]));

const change = (from: string, to: string): Machine["lines"] =>
  SAMPLE_MACHINE.lines.map((line) => (line.part === from ? { ...line, part: to } : line));

/** This record is a preset of the demo: a label, a sentence, and its state. */
export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly sentence: string;
  readonly state: DemoState;
}

/** These are the presets of the demo. The first two presets fit. Each other preset breaks one or more rules. */
export const PRESETS: readonly Preset[] = [
  {
    id: "fits",
    label: "A machine that fits",
    sentence: "The sample machine: each part fits.",
    state: { counts: countsOf(SAMPLE_MACHINE.lines), psuLoad: DEFAULT_PSU_LOAD, work: NO_WORK },
  },
  {
    id: "mix",
    label: "A mix of work",
    sentence: "4 sessions and 1 service take their share first. The CI jobs get the rest of the machine.",
    state: { counts: countsOf(SAMPLE_MACHINE.lines), psuLoad: DEFAULT_PSU_LOAD, work: new Map([["session", 4], ["service", 1]]) },
  },
  {
    id: "full",
    label: "Too much work",
    sentence: "16 sessions of 4 GiB take 64 GiB, more than the memory less its reserve. No CI job fits.",
    state: { counts: countsOf(SAMPLE_MACHINE.lines), psuLoad: DEFAULT_PSU_LOAD, work: new Map([["session", 16]]) },
  },
  {
    id: "hot",
    label: "A hot processor",
    sentence: "A processor of 170 W thermal design power, with a cooler of 150 W.",
    state: { counts: countsOf(change("cpu-a", "cpu-hot")), psuLoad: DEFAULT_PSU_LOAD, work: NO_WORK },
  },
  {
    id: "graphics",
    label: "A long graphics card",
    sentence: "A graphics card of 340 mm in a case for 330 mm, on a power supply of 300 W.",
    state: { counts: countsOf([...change("psu-550", "psu-300"), { part: "gpu-long", count: 1 }]), psuLoad: DEFAULT_PSU_LOAD, work: NO_WORK },
  },
  {
    id: "other-socket",
    label: "The wrong socket",
    sentence: "A processor for the socket S2 on a board with the socket S1, and DDR4 memory on a DDR5 board.",
    state: { counts: countsOf(change("ram-2x16", "ram-ddr4").map((line) => (line.part === "cpu-a" ? { ...line, part: "cpu-s2" } : line))), psuLoad: DEFAULT_PSU_LOAD, work: NO_WORK },
  },
  {
    id: "no-case",
    label: "No case",
    sentence: "The rules that read the case cannot read it, so they give no read, not a pass.",
    state: { counts: countsOf(SAMPLE_MACHINE.lines.filter((line) => line.part !== "case-a")), psuLoad: DEFAULT_PSU_LOAD, work: NO_WORK },
  },
];

/** This function gives the machine of a state. Each part and each work class with a count of 1 or more gives one line. */
export function machineOf(state: DemoState): Machine {
  const lines = SAMPLE_PARTS.flatMap((part) => {
    const count = state.counts.get(part.id) ?? 0;
    return count > 0 ? [{ part: part.id, count }] : [];
  });
  const work = WORK_CLASSES.flatMap((entry) => {
    const count = state.work.get(entry.id) ?? 0;
    return count > 0 ? [{ class: entry.id, count }] : [];
  });
  return work.length > 0 ? { id: MACHINE_ID, lines, work } : { id: MACHINE_ID, lines };
}

/** This record is the result of the check of the demo machine, its power and the values of its measures. */
export interface DemoResult {
  readonly verdict: Verdict;
  readonly findings: readonly Finding[];
  readonly measures: readonly MeasureValue[];
  readonly breaks: number;
  readonly unread: number;
  readonly power?: number;
  readonly limit?: number;
  readonly output?: number;
}

/** This function checks the machine of a state with each fit rule, and gives its measures. */
export function resultOf(state: DemoState): DemoResult {
  const machine = machineOf(state);
  const checked = checkDesign([machine], CATALOG, { psuLoad: state.psuLoad, work: WORK_CLASSES });
  const measured = measureDesign([machine], CATALOG, {
    psuLoad: state.psuLoad,
    work: WORK_CLASSES,
    cost: { prices: SAMPLE_PRICES },
    measures: [...MACHINE_MEASURES, ...MACHINE_COST_MEASURES, ...workMeasures(WORK_CLASSES)],
  });
  if (!checked.ok) throw new Error(checked.problems.join(" "));
  if (!measured.ok) throw new Error(measured.problems.join(" "));
  const value = (id: string) => measured.values.find((entry) => entry.measure === id)?.value;
  const findings = checked.findings;
  const result: DemoResult = {
    verdict: overall(findings),
    findings,
    measures: measured.values,
    breaks: findings.filter((finding) => finding.verdict === "breaks").length,
    unread: findings.filter((finding) => finding.verdict === "unread").length,
  };
  const power = value("power");
  const limit = value("power-limit");
  const output = value("power-output");
  return {
    ...result,
    ...(power === undefined ? {} : { power }),
    ...(limit === undefined ? {} : { limit }),
    ...(output === undefined ? {} : { output }),
  };
}

/** The text of each verdict, for the chip of a rule. */
export const VERDICT_TEXT: Readonly<Record<Verdict, string>> = { fits: "Fits", breaks: "Breaks", unread: "No read" };

/**
 * This function gives the headline of a result, for the verdict card. The result of a machine and the result of a site
 * both have a verdict and the counts of their problems.
 *
 * @param result - The verdict and the counts of the rules that break and that have no read
 * @param fits - The headline when each rule fits
 * @returns The headline
 */
export function headlineOf(result: Pick<DemoResult, "verdict" | "breaks" | "unread">, fits = "The parts fit"): string {
  if (result.verdict === "fits") return fits;
  const breaks = result.breaks === 1 ? "1 rule breaks" : `${String(result.breaks)} rules break`;
  const unread = result.unread === 1 ? "1 rule has no read" : `${String(result.unread)} rules have no read`;
  if (result.verdict === "breaks") return result.unread > 0 ? `${breaks}, ${unread}` : breaks;
  return unread;
}

/** This function gives the facts of a part as short texts, from the fields of its class. */
export function factsOf(part: Part): readonly string[] {
  const facts: string[] = [];
  const record = part as unknown as Readonly<Record<string, unknown>>;
  for (const name of Object.keys(PART_CLASSES[part.class])) {
    const value = record[name];
    if (value === undefined) continue;
    if (Array.isArray(value)) facts.push(`${name} ${value.join("/")}`);
    else if (typeof value === "object" && value !== null && "unit" in value && "value" in value) facts.push(`${name} ${String(value.value)} ${String(value.unit)}`);
    else facts.push(`${name} ${String(value)}`);
  }
  return facts;
}

/** This function gives the parts of the catalog by class, in the order of the table. */
export function partsByClass(): ReadonlyArray<readonly [PartClass, readonly Part[]]> {
  return PART_CLASS_NAMES.map((name) => [name, SAMPLE_PARTS.filter((part) => part.class === name)] as const);
}

const units = (count: number, id: string): string => {
  const [one, many] = WORK_NAMES[id] ?? [id, id];
  return `${String(count)} more ${count === 1 ? one : many}`;
};

/**
 * This function gives the sentence of the work of a result. The sentence gives the share of the work and the free share.
 * It also gives the CI jobs and the units of each class that fit in the free share.
 */
export function workSentence(result: Pick<DemoResult, "measures">): string {
  const value = (id: string): number | undefined => result.measures.find((entry) => entry.measure === id)?.value;
  const threads = value("work-threads");
  const memory = value("work-memory");
  const freeThreads = value("free-threads");
  const freeMemory = value("free-memory");
  const slots = value("runner-slots");
  if (threads === undefined || memory === undefined || freeThreads === undefined || freeMemory === undefined || slots === undefined) {
    return "The share of the work has no read: the machine needs a processor and memory.";
  }
  const jobs = `${String(slots)} CI ${slots === 1 ? "job" : "jobs"}`;
  if (threads === 0 && memory === 0) return `No other work. The machine less its reserve has room for ${jobs}.`;
  const taken = `The work takes ${String(threads)} threads and ${String(memory)} GiB.`;
  if (freeThreads < 0 || freeMemory < 0) return `${taken} That is more than the machine less its reserve, so no CI job fits.`;
  const more = WORK_CLASSES.map((entry) => units((value(`capacity-${entry.id}`) ?? 0) - (value(`work-${entry.id}`) ?? 0), entry.id));
  return `${taken} ${String(freeThreads)} threads and ${String(freeMemory)} GiB stay free: room for ${jobs}, or ${more.join(", or ")}.`;
}

/** This function gives the text of work lines, for example "4 sessions and 1 service". It gives "no other work" for no line. */
export function workText(lines: readonly { readonly class: string; readonly count: number }[]): string {
  const parts = lines
    .filter((line) => line.count > 0)
    .map((line) => {
      const [one, many] = WORK_NAMES[line.class] ?? [line.class, line.class];
      return `${String(line.count)} ${line.count === 1 ? one : many}`;
    });
  return parts.length === 0 ? "no other work" : parts.join(" and ");
}

/** This function writes a state as the hash of the address, so a visitor can share a machine. */
export function hashOf(state: DemoState): string {
  const parts = [...state.counts].filter(([, count]) => count > 0).map(([id, count]) => `${id}=${String(count)}`);
  const work = [...state.work].filter(([, count]) => count > 0).map(([id, count]) => `work.${id}=${String(count)}`);
  return `#${[...parts, `load=${String(Math.round(state.psuLoad * 100))}`, ...work].join("&")}`;
}

/** This function reads a state from the hash of the address. It ignores each part and each class of work that the demo does not have. */
export function stateOf(hash: string): DemoState | undefined {
  const text = hash.replace(/^#/, "");
  if (text === "") return undefined;
  const counts = new Map<string, number>();
  const work = new Map<string, number>();
  let psuLoad = DEFAULT_PSU_LOAD;
  for (const pair of text.split("&")) {
    const [key = "", raw = ""] = pair.split("=");
    const number = Number.parseInt(raw, 10);
    if (!Number.isInteger(number)) continue;
    const id = key.startsWith("work.") ? key.slice("work.".length) : undefined;
    if (key === "load") psuLoad = Math.min(100, Math.max(50, number)) / 100;
    else if (id !== undefined && WORK_CLASSES.some((entry) => entry.id === id)) work.set(id, Math.min(MAX_WORK, Math.max(0, number)));
    else if (CATALOG.has(key)) counts.set(key, Math.min(MAX_COUNT, Math.max(0, number)));
  }
  return { counts, psuLoad, work };
}
