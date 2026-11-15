import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkDesign } from "./check.ts";
import { MACHINE_COST_MEASURES } from "./cost.ts";
import { machineSchema, type Machine, type WorkLine } from "./machine.ts";
import { MACHINE_MEASURES, measureDesign, workMeasures, type MeasureOptions } from "./measure.ts";
import { readCatalog, type Part } from "./parts.ts";
import { SAMPLE_MACHINE, SAMPLE_PARTS, SAMPLE_PRICES, SAMPLE_SITE } from "./sample.ts";
import { checkSite, measureSite } from "./site-check.ts";
import { SITE_MEASURES, siteWorkMeasures } from "./site-formulas.ts";
import type { WorkClass } from "./variables.ts";

const read = readCatalog(SAMPLE_PARTS);
if (!read.ok) throw new Error(read.problems.join(" "));
const CATALOG: ReadonlyMap<string, Part> = read.value;

// The sample machine has 16 threads and 64 GiB. The default reserve is 2 GiB, and the default job is 4 threads and 16 GiB.
const SESSION: WorkClass = { id: "session", threads: 1, memory: 4 };
const SERVICE: WorkClass = { id: "service", threads: 2, memory: 8 };
const CLASSES: readonly WorkClass[] = [SESSION, SERVICE];

const withWork = (work: readonly WorkLine[], id = SAMPLE_MACHINE.id): Machine => ({ ...SAMPLE_MACHINE, id, work });

/** This function gives the value of each measure at one machine, by the id of the measure. */
const measuresOf = (machine: Machine, options: MeasureOptions = {}): Record<string, number | undefined> => {
  const result = measureDesign([machine], CATALOG, { work: CLASSES, measures: [...MACHINE_MEASURES, ...workMeasures(CLASSES)], ...options });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return Object.fromEntries(result.values.map((value) => [value.measure, value.value]));
};

/** This function gives the verdict of each fit rule at one machine, by the id of the rule. */
const verdictsOf = (machine: Machine): Record<string, string> => {
  const result = checkDesign([machine], CATALOG, { work: CLASSES });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return Object.fromEntries(result.findings.map((finding) => [finding.rule, finding.verdict]));
};

describe("a machine with no work lines", () => {
  it("keeps its runner slots, and its free share is the share less the reserve", () => {
    const values = measuresOf(SAMPLE_MACHINE);
    expect(values).toMatchObject({ "runner-slots": 3, "work-threads": 0, "work-memory": 0, "free-threads": 16, "free-memory": 62 });
    // The capacity of sessions: min(16 / 1, 62 / 4) = 15.5 units, rounded down.
    expect(values).toMatchObject({ "work-session": 0, "capacity-session": 15, "work-service": 0, "capacity-service": 7 });
  });

  it("fits the two rules of the work lines, also with a reserve that is more than the machine", () => {
    expect(verdictsOf(SAMPLE_MACHINE)).toMatchObject({ "work-threads": "fits", "work-memory": "fits" });
    const result = checkDesign([SAMPLE_MACHINE], CATALOG, { reserve: { threads: 32, memory: 128 } });
    if (!result.ok) throw new Error(result.problems.join(" "));
    expect(result.findings.filter((finding) => finding.rule.startsWith("work-")).map((finding) => finding.verdict)).toEqual(["fits", "fits"]);
  });
});

describe("a machine with work lines", () => {
  const machine = withWork([
    { class: "session", count: 4 },
    { class: "service", count: 1 },
  ]);

  it("gives the share of its work lines and the free share", () => {
    // The work lines take 4 x 1 + 2 = 6 threads and 4 x 4 + 8 = 24 GiB.
    expect(measuresOf(machine)).toMatchObject({ "work-threads": 6, "work-memory": 24, "free-threads": 10, "free-memory": 38 });
  });

  it("gives the runner slots in the free share", () => {
    // The free share gives min(10 / 4, 38 / 16) = 2.375 jobs.
    expect(measuresOf(machine)["runner-slots"]).toBe(2);
  });

  it("gives the units and the capacity of each class", () => {
    // Sessions: 4 units, and min(10 / 1, 38 / 4) = 9.5 more. Services: 1 unit, and min(10 / 2, 38 / 8) = 4.75 more.
    expect(measuresOf(machine)).toMatchObject({ "work-session": 4, "capacity-session": 13, "work-service": 1, "capacity-service": 5 });
  });

  it("adds the units of two lines of one class", () => {
    expect(measuresOf(withWork([{ class: "session", count: 2 }, { class: "session", count: 3 }]))).toMatchObject({ "work-session": 5, "work-memory": 20 });
  });

  it("breaks a rule when the work lines take more than the machine less the reserve", () => {
    expect(verdictsOf(machine)).toMatchObject({ "work-threads": "fits", "work-memory": "fits" });
    // 16 sessions take 16 threads and 64 GiB: the threads fit, and the memory less the reserve (62 GiB) does not.
    const full = withWork([{ class: "session", count: 16 }]);
    expect(verdictsOf(full)).toMatchObject({ "work-threads": "fits", "work-memory": "breaks" });
    expect(measuresOf(full)).toMatchObject({ "free-threads": 0, "free-memory": -2, "runner-slots": 0, "capacity-session": 16 });
    expect(verdictsOf(withWork([{ class: "service", count: 9 }]))).toMatchObject({ "work-threads": "breaks", "work-memory": "breaks" });
  });

  it("keeps the price of the parts and the other measures of the parts", () => {
    const options = { cost: { prices: SAMPLE_PRICES } };
    const costs = (m: Machine): Record<string, number | undefined> => measuresOf(m, { ...options, measures: MACHINE_COST_MEASURES });
    expect(costs(machine)).toEqual(costs(SAMPLE_MACHINE));
    const parts = ["power", "idle-power", "wall-power", "noise", "cores", "threads", "memory", "storage"];
    const pick = (values: Record<string, number | undefined>): unknown[] => parts.map((id) => values[id]);
    expect(pick(measuresOf(machine))).toEqual(pick(measuresOf(SAMPLE_MACHINE)));
  });
});

describe("the input of the work mix", () => {
  it("refuses a work line with a class that the options do not have", () => {
    const result = measureDesign([withWork([{ class: "lab", count: 1 }])], CATALOG, { work: CLASSES });
    expect(result).toEqual({ ok: false, problems: ["The machine node-1 names the work class lab, but the options do not have it."] });
  });

  it("refuses a class with an empty id, an id on two classes, or a share that is not more than 0", () => {
    const result = measureDesign([SAMPLE_MACHINE], CATALOG, {
      work: [SESSION, { ...SESSION }, { id: " ", threads: 1, memory: 1 }, { id: "idle", threads: 0, memory: 1 }],
    });
    expect(result).toEqual({
      ok: false,
      problems: [
        "The id session is on two work classes.",
        "A work class has an empty id.",
        "The threads and the memory of the work class idle are not more than 0.",
      ],
    });
  });

  it("accepts a machine with work lines, and refuses a count that is not a whole number of 1 or more", () => {
    expect(machineSchema.safeParse(withWork([{ class: "session", count: 2 }])).success).toBe(true);
    expect(machineSchema.safeParse(SAMPLE_MACHINE).success).toBe(true);
    expect(machineSchema.safeParse(withWork([{ class: "session", count: 0 }])).success).toBe(false);
    expect(machineSchema.safeParse(withWork([{ class: "session", count: 1.5 }])).success).toBe(false);
  });
});

describe("the work mix of a site", () => {
  const machines: readonly Machine[] = [withWork([{ class: "session", count: 4 }], "node-1"), withWork([{ class: "service", count: 2 }], "node-2")];

  it("gives the sums of the machines", () => {
    const result = measureSite(SAMPLE_SITE, machines, CATALOG, { work: CLASSES, measures: [...SITE_MEASURES, ...siteWorkMeasures(CLASSES)] });
    if (!result.ok) throw new Error(result.problems.join(" "));
    const values = Object.fromEntries(result.values.filter((value) => value.level === "site").map((value) => [value.measure, value.value]));
    // node-1: free 12 threads and 46 GiB, so 2 jobs. node-2: free 12 threads and 46 GiB, so 2 jobs.
    expect(values).toMatchObject({ "runner-slots": 4, "work-threads": 8, "work-memory": 32, "free-threads": 24, "free-memory": 92 });
    // Sessions: 4 + 11 on node-1, and 0 + 11 on node-2. Services: 0 + 5 on node-1, and 2 + 5 on node-2.
    expect(values).toMatchObject({ "work-session": 4, "capacity-session": 26, "work-service": 2, "capacity-service": 12 });
  });

  it("refuses a work line with a class that the options do not have", () => {
    expect(checkSite(SAMPLE_SITE, machines, CATALOG)).toEqual({
      ok: false,
      problems: [
        "The machine node-1 names the work class session, but the options do not have it.",
        "The machine node-2 names the work class service, but the options do not have it.",
      ],
    });
  });
});

describe("the capacity of a class", () => {
  const counts = fc.record({ session: fc.integer({ min: 0, max: 20 }), service: fc.integer({ min: 0, max: 10 }) });

  it("is the units of the class, and the most more units that fit in the free share", () => {
    fc.assert(
      fc.property(counts, ({ session, service }) => {
        const work: WorkLine[] = [];
        if (session > 0) work.push({ class: "session", count: session });
        if (service > 0) work.push({ class: "service", count: service });
        const values = measuresOf(withWork(work));
        const free = { threads: values["free-threads"] ?? Number.NaN, memory: values["free-memory"] ?? Number.NaN };
        expect(free).toEqual({ threads: 16 - session - 2 * service, memory: 62 - 4 * session - 8 * service });
        for (const cls of CLASSES) {
          const more = (values[`capacity-${cls.id}`] ?? Number.NaN) - (values[`work-${cls.id}`] ?? Number.NaN);
          expect(more).toBeGreaterThanOrEqual(0);
          if (more > 0) {
            expect(more * cls.threads).toBeLessThanOrEqual(free.threads);
            expect(more * cls.memory).toBeLessThanOrEqual(free.memory);
          }
          const next = more + 1;
          expect(next * cls.threads > free.threads || next * cls.memory > free.memory).toBe(true);
        }
        const slots = values["runner-slots"] ?? Number.NaN;
        expect(slots).toBe(Math.max(0, Math.floor(Math.min(free.threads / 4, free.memory / 16))));
      }),
    );
  });
});
