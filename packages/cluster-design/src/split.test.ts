import { checkSpace, type StrategyConfig } from "@mark1russell7/strategy-space";
import { describe, expect, it } from "vitest";
import {
  checkDesignConfig,
  COPIES_STAGE,
  DESIGN_ENGINE,
  designOf,
  designSpace,
  PLACEMENT_STAGE,
  workStage,
  type DesignInput,
  type DesignSpace,
  type DesignSpaceOptions,
  type SplitRange,
} from "./design-space.ts";
import { readCatalog, type Part } from "./parts.ts";
import { SAMPLE_MACHINE, SAMPLE_PARTS, SAMPLE_SITE } from "./sample.ts";
import { measureSite } from "./site-check.ts";
import { SITE_MEASURES, siteWorkMeasures } from "./site-formulas.ts";
import { sweepDesigns, workObjectives } from "./sweep.ts";
import type { WorkClass } from "./variables.ts";

const read = readCatalog(SAMPLE_PARTS);
if (!read.ok) throw new Error(read.problems.join(" "));
const CATALOG: ReadonlyMap<string, Part> = read.value;

// The sample machine has 16 threads and 64 GiB. The default reserve is 2 GiB, and the default job is 4 threads and 16 GiB.
const SESSION: WorkClass = { id: "session", threads: 1, memory: 4 };
const SERVICE: WorkClass = { id: "service", threads: 2, memory: 8 };
const CLASSES: readonly WorkClass[] = [SESSION, SERVICE];
const SPLIT: readonly SplitRange[] = [
  { class: "session", min: 0, max: 8 },
  { class: "service", min: 0, max: 2 },
];

/** The site of the sample, with its two fixed machines. The fixed machines have no work lines. */
const INPUT: DesignInput = { catalog: CATALOG, site: SAMPLE_SITE, fixed: [SAMPLE_MACHINE, { ...SAMPLE_MACHINE, id: "node-2" }] };

const spaceOf = (options: DesignSpaceOptions): DesignSpace => {
  const made = designSpace(CATALOG, options);
  if (!made.ok) throw new Error(made.problems.join(" "));
  return made.value;
};

const SPACE = spaceOf({ site: INPUT, work: CLASSES, split: SPLIT });

/** This function gives the config of one copy of the sample machine, with the units of each work class by its id. */
const configOf = (work: Readonly<Record<string, number>>): StrategyConfig => ({
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
    ...Object.fromEntries(Object.entries(work).map(([id, count]) => [workStage(id), { option: id, params: { count } }])),
    [COPIES_STAGE]: { option: COPIES_STAGE, params: { count: 1 } },
    [PLACEMENT_STAGE]: { option: "fill" },
  },
});

/** This function gives the values of the site measures of a config, by the id of the measure. */
const siteValues = (config: StrategyConfig): Record<string, number | undefined> => {
  const made = designOf(SPACE, config, INPUT);
  if (!made.ok) throw new Error(made.problems.join(" "));
  const measured = measureSite(made.value.site, made.value.machines, CATALOG, { work: CLASSES, measures: [...SITE_MEASURES, ...siteWorkMeasures(CLASSES)] });
  if (!measured.ok) throw new Error(measured.problems.join(" "));
  return Object.fromEntries(measured.values.filter((value) => value.level === "site").map((value) => [value.measure, value.value]));
};

describe("the split of the design space", () => {
  it("has one stage for each range of the split, after the slots and before the copies", () => {
    const names = SPACE.space.stages.map((stage) => stage.name);
    expect(names.slice(-4)).toEqual(["work-session", "work-service", COPIES_STAGE, PLACEMENT_STAGE]);
    expect(SPACE.space.stages.find((stage) => stage.name === "work-session")?.options).toEqual([
      { id: "session", params: [{ name: "count", kind: "int", min: 0, max: 8, default: 0 }] },
    ]);
    expect(SPACE.split).toEqual(SPLIT.map((range) => ({ ...range, stage: workStage(range.class) })));
    expect(SPACE.work).toEqual(CLASSES);
    expect(checkSpace(SPACE.space)).toEqual([]);
  });

  it("has no stage of work without a split", () => {
    const plain = spaceOf({ site: INPUT });
    expect(plain.space.stages.some((stage) => stage.name.startsWith("work-"))).toBe(false);
    expect(plain.split).toEqual([]);
    expect(plain.work).toEqual([]);
    expect(spaceOf({ site: INPUT, work: CLASSES }).space).toEqual(plain.space);
  });

  it("refuses a range of a class that the options do not have, a class with two ranges, and a bad range", () => {
    const made = designSpace(CATALOG, {
      work: CLASSES,
      split: [
        { class: "lab", min: 0, max: 1 },
        { class: "session", min: 0, max: 2 },
        { class: "session", min: -1, max: 2 },
        { class: "service", min: 3, max: 2 },
      ],
    });
    expect(made).toEqual({
      ok: false,
      problems: [
        "The split names the work class lab, but the options do not have it.",
        "The split has two ranges of the work class session.",
        "The range of the work class session is not whole numbers from 0 or more, with a max of the min or more.",
        "The range of the work class service is not whole numbers from 0 or more, with a max of the min or more.",
      ],
    });
    expect(designSpace(CATALOG, { work: [{ id: " ", threads: 1, memory: 1 }] })).toEqual({ ok: false, problems: ["A work class has an empty id."] });
  });
});

describe("the design of a split", () => {
  it("gives each new machine the work lines of the config, with no line for a count of 0", () => {
    const made = designOf(SPACE, configOf({ session: 4, service: 1 }), INPUT);
    if (!made.ok) throw new Error(made.problems.join(" "));
    expect(made.value.added.map((machine) => machine.work)).toEqual([
      [
        { class: "session", count: 4 },
        { class: "service", count: 1 },
      ],
    ]);
    const some = designOf(SPACE, configOf({ session: 3, service: 0 }), INPUT);
    expect(some.ok && some.value.added[0]?.work).toEqual([{ class: "session", count: 3 }]);
    const none = designOf(SPACE, configOf({ session: 0, service: 0 }), INPUT);
    expect(none.ok && none.value.added[0]).toEqual({ id: "new-1", lines: SAMPLE_MACHINE.lines });
  });

  it("gives the CI jobs the share that the work lines leave", () => {
    // Each fixed machine runs 3 jobs. The new machine runs 3 jobs with no work, and 2 jobs with 4 sessions and 1 service.
    expect(siteValues(configOf({ session: 0, service: 0 }))).toMatchObject({ "runner-slots": 9, "work-session": 0, "work-service": 0 });
    expect(siteValues(configOf({ session: 4, service: 1 }))).toMatchObject({ "runner-slots": 8, "work-session": 4, "work-service": 1 });
    // 8 sessions and 2 services leave 4 threads and 14 GiB: no job of 16 GiB fits.
    expect(siteValues(configOf({ session: 8, service: 2 }))).toMatchObject({ "runner-slots": 6, "work-session": 8, "work-service": 2, "free-memory": 62 * 2 + 14 });
  });

  it("checks the work lines with the classes of the space", () => {
    const fits = checkDesignConfig(SPACE, configOf({ session: 8, service: 2 }), INPUT);
    expect(fits.ok && fits.value.verdict).toBe("fits");
    const wide = spaceOf({ site: INPUT, work: CLASSES, split: [{ class: "session", min: 0, max: 16 }] });
    const full = checkDesignConfig(wide, configOf({ session: 16 }), INPUT);
    if (!full.ok) throw new Error(full.problems.join(" "));
    // 16 sessions take 64 GiB, more than the 62 GiB that the reserve leaves.
    expect(full.value.verdict).toBe("breaks");
    expect(full.value.machine.filter((finding) => finding.verdict === "breaks").map((finding) => finding.rule)).toEqual(["work-memory"]);
  });
});

describe("a search of the split", () => {
  it("gives the units of each class and the CI jobs as objectives, from the measures of the work classes", () => {
    const swept = sweepDesigns(SPACE, INPUT, {
      enumerate: { mode: "sample", n: 40, seed: "cluster-design split" },
      objectives: [{ name: "runner-slots", goal: "max", measure: "runner-slots" }, ...workObjectives(CLASSES)],
    });
    if (!swept.ok) throw new Error(swept.problems.join(" "));
    const { run } = swept.value;
    expect(run.counts.feasible).toBeGreaterThan(0);
    for (const row of run.rows.filter((r) => r.status === "feasible")) {
      const config = run.configs[row.config];
      if (config === undefined) throw new Error(`no config ${row.config}`);
      const made = designOf(SPACE, config, INPUT);
      if (!made.ok) throw new Error(made.problems.join(" "));
      // The fixed machines have no work lines, so the units of a class are the copies times the units of one copy.
      for (const work of CLASSES) {
        const each = made.value.added[0]?.work?.find((line) => line.class === work.id)?.count ?? 0;
        expect(row.values[`work-${work.id}`]).toBe(made.value.added.length * each);
      }
    }
  });

  it("gives one objective for each work class", () => {
    expect(workObjectives(CLASSES)).toEqual([
      { name: "work-session", goal: "max", measure: "work-session" },
      { name: "work-service", goal: "max", measure: "work-service" },
    ]);
  });
});
