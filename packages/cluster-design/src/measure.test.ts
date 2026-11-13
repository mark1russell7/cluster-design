import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkDesign } from "./check.ts";
import { evaluateDesign } from "./evaluate.ts";
import type { Machine } from "./machine.ts";
import { amountOf, MACHINE_MEASURES, measureDesign, type MeasureValue } from "./measure.ts";
import { readCatalog, type Part } from "./parts.ts";
import { SAMPLE_MACHINE, SAMPLE_PARTS } from "./sample.ts";

const read = readCatalog(SAMPLE_PARTS);
if (!read.ok) throw new Error(read.problems.join(" "));
const CATALOG: ReadonlyMap<string, Part> = read.value;

const valuesOf = (machines: readonly Machine[], psuLoad?: number): readonly MeasureValue[] => {
  const result = measureDesign(machines, CATALOG, psuLoad === undefined ? {} : { psuLoad });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.values;
};

const byMeasure = (values: readonly MeasureValue[]): Record<string, number | string | undefined> =>
  Object.fromEntries(values.map((value) => [value.measure, value.value ?? value.detail]));

describe("the measures of a machine", () => {
  it("give the power of the sample machine and the limit of its power supply", () => {
    // 88 + 30 + 2 x 6 + 8 + 2 x 9 + 3 = 159 W, and 550 W x 0.8 = 440 W.
    expect(byMeasure(valuesOf([SAMPLE_MACHINE]))).toEqual({ power: 159, "power-limit": 440, "power-output": 550 });
    expect(byMeasure(valuesOf([SAMPLE_MACHINE], 0.5))).toEqual({ power: 159, "power-limit": 275, "power-output": 550 });
  });

  it("give each value with the unit of its measure", () => {
    for (const value of valuesOf([SAMPLE_MACHINE])) expect(value.unit).toBe("W");
  });

  it("give no limit, with its reason, for a machine with no power supply", () => {
    const machine: Machine = { id: "no-psu", lines: SAMPLE_MACHINE.lines.filter((line) => line.part !== "psu-550") };
    const [power, limit, output] = valuesOf([machine]);
    expect(power?.value).toBe(159);
    expect(limit?.value).toBeUndefined();
    expect(limit?.detail).toMatch(/^#N\/A/);
    expect(output?.detail).toMatch(/^#N\/A/);
  });

  it("give the power 0 for a machine with no parts", () => {
    expect(valuesOf([{ id: "empty", lines: [] }])[0]?.value).toBe(0);
  });

  it("give the problems of the input", () => {
    expect(measureDesign([SAMPLE_MACHINE], CATALOG, { psuLoad: 0 })).toEqual({
      ok: false,
      problems: ["The load limit 0 is not more than 0 and not more than 1."],
    });
    expect(measureDesign([{ id: "x", lines: [{ part: "nothing", count: 1 }] }], CATALOG).ok).toBe(false);
  });

  it("give a reason for a result that is not a number", () => {
    expect(amountOf({ ok: true, value: "ten" })).toEqual({ detail: 'The program gave "ten", not a number.' });
    expect(amountOf({ ok: true, value: Number.POSITIVE_INFINITY })).toEqual({ detail: "The program gave null, not a number." });
    expect(amountOf({ ok: true, value: 12 })).toEqual({ value: 12 });
  });

  it("evaluate the items in the order of the machines, then the items", () => {
    const two: Machine[] = [SAMPLE_MACHINE, { id: "node-2", lines: [] }];
    const result = evaluateDesign(two, CATALOG, MACHINE_MEASURES);
    if (!result.ok) throw new Error(result.problems.join(" "));
    expect(result.evaluations.map((e) => `${e.machine}/${e.item.id}`)).toEqual([
      "node-1/power",
      "node-1/power-limit",
      "node-1/power-output",
      "node-2/power",
      "node-2/power-limit",
      "node-2/power-output",
    ]);
  });

  const machines = fc.uniqueArray(
    fc.record({
      id: fc.uuid(),
      lines: fc.array(fc.record({ part: fc.constantFrom(...SAMPLE_PARTS.map((part) => part.id)), count: fc.integer({ min: 1, max: 4 }) }), { maxLength: 12 }),
    }),
    { minLength: 1, maxLength: 3, selector: (machine: Machine) => machine.id },
  );

  it("agree with the rule psu-load at each machine and each load limit", () => {
    fc.assert(
      fc.property(machines, fc.double({ min: 0.05, max: 1, noNaN: true }), (design, psuLoad) => {
        const values = valuesOf(design, psuLoad);
        const checked = checkDesign(design, CATALOG, { psuLoad });
        if (!checked.ok) throw new Error(checked.problems.join(" "));
        for (const machine of design) {
          const value = (id: string) => values.find((v) => v.machine === machine.id && v.measure === id)?.value;
          const verdict = checked.findings.find((f) => f.machine === machine.id && f.rule === "psu-load")?.verdict;
          const power = value("power");
          const limit = value("power-limit");
          if (power === undefined || limit === undefined) expect(verdict).toBe("unread");
          else expect(verdict).toBe(power <= limit ? "fits" : "breaks");
        }
      }),
      { numRuns: 60 },
    );
  });
});
