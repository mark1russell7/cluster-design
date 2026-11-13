import { quantity } from "@mark1russell7/quantity";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Machine } from "./machine.ts";
import { measureDesign } from "./measure.ts";
import { readCatalog, type Part } from "./parts.ts";
import { SAMPLE_MACHINE, SAMPLE_PARTS, SAMPLE_SITE } from "./sample.ts";
import { checkSite, measureSite, type SiteOptions } from "./site-check.ts";
import { HOURS_PER_MONTH, SITE_MEASURES } from "./site-formulas.ts";
import { readSite, siteTree, type Site } from "./site.ts";

const read = readCatalog(SAMPLE_PARTS);
if (!read.ok) throw new Error(read.problems.join(" "));
const CATALOG: ReadonlyMap<string, Part> = read.value;

const MACHINES: readonly Machine[] = [
  { ...SAMPLE_MACHINE, id: "node-1" },
  { ...SAMPLE_MACHINE, id: "node-2" },
];

const machineValue = (measure: string): number => {
  const result = measureDesign([SAMPLE_MACHINE], CATALOG);
  if (!result.ok) throw new Error(result.problems.join(" "));
  const value = result.values.find((item) => item.measure === measure)?.value;
  if (value === undefined) throw new Error(`no value of ${measure}`);
  return value;
};

/** The power from the wall, the power at idle and the noise of one sample machine. */
const WALL = machineValue("wall-power");
const IDLE = machineValue("wall-idle-power");
const NOISE = machineValue("noise");

const valuesOf = (site: Site = SAMPLE_SITE, machines: readonly Machine[] = MACHINES, options: SiteOptions = {}): Record<string, number | string | undefined> => {
  const result = measureSite(site, machines, CATALOG, options);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return Object.fromEntries(result.values.map((value) => [`${value.id}:${value.measure}`, value.value ?? value.detail]));
};

const verdictsOf = (site: Site = SAMPLE_SITE, machines: readonly Machine[] = MACHINES, options: SiteOptions = {}): Record<string, string> => {
  const result = checkSite(site, machines, CATALOG, options);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return Object.fromEntries(result.findings.map((finding) => [`${finding.id}:${finding.rule}`, finding.verdict]));
};

const withCircuit = (site: Site, index: number, change: Partial<Site["circuits"][number]>): Site => ({
  ...site,
  circuits: site.circuits.map((circuit, i) => (i === index ? { ...circuit, ...change } : circuit)),
});

const withRoom = (site: Site, index: number, change: Partial<Site["rooms"][number]>): Site => ({
  ...site,
  rooms: site.rooms.map((room, i) => (i === index ? { ...room, ...change } : room)),
});

describe("the record of a site", () => {
  it("reads the sample site from JSON", () => {
    expect(readSite(JSON.parse(JSON.stringify(SAMPLE_SITE)))).toEqual({ ok: true, value: SAMPLE_SITE });
  });

  it("refuses an amount of the wrong kind, with its path", () => {
    const result = readSite(withCircuit(SAMPLE_SITE, 0, { breaker: quantity(15, "W") }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/^The site is not valid at circuits\.0\.breaker/);
  });

  it("refuses a format that it does not know, and a field that a site does not have", () => {
    expect(readSite({ ...SAMPLE_SITE, format: "site/0" }).ok).toBe(false);
    expect(readSite({ ...SAMPLE_SITE, owner: "someone" }).ok).toBe(false);
  });

  it("gives each problem of the places", () => {
    const site: Site = {
      ...SAMPLE_SITE,
      places: [
        { machine: "node-1", circuit: "circuit-x", room: "room-a" },
        { machine: "node-1", circuit: "circuit-a", room: "room-z" },
        { machine: "node-9", circuit: "circuit-a", room: "room-a" },
      ],
    };
    expect(siteTree(site, MACHINES, CATALOG)).toEqual({
      ok: false,
      problems: [
        "The place of node-1 names the circuit circuit-x, but the site does not have it.",
        "The place of node-1 names the room room-z, but the site does not have it.",
        "The machine node-1 has two places.",
        "A place names the machine node-9, but the design does not have it.",
        "The machine node-2 has no place.",
      ],
    });
  });

  it("gives a problem for an id on two circuits, and for a part that the catalog does not have", () => {
    const twice: Site = { ...SAMPLE_SITE, circuits: [SAMPLE_SITE.circuits[0], SAMPLE_SITE.circuits[0]].filter((circuit) => circuit !== undefined) };
    expect(siteTree(twice, MACHINES, CATALOG)).toEqual({ ok: false, problems: ["The id circuit-a is on two circuits."] });
    const unknown: Machine = { id: "node-2", lines: [{ part: "no-such-part", count: 1 }] };
    expect(siteTree(SAMPLE_SITE, [MACHINES[0] ?? SAMPLE_MACHINE, unknown], CATALOG)).toEqual({
      ok: false,
      problems: ["The machine node-2 names the part no-such-part, but the catalog does not have it."],
    });
  });
});

describe("the measures of a site", () => {
  it("add the power from the wall of the machines on a circuit, and its other load", () => {
    const values = valuesOf();
    expect(values["circuit-a:load"]).toBeCloseTo(2 * WALL + 200, 9);
    expect(values["circuit-a:idle-load"]).toBeCloseTo(2 * IDLE + 200, 9);
    expect(values["circuit-a:current"]).toBeCloseTo((2 * WALL + 200) / 120, 9);
    expect(values["circuit-a:limit"]).toBeCloseTo(120 * 15 * 0.8, 9);
    expect(values["circuit-a:plugs"]).toBe(2);
    expect(values["circuit-b:load"]).toBe(0);
    expect(values["circuit-b:plugs"]).toBe(0);
  });

  it("read the voltage and the breaker in volts and amperes, in each unit of the input", () => {
    const kilovolts = withCircuit(SAMPLE_SITE, 0, { voltage: quantity(0.12, "kV"), breaker: quantity(15000, "mA") });
    expect(valuesOf(kilovolts)["circuit-a:limit"]).toBeCloseTo(1440, 9);
  });

  it("give the heat and the noise of the machines in a room", () => {
    const values = valuesOf();
    expect(values["room-a:heat"]).toBeCloseTo(2 * WALL, 9);
    expect(values["room-a:idle-heat"]).toBeCloseTo(2 * IDLE, 9);
    // Two equal machines give 10 log10 2 dB, approximately 3 dB, more than one machine.
    expect(values["room-a:noise"]).toBeCloseTo(NOISE + 10 * Math.log10(2), 9);
    expect(values["room-a:machines"]).toBe(2);
    expect(values["room-b:heat"]).toBe(0);
    expect(values["room-b:noise"]).toBe(0);
    expect(values["room-b:machines"]).toBe(0);
  });

  it("give the power of the site and the cost of a month of its electricity", () => {
    const values = valuesOf();
    expect(HOURS_PER_MONTH).toBe(730.485);
    expect(values["site:power"]).toBeCloseTo(2 * WALL, 9);
    expect(values["site:idle-power"]).toBeCloseTo(2 * IDLE, 9);
    expect(values["site:cost"]).toBeCloseTo(((2 * WALL) / 1000) * HOURS_PER_MONTH * 0.15, 9);
    expect(values["site:idle-cost"]).toBeCloseTo(((2 * IDLE) / 1000) * HOURS_PER_MONTH * 0.15, 9);
    const cents = { ...SAMPLE_SITE, price: quantity(0.0015, "USD/Wh") };
    expect(valuesOf(cents)["site:cost"]).toBeCloseTo(((2 * WALL) / 1000) * HOURS_PER_MONTH * 1.5, 9);
  });

  it("give each value with the unit of its measure", () => {
    const result = measureSite(SAMPLE_SITE, MACHINES, CATALOG);
    if (!result.ok) throw new Error(result.problems.join(" "));
    const units = new Map(SITE_MEASURES.map((measure) => [measure.id, measure.unit]));
    for (const value of result.values) expect(value.unit).toBe(units.get(value.measure));
  });
});

describe("the rules of a site", () => {
  it("pass the sample site", () => {
    expect(new Set(Object.values(verdictsOf()))).toEqual(new Set(["fits"]));
  });

  it("break the load of a circuit above its continuous load limit", () => {
    expect(verdictsOf(withCircuit(SAMPLE_SITE, 0, { breaker: quantity(5, "A") }))).toMatchObject({ "circuit-a:circuit-load": "breaks", "circuit-b:circuit-load": "fits" });
    expect(verdictsOf(SAMPLE_SITE, MACHINES, { continuousLoad: 0.2 })).toMatchObject({ "circuit-a:circuit-load": "breaks" });
  });

  it("break the plugs of a circuit, and the heat, the noise and the places of a room", () => {
    const tight = withRoom(withCircuit(SAMPLE_SITE, 0, { sockets: 1 }), 0, { places: 1, heatLimit: quantity(300, "W"), noiseLimit: quantity(36, "dBA") });
    expect(verdictsOf(tight)).toMatchObject({
      "circuit-a:circuit-plugs": "breaks",
      "room-a:room-heat": "breaks",
      "room-a:room-noise": "breaks",
      "room-a:room-places": "breaks",
      "room-b:room-heat": "fits",
    });
  });

  it("give no verdict, and not a fit, when a machine has no power supply", () => {
    const noPsu: Machine = { id: "node-2", lines: SAMPLE_MACHINE.lines.filter((line) => line.part !== "psu-550") };
    const verdicts = verdictsOf(SAMPLE_SITE, [MACHINES[0] ?? SAMPLE_MACHINE, noPsu]);
    expect(verdicts["circuit-a:circuit-load"]).toBe("unread");
    expect(verdicts["room-a:room-heat"]).toBe("unread");
  });

  it("refuse a continuous load limit that is not more than 0 and not more than 1", () => {
    expect(checkSite(SAMPLE_SITE, MACHINES, CATALOG, { continuousLoad: 0 })).toEqual({
      ok: false,
      problems: ["The continuous load limit 0 is not more than 0 and not more than 1."],
    });
    expect(measureSite(SAMPLE_SITE, MACHINES, CATALOG, { continuousLoad: 1.5 }).ok).toBe(false);
  });

  it("agree with the measures: a circuit fits when its load is not more than its limit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 0, max: 3000 }),
        fc.double({ min: 0.05, max: 1, noNaN: true }),
        (breaker, otherLoad, continuousLoad) => {
          const site = withCircuit(SAMPLE_SITE, 0, { breaker: quantity(breaker, "A"), otherLoad: quantity(otherLoad, "W") });
          const values = valuesOf(site, MACHINES, { continuousLoad });
          const load = values["circuit-a:load"];
          const limit = values["circuit-a:limit"];
          if (typeof load !== "number" || typeof limit !== "number") return false;
          return verdictsOf(site, MACHINES, { continuousLoad })["circuit-a:circuit-load"] === (load <= limit ? "fits" : "breaks");
        },
      ),
      { seed: 20261113, numRuns: 60 },
    );
  });
});
