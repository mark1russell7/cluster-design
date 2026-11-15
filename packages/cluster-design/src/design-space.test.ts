import { quantity } from "@mark1russell7/quantity";
import { checkConfig, checkSpace, configId, enumerateSpace, type StrategyConfig } from "@mark1russell7/strategy-space";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { verdictOf } from "./check.ts";
import {
  checkDesignConfig,
  COPIES_STAGE,
  DESIGN_ENGINE,
  designOf,
  designSpace,
  freeCounts,
  placeMachines,
  PLACEMENT_STAGE,
  type DesignInput,
  type DesignSpace,
  type DesignSpaceOptions,
} from "./design-space.ts";
import { evaluateDesign } from "./evaluate.ts";
import type { Machine } from "./machine.ts";
import { readCatalog, type Part } from "./parts.ts";
import { FIT_RULES } from "./rules.ts";
import { SITE_RULES } from "./site-formulas.ts";
import type { Site } from "./site.ts";
import { SAMPLE_MACHINE, SAMPLE_PARTS, SAMPLE_SITE } from "./sample.ts";

const catalogOf = (parts: readonly Part[]): ReadonlyMap<string, Part> => {
  const read = readCatalog(parts);
  if (!read.ok) throw new Error(read.problems.join(" "));
  return read.value;
};

const CATALOG = catalogOf(SAMPLE_PARTS);

const spaceOf = (options: DesignSpaceOptions = {}, catalog = CATALOG): DesignSpace => {
  const made = designSpace(catalog, options);
  if (!made.ok) throw new Error(made.problems.join(" "));
  return made.value;
};

const DERIVED = spaceOf();
const RAW = spaceOf({ derive: false });

/** The site of the sample, with its two fixed machines. */
const INPUT: DesignInput = { catalog: CATALOG, site: SAMPLE_SITE, fixed: [SAMPLE_MACHINE, { ...SAMPLE_MACHINE, id: "node-2" }] };

/** This function gives the config of the sample machine, with a count of copies and a rule of the placement. */
const sampleConfig = (copies: number, placement: "fill" | "spread"): StrategyConfig => ({
  space: DESIGN_ENGINE,
  stages: {
    cpu: { option: "cpu-a" },
    board: { option: "board-a" },
    memory: { option: "ram-2x16", params: { count: 2 } },
    storage: { option: "ssd-m2", params: { count: 1 } },
    "storage-2": { option: "hdd-sata", params: { count: 2 } },
    psu: { option: "psu-550" },
    case: { option: "case-a" },
    cooler: { option: "cooler-a" },
    fan: { option: "fan-120", params: { count: 2 } },
    gpu: null,
    [COPIES_STAGE]: { option: COPIES_STAGE, params: { count: copies } },
    [PLACEMENT_STAGE]: { option: placement },
  },
});

describe("the design space", () => {
  it("has one stage for each slot, then the copies and the placement, and the checks of strategy-space find no break", () => {
    expect(DERIVED.space.stages.map((stage) => stage.name)).toEqual([
      "cpu",
      "board",
      "memory",
      "storage",
      "storage-2",
      "psu",
      "case",
      "cooler",
      "fan",
      "gpu",
      COPIES_STAGE,
      PLACEMENT_STAGE,
    ]);
    expect(checkSpace(DERIVED.space)).toEqual([]);
    expect(checkSpace(RAW.space)).toEqual([]);
  });

  it("gets a constraint from each fit rule of two classes that a pair of parts breaks at each count", () => {
    const fromRules = DERIVED.derived.filter((d) => d.reason !== "order").map((d) => [d.reason, d.constraint]);
    expect(fromRules).toEqual([
      ["cpu-socket", { if: { stage: "cpu", option: "cpu-s2" }, then: { not: { stage: "board", option: "board-a" } } }],
      ["cooler-rating", { if: { stage: "cooler", option: "cooler-a" }, then: { not: { stage: "cpu", option: "cpu-hot" } } }],
      ["memory-type", { if: { stage: "memory", option: "ram-ddr4" }, then: { not: { stage: "board", option: "board-a" } } }],
      ["gpu-length", { if: { stage: "gpu", option: "gpu-long" }, then: { not: { stage: "case", option: "case-a" } } }],
    ]);
    expect(DERIVED.excluded).toEqual([]);
  });

  it("keeps the parts of two slots of one class in the order of the catalog, and never takes one part twice", () => {
    const grid = enumerateSpace(DERIVED.space, { mode: "grid", levels: 2 });
    expect(grid.length).toBeGreaterThan(0);
    const order = [...CATALOG.values()].filter((part) => part.class === "storage").map((part) => part.id);
    for (const config of grid) {
      const first = config.stages["storage"]?.option;
      const second = config.stages["storage-2"]?.option;
      if (first === undefined || second === undefined) continue;
      expect(order.indexOf(first)).toBeLessThan(order.indexOf(second));
    }
  });

  it("removes only the configs that the fit rules refuse", () => {
    const sample = enumerateSpace(RAW.space, { mode: "sample", n: 160, seed: 4242 });
    let refused = 0;
    for (const config of sample) {
      if (checkConfig(DERIVED.space, config).length === 0) continue;
      refused += 1;
      const checked = checkDesignConfig(RAW, config, INPUT);
      if (!checked.ok) throw new Error(checked.problems.join(" "));
      expect(checked.value.machine.some((finding) => finding.verdict === "breaks")).toBe(true);
    }
    expect(refused).toBeGreaterThan(40);
  });

  it("removes a part that breaks a fit rule of one class at each count", () => {
    const bad = { ...(CATALOG.get("psu-300") as Part), id: "psu-bad", efficiency: quantity(120, "%") } as Part;
    const space = spaceOf({}, catalogOf([...SAMPLE_PARTS, bad]));
    expect(space.excluded).toEqual([{ stage: "psu", part: "psu-bad", rule: "psu-efficiency" }]);
    expect(space.space.stages.find((stage) => stage.name === "psu")?.options.map((option) => option.id)).toEqual(["psu-550", "psu-300"]);
    const config = { ...sampleConfig(1, "fill"), stages: { ...sampleConfig(1, "fill").stages, psu: { option: "psu-bad" } } };
    const raw = spaceOf({ derive: false }, catalogOf([...SAMPLE_PARTS, bad]));
    const checked = checkDesignConfig(raw, config, { ...INPUT, catalog: catalogOf([...SAMPLE_PARTS, bad]) });
    if (!checked.ok) throw new Error(checked.problems.join(" "));
    expect(checked.value.machine.find((finding) => finding.rule === "psu-efficiency")?.verdict).toBe("breaks");
  });

  it("gives problems for a bad range, a required class with no part, and two required slots with one part", () => {
    expect(designSpace(CATALOG, { copies: { min: 0, max: 2 } })).toEqual({
      ok: false,
      problems: ["The range of the copies is not whole numbers from 1 or more, with a max of the min or more."],
    });
    const noCpu = catalogOf(SAMPLE_PARTS.filter((part) => part.class !== "cpu"));
    expect(designSpace(noCpu)).toEqual({ ok: false, problems: ["The slot cpu has no part of the class cpu that can fit."] });
    const twoCases = designSpace(CATALOG, {
      slots: [
        { class: "case", min: 1, max: 1 },
        { class: "case", min: 1, max: 1 },
      ],
    });
    expect(twoCases).toEqual({
      ok: false,
      problems: ["The slots case and case-2 need two parts of the class case or more, because each slot takes a different part."],
    });
  });
});

describe("the class declarations of the fit rules", () => {
  const ids = [...CATALOG.keys()];
  const lines = fc.array(fc.record({ part: fc.constantFrom(...ids), count: fc.integer({ min: 1, max: 4 }) }), { maxLength: 12 });

  it("hold: each rule gives the same verdict on a machine and on the lines of its classes only", () => {
    fc.assert(
      fc.property(lines, (all) => {
        for (const rule of FIT_RULES) {
          const full: Machine = { id: "full", lines: all };
          const part: Machine = { id: "part", lines: all.filter((line) => rule.classes.includes((CATALOG.get(line.part) as Part).class)) };
          const evaluated = evaluateDesign([full, part], CATALOG, [rule]);
          if (!evaluated.ok) throw new Error(evaluated.problems.join(" "));
          const [a, b] = evaluated.evaluations.map((e) => verdictOf(e.result).verdict);
          if (a !== b) throw new Error(`${rule.id}: ${String(a)} on the machine, ${String(b)} on the lines of ${rule.classes.join(", ")}`);
        }
      }),
      { numRuns: 60, seed: 7 },
    );
  });
});

describe("the design of a config", () => {
  it("makes the copies of the new machine with the lines of the stages", () => {
    const made = designOf(DERIVED, sampleConfig(2, "fill"), INPUT);
    if (!made.ok) throw new Error(made.problems.join(" "));
    expect(made.value.added.map((machine) => machine.id)).toEqual(["new-1", "new-2"]);
    expect(made.value.added[0]?.lines).toEqual(SAMPLE_MACHINE.lines);
    expect(made.value.machines).toHaveLength(4);
  });

  it("fills the first free room and circuit, or spreads over the most free ones", () => {
    const placesOf = (copies: number, placement: "fill" | "spread"): string[] => {
      const made = designOf(DERIVED, sampleConfig(copies, placement), INPUT);
      if (!made.ok) throw new Error(made.problems.join(" "));
      return made.value.site.places.slice(2).map((place) => `${place.machine}:${place.room}:${place.circuit}`);
    };
    expect(placesOf(2, "fill")).toEqual(["new-1:room-b:circuit-a", "new-2:room-b:circuit-a"]);
    expect(placesOf(2, "spread")).toEqual(["new-1:room-b:circuit-a", "new-2:room-b:circuit-b"]);
    // Circuit-a has 4 sockets and 2 fixed machines, so the third copy goes to circuit-b. Room-b is full, so it goes to room-a.
    expect(placesOf(3, "fill")).toEqual(["new-1:room-b:circuit-a", "new-2:room-b:circuit-a", "new-3:room-a:circuit-b"]);
  });

  it("gives problems for a config that the space refuses, and for the id of a fixed machine", () => {
    const bad = designOf(DERIVED, { ...sampleConfig(1, "fill"), stages: { ...sampleConfig(1, "fill").stages, cpu: { option: "cpu-s2" } } }, INPUT);
    expect(bad.ok).toBe(false);
    const clash = designOf(DERIVED, sampleConfig(1, "fill"), { ...INPUT, prefix: "node-" });
    expect(clash).toEqual({ ok: false, problems: ["The id node-1 of a new machine is the id of a fixed machine."] });
  });

  it("gives a site with no room or circuit as a problem", () => {
    const empty = { ...SAMPLE_SITE, rooms: [], circuits: [], places: [] };
    expect(placeMachines(empty, [], [SAMPLE_MACHINE], CATALOG, "fill")).toEqual({
      ok: false,
      problems: ["The site has no room for the new machines.", "The site has no circuit for the new machines."],
    });
  });
});

describe("the check of a config", () => {
  it("gives one verdict from the fit rules of the new machine and the rules of the site", () => {
    const one = checkDesignConfig(DERIVED, sampleConfig(1, "fill"), INPUT);
    if (!one.ok) throw new Error(one.problems.join(" "));
    expect(one.value.id).toBe(configId(DERIVED.space, sampleConfig(1, "fill")));
    expect(one.value.machine.every((finding) => finding.verdict === "fits")).toBe(true);
    expect(one.value.machine).toHaveLength(FIT_RULES.length);
  });

  it("refuses three copies, because the third one goes to a full room", () => {
    const three = checkDesignConfig(DERIVED, sampleConfig(3, "fill"), INPUT);
    if (!three.ok) throw new Error(three.problems.join(" "));
    expect(three.value.verdict).toBe("breaks");
    const broken = three.value.site.filter((finding) => finding.verdict === "breaks").map((finding) => `${finding.id}:${finding.rule}`);
    expect(broken).toContain("room-a:room-places");
  });
});

describe("the limits of the site on the copies", () => {
  const brokenRules = (checked: ReturnType<typeof checkDesignConfig>): string[] => {
    if (!checked.ok) throw new Error(checked.problems.join(" "));
    return checked.value.site.filter((finding) => finding.verdict === "breaks").map((finding) => finding.rule);
  };

  it("lowers the max of the copies to the free places of the sample site, with the reason of each limit", () => {
    const limited = spaceOf({ site: INPUT });
    expect(limited.limits).toEqual([
      { rule: "room-places", free: 2, each: 1, max: 2 },
      { rule: "circuit-plugs", free: 4, each: 1, max: 4 },
    ]);
    expect(limited.copies).toEqual({ min: 1, max: 2 });
    expect(checkSpace(limited.space)).toEqual([]);
    expect(checkConfig(limited.space, sampleConfig(2, "spread"))).toEqual([]);
    expect(checkConfig(limited.space, sampleConfig(3, "fill")).length).toBeGreaterThan(0);
    expect(brokenRules(checkDesignConfig(DERIVED, sampleConfig(3, "spread"), INPUT))).toContain("room-places");
    expect(DERIVED.limits).toEqual([]);
  });

  it("takes a limit only from a rule of the list", () => {
    const limited = spaceOf({ site: INPUT, siteRules: SITE_RULES.filter((rule) => rule.id !== "room-places") });
    expect(limited.limits.map((limit) => limit.rule)).toEqual(["circuit-plugs"]);
    expect(limited.copies).toEqual({ min: 1, max: 4 });
  });

  it("gives a problem when the site has no free place for one copy", () => {
    const full = { ...SAMPLE_SITE, rooms: SAMPLE_SITE.rooms.filter((room) => room.id === "room-a") };
    const made = designSpace(CATALOG, { site: { site: full, fixed: INPUT.fixed ?? [] } });
    expect(made).toEqual({ ok: false, problems: ["The site has room for 0 new machines by the rule room-places, less than the min 1 of the copies."] });
  });

  it("holds on random sites: a count above the max breaks the rule of the limit, and fill places the max", () => {
    const drawn = fc.record({
      places: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 3 }),
      sockets: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 3 }),
      fixed: fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 4 }),
    });
    fc.assert(
      fc.property(drawn, ({ places, sockets, fixed }) => {
        const machines: Machine[] = fixed.map((_, i) => ({ ...SAMPLE_MACHINE, id: `fixed-${String(i)}` }));
        const site: Site = {
          ...SAMPLE_SITE,
          rooms: places.map((n, i) => ({ id: `room-${String(i)}`, places: n, heatLimit: quantity(1e6, "W"), noiseLimit: quantity(200, "dBA") })),
          circuits: sockets.map((n, i) => ({ id: `circuit-${String(i)}`, voltage: quantity(120, "V"), breaker: quantity(1000, "A"), sockets: n, otherLoad: quantity(0, "W") })),
          places: fixed.map(([r, c], i) => ({ machine: `fixed-${String(i)}`, room: `room-${String(r % places.length)}`, circuit: `circuit-${String(c % sockets.length)}` })),
        };
        const input: DesignInput = { catalog: CATALOG, site, fixed: machines };
        const made = designSpace(CATALOG, { site: input });
        if (!made.ok) {
          expect(made.problems[0]).toMatch(/^The site has room for 0 new machines/);
          expect(brokenRules(checkDesignConfig(DERIVED, sampleConfig(1, "spread"), input)).some((rule) => rule === "room-places" || rule === "circuit-plugs")).toBe(true);
          return;
        }
        const { max } = made.value.copies;
        const least = made.value.limits.filter((limit) => limit.max === max).map((limit) => limit.rule);
        if (max < DERIVED.copies.max) {
          for (const placement of ["fill", "spread"] as const) {
            expect(brokenRules(checkDesignConfig(DERIVED, sampleConfig(max + 1, placement), input)).some((rule) => least.includes(rule))).toBe(true);
          }
        }
        const free = freeCounts(site, machines, CATALOG);
        if ([...free.rooms.values(), ...free.circuits.values()].every((n) => n >= 0)) {
          // A range of one count has no param, so the config of the limited space has no count of copies.
          const config = sampleConfig(max, "fill");
          const one = max === made.value.copies.min ? { ...config, stages: { ...config.stages, [COPIES_STAGE]: { option: COPIES_STAGE } } } : config;
          expect(brokenRules(checkDesignConfig(made.value, one, input))).toEqual([]);
        }
      }),
      { numRuns: 80, seed: 20261115 },
    );
  });
});
