import { FIT_RULES } from "@mark1russell7/cluster-design";
import { SAMPLE_PARTS, SAMPLE_PRICES } from "@mark1russell7/cluster-design/sample";
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
  WORK_CLASSES,
  WORK_NAMES,
  workSentence,
  workText,
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
    expect(headlineOf(resultOf({ counts: new Map(), psuLoad: 0.8, work: new Map() }))).toMatch(/rules break/);
  });

  it("breaks the load rule at a low load limit", () => {
    const state = preset("hot");
    expect(problems(state)).toEqual({ "cooler-rating": "breaks" });
    expect(problems({ ...state, psuLoad: 0.5 })).toEqual({ "cooler-rating": "breaks", "psu-load": "breaks" });
    expect(problems({ ...preset("fits"), psuLoad: 0.5 })).toEqual({});
  });

  it("makes a machine with one line for each part with a count", () => {
    const machine = machineOf({ counts: new Map([["cpu-a", 2], ["board-a", 0], ["ssd-m2", 1]]), psuLoad: 0.8, work: new Map() });
    expect(machine).toEqual({ id: MACHINE_ID, lines: [{ part: "cpu-a", count: 2 }, { part: "ssd-m2", count: 1 }] });
    const busy = machineOf({ counts: new Map([["cpu-a", 1]]), psuLoad: 0.8, work: new Map([["session", 3], ["service", 0]]) });
    expect(busy).toEqual({ id: MACHINE_ID, lines: [{ part: "cpu-a", count: 1 }], work: [{ class: "session", count: 3 }] });
  });

  it("keeps a state in the hash of the address", () => {
    for (const { state } of PRESETS) {
      const back = stateOf(hashOf(state));
      expect(back?.psuLoad).toBe(state.psuLoad);
      expect(back?.work).toEqual(new Map([...state.work].filter(([, count]) => count > 0)));
      expect(machineOf(back ?? state)).toEqual(machineOf(state));
    }
    expect(stateOf("")).toBeUndefined();
    expect(stateOf("#nothing=3&cpu-a=99&load=20")).toEqual({ counts: new Map([["cpu-a", 8]]), psuLoad: 0.5, work: new Map() });
    expect(stateOf("#cpu-a=1&work.session=99&work.service=-2&work.cpu-a=3&work.nothing=1")?.work).toEqual(new Map([["session", 16], ["service", 0]]));
  });

  it("gives each part with its facts, in the classes of the table", () => {
    expect(partsByClass().flatMap(([, parts]) => parts)).toHaveLength(SAMPLE_PARTS.length);
    const cooler = SAMPLE_PARTS.find((part) => part.id === "cooler-a");
    if (cooler === undefined) throw new Error("No cooler");
    expect(factsOf(cooler)).toEqual(["sockets S1/S2", "height 155 mm", "rating 150 W", "power 3 W", "idlePower 1 W", "noise 30 dBA"]);
  });

  it("gives the text of each tile of the measures", () => {
    const measures = new Map(resultOf(preset("fits")).measures.map((value) => [value.measure, formatMeasure(value)]));
    expect(Object.keys(TILE_LABELS).map((id) => measures.get(id))).toEqual(["43 W", "181 W", "54 W", "34.8 dBA", "16", "64 GiB", "9 TB", "3", "$959"]);
    expect(formatMeasure({ machine: "m", measure: "noise", unit: "dBA", detail: "#NUM!" })).toBe("–");
    expect(formatMeasure({ machine: "m", measure: "storage", unit: "GB", value: 512 })).toBe("512 GB");
  });
});

describe("the work next to the CI jobs", () => {
  const value = (state: DemoState, id: string): number | undefined => resultOf(state).measures.find((entry) => entry.measure === id)?.value;

  it("gives the CI jobs the rest of the machine after the work", () => {
    const mix = preset("mix");
    expect(problems(mix)).toEqual({});
    const ids = ["work-threads", "work-memory", "free-threads", "free-memory", "runner-slots", "capacity-session", "capacity-service"];
    expect(ids.map((id) => value(mix, id))).toEqual([6, 24, 10, 38, 2, 13, 5]);
    expect(value(preset("fits"), "runner-slots")).toBe(3);
  });

  it("breaks the memory rule of the work when the work takes more than the machine less its reserve", () => {
    expect(problems(preset("full"))).toEqual({ "work-memory": "breaks" });
    expect(value(preset("full"), "runner-slots")).toBe(0);
  });

  it("gives a sentence of the share of the work", () => {
    expect(workSentence(resultOf(preset("fits")))).toBe("No other work. The machine less its reserve has room for 3 CI jobs.");
    expect(workSentence(resultOf(preset("mix")))).toBe(
      "The work takes 6 threads and 24 GiB. 10 threads and 38 GiB stay free: room for 2 CI jobs, or 9 more sessions, or 4 more services.",
    );
    expect(workSentence(resultOf(preset("full")))).toBe("The work takes 16 threads and 64 GiB. That is more than the machine less its reserve, so no CI job fits.");
    expect(workSentence({ measures: [] })).toMatch(/no read/);
  });

  it("has a name for each class of work", () => {
    expect(WORK_CLASSES.map((entry) => WORK_NAMES[entry.id]?.[1])).toEqual(["sessions", "services"]);
  });

  it("gives the text of work lines, with one name for one unit", () => {
    expect(workText([{ class: "session", count: 4 }, { class: "service", count: 1 }])).toBe("4 sessions and 1 service");
    expect(workText([{ class: "session", count: 1 }, { class: "service", count: 0 }])).toBe("1 session");
    expect(workText([{ class: "other", count: 2 }])).toBe("2 other");
    expect(workText([])).toBe("no other work");
  });
});

describe("the price of the demo machine", () => {
  it("gives the price of the parts of the machine from the sample prices", () => {
    const price = resultOf(preset("fits")).measures.find((value) => value.measure === "price");
    expect(price?.value).toBe(959);
    expect(price === undefined ? "" : formatMeasure(price)).toBe("$959");
    expect(TILE_LABELS["price"]).toBe("Price of the parts");
  });

  it("has a sample price for each part of the catalog", () => {
    expect(new Set(SAMPLE_PRICES.prices.map((line) => line.part))).toEqual(new Set(SAMPLE_PARTS.map((part) => part.id)));
  });
});
