import { quantity, type Quantity } from "@mark1russell7/quantity";
import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import { MACHINE_COST_MEASURES, PRICES_FORMAT, readPrices, SITE_COST_MEASURES, type CostOptions, type PriceList } from "./cost.ts";
import { designSpace, designOf, type DesignInput } from "./design-space.ts";
import type { Machine, PartLine } from "./machine.ts";
import { measureDesign } from "./measure.ts";
import { readCatalog, type Part } from "./parts.ts";
import { SAMPLE_MACHINE, SAMPLE_PARTS, SAMPLE_PRICES, SAMPLE_SITE } from "./sample.ts";
import { measureSite, type SiteOptions } from "./site-check.ts";
import { SITE_MEASURES } from "./site-formulas.ts";
import type { Site } from "./site.ts";
import { DESIGN_OBJECTIVES, sweepDesigns, type DesignObjective } from "./sweep.ts";

const read = readCatalog(SAMPLE_PARTS);
if (!read.ok) throw new Error(read.problems.join(" "));
const CATALOG: ReadonlyMap<string, Part> = read.value;

/** The price of each sample part in USD. */
const PRICE = new Map(SAMPLE_PRICES.prices.map((line) => [line.part, line.price.value]));

const MACHINES: readonly Machine[] = [
  { ...SAMPLE_MACHINE, id: "node-1" },
  { ...SAMPLE_MACHINE, id: "node-2" },
];

const MEASURES = [...SITE_MEASURES, ...SITE_COST_MEASURES];

/** This function gives the values of the site and cost measures by `<key>:<measure>`, or the detail of a measure without a value. */
const valuesOf = (cost: CostOptions | undefined, machines: readonly Machine[] = MACHINES, site: Site = SAMPLE_SITE, options: SiteOptions = {}): Record<string, number | string | undefined> => {
  const result = measureSite(site, machines, CATALOG, { ...options, ...(cost === undefined ? {} : { cost }), measures: MEASURES });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return Object.fromEntries(result.values.map((value) => [`${value.id}:${value.measure}`, value.value ?? value.detail]));
};

const numberOf = (values: Record<string, number | string | undefined>, key: string): number => {
  const value = values[key];
  if (typeof value !== "number") throw new Error(`no value of ${key}: ${String(value)}`);
  return value;
};

const problemsOf = (cost: CostOptions): readonly string[] => {
  const result = measureSite(SAMPLE_SITE, MACHINES, CATALOG, { cost, measures: SITE_COST_MEASURES });
  return result.ok ? [] : result.problems;
};

const pricesOf = (prices: Readonly<Record<string, number>>): PriceList => ({
  format: PRICES_FORMAT,
  prices: Object.entries(prices).map(([part, value]) => ({ part, price: quantity(value, "USD") })),
});

/** This function gives the sample price list without the price of one part. */
const withoutPrice = (part: string): PriceList => ({ format: PRICES_FORMAT, prices: SAMPLE_PRICES.prices.filter((line) => line.part !== part) });

describe("a price list", () => {
  it("reads the sample price list", () => {
    expect(readPrices(SAMPLE_PRICES)).toEqual({ ok: true, value: SAMPLE_PRICES });
  });

  it("refuses another format, a price that is not money, a price below 0 and a field that a line does not have", () => {
    const line = { part: "cpu-a", price: quantity(1, "USD") };
    const cases: unknown[] = [
      { format: "prices/2", prices: [line] },
      { format: PRICES_FORMAT, prices: [{ ...line, price: quantity(1, "W") }] },
      { format: PRICES_FORMAT, prices: [{ ...line, price: quantity(-1, "USD") }] },
      { format: PRICES_FORMAT, prices: [{ ...line, seller: "x" }] },
      { format: PRICES_FORMAT, prices: [{ ...line, part: " " }] },
    ];
    for (const value of cases) {
      const result = readPrices(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problems[0]).toMatch(/^The price list is not valid/);
    }
  });

  it("keeps the source of a price", () => {
    const list = { format: PRICES_FORMAT, prices: [{ part: "cpu-a", price: quantity(1, "USD"), source: "seller:offer-1" }] };
    expect(readPrices(list)).toEqual({ ok: true, value: list });
  });
});

describe("the problems of the cost options", () => {
  it("gives one problem for each fault of the input", () => {
    expect(problemsOf({ prices: pricesOf({ "cpu-x": 1 }) })).toEqual(["The price list names the part cpu-x, but the catalog does not have it."]);
    expect(problemsOf({ prices: { format: PRICES_FORMAT, prices: [...SAMPLE_PRICES.prices, { part: "cpu-a", price: quantity(1, "USD") }] } })).toEqual([
      "The part cpu-a has two prices.",
    ]);
    expect(problemsOf({ stock: [{ part: "cpu-x", count: 1 }] })).toEqual(["The stock names the part cpu-x, but the catalog does not have it."]);
    expect(problemsOf({ stock: [{ part: "cpu-a", count: 0 }] })[0]).toMatch(/^The stock is not valid at 0\.count/);
    expect(problemsOf({ owned: ["node-9"] })).toEqual(["The owned machine node-9 is not a machine of the design."]);
    expect(problemsOf({ busy: 1.5 })).toEqual(["The busy share 1.5 is not from 0 to 1."]);
    expect(problemsOf({ busy: Number.NaN })).toEqual(["The busy share NaN is not from 0 to 1."]);
    expect(problemsOf({ horizon: quantity(5, "W") })[0]).toMatch(/^The horizon is not valid/);
    expect(problemsOf({ horizon: quantity(-1, "mo") })[0]).toMatch(/^The horizon is not valid/);
  });

  it("refuses the faults in the evaluation of a machine too", () => {
    const result = measureDesign([SAMPLE_MACHINE], CATALOG, { cost: { owned: ["node-9"] }, measures: MACHINE_COST_MEASURES });
    expect(result).toEqual({ ok: false, problems: ["The owned machine node-9 is not a machine of the design."] });
  });
});

describe("the price of a machine", () => {
  const priceOf = (machine: Machine, prices: PriceList = SAMPLE_PRICES): number | string | undefined => {
    const result = measureDesign([machine], CATALOG, { cost: { prices }, measures: MACHINE_COST_MEASURES });
    if (!result.ok) throw new Error(result.problems.join(" "));
    return result.values[0]?.value ?? result.values[0]?.detail;
  };

  it("gives the sum of the count times the price of each line", () => {
    expect(priceOf(SAMPLE_MACHINE)).toBe(959);
  });

  it("gives no value, with the part, when a part has no price", () => {
    const prices = withoutPrice("board-a");
    expect(priceOf(SAMPLE_MACHINE, prices)).toMatch(/board-a/);
  });

  it("gives the sum over the lines for each machine and each price", () => {
    const line = fc.record({ part: fc.constantFrom(...CATALOG.keys()), count: fc.integer({ min: 1, max: 4 }) });
    const price = fc.dictionary(fc.constantFrom(...CATALOG.keys()), fc.integer({ min: 0, max: 2000 }));
    fc.assert(
      fc.property(fc.array(line, { maxLength: 8 }), price, (lines, prices) => {
        const all = Object.fromEntries([...CATALOG.keys()].map((part) => [part, prices[part] ?? 1]));
        const expected = lines.reduce((sum, item) => sum + item.count * (all[item.part] ?? 0), 0);
        expect(priceOf({ id: "m", lines }, pricesOf(all))).toBe(expected);
      }),
    );
  });
});

/**
 * This function gives the purchase of a design with plain arithmetic: for each part, the count in the machines that the
 * user does not own, less the stock and not below 0, times the price.
 */
const purchaseOf = (machines: readonly Machine[], owned: ReadonlySet<string>, stock: readonly PartLine[], prices: ReadonlyMap<string, number>): number => {
  const need = new Map<string, number>();
  for (const machine of machines) {
    if (owned.has(machine.id)) continue;
    for (const line of machine.lines) need.set(line.part, (need.get(line.part) ?? 0) + line.count);
  }
  for (const line of stock) need.set(line.part, (need.get(line.part) ?? 0) - line.count);
  return [...need].reduce((sum, [part, count]) => sum + Math.max(count, 0) * (prices.get(part) ?? Number.NaN), 0);
};

describe("the purchase of a site", () => {
  it("buys each part of the machines that the user does not own", () => {
    expect(valuesOf({ prices: SAMPLE_PRICES })["site:purchase"]).toBe(2 * 959);
    expect(valuesOf({ prices: SAMPLE_PRICES, owned: ["node-1"] })["site:purchase"]).toBe(959);
    expect(valuesOf({ prices: SAMPLE_PRICES, owned: ["node-1", "node-2"] })["site:purchase"]).toBe(0);
  });

  it("takes the parts from the stock first, and buys no part below 0", () => {
    const stock = [
      { part: "ram-2x16", count: 3 },
      { part: "fan-120", count: 1 },
      { part: "gpu-long", count: 2 },
    ];
    expect(valuesOf({ prices: SAMPLE_PRICES, stock })["site:purchase"]).toBe(2 * 959 - 3 * 90 - 12);
    expect(valuesOf({ prices: SAMPLE_PRICES, stock: [{ part: "ram-2x16", count: 9 }] })["site:purchase"]).toBe(2 * 959 - 4 * 90);
  });

  it("adds the counts of two stock lines of one part", () => {
    const stock = [
      { part: "ram-2x16", count: 1 },
      { part: "ram-2x16", count: 2 },
    ];
    expect(valuesOf({ prices: SAMPLE_PRICES, stock })["site:purchase"]).toBe(2 * 959 - 3 * 90);
  });

  it("needs no price of a part that the user does not buy", () => {
    const prices = withoutPrice("case-a");
    expect(valuesOf({ prices, stock: [{ part: "case-a", count: 2 }] })["site:purchase"]).toBe(2 * 959 - 2 * 75);
    expect(valuesOf({ prices, owned: ["node-1", "node-2"] })["site:purchase"]).toBe(0);
  });

  it("gives no purchase, total cost or slot cost, with the part, when a part to buy has no price", () => {
    const prices = withoutPrice("case-a");
    const values = valuesOf({ prices });
    for (const key of ["site:purchase", "site:total-cost", "site:slot-cost"]) expect(values[key]).toMatch(/case-a/);
    expect(typeof values["site:energy-cost"]).toBe("number");
    expect(valuesOf(undefined)["site:purchase"]).toMatch(/cpu-a/);
  });

  it("equals the plain arithmetic for each design, owned set, stock and price list", () => {
    const parts = [...CATALOG.keys()];
    const line = fc.record({ part: fc.constantFrom(...parts), count: fc.integer({ min: 1, max: 4 }) });
    const machines = fc.array(fc.array(line, { maxLength: 6 }), { minLength: 1, maxLength: 4 });
    const input = fc.record({
      machines,
      owned: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
      stock: fc.array(fc.record({ part: fc.constantFrom(...parts), count: fc.integer({ min: 1, max: 5 }) }), { maxLength: 6 }),
      prices: fc.array(fc.integer({ min: 0, max: 2000 }), { minLength: parts.length, maxLength: parts.length }),
    });
    fc.assert(
      fc.property(input, ({ machines: lists, owned: flags, stock, prices }) => {
        const made: Machine[] = lists.map((lines, i) => ({ id: `m${String(i)}`, lines }));
        const site: Site = { ...SAMPLE_SITE, places: made.map((machine) => ({ machine: machine.id, circuit: "circuit-a", room: "room-a" })) };
        const owned = made.filter((_, i) => flags[i] === true).map((machine) => machine.id);
        const price = new Map(parts.map((part, i) => [part, prices[i] ?? 0]));
        const list = pricesOf(Object.fromEntries(price));
        const expected = purchaseOf(made, new Set(owned), stock, price);
        expect(valuesOf({ prices: list, owned, stock }, made, site)["site:purchase"]).toBe(expected);
      }),
    );
  });
});

describe("the cost of the electricity over the horizon", () => {
  const base = valuesOf({ prices: SAMPLE_PRICES });
  const month = numberOf(base, "site:cost");
  const idle = numberOf(base, "site:idle-cost");

  it("is a bound by default: the most power for 36 months", () => {
    expect(numberOf(base, "site:energy-cost")).toBeCloseTo(36 * month, 9);
  });

  it("takes the power at idle and the most power for the busy share of the time", () => {
    const busy = (share: number, horizon: Quantity = quantity(12, "mo")): number => numberOf(valuesOf({ busy: share, horizon }), "site:energy-cost");
    expect(busy(0)).toBeCloseTo(12 * idle, 9);
    expect(busy(1)).toBeCloseTo(12 * month, 9);
    expect(busy(0.25)).toBeCloseTo(12 * (idle + 0.25 * (month - idle)), 9);
    expect(busy(0.25, quantity(1, "yr"))).toBeCloseTo(busy(0.25), 9);
    expect(busy(0.25, quantity(30, "d"))).toBeCloseTo(((30 * 24) / 730.485) * (idle + 0.25 * (month - idle)), 9);
    expect(busy(1, quantity(0, "mo"))).toBe(0);
  });

  it("grows with the busy share and with the horizon", () => {
    const share = uniformDouble({ min: 0, max: 1 });
    const months = fc.integer({ min: 0, max: 120 });
    fc.assert(
      fc.property(share, share, months, months, (a, b, m, n) => {
        const cost = (s: number, h: number): number => numberOf(valuesOf({ busy: s, horizon: quantity(h, "mo") }), "site:energy-cost");
        const [low, high] = a <= b ? [a, b] : [b, a];
        const [short, long] = m <= n ? [m, n] : [n, m];
        expect(cost(low, short)).toBeLessThanOrEqual(cost(high, short) + 1e-9);
        expect(cost(low, short)).toBeLessThanOrEqual(cost(low, long) + 1e-9);
      }),
      { numRuns: 30 },
    );
  });
});

describe("the total cost and the cost of a slot", () => {
  it("adds the purchase and the electricity, and divides by the runner slots", () => {
    const values = valuesOf({ prices: SAMPLE_PRICES, owned: ["node-1"], busy: 0.5 });
    const totalCost = numberOf(values, "site:purchase") + numberOf(values, "site:energy-cost");
    expect(numberOf(values, "site:total-cost")).toBeCloseTo(totalCost, 9);
    expect(numberOf(values, "site:slot-cost")).toBeCloseTo(totalCost / numberOf(values, "site:runner-slots"), 9);
  });

  it("gives no slot cost when the site runs no CI job", () => {
    const values = valuesOf({ prices: SAMPLE_PRICES }, MACHINES, SAMPLE_SITE, { job: { threads: 1000, memory: 1 } });
    expect(values["site:runner-slots"]).toBe(0);
    expect(typeof values["site:total-cost"]).toBe("number");
    expect(typeof values["site:slot-cost"]).toBe("string");
  });
});

describe("a sweep with a cost objective", () => {
  const input: DesignInput = { catalog: CATALOG, site: SAMPLE_SITE, fixed: MACHINES };
  const made = designSpace(CATALOG, { site: input });
  if (!made.ok) throw new Error(made.problems.join(" "));
  const space = made.value;
  const objectives: readonly DesignObjective[] = [...DESIGN_OBJECTIVES, { name: "total-cost", goal: "min", measure: "total-cost" }];
  const enumerate = { mode: "sample" as const, n: 30, seed: "cluster-design cost" };

  it("buys no part of the fixed machines, and gives the total cost of each feasible design", () => {
    const swept = sweepDesigns(space, input, { enumerate, objectives, cost: { prices: SAMPLE_PRICES } });
    if (!swept.ok) throw new Error(swept.problems.join(" "));
    const feasible = swept.value.run.rows.filter((row) => row.status === "feasible");
    expect(feasible.length).toBeGreaterThan(0);
    for (const row of feasible) {
      const config = swept.value.run.configs[row.config];
      if (config === undefined) throw new Error(`no config ${row.config}`);
      const design = designOf(space, config, input);
      if (!design.ok) throw new Error(design.problems.join(" "));
      const values = valuesOf({ prices: SAMPLE_PRICES, owned: ["node-1", "node-2"] }, design.value.machines, design.value.site);
      expect(row.values["total-cost"]).toBe(values["site:total-cost"]);
      expect(numberOf(values, "site:purchase")).toBe(purchaseOf(design.value.added, new Set(), [], PRICE));
    }
  });

  it("buys the parts of the fixed machines when the option owned names no machine", () => {
    const swept = sweepDesigns(space, input, { enumerate, objectives, cost: { prices: SAMPLE_PRICES, owned: [] } });
    const own = sweepDesigns(space, input, { enumerate, objectives, cost: { prices: SAMPLE_PRICES } });
    if (!swept.ok || !own.ok) throw new Error("the sweep failed");
    const fixed = 2 * 959;
    own.value.run.rows.forEach((row, i) => {
      const other = swept.value.run.rows[i];
      if (row.status !== "feasible" || other === undefined) return;
      expect(other.values["total-cost"]).toBeCloseTo((row.values["total-cost"] ?? Number.NaN) + fixed, 6);
    });
  });

  it("makes a row unread, and names the measure, when a part to buy has no price", () => {
    const swept = sweepDesigns(space, input, { enumerate, objectives });
    if (!swept.ok) throw new Error(swept.problems.join(" "));
    const rows = swept.value.run.rows.filter((row) => row.breaks.length === 0);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.status).toBe("unread");
      expect(row.missing).toEqual(["total-cost"]);
      expect(swept.value.unread[row.config]).toEqual(["site:total-cost"]);
    }
  });
});
