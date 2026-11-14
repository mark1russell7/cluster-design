/**
 * The model of the site part of the demo. It has the copies of the demo machine and their places on two circuits and
 * in two rooms. It also has the result of the check of the site. The page code in `site-page.ts` draws this model. This module has no DOM code,
 * so the tests run it in Node.js.
 */
import {
  checkSite,
  measureSite,
  overall,
  SITE_FORMAT,
  type Machine,
  type Site,
  type SiteFinding,
  type SiteMeasureValue,
  type Verdict,
} from "@mark1russell7/cluster-design";
import { CATALOG } from "./demo.ts";

/** The most copies of the demo machine in the site. */
export const MAX_COPIES = 6;

/** The voltages that a circuit of the demo can have, in volts. */
export const VOLTAGES: readonly number[] = [120, 230];

/** The ratings that a breaker of the demo can have, in amperes. */
export const BREAKERS: readonly number[] = [10, 15, 20, 30];

/** The bounds of each number of the site state: the least value, the most value and the step. */
export const SITE_BOUNDS = {
  sockets: { min: 0, max: 8, step: 1 },
  otherLoad: { min: 0, max: 3000, step: 50 },
  places: { min: 0, max: 8, step: 1 },
  heatLimit: { min: 0, max: 5000, step: 50 },
  noiseLimit: { min: 20, max: 80, step: 1 },
  price: { min: 0.01, max: 1, step: 0.01 },
} as const;

/** This record is one circuit of the demo: its voltage in volts, its breaker in amperes, its free sockets and its other load in watts. */
export interface CircuitState {
  readonly voltage: number;
  readonly breaker: number;
  readonly sockets: number;
  readonly otherLoad: number;
}

/** This record is one room of the demo: its places for machines, its heat limit in watts and its noise limit in dBA. */
export interface RoomState {
  readonly places: number;
  readonly heatLimit: number;
  readonly noiseLimit: number;
}

/** This record is the place of one copy of the machine: the index of its circuit and the index of its room. */
export interface CopyPlace {
  readonly circuit: 0 | 1;
  readonly room: 0 | 1;
}

/** This record is the state of the site: the place of each copy, the price of electricity in USD/kWh, the circuits and the rooms. */
export interface SiteState {
  readonly places: readonly CopyPlace[];
  readonly price: number;
  readonly circuits: readonly [CircuitState, CircuitState];
  readonly rooms: readonly [RoomState, RoomState];
}

/** The ids of the two circuits and the two rooms, and their labels. */
export const CIRCUITS = [
  { id: "circuit-a", label: "Circuit A" },
  { id: "circuit-b", label: "Circuit B" },
] as const;
export const ROOMS = [
  { id: "room-a", label: "Room A" },
  { id: "room-b", label: "Room B" },
] as const;

/** The site state of the sample site of the package: two copies on circuit A in room A. */
export const SAMPLE_SITE_STATE: SiteState = {
  places: [
    { circuit: 0, room: 0 },
    { circuit: 0, room: 0 },
  ],
  price: 0.15,
  circuits: [
    { voltage: 120, breaker: 15, sockets: 4, otherLoad: 200 },
    { voltage: 120, breaker: 15, sockets: 2, otherLoad: 0 },
  ],
  rooms: [
    { places: 2, heatLimit: 500, noiseLimit: 45 },
    { places: 2, heatLimit: 1000, noiseLimit: 35 },
  ],
};

/** This function gives the id of a copy of the machine. */
export const copyId = (index: number): string => `node-${String(index + 1)}`;

/** This function gives the copies of a machine, one for each place of the state. */
export function copiesOf(machine: Machine, state: SiteState): readonly Machine[] {
  return state.places.map((_, index) => ({ id: copyId(index), lines: machine.lines }));
}

/** This function gives the site record of a state. The record is input data, as a user gives it. */
export function siteOf(state: SiteState): Site {
  return {
    format: SITE_FORMAT,
    price: { value: state.price, unit: "USD/kWh" },
    circuits: state.circuits.map((circuit, index) => ({
      id: CIRCUITS[index]?.id ?? "",
      voltage: { value: circuit.voltage, unit: "V" },
      breaker: { value: circuit.breaker, unit: "A" },
      sockets: circuit.sockets,
      otherLoad: { value: circuit.otherLoad, unit: "W" },
    })),
    rooms: state.rooms.map((room, index) => ({
      id: ROOMS[index]?.id ?? "",
      places: room.places,
      heatLimit: { value: room.heatLimit, unit: "W" },
      noiseLimit: { value: room.noiseLimit, unit: "dBA" },
    })),
    places: state.places.map((place, index) => ({ machine: copyId(index), circuit: CIRCUITS[place.circuit].id, room: ROOMS[place.room].id })),
  };
}

/** This record is the view of one circuit: its values, its limits and the findings of its rules. */
export interface CircuitView {
  readonly id: string;
  readonly label: string;
  readonly state: CircuitState;
  readonly copies: readonly string[];
  readonly load?: number;
  readonly idleLoad?: number;
  readonly current?: number;
  readonly limit?: number;
  readonly plugs?: number;
  readonly verdict: Verdict;
  readonly findings: readonly SiteFinding[];
}

/** This record is the view of one room: its values, its limits and the findings of its rules. */
export interface RoomView {
  readonly id: string;
  readonly label: string;
  readonly state: RoomState;
  readonly copies: readonly string[];
  readonly heat?: number;
  readonly idleHeat?: number;
  readonly noise?: number;
  readonly machines?: number;
  readonly verdict: Verdict;
  readonly findings: readonly SiteFinding[];
}

/** This record is the result of the check of a site: the verdict, the findings, the values of the site, each circuit and each room. */
export interface SiteResult {
  readonly verdict: Verdict;
  readonly findings: readonly SiteFinding[];
  readonly measures: readonly SiteMeasureValue[];
  readonly breaks: number;
  readonly unread: number;
  readonly power?: number;
  readonly idlePower?: number;
  readonly cost?: number;
  readonly idleCost?: number;
  readonly circuits: readonly CircuitView[];
  readonly rooms: readonly RoomView[];
}

const withValue = <K extends string>(key: K, value: number | undefined): Partial<Record<K, number>> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, number>);

/** This function checks the copies of a machine in the site of a state with each site rule, and gives the measures of the site. */
export function siteResultOf(machine: Machine, state: SiteState): SiteResult {
  const site = siteOf(state);
  const machines = copiesOf(machine, state);
  const checked = checkSite(site, machines, CATALOG);
  const measured = measureSite(site, machines, CATALOG);
  if (!checked.ok) throw new Error(checked.problems.join(" "));
  if (!measured.ok) throw new Error(measured.problems.join(" "));
  const value = (id: string, measure: string) => measured.values.find((entry) => entry.id === id && entry.measure === measure)?.value;
  const findings = checked.findings;
  const findingsOf = (id: string) => findings.filter((finding) => finding.id === id);
  const circuits = CIRCUITS.map(({ id, label }, index): CircuitView => {
    const own = findingsOf(id);
    return {
      id,
      label,
      state: state.circuits[index] ?? SAMPLE_SITE_STATE.circuits[0],
      copies: state.places.flatMap((place, copy) => (place.circuit === index ? [copyId(copy)] : [])),
      ...withValue("load", value(id, "load")),
      ...withValue("idleLoad", value(id, "idle-load")),
      ...withValue("current", value(id, "current")),
      ...withValue("limit", value(id, "limit")),
      ...withValue("plugs", value(id, "plugs")),
      verdict: overall(own),
      findings: own,
    };
  });
  const rooms = ROOMS.map(({ id, label }, index): RoomView => {
    const own = findingsOf(id);
    return {
      id,
      label,
      state: state.rooms[index] ?? SAMPLE_SITE_STATE.rooms[0],
      copies: state.places.flatMap((place, copy) => (place.room === index ? [copyId(copy)] : [])),
      ...withValue("heat", value(id, "heat")),
      ...withValue("idleHeat", value(id, "idle-heat")),
      ...withValue("noise", value(id, "noise")),
      ...withValue("machines", value(id, "machines")),
      verdict: overall(own),
      findings: own,
    };
  });
  return {
    verdict: overall(findings),
    findings,
    measures: measured.values,
    breaks: findings.filter((finding) => finding.verdict === "breaks").length,
    unread: findings.filter((finding) => finding.verdict === "unread").length,
    ...withValue("power", value("site", "power")),
    ...withValue("idlePower", value("site", "idle-power")),
    ...withValue("cost", value("site", "cost")),
    ...withValue("idleCost", value("site", "idle-cost")),
    circuits,
    rooms,
  };
}

/** This record is a preset of the site: a label, a sentence, and its state. */
export interface SitePreset {
  readonly id: string;
  readonly label: string;
  readonly sentence: string;
  readonly state: SiteState;
}

const placesOf = (text: string): readonly CopyPlace[] =>
  text.split(" ").map((pair) => ({ circuit: pair[0] === "b" ? 1 : 0, room: pair[1] === "b" ? 1 : 0 }));

const withCircuit = (index: 0 | 1, change: Partial<CircuitState>): SiteState["circuits"] => {
  const [a, b] = SAMPLE_SITE_STATE.circuits;
  return index === 0 ? [{ ...a, ...change }, b] : [a, { ...b, ...change }];
};

/** These are the presets of the site. Each preset after the first breaks one or more site rules. */
export const SITE_PRESETS: readonly SitePreset[] = [
  {
    id: "fits",
    label: "Two machines that fit",
    sentence: "The sample site: two machines on circuit A, in room A.",
    state: SAMPLE_SITE_STATE,
  },
  {
    id: "crowded",
    label: "Five machines in one room",
    sentence: "Five machines on circuit A, in room A: too few sockets, too few places and too much heat.",
    state: { ...SAMPLE_SITE_STATE, places: placesOf("aa aa aa aa aa") },
  },
  {
    id: "heater",
    label: "A space heater",
    sentence: "A space heater of 1500 W shares circuit A with two machines.",
    state: { ...SAMPLE_SITE_STATE, circuits: withCircuit(0, { otherLoad: 1500 }) },
  },
  {
    id: "volts",
    label: "The heater on 230 V",
    sentence: "The same load on a circuit of 230 V: the same breaker carries more watts.",
    state: { ...SAMPLE_SITE_STATE, circuits: withCircuit(0, { otherLoad: 1500, voltage: 230 }) },
  },
  {
    id: "quiet",
    label: "A quiet room",
    sentence: "Four machines, two in each room. Room B has a noise limit of 35 dBA.",
    state: { ...SAMPLE_SITE_STATE, places: placesOf("aa aa bb bb") },
  },
];

const clamp = (value: number, bounds: { readonly min: number; readonly max: number }): number => Math.min(bounds.max, Math.max(bounds.min, value));
const numbersOf = (text: string | undefined): readonly number[] => (text ?? "").split(".").map((part) => Number.parseInt(part, 10));
const nearest = (value: number, list: readonly number[], fallback: number): number =>
  Number.isFinite(value) && list.includes(value) ? value : fallback;
const or = (value: number | undefined, fallback: number): number => (value === undefined || !Number.isFinite(value) ? fallback : value);

/** This function writes a site state as pairs of the hash of the address, so a visitor can share a site. */
export function siteHashOf(state: SiteState): string {
  const places = state.places.map((place) => `${place.circuit === 1 ? "b" : "a"}${place.room === 1 ? "b" : "a"}`).join(".");
  const circuits = state.circuits.map((c, index) => `c${String(index)}=${[c.voltage, c.breaker, c.sockets, c.otherLoad].join(".")}`);
  const rooms = state.rooms.map((r, index) => `r${String(index)}=${[r.places, r.heatLimit, r.noiseLimit].join(".")}`);
  return [`at=${places}`, `price=${String(Math.round(state.price * 100))}`, ...circuits, ...rooms].join("&");
}

/** This function reads a site state from the hash of the address. A hash with no pair `at` gives no state. */
export function siteStateOf(hash: string): SiteState | undefined {
  const pairs = new Map(
    hash
      .replace(/^#/, "")
      .split("&")
      .map((pair) => pair.split("=") as [string, string | undefined]),
  );
  const at = pairs.get("at");
  if (at === undefined) return undefined;
  const places = at === "" ? [] : at.split(".").slice(0, MAX_COPIES).map((pair) => ({ circuit: pair[0] === "b" ? 1 : 0, room: pair[1] === "b" ? 1 : 0 }) as const);
  const circuitOf = (index: 0 | 1): CircuitState => {
    const [voltage, breaker, sockets, otherLoad] = numbersOf(pairs.get(`c${String(index)}`));
    const fallback = SAMPLE_SITE_STATE.circuits[index];
    return {
      voltage: nearest(or(voltage, fallback.voltage), VOLTAGES, fallback.voltage),
      breaker: nearest(or(breaker, fallback.breaker), BREAKERS, fallback.breaker),
      sockets: clamp(or(sockets, fallback.sockets), SITE_BOUNDS.sockets),
      otherLoad: clamp(or(otherLoad, fallback.otherLoad), SITE_BOUNDS.otherLoad),
    };
  };
  const roomOf = (index: 0 | 1): RoomState => {
    const [places, heatLimit, noiseLimit] = numbersOf(pairs.get(`r${String(index)}`));
    const fallback = SAMPLE_SITE_STATE.rooms[index];
    return {
      places: clamp(or(places, fallback.places), SITE_BOUNDS.places),
      heatLimit: clamp(or(heatLimit, fallback.heatLimit), SITE_BOUNDS.heatLimit),
      noiseLimit: clamp(or(noiseLimit, fallback.noiseLimit), SITE_BOUNDS.noiseLimit),
    };
  };
  const cents = Number.parseInt(pairs.get("price") ?? "", 10);
  const price = clamp(or(cents, SAMPLE_SITE_STATE.price * 100) / 100, SITE_BOUNDS.price);
  return { places, price, circuits: [circuitOf(0), circuitOf(1)], rooms: [roomOf(0), roomOf(1)] };
}

/** This function gives an amount of money in US dollars, with cents under 100 dollars. */
export function formatUsd(value: number | undefined): string {
  if (value === undefined) return "–";
  return value < 100 ? `$${value.toFixed(2)}` : `$${String(Math.round(value))}`;
}
