import { quantity } from "@mark1russell7/quantity";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkDesign } from "./check.ts";
import type { Share } from "./evaluate.ts";
import { NOISY_CLASSES, POWERED_CLASSES } from "./formulas.ts";
import type { Machine } from "./machine.ts";
import { MACHINE_MEASURES, measureDesign, type MeasureOptions } from "./measure.ts";
import { PART_CLASSES, readCatalog, type Part } from "./parts.ts";
import { SAMPLE_MACHINE, SAMPLE_PARTS } from "./sample.ts";

const catalogOf = (parts: readonly Part[]): ReadonlyMap<string, Part> => {
  const read = readCatalog(parts);
  if (!read.ok) throw new Error(read.problems.join(" "));
  return read.value;
};

const CATALOG = catalogOf(SAMPLE_PARTS);

/** This function gives the value of each measure at one machine, by the id of the measure. */
const measuresOf = (machine: Machine, options: MeasureOptions = {}, catalog = CATALOG): Record<string, number | undefined> => {
  const result = measureDesign([machine], catalog, options);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return Object.fromEntries(result.values.map((value) => [value.measure, value.value]));
};

const fan = (noise: number, id = `test-fan-${String(noise)}`): Part => ({
  id,
  class: "fan",
  name: `Fan, ${String(noise)} dBA`,
  power: quantity(2, "W"),
  idlePower: quantity(1, "W"),
  noise: quantity(noise, "dBA"),
});

describe("the formulas of the sample machine", () => {
  it("give its power, its heat, its noise and its capacity", () => {
    const values = measuresOf(SAMPLE_MACHINE);
    // At idle: 10 + 15 + 2 x 2 + 1 + 2 x 5 + 1 + 2 x 1 = 43 W.
    expect(values["idle-power"]).toBe(43);
    // From the wall: 163 W / 0.9, and 43 W / 0.8 at idle.
    expect(values["wall-power"]).toBeCloseTo(163 / 0.9, 9);
    expect(values["wall-idle-power"]).toBeCloseTo(53.75, 9);
    // The sound energy: 10^0 + 2 x 10^2.8 + 10^2 + 10^3 + 2 x 10^2.5, and 10 log10 of it.
    const energy = 1 + 2 * 10 ** 2.8 + 10 ** 2 + 10 ** 3 + 2 * 10 ** 2.5;
    expect(values["noise"]).toBeCloseTo(10 * Math.log10(energy), 9);
    expect(values).toMatchObject({ cores: 8, threads: 16, memory: 64, storage: 9000 });
    // The threads give 16 / 4 = 4 jobs, and the memory gives (64 - 2) / 16 = 3.875 jobs.
    expect(values["runner-slots"]).toBe(3);
  });

  it("give the runner slots for each job size and reserve", () => {
    expect(measuresOf(SAMPLE_MACHINE, { job: { threads: 2, memory: 7 } })["runner-slots"]).toBe(8);
    expect(measuresOf(SAMPLE_MACHINE, { job: { threads: 8, memory: 8 }, reserve: { threads: 2, memory: 2 } })["runner-slots"]).toBe(1);
    expect(measuresOf(SAMPLE_MACHINE, { job: { threads: 4, memory: 64 } })["runner-slots"]).toBe(0);
  });

  it("give a unit of quantity to each measure", () => {
    for (const measure of MACHINE_MEASURES) expect(() => quantity(1, measure.unit)).not.toThrow();
  });

  it("refuse a job with no threads and a reserve less than 0", () => {
    expect(measureDesign([SAMPLE_MACHINE], CATALOG, { job: { threads: 0, memory: 16 } })).toEqual({
      ok: false,
      problems: ["The threads and the memory of a job are not more than 0."],
    });
    expect(measureDesign([SAMPLE_MACHINE], CATALOG, { reserve: { threads: 0, memory: -1 } })).toEqual({
      ok: false,
      problems: ["The threads and the memory of the reserve are less than 0."],
    });
  });

  it("name each class with a power or a noise", () => {
    expect(POWERED_CLASSES.every((name) => "idlePower" in PART_CLASSES[name])).toBe(true);
    expect(NOISY_CLASSES).toEqual(["storage", "psu", "cooler", "fan", "gpu"]);
  });
});

describe("the properties of the formulas", () => {
  const BASE: Machine = { id: "node", lines: SAMPLE_MACHINE.lines.filter((line) => line.part !== "fan-120") };
  const LEVELS = fc.integer({ min: 0, max: 60 });

  it("add 10 log10 of n to the level of n equal sources", () => {
    fc.assert(
      fc.property(LEVELS, fc.integer({ min: 1, max: 12 }), (level, n) => {
        const part = fan(level);
        const catalog = catalogOf([part]);
        const one = measuresOf({ id: "node", lines: [{ part: part.id, count: 1 }] }, {}, catalog)["noise"];
        const many = measuresOf({ id: "node", lines: [{ part: part.id, count: n }] }, {}, catalog)["noise"];
        expect(one).toBeCloseTo(level, 9);
        expect(many).toBeCloseTo(level + 10 * Math.log10(n), 9);
      }),
      { numRuns: 50 },
    );
  });

  it("do not lower the noise when a part is added, and are not less than the loudest part", () => {
    fc.assert(
      fc.property(fc.uniqueArray(LEVELS, { minLength: 1, maxLength: 6 }), LEVELS, (levels, extra) => {
        const parts = [...levels.map((level) => fan(level)), fan(extra, "test-fan-extra")];
        const catalog = catalogOf([...SAMPLE_PARTS, ...parts]);
        const lines = levels.map((level) => ({ part: `test-fan-${String(level)}`, count: 1 }));
        const before = measuresOf({ id: "node", lines: [...BASE.lines, ...lines] }, {}, catalog)["noise"] ?? Number.NaN;
        const after = measuresOf({ id: "node", lines: [...BASE.lines, ...lines, { part: "test-fan-extra", count: 1 }] }, {}, catalog)["noise"];
        expect(after).toBeGreaterThan(before);
        expect(before).toBeGreaterThanOrEqual(Math.max(...levels));
      }),
      { numRuns: 50 },
    );
  });

  const machines = fc.record({
    id: fc.constant("node"),
    lines: fc.array(fc.record({ part: fc.constantFrom(...SAMPLE_PARTS.map((part) => part.id)), count: fc.integer({ min: 1, max: 4 }) }), { maxLength: 12 }),
  });

  it("take more power from the wall than the parts take, when the efficiency rule fits", () => {
    fc.assert(
      fc.property(machines, (machine) => {
        const values = measuresOf(machine);
        const checked = checkDesign([machine], CATALOG);
        if (!checked.ok) throw new Error(checked.problems.join(" "));
        const efficiency = checked.findings.find((finding) => finding.rule === "psu-efficiency")?.verdict;
        const [power, wall, idle, wallIdle] = [values["power"], values["wall-power"], values["idle-power"], values["wall-idle-power"]];
        if (efficiency !== "fits" || wall === undefined || wallIdle === undefined) return;
        expect(wall).toBeGreaterThanOrEqual(power ?? Number.NaN);
        expect(wallIdle).toBeGreaterThanOrEqual(idle ?? Number.NaN);
      }),
      { numRuns: 60 },
    );
  });

  const shares = (least: number): fc.Arbitrary<Share> =>
    fc.record({ threads: fc.integer({ min: least, max: 16 }), memory: fc.integer({ min: least, max: 64 }) });

  it("give the most jobs that fit in the threads and the memory less the reserve", () => {
    fc.assert(
      fc.property(machines, shares(1), shares(0), (machine, job, reserve) => {
        const values = measuresOf(machine, { job, reserve });
        const [slots, threads, memory] = [values["runner-slots"], values["threads"], values["memory"]];
        if (slots === undefined || threads === undefined || memory === undefined) return;
        expect(Number.isInteger(slots) && slots >= 0).toBe(true);
        if (slots > 0) {
          expect(slots * job.threads).toBeLessThanOrEqual(threads - reserve.threads);
          expect(slots * job.memory).toBeLessThanOrEqual(memory - reserve.memory);
        }
        const next = slots + 1;
        expect(next * job.threads > threads - reserve.threads || next * job.memory > memory - reserve.memory).toBe(true);
      }),
      { numRuns: 80 },
    );
  });

  it("do not give more jobs for a bigger job", () => {
    fc.assert(
      fc.property(machines, shares(1), shares(0), (machine, job, more) => {
        const small = measuresOf(machine, { job })["runner-slots"];
        const big = measuresOf(machine, { job: { threads: job.threads + more.threads, memory: job.memory + more.memory } })["runner-slots"];
        if (small === undefined || big === undefined) return;
        expect(big).toBeLessThanOrEqual(small);
      }),
      { numRuns: 60 },
    );
  });
});
