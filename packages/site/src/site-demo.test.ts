import { SITE_RULES } from "@mark1russell7/cluster-design";
import { SAMPLE_SITE } from "@mark1russell7/cluster-design/sample";
import { describe, expect, it } from "vitest";
import { headlineOf, machineOf, PRESETS } from "./demo.ts";
import {
  copiesOf,
  formatUsd,
  MAX_COPIES,
  SAMPLE_SITE_STATE,
  siteHashOf,
  siteOf,
  SITE_PRESETS,
  siteResultOf,
  siteStateOf,
  type SiteState,
} from "./site-demo.ts";

const firstPreset = PRESETS[0];
if (firstPreset === undefined) throw new Error("The demo has no preset.");
const MACHINE = machineOf(firstPreset.state);

const preset = (id: string): SiteState => {
  const found = SITE_PRESETS.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`No site preset ${id}`);
  return found.state;
};

const problems = (state: SiteState): Record<string, string> =>
  Object.fromEntries(
    siteResultOf(MACHINE, state)
      .findings.filter((finding) => finding.verdict !== "fits")
      .map((finding) => [`${finding.id}:${finding.rule}`, finding.verdict]),
  );

describe("the site of the demo", () => {
  it("starts with the sample site of the package", () => {
    expect(siteOf(SAMPLE_SITE_STATE)).toEqual(SAMPLE_SITE);
    expect(copiesOf(MACHINE, SAMPLE_SITE_STATE).map((machine) => machine.id)).toEqual(["node-1", "node-2"]);
  });

  it("checks each rule at each circuit and each room", () => {
    const result = siteResultOf(MACHINE, SAMPLE_SITE_STATE);
    expect(result.verdict).toBe("fits");
    expect(result.findings).toHaveLength(SITE_RULES.filter((rule) => rule.level === "circuit").length * 2 + SITE_RULES.filter((rule) => rule.level === "room").length * 2);
  });

  it("gives the values of each circuit and each room", () => {
    const result = siteResultOf(MACHINE, SAMPLE_SITE_STATE);
    const [a, b] = result.circuits;
    const wall = (result.power ?? 0) / 2;
    expect(wall).toBeGreaterThan(0);
    expect(a).toMatchObject({ id: "circuit-a", copies: ["node-1", "node-2"], limit: 1440, plugs: 2, verdict: "fits" });
    expect(a?.load).toBeCloseTo(2 * wall + 200, 9);
    expect(a?.current).toBeCloseTo((2 * wall + 200) / 120, 9);
    expect(b).toMatchObject({ id: "circuit-b", copies: [], load: 0, plugs: 0 });
    expect(result.rooms[0]).toMatchObject({ id: "room-a", copies: ["node-1", "node-2"], machines: 2 });
    expect(result.rooms[0]?.heat).toBeCloseTo(2 * wall, 9);
    expect(result.cost).toBeCloseTo(((2 * wall) / 1000) * 730.485 * 0.15, 9);
  });

  it("gives the rules that each preset breaks", () => {
    expect(problems(preset("fits"))).toEqual({});
    expect(problems(preset("crowded"))).toEqual({ "circuit-a:circuit-plugs": "breaks", "room-a:room-heat": "breaks", "room-a:room-places": "breaks" });
    expect(problems(preset("heater"))).toEqual({ "circuit-a:circuit-load": "breaks" });
    expect(problems(preset("volts"))).toEqual({});
    expect(problems(preset("quiet"))).toEqual({ "room-b:room-noise": "breaks" });
  });

  it("gives the headline of the site", () => {
    expect(headlineOf(siteResultOf(MACHINE, preset("fits")), "The site fits")).toBe("The site fits");
    expect(headlineOf(siteResultOf(MACHINE, preset("heater")), "The site fits")).toBe("1 rule breaks");
    expect(headlineOf(siteResultOf(MACHINE, preset("crowded")), "The site fits")).toBe("3 rules break");
  });

  it("gives a circuit of 230 V a higher limit with the same breaker", () => {
    expect(siteResultOf(MACHINE, preset("volts")).circuits[0]?.limit).toBe(230 * 15 * 0.8);
  });

  it("gives no read, and not a fit, when the machine has no power supply", () => {
    const empty = machineOf({ counts: new Map(), psuLoad: 0.8 });
    const result = siteResultOf(empty, SAMPLE_SITE_STATE);
    expect(result.verdict).toBe("unread");
    expect(Object.fromEntries(result.findings.filter((f) => f.verdict === "unread").map((f) => [`${f.id}:${f.rule}`, f.verdict]))).toEqual({
      "circuit-a:circuit-load": "unread",
      "room-a:room-heat": "unread",
    });
  });

  it("checks a site with no machine", () => {
    const result = siteResultOf(MACHINE, { ...SAMPLE_SITE_STATE, places: [] });
    expect(result.verdict).toBe("fits");
    expect(result.power).toBe(0);
  });
});

describe("the hash of a site", () => {
  it("writes and reads each preset", () => {
    for (const { state } of SITE_PRESETS) expect(siteStateOf(`#${siteHashOf(state)}`)).toEqual(state);
  });

  it("goes after the pairs of the machine", () => {
    expect(siteStateOf("#cpu-a=1&load=80&at=ab.ba&price=20")).toMatchObject({ places: [{ circuit: 0, room: 1 }, { circuit: 1, room: 0 }], price: 0.2 });
  });

  it("gives no state with no pair at", () => {
    expect(siteStateOf("#cpu-a=1&load=80")).toBeUndefined();
    expect(siteStateOf("")).toBeUndefined();
  });

  it("keeps each value in its bounds, and each voltage and breaker in its list", () => {
    const read = siteStateOf(`#at=${Array.from({ length: 9 }, () => "aa").join(".")}&price=900&c0=99.17.40.99999&r0=99.-5.200`);
    expect(read?.places).toHaveLength(MAX_COPIES);
    expect(read?.price).toBe(1);
    expect(read?.circuits[0]).toEqual({ voltage: 120, breaker: 15, sockets: 8, otherLoad: 3000 });
    expect(read?.rooms[0]).toEqual({ places: 8, heatLimit: 0, noiseLimit: 80 });
    expect(read?.circuits[1]).toEqual(SAMPLE_SITE_STATE.circuits[1]);
  });

  it("reads an empty list of places", () => {
    expect(siteStateOf("#at=")?.places).toEqual([]);
  });
});

describe("the text of money", () => {
  it("gives cents under 100 dollars", () => {
    expect(formatUsd(39.6912)).toBe("$39.69");
    expect(formatUsd(123.4)).toBe("$123");
    expect(formatUsd(undefined)).toBe("–");
  });
});
