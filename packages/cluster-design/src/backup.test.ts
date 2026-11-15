import { quantity } from "@mark1russell7/quantity";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  backupSpace,
  BACKUP_FORMAT,
  checkBackup,
  measureBackup,
  readBackup,
  type Backup,
  type BackupMeasureValue,
  type BackupSource,
} from "./backup.ts";

const W = (value: number) => quantity(value, "W");

// Generic loads and sources. The numbers are round values for the hand math of the tests, not the values of a product.
const LOADS: Backup["loads"] = [
  { id: "modem", low: W(6), high: W(9), plugs: ["ac", "dc-12v"] },
  { id: "router", low: W(10), high: W(15), plugs: ["ac"] },
  { id: "phone", low: W(2), high: W(18), plugs: ["usb-c"], charge: quantity(15, "Wh") },
];

// The UPS: t = 60 * 60 / (p + 10), so 50 W holds 60 min and 110 W holds 30 min. The own use is 10 W, and 60 of 80 Wh is usable.
const UPS: BackupSource = {
  id: "ups",
  need: "internet",
  rated: W(300),
  outputs: ["ac"],
  carries: ["modem", "router"],
  energy: quantity(80, "Wh"),
  points: [
    { load: W(50), time: quantity(1, "h") },
    { load: W(110), time: quantity(30, "min") },
  ],
  price: quantity(120, "USD"),
};
const DC: BackupSource = {
  id: "dc",
  need: "internet",
  rated: W(36),
  outputs: ["dc-12v"],
  carries: ["modem", "router"],
  energy: quantity(100, "Wh"),
  usable: 0.9,
  ownUse: W(1),
  price: quantity(60, "USD"),
};
const SMALL: BackupSource = {
  id: "small",
  need: "internet",
  rated: W(20),
  outputs: ["ac", "dc-12v"],
  carries: ["modem", "router"],
  capacity: { charge: quantity(10_000, "mAh"), voltage: quantity(3.7, "V") },
};
const BANK: BackupSource = {
  id: "bank",
  need: "phone",
  rated: W(20),
  continuousShare: 1,
  outputs: ["usb-a", "usb-c"],
  carries: ["phone"],
  capacity: { charge: quantity(20_000, "mAh"), voltage: quantity(3.7, "V") },
  usable: 0.65,
  ownUse: W(0),
  price: quantity(30, "USD"),
};
const BACKUP: Backup = { format: BACKUP_FORMAT, loads: LOADS, sources: [UPS, DC, SMALL, BANK] };

function valueAt(values: readonly BackupMeasureValue[], source: string, measure: string): BackupMeasureValue {
  const found = values.find((value) => value.source === source && value.measure === measure);
  if (found === undefined) throw new Error(`no ${measure} at ${source}`);
  return found;
}

function measured(backup: Backup = BACKUP): readonly BackupMeasureValue[] {
  const result = measureBackup(backup);
  if (!result.ok) throw new Error(result.problems.join("\n"));
  return result.values;
}

describe("readBackup", () => {
  it("accepts a backup record, and an amount in each unit of its kind", () => {
    expect(readBackup(JSON.parse(JSON.stringify(BACKUP)))).toEqual({ ok: true, value: BACKUP });
  });

  it("gives a problem with the path for an amount of the wrong kind and for a field that the record does not have", () => {
    const wrong = { ...BACKUP, loads: [{ ...LOADS[0], low: quantity(6, "Wh") }], sources: [{ ...UPS, color: "red" }] };
    const result = readBackup(JSON.parse(JSON.stringify(wrong)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.some((problem) => problem.includes("at loads.0.low"))).toBe(true);
    expect(result.problems.some((problem) => problem.includes("at sources.0"))).toBe(true);
  });

  it("refuses a usable share more than 1 and a source with no output", () => {
    const result = readBackup(JSON.parse(JSON.stringify({ ...BACKUP, sources: [{ ...DC, usable: 1.2, outputs: [] }] })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.filter((problem) => problem.includes("at sources.0")).length).toBe(2);
  });
});

describe("backupSpace", () => {
  it("gives the energy from the capacity and the usable share and the own use from the runtime points", () => {
    const result = backupSpace(BACKUP);
    if (!result.ok) throw new Error(result.problems.join("\n"));
    const [ups, dc, small, bank] = result.sources;
    expect(ups?.ownUse?.value).toBeCloseTo(10, 9);
    expect(ups?.usable).toBeCloseTo(0.75, 9);
    expect(ups?.basis).toEqual({ energy: "input", usable: "points", ownUse: "points" });
    expect(ups?.continuousShare).toBe(0.8);
    expect(dc?.basis).toEqual({ energy: "input", usable: "input", ownUse: "input" });
    expect(small?.energy?.value).toBeCloseTo(37, 9);
    expect(small?.basis).toEqual({ energy: "capacity" });
    expect(bank?.energy?.value).toBeCloseTo(74, 9);
    expect(bank?.continuousShare).toBe(1);
  });

  it("gives an own use of 0 when the runtime points give less", () => {
    // (25 * 100 - 60 * 50) / (60 - 25) is less than 0. Thus the own use is 0, and 60 min at 50 W is 50 Wh of the 100 Wh.
    const points: BackupSource["points"] = [
      { load: W(50), time: quantity(60, "min") },
      { load: W(100), time: quantity(25, "min") },
    ];
    const result = backupSpace({ ...BACKUP, sources: [{ ...UPS, energy: quantity(100, "Wh"), points }] });
    if (!result.ok) throw new Error(result.problems.join("\n"));
    expect(result.sources[0]?.ownUse?.value).toBe(0);
    expect(result.sources[0]?.usable).toBeCloseTo(0.5, 9);
  });

  it("keeps a value of the input before a value of the runtime points", () => {
    const result = backupSpace({ ...BACKUP, sources: [{ ...UPS, usable: 0.5 }] });
    if (!result.ok) throw new Error(result.problems.join("\n"));
    expect(result.sources[0]?.usable).toBe(0.5);
    expect(result.sources[0]?.basis).toEqual({ energy: "input", usable: "input", ownUse: "points" });
  });

  it("gives the problems of the input", () => {
    const bad: Backup = {
      format: BACKUP_FORMAT,
      loads: [{ id: "a", low: W(5), high: W(4), plugs: ["ac"] }, { id: "a", low: W(1), high: W(2), plugs: ["ac"], charge: quantity(0, "Wh") }],
      sources: [
        { id: "s", need: "n", rated: W(0), outputs: ["ac"], carries: ["x", "a", "a"] },
        { id: "t", need: "n", rated: W(10), outputs: ["ac"], carries: [], energy: quantity(10, "Wh"), points: [{ load: W(20), time: quantity(5, "min") }, { load: W(10), time: quantity(9, "min") }] },
        { id: "u", need: "n", rated: W(10), outputs: ["ac"], carries: [], energy: quantity(10, "Wh"), points: [{ load: W(10), time: quantity(9, "min") }, { load: W(20), time: quantity(9, "min") }] },
      ],
    };
    const result = backupSpace(bad, { continuousShare: 1.5 });
    expect(result).toEqual({
      ok: false,
      problems: [
        "Two records have the id a.",
        "The continuous share 1.5 is not more than 0 and not more than 1.",
        "The load a has a most power less than its low power.",
        "The load a has a charge of 0.",
        "The source s has a rated power of 0.",
        "The source s carries x, which is not a load.",
        "The source s carries a load two times.",
        "The source s has no energy and no capacity.",
        "The source t has runtime points where the higher load does not give fewer minutes.",
        "The source u has runtime points where the higher load does not give fewer minutes.",
      ],
    });
  });
});

describe("measureBackup", () => {
  it("gives the load, the ceiling, the estimate and the price of each minute", () => {
    const values = measured();
    const at = (measure: string) => valueAt(values, "ups", measure).value;
    expect(at("load-low")).toBe(16);
    expect(at("load-high")).toBe(24);
    expect(at("limit")).toBe(240);
    expect(at("ceiling-high")).toBeCloseTo(200, 9);
    expect(at("ceiling-low")).toBeCloseTo(300, 9);
    expect(at("minutes-high")).toBeCloseTo((60 / 34) * 60, 9);
    expect(at("minutes-low")).toBeCloseTo((60 / 26) * 60, 9);
    expect(at("price-per-minute")).toBeCloseTo(0.6, 9);
  });

  it("gives the full charges of the batteries of the loads", () => {
    const values = measured();
    const at = (measure: string) => valueAt(values, "bank", measure).value;
    expect(at("charge")).toBe(15);
    expect(at("charges-ceiling")).toBeCloseTo(74 / 15, 9);
    expect(at("charges")).toBeCloseTo((74 * 0.65) / 15, 9);
    expect(at("price-per-charge")).toBeCloseTo(30 / (74 / 15), 9);
  });

  it("gives a reason, not a number, when a source has no value for a measure", () => {
    const values = measured();
    expect(valueAt(values, "small", "minutes-high").value).toBeUndefined();
    expect(valueAt(values, "small", "minutes-high").detail).toMatch(/usable/);
    expect(valueAt(values, "small", "price-per-minute").detail).toMatch(/price/);
    expect(valueAt(values, "ups", "charges-ceiling").value).toBeUndefined();
  });

  it("ranks the sources of a need by the ceiling, and gives no rank to a source without the plugs", () => {
    const values = measured();
    expect(valueAt(values, "ups", "rank-by-minutes").value).toBe(1);
    expect(valueAt(values, "small", "rank-by-minutes").value).toBe(2);
    expect(valueAt(values, "dc", "rank-by-minutes").detail).toMatch(/none/);
    expect(valueAt(values, "bank", "rank-by-minutes").value).toBe(1);
    expect(valueAt(values, "bank", "rank-by-charges").value).toBe(1);
  });

  it("gives no rank to a source with no score, also when it has no other source in its need", () => {
    // The loads of the UPS have no battery, so the UPS has no full charges and no rank by charges.
    const values = measured({ ...BACKUP, sources: [UPS] });
    expect(valueAt(values, "ups", "rank-by-charges").value).toBeUndefined();
    expect(valueAt(values, "ups", "rank-by-charges").detail).toMatch(/divide/);
  });

  it("gives equal scores the same rank", () => {
    const twin: BackupSource = { ...UPS, id: "twin" };
    const values = measured({ ...BACKUP, sources: [UPS, twin, SMALL] });
    expect(valueAt(values, "ups", "rank-by-minutes").value).toBe(1);
    expect(valueAt(values, "twin", "rank-by-minutes").value).toBe(1);
    expect(valueAt(values, "small", "rank-by-minutes").value).toBe(3);
  });
});

describe("checkBackup", () => {
  it("examines the load limit, the plugs and the usable share of each source", () => {
    const result = checkBackup(BACKUP);
    if (!result.ok) throw new Error(result.problems.join("\n"));
    const verdict = (source: string, rule: string) => result.findings.find((finding) => finding.source === source && finding.rule === rule)?.verdict;
    expect(["source-load", "source-plugs", "usable-share"].map((rule) => verdict("ups", rule))).toEqual(["fits", "fits", "fits"]);
    expect(verdict("dc", "source-plugs")).toBe("breaks");
    expect(verdict("dc", "source-load")).toBe("fits");
    expect(verdict("small", "source-load")).toBe("breaks");
    expect(verdict("small", "usable-share")).toBe("unread");
    expect(["source-load", "source-plugs", "usable-share"].map((rule) => verdict("bank", rule))).toEqual(["fits", "fits", "fits"]);
  });

  it("breaks the usable share when the runtime points of the maker give more energy than the battery has", () => {
    const result = checkBackup({ ...BACKUP, sources: [{ ...UPS, energy: quantity(10, "Wh") }] });
    if (!result.ok) throw new Error(result.problems.join("\n"));
    expect(result.findings.find((finding) => finding.rule === "usable-share")?.verdict).toBe("breaks");
  });

  it("uses the continuous share of the options for a source that does not give it", () => {
    const loadVerdict = (continuousShare?: number) => {
      const result = checkBackup({ ...BACKUP, sources: [{ ...SMALL, rated: W(24) }] }, continuousShare === undefined ? {} : { continuousShare });
      if (!result.ok) throw new Error(result.problems.join("\n"));
      return result.findings.find((finding) => finding.rule === "source-load")?.verdict;
    };
    expect(loadVerdict()).toBe("breaks");
    expect(loadVerdict(1)).toBe("fits");
  });
});

describe("the properties of backup power", () => {
  const PARAMS = { numRuns: 100, seed: 20261115 };

  it("the calibration gives back the usable share and the own use of the model", () => {
    const model = fc.record({
      energy: fc.double({ min: 10, max: 2000, noNaN: true }),
      usable: fc.double({ min: 0.3, max: 1, noNaN: true }),
      ownUse: fc.double({ min: 0, max: 50, noNaN: true }),
      p1: fc.double({ min: 1, max: 500, noNaN: true }),
      ratio: fc.double({ min: 1.2, max: 4, noNaN: true }),
    });
    fc.assert(
      fc.property(model, ({ energy, usable, ownUse, p1, ratio }) => {
        const p2 = p1 * ratio;
        const minutes = (p: number) => (60 * energy * usable) / (p + ownUse);
        const source: BackupSource = {
          id: "s",
          need: "n",
          rated: W(1000),
          outputs: ["ac"],
          carries: [],
          energy: quantity(energy, "Wh"),
          points: [
            { load: W(p1), time: quantity(minutes(p1), "min") },
            { load: W(p2), time: quantity(minutes(p2), "min") },
          ],
        };
        const result = backupSpace({ format: BACKUP_FORMAT, loads: [], sources: [source] });
        if (!result.ok) return false;
        const calibrated = result.sources[0];
        return Math.abs((calibrated?.usable ?? 0) - usable) < 1e-6 && Math.abs((calibrated?.ownUse?.value ?? -1) - ownUse) < 1e-6;
      }),
      PARAMS,
    );
  });

  const sourcesArb = fc.uniqueArray(
    fc.record({
      id: fc.constantFrom("a", "b", "c", "d", "e", "f"),
      need: fc.constantFrom("internet", "phone"),
      energy: fc.integer({ min: 1, max: 500 }),
      outputs: fc.subarray(["ac", "dc-12v", "usb-c"], { minLength: 1 }),
      carries: fc.subarray(["modem", "router", "phone"], { minLength: 1 }),
    }),
    { selector: (source) => source.id, minLength: 1, maxLength: 6 },
  );
  const toSources = (raw: readonly { id: string; need: string; energy: number; outputs: string[]; carries: string[] }[]): BackupSource[] =>
    raw.map(({ id, need, energy, outputs, carries }) => ({ id, need, rated: W(100), outputs, carries, energy: quantity(energy, "Wh"), usable: 0.8, ownUse: W(2), price: quantity(10, "USD") }));

  it("each value of a source does not change when the order of the sources and the loads changes", () => {
    fc.assert(
      fc.property(sourcesArb, fc.func(fc.integer()), (raw, order) => {
        const sources = toSources(raw);
        const shuffle = <T,>(list: readonly T[]): T[] => [...list].map((item, index) => ({ item, key: order(index) })).sort((x, y) => x.key - y.key).map(({ item }) => item);
        const one = measured({ format: BACKUP_FORMAT, loads: LOADS, sources });
        const two = measured({ format: BACKUP_FORMAT, loads: shuffle(LOADS), sources: shuffle(sources) });
        const key = (value: BackupMeasureValue) => `${value.source} ${value.measure}`;
        const sorted = (values: readonly BackupMeasureValue[]) => [...values].sort((x, y) => key(x).localeCompare(key(y)));
        expect(sorted(two)).toEqual(sorted(one));
      }),
      PARAMS,
    );
  });

  it("the rank of a source is 1 plus the sources of its need with the plugs and a higher ceiling", () => {
    fc.assert(
      fc.property(sourcesArb, (raw) => {
        const backup: Backup = { format: BACKUP_FORMAT, loads: LOADS, sources: toSources(raw) };
        const values = measured(backup);
        const check = checkBackup(backup);
        if (!check.ok) return false;
        const plugs = (source: string) => check.findings.find((finding) => finding.source === source && finding.rule === "source-plugs")?.verdict === "fits";
        const ceiling = (source: string) => valueAt(values, source, "ceiling-high").value ?? Number.NaN;
        for (const source of raw) {
          const rank = valueAt(values, source.id, "rank-by-minutes");
          if (!plugs(source.id)) {
            expect(rank.value).toBeUndefined();
            continue;
          }
          const higher = raw.filter((other) => other.id !== source.id && other.need === source.need && plugs(other.id) && ceiling(other.id) > ceiling(source.id));
          expect(rank.value).toBe(1 + higher.length);
        }
        return true;
      }),
      PARAMS,
    );
  });

  it("k times the energy gives k times the ceiling, the estimate and the charges", () => {
    fc.assert(
      fc.property(sourcesArb, fc.integer({ min: 2, max: 9 }), (raw, k) => {
        const sources = toSources(raw);
        const scaled = sources.map((source) => ({ ...source, energy: quantity((source.energy?.value ?? 0) * k, "Wh") }));
        const one = measured({ format: BACKUP_FORMAT, loads: LOADS, sources });
        const two = measured({ format: BACKUP_FORMAT, loads: LOADS, sources: scaled });
        for (const measure of ["ceiling-high", "minutes-low", "charges-ceiling", "charges"]) {
          for (const source of raw) {
            const before = valueAt(one, source.id, measure).value;
            const after = valueAt(two, source.id, measure).value;
            if (before === undefined) expect(after).toBeUndefined();
            else expect(after).toBeCloseTo(before * k, 6);
          }
        }
      }),
      PARAMS,
    );
  });
});
