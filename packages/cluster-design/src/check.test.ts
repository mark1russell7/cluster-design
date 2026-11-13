import { quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import type { Expr } from "@mark1russell7/vex";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkDesign, overall, verdictOf, type Finding } from "./check.ts";
import { designTree, type Machine } from "./machine.ts";
import { PART_CLASSES, PART_CLASS_NAMES, readCatalog, type Part } from "./parts.ts";
import { FIT_RULES } from "./rules.ts";
import { SAMPLE_MACHINE, SAMPLE_PARTS } from "./sample.ts";

const catalogOf = (parts: readonly Part[]): ReadonlyMap<string, Part> => {
  const read = readCatalog(parts);
  if (!read.ok) throw new Error(read.problems.join(" "));
  return read.value;
};

const CATALOG = catalogOf(SAMPLE_PARTS);

const findingsOf = (machines: readonly Machine[], catalog = CATALOG, psuLoad?: number): readonly Finding[] => {
  const result = checkDesign(machines, catalog, psuLoad === undefined ? {} : { psuLoad });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.findings;
};

/** This function gives the rules that do not fit, with their verdicts. */
const notFitting = (findings: readonly Finding[]): Record<string, string> =>
  Object.fromEntries(findings.filter((f) => f.verdict !== "fits").map((f) => [f.rule, f.verdict]));

const swap = (from: string, to: string): Machine => ({
  id: `with-${to}`,
  lines: SAMPLE_MACHINE.lines.map((line) => (line.part === from ? { ...line, part: to } : line)),
});

const withLines = (id: string, lines: Machine["lines"]): Machine => ({ id, lines });

describe("the fit rules", () => {
  it("find that the sample machine fits each rule", () => {
    const findings = findingsOf([SAMPLE_MACHINE]);
    expect(findings).toHaveLength(FIT_RULES.length);
    expect(notFitting(findings)).toEqual({});
    expect(overall(findings)).toBe("fits");
  });

  it.each([
    ["cpu-a", "cpu-s2", { "cpu-socket": "breaks" }],
    ["cpu-a", "cpu-hot", { "cooler-rating": "breaks" }],
    ["ram-2x16", "ram-ddr4", { "memory-type": "breaks" }],
  ])("find the rule that the part %s breaks when %s replaces it", (from, to, broken) => {
    expect(notFitting(findingsOf([swap(from, to)]))).toEqual(broken);
  });

  it("find a graphics card that is longer than the case", () => {
    const machine = withLines("gpu", [...SAMPLE_MACHINE.lines, { part: "gpu-long", count: 1 }]);
    expect(notFitting(findingsOf([machine]))).toEqual({ "gpu-length": "breaks" });
  });

  it("count the memory modules and the memory size of each kit", () => {
    const lines = SAMPLE_MACHINE.lines.map((line) => (line.part === "ram-2x16" ? { ...line, count: 3 } : line));
    expect(notFitting(findingsOf([withLines("six-modules", lines)]))).toEqual({ "memory-slots": "breaks" });
  });

  it("count the drives of each interface", () => {
    const m2 = SAMPLE_MACHINE.lines.map((line) => (line.part === "ssd-m2" ? { ...line, count: 3 } : line));
    const sata = SAMPLE_MACHINE.lines.map((line) => (line.part === "hdd-sata" ? { ...line, count: 5 } : line));
    expect(notFitting(findingsOf([withLines("m2", m2), withLines("sata", sata)]))).toEqual({ "m2-slots": "breaks", "sata-ports": "breaks" });
  });

  it("add the power of each part with its count, and compare it to the load limit of the power supply", () => {
    // 230 + 30 + 2 x 6 + 8 + 2 x 9 + 3 = 301 W. The limit is 0.8 x 300 W = 240 W.
    const machine = withLines(
      "hot",
      swap("cpu-a", "cpu-hot").lines.map((line) => (line.part === "psu-550" ? { ...line, part: "psu-300" } : line)),
    );
    expect(notFitting(findingsOf([machine]))).toEqual({ "cooler-rating": "breaks", "psu-load": "breaks" });
    // 88 + 30 + 12 + 8 + 18 + 3 = 159 W. The limit 0.8 x 300 W = 240 W fits, but 0.5 x 300 W = 150 W does not.
    expect(notFitting(findingsOf([swap("psu-550", "psu-300")]))).toEqual({});
    expect(notFitting(findingsOf([swap("psu-550", "psu-300")], CATALOG, 0.5))).toEqual({ "psu-load": "breaks" });
  });

  it("give no read, and not a pass, for a rule that reads a part that the machine does not have", () => {
    const findings = findingsOf([withLines("no-case", SAMPLE_MACHINE.lines.filter((line) => line.part !== "case-a"))]);
    expect(notFitting(findings)).toEqual({
      "one-case": "breaks",
      "cooler-height": "unread",
      "board-in-case": "unread",
      "psu-in-case": "unread",
    });
    expect(findings.find((f) => f.rule === "board-in-case")?.detail).toMatch(/^#N\/A/);
    expect(overall(findings)).toBe("breaks");
  });

  it("find two processors on a board with one socket", () => {
    const lines = SAMPLE_MACHINE.lines.map((line) => (["cpu-a", "cooler-a"].includes(line.part) ? { ...line, count: 2 } : line));
    expect(notFitting(findingsOf([withLines("two", lines)]))).toEqual({ "cpu-count": "breaks" });
  });

  it("find a machine with no processor and no memory", () => {
    const lines = SAMPLE_MACHINE.lines.filter((line) => !["cpu-a", "cooler-a", "ram-2x16"].includes(line.part));
    const broken = notFitting(findingsOf([withLines("empty", lines)]));
    expect(broken).toMatchObject({ "cpu-count": "breaks", "memory-count": "breaks" });
  });
});

describe("the rule programs", () => {
  const refs = (expr: unknown, into: string[][] = []): string[][] => {
    if (Array.isArray(expr)) for (const item of expr) refs(item, into);
    else if (typeof expr === "object" && expr !== null) {
      const node = expr as { tag?: string; path?: readonly string[] };
      if (node.tag === "ref" && node.path !== undefined) into.push([...node.path]);
      for (const value of Object.values(expr)) refs(value, into);
    }
    return into;
  };

  it("have unique ids", () => {
    expect(new Set(FIT_RULES.map((rule) => rule.id)).size).toBe(FIT_RULES.length);
  });

  it("read only the fields of the classes that each rule names", () => {
    for (const rule of FIT_RULES) {
      const known = new Set(["class", "count", "part", ...rule.classes.flatMap((name) => Object.keys(PART_CLASSES[name]))]);
      const unknown = refs(rule.program as Expr).filter((path) => !known.has(path[0] ?? ""));
      expect({ rule: rule.id, unknown }).toEqual({ rule: rule.id, unknown: [] });
    }
  });
});

describe("the verdict", () => {
  it("is fits for true, breaks for false, and unread for each other value", () => {
    expect(verdictOf({ ok: true, value: true })).toEqual({ verdict: "fits" });
    expect(verdictOf({ ok: true, value: false })).toEqual({ verdict: "breaks" });
    expect(verdictOf({ ok: true, value: 1 }).verdict).toBe("unread");
  });

  it("puts a break before no read, and no read before a fit", () => {
    const f = (verdict: Finding["verdict"]): Finding => ({ machine: "m", rule: "r", sentence: "s", verdict });
    expect(overall([f("fits"), f("unread"), f("breaks")])).toBe("breaks");
    expect(overall([f("fits"), f("unread")])).toBe("unread");
    expect(overall([])).toBe("fits");
  });
});

describe("the input", () => {
  it("refuses a part with an amount of the wrong kind, a field of a different class, and an id on two parts", () => {
    const board = SAMPLE_PARTS.find((part) => part.class === "board");
    const read = readCatalog([
      { ...board, id: "b1", power: quantity(30, "mm") },
      { ...board, id: "b2", output: quantity(30, "W") },
      { ...board, id: "b3" },
      { ...board, id: "b3" },
    ]);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems).toHaveLength(3);
    expect(read.problems[0]).toMatch(/^The part 0 is not valid at power/);
    expect(read.problems[2]).toBe("The id b3 is on two parts.");
  });

  it("refuses a machine id on two machines and a part that the catalog does not have", () => {
    const tree = designTree([SAMPLE_MACHINE, SAMPLE_MACHINE, withLines("x", [{ part: "nothing", count: 1 }])], CATALOG);
    expect(tree).toEqual({
      ok: false,
      problems: ["The id node-1 is on two machines.", "The machine x names the part nothing, but the catalog does not have it."],
    });
  });

  it("refuses a load limit that is not more than 0 and not more than 1", () => {
    expect(checkDesign([SAMPLE_MACHINE], CATALOG, { psuLoad: 0 }).ok).toBe(false);
    expect(checkDesign([SAMPLE_MACHINE], CATALOG, { psuLoad: 1.5 }).ok).toBe(false);
    expect(checkDesign([SAMPLE_MACHINE], CATALOG, { psuLoad: Number.NaN }).ok).toBe(false);
  });
});

describe("the properties", () => {
  /** A different unit of each rule unit: the unit, then the multiplier and the divisor from the rule unit to it. */
  const OTHER: Readonly<Record<string, readonly [string, number, number]>> = {
    W: ["kW", 1, 1000],
    mm: ["cm", 1, 10],
    GiB: ["MiB", 1024, 1],
    GB: ["MB", 1000, 1],
  };

  /** This function gives the part with each amount in a different unit. The conversion back must be exact. */
  const inOtherUnits = (part: Part): Part => {
    const fields: Record<string, unknown> = { ...part };
    for (const [name, spec] of Object.entries(PART_CLASSES[part.class] as Record<string, { kind: string; unit?: string }>)) {
      const value = fields[name] as Quantity | undefined;
      if (spec.kind !== "amount" || value === undefined || value.unit !== spec.unit) continue;
      const other = OTHER[value.unit];
      if (other === undefined) continue;
      const moved = quantity((value.value * other[1]) / other[2], other[0]);
      if (valueIn(moved, value.unit) !== value.value) throw new Error(`${part.id}.${name} does not come back exactly from ${other[0]}`);
      fields[name] = moved;
    }
    return fields as unknown as Part;
  };

  const machines = fc.uniqueArray(
    fc.record({
      id: fc.uuid(),
      lines: fc.array(fc.record({ part: fc.constantFrom(...SAMPLE_PARTS.map((part) => part.id)), count: fc.integer({ min: 1, max: 4 }) }), { maxLength: 12 }),
    }),
    { minLength: 1, maxLength: 3, selector: (machine: Machine) => machine.id },
  );

  it("give the same verdicts when each amount is in a different unit", () => {
    const other = catalogOf(SAMPLE_PARTS.map(inOtherUnits));
    fc.assert(
      fc.property(machines, (design) => {
        expect(findingsOf(design, other)).toEqual(findingsOf(design));
      }),
      { numRuns: 60 },
    );
  });

  it("give a verdict for each rule at each machine, and a fit only when the program gives true", () => {
    fc.assert(
      fc.property(machines, (design) => {
        const findings = findingsOf(design);
        expect(findings).toHaveLength(design.length * FIT_RULES.length);
        for (const finding of findings) expect(finding.verdict === "unread").toBe(finding.detail !== undefined);
      }),
      { numRuns: 60 },
    );
  });

  it("do not break the load rule at a higher load limit when a lower one fits", () => {
    fc.assert(
      fc.property(machines, fc.double({ min: 0.05, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (design, low, t) => {
        const high = low + (1 - low) * t;
        const load = (limit: number) => findingsOf(design, CATALOG, limit).filter((f) => f.rule === "psu-load").map((f) => f.verdict);
        load(low).forEach((verdict, index) => {
          if (verdict === "fits") expect(load(high)[index]).toBe("fits");
        });
      }),
      { numRuns: 40 },
    );
  });

  it("cover each class of the table in the sample", () => {
    expect(new Set(SAMPLE_PARTS.map((part) => part.class))).toEqual(new Set(PART_CLASS_NAMES));
  });
});
