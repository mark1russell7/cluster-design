import { FIT_RULES } from "@mark1russell7/cluster-design";
import { SAMPLE_PARTS } from "@mark1russell7/cluster-design/sample";
import { describe, expect, it } from "vitest";
import {
  factsOf,
  formatMeasure,
  hashOf,
  headlineOf,
  machineOf,
  MACHINE_ID,
  partsByClass,
  PRESETS,
  resultOf,
  stateOf,
  TILE_LABELS,
  type DemoState,
} from "./demo.ts";

const preset = (id: string): DemoState => {
  const found = PRESETS.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`No preset ${id}`);
  return found.state;
};

const problems = (state: DemoState): Record<string, string> =>
  Object.fromEntries(resultOf(state).findings.filter((f) => f.verdict !== "fits").map((f) => [f.rule, f.verdict]));

describe("the demo", () => {
  it("starts with a machine that fits, with its power and its limit", () => {
    const result = resultOf(preset("fits"));
    expect(result.verdict).toBe("fits");
    expect(result.findings).toHaveLength(FIT_RULES.length);
    expect({ power: result.power, limit: result.limit, output: result.output }).toEqual({ power: 163, limit: 440, output: 550 });
    expect(headlineOf(result)).toBe("The parts fit");
  });

  it("gives the rules that each preset breaks", () => {
    expect(problems(preset("hot"))).toEqual({ "cooler-rating": "breaks" });
    expect(problems(preset("graphics"))).toEqual({ "gpu-length": "breaks", "psu-load": "breaks" });
    expect(problems(preset("other-socket"))).toEqual({ "cpu-socket": "breaks", "memory-type": "breaks" });
    expect(problems(preset("no-case"))).toEqual({
      "one-case": "breaks",
      "cooler-height": "unread",
      "board-in-case": "unread",
      "psu-in-case": "unread",
      "fan-slots": "unread",
    });
  });

  it("gives a headline that counts the breaks and the rules with no read", () => {
    expect(headlineOf(resultOf(preset("hot")))).toBe("1 rule breaks");
    expect(headlineOf(resultOf(preset("graphics")))).toBe("2 rules break");
    expect(headlineOf(resultOf(preset("no-case")))).toBe("1 rule breaks, 4 rules have no read");
    expect(headlineOf(resultOf({ counts: new Map(), psuLoad: 0.8 }))).toMatch(/rules break/);
  });

  it("breaks the load rule at a low load limit", () => {
    const state = preset("hot");
    expect(problems(state)).toEqual({ "cooler-rating": "breaks" });
    expect(problems({ ...state, psuLoad: 0.5 })).toEqual({ "cooler-rating": "breaks", "psu-load": "breaks" });
    expect(problems({ ...preset("fits"), psuLoad: 0.5 })).toEqual({});
  });

  it("makes a machine with one line for each part with a count", () => {
    const machine = machineOf({ counts: new Map([["cpu-a", 2], ["board-a", 0], ["ssd-m2", 1]]), psuLoad: 0.8 });
    expect(machine).toEqual({ id: MACHINE_ID, lines: [{ part: "cpu-a", count: 2 }, { part: "ssd-m2", count: 1 }] });
  });

  it("keeps a state in the hash of the address", () => {
    for (const { state } of PRESETS) {
      const back = stateOf(hashOf(state));
      expect(back?.psuLoad).toBe(state.psuLoad);
      expect(machineOf(back ?? state)).toEqual(machineOf(state));
    }
    expect(stateOf("")).toBeUndefined();
    expect(stateOf("#nothing=3&cpu-a=99&load=20")).toEqual({ counts: new Map([["cpu-a", 8]]), psuLoad: 0.5 });
  });

  it("gives each part with its facts, in the classes of the table", () => {
    expect(partsByClass().flatMap(([, parts]) => parts)).toHaveLength(SAMPLE_PARTS.length);
    const cooler = SAMPLE_PARTS.find((part) => part.id === "cooler-a");
    if (cooler === undefined) throw new Error("No cooler");
    expect(factsOf(cooler)).toEqual(["sockets S1/S2", "height 155 mm", "rating 150 W", "power 3 W", "idlePower 1 W", "noise 30 dBA"]);
  });

  it("gives the text of each tile of the measures", () => {
    const measures = new Map(resultOf(preset("fits")).measures.map((value) => [value.measure, formatMeasure(value)]));
    expect(Object.keys(TILE_LABELS).map((id) => measures.get(id))).toEqual(["43 W", "181 W", "54 W", "34.8 dBA", "16", "64 GiB", "9 TB", "3"]);
    expect(formatMeasure({ machine: "m", measure: "noise", unit: "dBA", detail: "#NUM!" })).toBe("–");
    expect(formatMeasure({ machine: "m", measure: "storage", unit: "GB", value: 512 })).toBe("512 GB");
  });
});
