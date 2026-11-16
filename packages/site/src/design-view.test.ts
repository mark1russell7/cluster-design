import { FIT_RULES, SITE_RULES } from "@mark1russell7/cluster-design";
import { describe, expect, it } from "vitest";
import { stateOf, workText, type DemoState } from "./demo.ts";
import {
  AXES,
  AXIS_IDS,
  axesOf,
  axisOf,
  breakCounts,
  builderHashOf,
  countsOf,
  DEFAULT_VIEW,
  firstChoice,
  frontLine,
  frontOn,
  nameOf,
  ruleSentence,
  sweepView,
  viewHashOf,
  viewInputOf,
  viewObjectives,
  viewStateOf,
  VIEW_SPLIT,
  WORK_AXIS_IDS,
  withWork,
  valuesOf,
  whereOf,
  type Axis,
  type ViewPoint,
  type ViewState,
} from "./design-view.ts";
import { SAMPLE_SITE_STATE, siteHashOf, siteStateOf, type SiteState } from "./site-demo.ts";

const DEMO: DemoState = { counts: new Map(), psuLoad: 0.8, work: new Map() };
const VIEW: ViewState = { ...DEFAULT_VIEW, n: 80, seed: 3 };

function pointsOf(site: SiteState = SAMPLE_SITE_STATE, view: ViewState = VIEW, psuLoad = 0.8): readonly ViewPoint[] {
  const result = sweepView(viewInputOf(site, psuLoad, view));
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.points;
}

const POINTS = pointsOf();

/** A site where each room is too loud for each machine, so a design in two rooms breaks the noise rule two times. */
const STRICT: SiteState = {
  ...SAMPLE_SITE_STATE,
  rooms: [
    { places: 2, heatLimit: 1000, noiseLimit: 1 },
    { places: 2, heatLimit: 1000, noiseLimit: 1 },
  ],
};

/** This function makes a design for a test of a pure function. */
const pointOf = (id: string, breaks: readonly string[] = [], values: ViewPoint["values"] = {}): ViewPoint => ({
  id,
  status: breaks.length === 0 ? "fits" : "breaks",
  values,
  breaks,
  lines: [],
  places: [{ circuit: 0, room: 0 }],
});

/** The plain reference of the front: a design that fits, and that no other design that fits beats. */
function referenceFront(points: readonly ViewPoint[], x: Axis, y: Axis): ReadonlySet<string> {
  const fits = points.filter((point) => point.status === "fits");
  const better = (axis: Axis, a: number, b: number): boolean => (axis.goal === "min" ? a < b : a > b);
  const atLeast = (axis: Axis, a: number, b: number): boolean => a === b || better(axis, a, b);
  const value = (point: ViewPoint, axis: Axis): number => point.values[axis.id] ?? Number.NaN;
  const beats = (a: ViewPoint, b: ViewPoint): boolean =>
    atLeast(x, value(a, x), value(b, x)) && atLeast(y, value(a, y), value(b, y)) && (better(x, value(a, x), value(b, x)) || better(y, value(a, y), value(b, y)));
  return new Set(fits.filter((point) => !fits.some((other) => beats(other, point))).map((point) => point.id));
}

describe("the sweep of the view", () => {
  it("gives designs of 1 to 4 machines, each on a circuit and in a room of the site", () => {
    expect(POINTS.length).toBeGreaterThan(40);
    for (const point of POINTS) {
      expect(point.places.length).toBeGreaterThanOrEqual(1);
      expect(point.places.length).toBeLessThanOrEqual(4);
      expect(point.lines.length).toBeGreaterThan(0);
      for (const place of point.places) {
        expect([0, 1]).toContain(place.circuit);
        expect([0, 1]).toContain(place.room);
      }
    }
  });

  it("gives each value of each goal to a design that fits, and the rules that break to the other designs", () => {
    const counts = countsOf(POINTS);
    expect(counts.fits).toBeGreaterThan(0);
    expect(counts.breaks).toBeGreaterThan(0);
    for (const point of POINTS) {
      if (point.status === "fits") {
        expect(point.breaks).toEqual([]);
        expect(Object.keys(point.values).sort()).toEqual(axesOf(false).map((axis) => axis.id).sort());
      }
      if (point.status === "breaks") expect(point.breaks.length).toBeGreaterThan(0);
      expect(new Set(point.breaks).size).toBe(point.breaks.length);
    }
  });

  it("puts the copies on each circuit and in each room of the site", () => {
    const places = POINTS.flatMap((point) => point.places);
    expect(new Set(places.map((place) => place.circuit))).toEqual(new Set([0, 1]));
    expect(new Set(places.map((place) => place.room))).toEqual(new Set([0, 1]));
  });

  it("names each rule that breaks by the id of a rule of the package, one time for each design", () => {
    const ids = new Set([...FIT_RULES, ...SITE_RULES].map((rule) => rule.id));
    const strict = pointsOf(STRICT);
    for (const point of [...POINTS, ...strict]) {
      for (const rule of point.breaks) expect(ids).toContain(rule);
      expect(new Set(point.breaks).size).toBe(point.breaks.length);
    }
    const twoRooms = strict.filter((point) => new Set(point.places.map((place) => place.room)).size === 2);
    expect(twoRooms.length).toBeGreaterThan(0);
    for (const point of twoRooms) expect(point.breaks).toContain("room-noise");
  });

  it("keeps only the values of the goals that are finite numbers", () => {
    expect(valuesOf({ "total-cost": 10, "slot-cost": Infinity, power: Number.NaN, noise: undefined, "runner-slots": "4", other: 3 })).toEqual({ "total-cost": 10 });
  });

  it("gives the same designs for the same seed, and other designs for another seed", () => {
    expect(pointsOf().map((point) => point.id)).toEqual(POINTS.map((point) => point.id));
    expect(pointsOf(SAMPLE_SITE_STATE, { ...VIEW, seed: 4 }).map((point) => point.id)).not.toEqual(POINTS.map((point) => point.id));
  });

  it("reads the busy share of the site: more time at full power costs more for each design that fits", () => {
    const idle = pointsOf({ ...SAMPLE_SITE_STATE, busy: 0 });
    const busy = pointsOf({ ...SAMPLE_SITE_STATE, busy: 1 });
    const fits = idle.filter((point) => point.status === "fits");
    expect(fits.length).toBeGreaterThan(0);
    for (const point of fits) {
      const other = busy.find((entry) => entry.id === point.id);
      expect(other?.values["total-cost"]).toBeGreaterThan(point.values["total-cost"] ?? Infinity);
      expect(other?.values["runner-slots"]).toBe(point.values["runner-slots"]);
    }
  });

  it("counts the rules that break, the most first", () => {
    const counts = breakCounts(POINTS);
    expect(counts.length).toBeGreaterThan(0);
    for (let index = 1; index < counts.length; index += 1) expect(counts[index - 1]?.[1]).toBeGreaterThanOrEqual(counts[index]?.[1] ?? 0);
    const total = POINTS.reduce((sum, point) => sum + point.breaks.length, 0);
    expect(counts.reduce((sum, [, count]) => sum + count, 0)).toBe(total);
  });

  it("orders the rules by their count, then by their id", () => {
    const points = [pointOf("a", ["room-noise"]), pointOf("b", ["cpu-socket", "room-noise"]), pointOf("c", ["circuit-load", "cpu-socket"]), pointOf("d")];
    expect(breakCounts(points)).toEqual([
      ["cpu-socket", 2],
      ["room-noise", 2],
      ["circuit-load", 1],
    ]);
  });
});

describe("the front of two goals", () => {
  const goals = axesOf(false);
  const pairs = goals.flatMap((x) => goals.filter((y) => y.id !== x.id).map((y) => [x, y] as const));

  it("holds the designs that no other design that fits beats, for each pair of goals", () => {
    for (const [x, y] of pairs) expect([...frontOn(POINTS, x, y)].sort()).toEqual([...referenceFront(POINTS, x, y)].sort());
  });

  it("has a line through each design of the front, with a corner between two designs", () => {
    for (const [x, y] of pairs) {
      const front = POINTS.filter((point) => frontOn(POINTS, x, y).has(point.id));
      const line = frontLine(front, x, y);
      expect(line.length).toBe(Math.max(0, front.length * 2 - 1));
      for (let index = 1; index < line.length; index += 1) {
        const [a, b] = [line[index - 1], line[index]];
        if (a === undefined || b === undefined) throw new Error("The line has a gap.");
        // Each step of the line changes one goal only, so the line is a staircase.
        expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
        expect(b[0]).toBeGreaterThanOrEqual(a[0]);
      }
    }
  });

  it("has each corner on the worse side: each design next to a corner is as good as the corner on both goals", () => {
    const atLeast = (axis: Axis, a: number, b: number): boolean => (axis.goal === "min" ? a <= b : a >= b);
    for (const [x, y] of pairs) {
      const line = frontLine(
        POINTS.filter((point) => frontOn(POINTS, x, y).has(point.id)),
        x,
        y,
      );
      for (let index = 1; index < line.length - 1; index += 2) {
        const [before, corner, after] = [line[index - 1], line[index], line[index + 1]];
        if (before === undefined || corner === undefined || after === undefined) throw new Error("The line has a gap.");
        for (const design of [before, after]) {
          expect(atLeast(x, design[0], corner[0])).toBe(true);
          expect(atLeast(y, design[1], corner[1])).toBe(true);
        }
      }
    }
  });

  it("is empty when no design fits", () => {
    const none = POINTS.map((point) => ({ ...point, status: "breaks" as const }));
    expect(frontOn(none, axisOf("total-cost"), axisOf("runner-slots")).size).toBe(0);
  });
});

describe("the first choice", () => {
  it("is the design that fits with the least cost of one CI slot", () => {
    const first = firstChoice(POINTS);
    expect(first?.status).toBe("fits");
    for (const point of POINTS.filter((entry) => entry.status === "fits")) {
      expect(first?.values["slot-cost"]).toBeLessThanOrEqual(point.values["slot-cost"] ?? Infinity);
    }
  });

  it("is no design when no design fits", () => {
    expect(firstChoice(POINTS.filter((point) => point.status !== "fits"))).toBeUndefined();
  });
});

describe("the split of work", () => {
  const SPLIT: ViewState = { ...VIEW, work: true };
  const SPLIT_POINTS = pointsOf(SAMPLE_SITE_STATE, SPLIT);
  const count = (point: ViewPoint, id: string): number => point.work.find((line) => line.class === id)?.count ?? 0;

  it("has the work goals only with the split", () => {
    expect(axesOf(false).map((axis) => axis.id)).toEqual(AXIS_IDS.filter((id) => !WORK_AXIS_IDS.includes(id)));
    expect(axesOf(true)).toEqual(AXES);
    expect(viewObjectives(false).map((objective) => objective.name)).not.toContain("work-session");
    expect(viewObjectives(true).map((objective) => objective.measure)).toEqual([...AXIS_IDS]);
  });

  it("gives no work line to a design of a view without the split", () => {
    expect(POINTS.every((point) => point.work.length === 0)).toBe(true);
  });

  it("gives each new machine work in the ranges of the split, and each goal to a design that fits", () => {
    const fits = SPLIT_POINTS.filter((point) => point.status === "fits");
    expect(fits.length).toBeGreaterThan(0);
    for (const point of SPLIT_POINTS) {
      for (const range of VIEW_SPLIT) {
        expect(count(point, range.class)).toBeGreaterThanOrEqual(range.min);
        expect(count(point, range.class)).toBeLessThanOrEqual(range.max);
      }
    }
    for (const point of fits) {
      expect(Object.keys(point.values).sort()).toEqual([...AXIS_IDS].sort());
      expect(point.values["work-session"]).toBe(count(point, "session") * point.places.length);
      expect(point.values["work-service"]).toBe(count(point, "service") * point.places.length);
    }
  });

  it("trades sessions against CI runner slots: the front of the two goals holds more than one design", () => {
    const front = frontOn(SPLIT_POINTS, axisOf("runner-slots"), axisOf("work-session"));
    expect(front.size).toBeGreaterThan(1);
    expect([...front].sort()).toEqual([...referenceFront(SPLIT_POINTS, axisOf("runner-slots"), axisOf("work-session"))].sort());
  });

  it("names the work of each machine of a design", () => {
    const point = SPLIT_POINTS.find((entry) => count(entry, "session") > 0);
    if (point === undefined) throw new Error("No design has a session.");
    expect(nameOf(point).endsWith(`, each with ${workText(point.work)}`)).toBe(true);
    const idle = SPLIT_POINTS.find((entry) => entry.work.every((line) => line.count === 0));
    if (idle !== undefined) expect(nameOf(idle)).not.toContain("each with");
  });

  it("opens a design in the builder with the work of each machine", () => {
    const point = SPLIT_POINTS.find((entry) => entry.status === "fits" && count(entry, "session") > 0);
    if (point === undefined) throw new Error("No design that fits has a session.");
    const hash = builderHashOf(point, DEMO, SAMPLE_SITE_STATE, SPLIT);
    expect(Object.fromEntries(stateOf(hash)?.work ?? [])).toEqual(Object.fromEntries(point.work.map((line) => [line.class, line.count])));
    expect(viewStateOf(hash)).toEqual(SPLIT);
  });

  it("shows the CI runner slots across and the sessions up when the split starts", () => {
    expect(withWork(DEFAULT_VIEW, true)).toEqual({ ...DEFAULT_VIEW, work: true, x: "runner-slots", y: "work-session" });
  });

  it("changes each work goal to a free default goal when the split stops", () => {
    expect(withWork({ ...SPLIT, x: "runner-slots", y: "work-session" }, false)).toEqual({ ...SPLIT, work: false, x: "runner-slots", y: "total-cost" });
    expect(withWork({ ...SPLIT, x: "work-service", y: "work-session" }, false)).toEqual({ ...SPLIT, work: false, x: "total-cost", y: "runner-slots" });
    expect(withWork({ ...SPLIT, x: "work-service", y: "total-cost" }, false)).toEqual({ ...SPLIT, work: false, x: "runner-slots", y: "total-cost" });
    expect(withWork({ ...SPLIT, x: "noise", y: "power" }, false)).toEqual({ ...SPLIT, work: false, x: "noise", y: "power" });
  });
});

describe("the hash of the view", () => {
  it("keeps the view state", () => {
    const view: ViewState = { x: "noise", y: "slot-cost", n: 1000, seed: 42, work: false };
    expect(viewStateOf(`#${viewHashOf(view)}`)).toEqual(view);
    const split: ViewState = { x: "work-service", y: "runner-slots", n: 250, seed: 7, work: true };
    expect(viewHashOf(split)).toContain("vw=1");
    expect(viewStateOf(`#${viewHashOf(split)}`)).toEqual(split);
  });

  it("gives a work goal only to a view with the split", () => {
    expect(viewStateOf("#vx=work-session&vy=power")).toEqual({ ...DEFAULT_VIEW, y: "power" });
    expect(viewStateOf("#vx=work-session&vy=power&vw=1")).toEqual({ ...DEFAULT_VIEW, x: "work-session", y: "power", work: true });
  });

  it("gives the default to each pair that is missing or bad", () => {
    expect(viewStateOf("")).toEqual(DEFAULT_VIEW);
    expect(viewStateOf("#vx=nothing&vy=power&vn=7&vs=-2")).toEqual({ ...DEFAULT_VIEW, y: "power" });
    expect(viewStateOf("#vs=1000000")).toEqual(DEFAULT_VIEW);
  });

  it("opens a design in the builder with its parts, its places and the same view", () => {
    const point = firstChoice(POINTS);
    if (point === undefined) throw new Error("No design fits.");
    const view: ViewState = { ...VIEW, n: 250 };
    const hash = builderHashOf(point, DEMO, SAMPLE_SITE_STATE, view);
    expect(Object.fromEntries(stateOf(hash)?.counts ?? [])).toEqual(Object.fromEntries(point.lines.map((line) => [line.part, line.count])));
    expect(siteStateOf(hash)).toEqual({ ...SAMPLE_SITE_STATE, places: point.places });
    expect(viewStateOf(hash)).toEqual(view);
  });

  it("does not change the machine or the site of a hash", () => {
    const machine = "#cpu-a=1&board-a=1&load=80";
    const hash = `${machine}&${siteHashOf(SAMPLE_SITE_STATE)}&${viewHashOf(VIEW)}`;
    expect(stateOf(hash)).toEqual(stateOf(machine));
    expect(siteStateOf(hash)).toEqual(SAMPLE_SITE_STATE);
  });
});

describe("the text of a design", () => {
  it("names the count of machines and the processor", () => {
    const point = POINTS.find((entry) => entry.places.length === 1);
    if (point !== undefined) expect(nameOf(point)).toMatch(/^1 machine with Processor/);
    const many = POINTS.find((entry) => entry.places.length > 1);
    if (many !== undefined) expect(nameOf(many)).toMatch(new RegExp(`^${String(many.places.length)} machines with `));
  });

  it("counts the copies on each circuit and in each room", () => {
    const point = {
      ...pointOf("a"),
      places: [
        { circuit: 0, room: 0 },
        { circuit: 1, room: 1 },
        { circuit: 1, room: 0 },
      ],
    } satisfies ViewPoint;
    expect(whereOf(point)).toBe("Circuit A: 1, Circuit B: 2 · Room A: 2, Room B: 1");
    expect(whereOf(pointOf("b"))).toBe("Circuit A: 1 · Room A: 1");
  });

  it("gives the sentence of a rule of the package, and the id of another rule", () => {
    expect(ruleSentence("cpu-socket")).toMatch(/socket/);
    expect(ruleSentence("no-such-rule")).toBe("no-such-rule");
  });
});
