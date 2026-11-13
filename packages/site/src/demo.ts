/**
 * The model of the demo: the counts of the sample parts, the machine that they make, and the result of the check.
 * The page code in `index.ts` draws this model. This module has no DOM code, so the tests run it in Node.js.
 */
import {
  checkDesign,
  DEFAULT_PSU_LOAD,
  measureDesign,
  overall,
  PART_CLASSES,
  PART_CLASS_NAMES,
  readCatalog,
  type Finding,
  type Machine,
  type Part,
  type PartClass,
  type Verdict,
} from "@mark1russell7/cluster-design";
import { SAMPLE_MACHINE, SAMPLE_PARTS } from "@mark1russell7/cluster-design/sample";

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
  gpu: "Graphics cards",
};

/** This record is the state of the demo: the count of each part, and the load limit of the power supply. */
export interface DemoState {
  readonly counts: ReadonlyMap<string, number>;
  readonly psuLoad: number;
}

/** The most parts of one kind in the demo. */
export const MAX_COUNT = 8;

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

/** These are the presets of the demo. Each preset after the first breaks one or more rules. */
export const PRESETS: readonly Preset[] = [
  {
    id: "fits",
    label: "A machine that fits",
    sentence: "The sample machine: each part fits.",
    state: { counts: countsOf(SAMPLE_MACHINE.lines), psuLoad: DEFAULT_PSU_LOAD },
  },
  {
    id: "hot",
    label: "A hot processor",
    sentence: "A processor of 170 W thermal design power, with a cooler of 150 W.",
    state: { counts: countsOf(change("cpu-a", "cpu-hot")), psuLoad: DEFAULT_PSU_LOAD },
  },
  {
    id: "graphics",
    label: "A long graphics card",
    sentence: "A graphics card of 340 mm in a case for 330 mm, on a power supply of 300 W.",
    state: { counts: countsOf([...change("psu-550", "psu-300"), { part: "gpu-long", count: 1 }]), psuLoad: DEFAULT_PSU_LOAD },
  },
  {
    id: "other-socket",
    label: "The wrong socket",
    sentence: "A processor for the socket S2 on a board with the socket S1, and DDR4 memory on a DDR5 board.",
    state: { counts: countsOf(change("ram-2x16", "ram-ddr4").map((line) => (line.part === "cpu-a" ? { ...line, part: "cpu-s2" } : line))), psuLoad: DEFAULT_PSU_LOAD },
  },
  {
    id: "no-case",
    label: "No case",
    sentence: "The rules that read the case cannot read it, so they give no read, not a pass.",
    state: { counts: countsOf(SAMPLE_MACHINE.lines.filter((line) => line.part !== "case-a")), psuLoad: DEFAULT_PSU_LOAD },
  },
];

/** This function gives the machine of a state: one line for each part with a count of 1 or more. */
export function machineOf(state: DemoState): Machine {
  const lines = SAMPLE_PARTS.flatMap((part) => {
    const count = state.counts.get(part.id) ?? 0;
    return count > 0 ? [{ part: part.id, count }] : [];
  });
  return { id: MACHINE_ID, lines };
}

/** This record is the result of the check of the demo machine, and its power. */
export interface DemoResult {
  readonly verdict: Verdict;
  readonly findings: readonly Finding[];
  readonly breaks: number;
  readonly unread: number;
  readonly power?: number;
  readonly limit?: number;
  readonly output?: number;
}

/** This function checks the machine of a state with each fit rule, and gives its measures. */
export function resultOf(state: DemoState): DemoResult {
  const machine = machineOf(state);
  const checked = checkDesign([machine], CATALOG, { psuLoad: state.psuLoad });
  const measured = measureDesign([machine], CATALOG, { psuLoad: state.psuLoad });
  if (!checked.ok) throw new Error(checked.problems.join(" "));
  if (!measured.ok) throw new Error(measured.problems.join(" "));
  const value = (id: string) => measured.values.find((entry) => entry.measure === id)?.value;
  const findings = checked.findings;
  const result: DemoResult = {
    verdict: overall(findings),
    findings,
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

/** This function gives the headline of a result, for the verdict card. */
export function headlineOf(result: DemoResult): string {
  if (result.verdict === "fits") return "The parts fit";
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

/** This function writes a state as the hash of the address, so a visitor can share a machine. */
export function hashOf(state: DemoState): string {
  const parts = [...state.counts].filter(([, count]) => count > 0).map(([id, count]) => `${id}=${String(count)}`);
  return `#${[...parts, `load=${String(Math.round(state.psuLoad * 100))}`].join("&")}`;
}

/** This function reads a state from the hash of the address. It ignores each part that the catalog does not have. */
export function stateOf(hash: string): DemoState | undefined {
  const text = hash.replace(/^#/, "");
  if (text === "") return undefined;
  const counts = new Map<string, number>();
  let psuLoad = DEFAULT_PSU_LOAD;
  for (const pair of text.split("&")) {
    const [key = "", raw = ""] = pair.split("=");
    const number = Number.parseInt(raw, 10);
    if (!Number.isInteger(number)) continue;
    if (key === "load") psuLoad = Math.min(100, Math.max(50, number)) / 100;
    else if (CATALOG.has(key)) counts.set(key, Math.min(MAX_COUNT, Math.max(0, number)));
  }
  return { counts, psuLoad };
}
