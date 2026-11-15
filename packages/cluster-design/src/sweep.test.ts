import { quantity } from "@mark1russell7/quantity";
import type { StrategyConfig } from "@mark1russell7/strategy-space";
import { app, lit, ref } from "@mark1russell7/vex";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkDesignConfig, designSpace, type DesignInput, type DesignSpace } from "./design-space.ts";
import { readCatalog, type Part } from "./parts.ts";
import { SAMPLE_MACHINE, SAMPLE_PARTS, SAMPLE_SITE } from "./sample.ts";
import { measureSite } from "./site-check.ts";
import { SITE_RULES, type SiteRule } from "./site-formulas.ts";
import {
  DESIGN_OBJECTIVES,
  DESIGN_SWEEP_EVALUATOR,
  evolveDesigns,
  sweepDesigns,
  type DesignEvolution,
  type DesignEvolveOptions,
  type DesignSweep,
  type DesignSweepOptions,
} from "./sweep.ts";

const read = readCatalog(SAMPLE_PARTS);
if (!read.ok) throw new Error(read.problems.join(" "));
const CATALOG: ReadonlyMap<string, Part> = read.value;

/** The site of the sample, with its two fixed machines. */
const INPUT: DesignInput = { catalog: CATALOG, site: SAMPLE_SITE, fixed: [SAMPLE_MACHINE, { ...SAMPLE_MACHINE, id: "node-2" }] };

const made = designSpace(CATALOG, { site: INPUT });
if (!made.ok) throw new Error(made.problems.join(" "));
const SPACE: DesignSpace = made.value;

const SAMPLE: DesignSweepOptions = { enumerate: { mode: "sample", n: 40, seed: "cluster-design sweep" } };

const sweepOf = (options: DesignSweepOptions = SAMPLE, input: DesignInput = INPUT): DesignSweep => {
  const swept = sweepDesigns(SPACE, input, options);
  if (!swept.ok) throw new Error(swept.problems.join(" "));
  return swept.value;
};

/** This function gives the verdict of a config from the check, and the names of the rules that it breaks. */
const checkOf = (config: StrategyConfig, input: DesignInput = INPUT): { verdict: string; breaks: string[] } => {
  const checked = checkDesignConfig(SPACE, config, input);
  if (!checked.ok) throw new Error(checked.problems.join(" "));
  const breaks = [
    ...checked.value.machine.filter((f) => f.verdict === "breaks").map((f) => `${f.machine}:${f.rule}`),
    ...checked.value.site.filter((f) => f.verdict === "breaks").map((f) => `${f.id}:${f.rule}`),
  ];
  return { verdict: checked.value.verdict, breaks };
};

const STATUS: Record<string, string> = { fits: "feasible", breaks: "breaks", unread: "unread" };

describe("a sweep of the design space", () => {
  it("gives each design the verdict of the check and the rules that it breaks", () => {
    const { run } = sweepOf();
    expect(run.rows).toHaveLength(40 - run.repeats);
    expect(run.counts.feasible).toBeGreaterThan(0);
    expect(run.counts.breaks).toBeGreaterThan(0);
    for (const row of run.rows) {
      const config = run.configs[row.config];
      if (config === undefined) throw new Error(`no config ${row.config}`);
      const { verdict, breaks } = checkOf(config);
      expect(row.status).toBe(STATUS[verdict]);
      expect(row.breaks).toEqual(breaks);
      expect(row.rank === null).toBe(row.status !== "feasible");
    }
  });

  it("holds the verdict of the check over random samples", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
        const { run } = sweepOf({ enumerate: { mode: "sample", n: 6, seed } });
        for (const row of run.rows) {
          const config = run.configs[row.config];
          if (config === undefined) return false;
          if (row.status !== STATUS[checkOf(config).verdict]) return false;
        }
        return true;
      }),
      { numRuns: 8, seed: 20261115 },
    );
  });

  it("gives each objective the value of its measure of the site, and the worst room for the noise", () => {
    const { run } = sweepOf();
    expect(run.objectives).toEqual([
      { name: "runner-slots", goal: "max", unit: "count" },
      { name: "power", goal: "min", unit: "W" },
      { name: "idle-cost", goal: "min", unit: "USD" },
      { name: "noise", goal: "min", unit: "dBA" },
    ]);
    for (const row of run.rows.filter((r) => r.status === "feasible")) {
      const config = run.configs[row.config];
      if (config === undefined) throw new Error(`no config ${row.config}`);
      const checked = checkDesignConfig(SPACE, config, INPUT);
      if (!checked.ok) throw new Error(checked.problems.join(" "));
      const { site, machines } = checked.value.design;
      const measured = measureSite(site, machines, CATALOG);
      if (!measured.ok) throw new Error(measured.problems.join(" "));
      const at = (key: string, measure: string): number | undefined => measured.values.find((v) => v.id === key && v.measure === measure)?.value;
      expect(row.values["runner-slots"]).toBe(at("site", "runner-slots"));
      expect(row.values["power"]).toBe(at("site", "power"));
      expect(row.values["idle-cost"]).toBe(at("site", "idle-cost"));
      expect(row.values["noise"]).toBe(Math.max(at("room-a", "noise") ?? Number.NaN, at("room-b", "noise") ?? Number.NaN));
    }
  });

  it("puts a feasible design with the most runner slots on the front", () => {
    const { run } = sweepOf();
    const feasible = run.rows.filter((r) => r.status === "feasible");
    const most = Math.max(...feasible.map((r) => r.values["runner-slots"] ?? Number.NaN));
    expect(feasible.some((r) => r.values["runner-slots"] === most && r.front)).toBe(true);
    expect(run.counts.front).toBe(run.rows.filter((r) => r.front).length);
  });

  it("is deterministic, and another input gives another run", () => {
    const one = sweepOf();
    expect(sweepOf()).toEqual(one);
    expect(one.run.evaluator).toMatch(new RegExp(`^${DESIGN_SWEEP_EVALUATOR} input [0-9a-f]{16}$`));
    const dear = sweepOf(SAMPLE, { ...INPUT, site: { ...SAMPLE_SITE, price: quantity(0.3, "USD/kWh") } });
    expect(dear.run.run).not.toBe(one.run.run);
    expect(dear.run.rows.map((r) => r.config)).toEqual(one.run.rows.map((r) => r.config));
    const row = one.run.rows.find((r) => r.status === "feasible");
    const twice = dear.run.rows.find((r) => r.config === row?.config);
    expect(twice?.values["idle-cost"]).toBeCloseTo(2 * (row?.values["idle-cost"] ?? Number.NaN), 9);
    const jobs = sweepOf({ ...SAMPLE, job: { threads: 2, memory: 8 } });
    expect(jobs.run.run).not.toBe(one.run.run);
  });

  it("gives no value and no rank to a design with a rule without a read", () => {
    const probe: SiteRule = { id: "probe", sentence: "The probe reads a field that the site does not have.", level: "site", program: app("lte", ref("missing"), lit(1)) };
    const { run, unread } = sweepOf({ ...SAMPLE, siteRules: [...SITE_RULES, probe] });
    expect(run.counts.feasible).toBe(0);
    expect(run.counts.unread).toBeGreaterThan(0);
    for (const row of run.rows) {
      expect(unread[row.config]).toEqual(["site:probe"]);
      expect(row.rank).toBeNull();
      if (row.status === "unread") expect(row.missing).toEqual(DESIGN_OBJECTIVES.map((o) => o.name));
    }
    expect(Object.keys(unread)).toHaveLength(run.rows.length);
    expect(sweepOf().unread).toEqual({});
  });

  it("takes the objectives of the caller, and gives the best value of a measure with the goal max", () => {
    const { run } = sweepOf({ ...SAMPLE, objectives: [{ name: "quiet", goal: "max", measure: "noise" }, { name: "slots", goal: "max", measure: "runner-slots" }] });
    expect(run.objectives.map((o) => o.name)).toEqual(["quiet", "slots"]);
    for (const row of run.rows.filter((r) => r.status === "feasible")) {
      const config = run.configs[row.config];
      if (config === undefined) throw new Error(`no config ${row.config}`);
      const checked = checkDesignConfig(SPACE, config, INPUT);
      if (!checked.ok) throw new Error(checked.problems.join(" "));
      const measured = measureSite(checked.value.design.site, checked.value.design.machines, CATALOG);
      if (!measured.ok) throw new Error(measured.problems.join(" "));
      const rooms = measured.values.filter((v) => v.measure === "noise").map((v) => v.value ?? Number.NaN);
      expect(row.values["quiet"]).toBe(Math.min(...rooms));
    }
  });

  it("gives the problems of the objectives, the enumeration and the input", () => {
    expect(sweepDesigns(SPACE, INPUT, { ...SAMPLE, objectives: [] })).toEqual({ ok: false, problems: ["The list of the objectives is empty."] });
    expect(sweepDesigns(SPACE, INPUT, { ...SAMPLE, objectives: [{ name: "x", goal: "min", measure: "nope" }] })).toEqual({
      ok: false,
      problems: ["The objective x reads the measure nope, and the measures have no measure with this id."],
    });
    const twice = sweepDesigns(SPACE, INPUT, { ...SAMPLE, objectives: [DESIGN_OBJECTIVES[1], DESIGN_OBJECTIVES[1]].filter((o) => o !== undefined) });
    expect(twice).toEqual({ ok: false, problems: ["The name power is on two objectives."] });
    const grid = sweepDesigns(SPACE, INPUT, { enumerate: { mode: "grid", levels: 2, limit: 1 } });
    expect(grid.ok).toBe(false);
    const roomless = sweepDesigns(SPACE, { ...INPUT, site: { ...SAMPLE_SITE, rooms: [], places: [] } }, SAMPLE);
    expect(roomless).toEqual({ ok: false, problems: ["The site has no room for the new machines."] });
    const nan = sweepDesigns(SPACE, INPUT, { ...SAMPLE, continuousLoad: Number.NaN });
    expect(nan.ok).toBe(false);
    if (!nan.ok) expect(nan.problems[0]).toMatch(/^The input has a value that JSON cannot hold: /);
  });
});

const EVOLVE: DesignEvolveOptions = { seed: "cluster-design evolve", evaluations: 60, population: 12 };

const evolveOf = (options: DesignEvolveOptions = EVOLVE, input: DesignInput = INPUT): DesignEvolution => {
  const made = evolveDesigns(SPACE, input, options);
  if (!made.ok) throw new Error(made.problems.join(" "));
  return made.value;
};

/** This function tells if the values `a` dominate the values `b` for the objectives of a run. */
const dominates = (objectives: readonly { name: string; goal: string }[], a: Record<string, number | null>, b: Record<string, number | null>): boolean => {
  let better = false;
  for (const { name, goal } of objectives) {
    const x = (goal === "max" ? 1 : -1) * (a[name] ?? Number.NaN);
    const y = (goal === "max" ? 1 : -1) * (b[name] ?? Number.NaN);
    if (x < y) return false;
    if (x > y) better = true;
  }
  return better;
};

describe("a genetic search of the design space", () => {
  it("gives each design the verdict of the check and the rules that it breaks, in the budget", () => {
    const { run } = evolveOf();
    expect(run.method).toBe("evolve");
    expect(run.stop).toBe("budget");
    expect(run.rows).toHaveLength(60);
    expect(run.generations).toBeGreaterThan(1);
    expect(new Set(run.rows.map((r) => r.config)).size).toBe(run.rows.length);
    expect(run.counts.feasible).toBeGreaterThan(0);
    for (const row of run.rows) {
      const config = run.configs[row.config];
      if (config === undefined) throw new Error(`no config ${row.config}`);
      const { verdict, breaks } = checkOf(config);
      expect(row.status).toBe(STATUS[verdict]);
      expect(row.breaks).toEqual(breaks);
      expect(row.rank === null).toBe(row.status !== "feasible");
    }
  });

  it("gives each design the evaluation of the sweep: the same evaluator and the measures of the site", () => {
    const { run } = evolveOf();
    expect(run.evaluator).toBe(sweepOf().run.evaluator);
    expect(run.objectives).toEqual(sweepOf().run.objectives);
    for (const row of run.rows.filter((r) => r.status === "feasible")) {
      const config = run.configs[row.config];
      if (config === undefined) throw new Error(`no config ${row.config}`);
      const checked = checkDesignConfig(SPACE, config, INPUT);
      if (!checked.ok) throw new Error(checked.problems.join(" "));
      const measured = measureSite(checked.value.design.site, checked.value.design.machines, CATALOG);
      if (!measured.ok) throw new Error(measured.problems.join(" "));
      const at = (key: string, measure: string): number | undefined => measured.values.find((v) => v.id === key && v.measure === measure)?.value;
      expect(row.values["runner-slots"]).toBe(at("site", "runner-slots"));
      expect(row.values["power"]).toBe(at("site", "power"));
      expect(row.values["idle-cost"]).toBe(at("site", "idle-cost"));
      expect(row.values["noise"]).toBe(Math.max(at("room-a", "noise") ?? Number.NaN, at("room-b", "noise") ?? Number.NaN));
    }
  });

  it("puts no design on the front that another feasible design of the run dominates", () => {
    const { run } = evolveOf();
    const feasible = run.rows.filter((r) => r.status === "feasible");
    const front = feasible.filter((r) => r.rank === 1);
    expect(front.length).toBeGreaterThan(0);
    for (const row of front) expect(feasible.some((other) => dominates(run.objectives, other.values, row.values))).toBe(false);
    for (const row of feasible.filter((r) => r.rank !== 1)) expect(feasible.some((other) => dominates(run.objectives, other.values, row.values))).toBe(true);
  });

  it("gives the options of the algorithm to the run, and the defaults of evolve without them", () => {
    const { run } = evolveOf({ ...EVOLVE, population: 10, mutation: 0.5, crossover: 0.7 });
    expect([run.population, run.mutation, run.crossover]).toEqual([10, 0.5, 0.7]);
    const plain = evolveOf({ seed: 7, evaluations: 45 }).run;
    expect(plain.population).toBe(40);
    expect(plain.crossover).toBe(0.9);
    expect(plain.mutation).toBeCloseTo(1 / SPACE.space.stages.length, 12);
    expect(plain.rows).toHaveLength(45);
  });

  it("is deterministic, and another seed or another input gives another run", () => {
    const one = evolveOf();
    expect(evolveOf()).toEqual(one);
    expect(evolveOf({ ...EVOLVE, seed: "another seed" }).run.run).not.toBe(one.run.run);
    const dear = evolveOf(EVOLVE, { ...INPUT, site: { ...SAMPLE_SITE, price: quantity(0.3, "USD/kWh") } });
    expect(dear.run.run).not.toBe(one.run.run);
    expect(dear.run.evaluator).not.toBe(one.run.evaluator);
  });

  it("gives no value and no rank to a design with a rule without a read", () => {
    const probe: SiteRule = { id: "probe", sentence: "The probe reads a field that the site does not have.", level: "site", program: app("lte", ref("missing"), lit(1)) };
    const { run, unread } = evolveOf({ ...EVOLVE, siteRules: [...SITE_RULES, probe] });
    expect(run.counts.feasible).toBe(0);
    expect(run.counts.unread).toBeGreaterThan(0);
    for (const row of run.rows) {
      expect(unread[row.config]).toEqual(["site:probe"]);
      expect(row.rank).toBeNull();
    }
    expect(evolveOf().unread).toEqual({});
  });

  it("gives the problems of the objectives, the options and the input", () => {
    expect(evolveDesigns(SPACE, INPUT, { ...EVOLVE, objectives: [] })).toEqual({ ok: false, problems: ["The list of the objectives is empty."] });
    expect(evolveDesigns(SPACE, INPUT, { ...EVOLVE, objectives: [{ name: "x", goal: "min", measure: "nope" }] })).toEqual({
      ok: false,
      problems: ["The objective x reads the measure nope, and the measures have no measure with this id."],
    });
    const none = evolveDesigns(SPACE, INPUT, { ...EVOLVE, evaluations: 0 });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.problems.join(" ")).toMatch(/evaluations is 0/);
    const alone = evolveDesigns(SPACE, INPUT, { ...EVOLVE, population: 1 });
    expect(alone.ok).toBe(false);
    if (!alone.ok) expect(alone.problems.join(" ")).toMatch(/population is 1/);
    const roomless = evolveDesigns(SPACE, { ...INPUT, site: { ...SAMPLE_SITE, rooms: [], places: [] } }, EVOLVE);
    expect(roomless).toEqual({ ok: false, problems: ["The site has no room for the new machines."] });
  });
});
