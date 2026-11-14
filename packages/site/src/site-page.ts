/**
 * The page code of the site part of the demo. It draws the model of `site-demo.ts`: the copies of the machine of the
 * configurator, two circuits and two rooms. Each change of the visitor gives a new state, and the page checks the site
 * again. The controls stay in the page between two draws, so a slider keeps its drag.
 */
import { SITE_MEASURES, SITE_RULES, type Machine, type SiteFinding, type Verdict } from "@mark1russell7/cluster-design";
import { byId, h } from "@mark1russell7/site-pages/chrome";
import { headlineOf, VERDICT_TEXT } from "./demo.ts";
import {
  BREAKERS,
  CIRCUITS,
  copyId,
  formatUsd,
  MAX_COPIES,
  ROOMS,
  SITE_BOUNDS,
  SITE_PRESETS,
  siteResultOf,
  VOLTAGES,
  type CircuitState,
  type CircuitView,
  type CopyPlace,
  type RoomState,
  type RoomView,
  type SiteResult,
  type SiteState,
} from "./site-demo.ts";

/** This record is the site part of the page: its state, and the function that draws it again. */
export interface SitePage {
  /** This function gives the site state of the page. */
  readonly state: () => SiteState;
  /** This function draws the site again. With a state, the site takes that state first, as for a new hash. */
  readonly draw: (next?: SiteState) => void;
}

/** This record is the input of the site part: the machine of the configurator, the first state and the hook of a change. */
export interface SitePageOptions {
  readonly machine: () => Machine;
  readonly initial: SiteState | undefined;
  readonly changed: () => void;
}

interface Bounds {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

const programs = new Map(SITE_RULES.map((rule) => [rule.id, JSON.stringify(rule.program, null, 1)]));
const sentences = new Map(SITE_MEASURES.map((measure) => [measure.id, measure.sentence]));
const labels = new Map<string, string>([...CIRCUITS, ...ROOMS].map(({ id, label }) => [id, label]));
const LETTERS = ["A", "B"] as const;

const watts = (value: number | undefined): string => (value === undefined ? "–" : `${String(Math.round(value))} W`);
const amps = (value: number | undefined): string => (value === undefined ? "–" : `${value.toFixed(1)} A`);
const decibels = (value: number | undefined): string => (value === undefined ? "–" : `${value.toFixed(1)} dBA`);
const names = (copies: readonly string[]): string => (copies.length === 0 ? "none" : copies.join(", "));
const breaks = (findings: readonly SiteFinding[], rule: string): boolean => findings.some((finding) => finding.rule === rule && finding.verdict === "breaks");

/** This function makes a bar of a value against a limit. The fill is red when its rule breaks. */
function gauge(): { readonly root: HTMLElement; readonly set: (value: number | undefined, limit: number | undefined, over: boolean) => void } {
  const fill = h("span", { class: "meter-fill" });
  const mark = h("span", { class: "meter-limit" });
  return {
    root: h("div", { class: "meter-bar", "aria-hidden": "true" }, fill, mark),
    set: (value, limit, over) => {
      const scale = Math.max(value ?? 0, limit ?? 0, 1);
      fill.style.width = `${String(((value ?? 0) / scale) * 100)}%`;
      fill.dataset["over"] = String(over);
      mark.hidden = limit === undefined;
      if (limit !== undefined) mark.style.left = `${String((limit / scale) * 100)}%`;
    },
  };
}

/** This function makes a stepper of a count in its bounds. */
function stepper(label: string, bounds: Bounds, pick: (value: number) => void): { readonly root: HTMLElement; readonly set: (value: number) => void } {
  const output = h("output", { class: "count" });
  const less = h("button", { class: "step", type: "button", "aria-label": `One less: ${label}` }, "−");
  const more = h("button", { class: "step", type: "button", "aria-label": `One more: ${label}` }, "+");
  let value = bounds.min;
  less.addEventListener("click", () => pick(Math.max(bounds.min, value - bounds.step)));
  more.addEventListener("click", () => pick(Math.min(bounds.max, value + bounds.step)));
  return {
    root: h("div", { class: "stepper" }, less, output, more),
    set: (next) => {
      value = next;
      output.textContent = String(next);
      less.disabled = next <= bounds.min;
      more.disabled = next >= bounds.max;
    },
  };
}

/** This function makes a slider of a number in its bounds, with the text of its value. */
function slider(label: string, bounds: Bounds, text: (value: number) => string, pick: (value: number) => void): { readonly root: HTMLElement; readonly set: (value: number) => void } {
  const input = h("input", { type: "range", min: bounds.min, max: bounds.max, step: bounds.step });
  const shown = h("strong");
  input.addEventListener("input", () => pick(Number(input.value)));
  return {
    root: h("label", { class: "load" }, h("span", {}, `${label}: `, shown), input),
    set: (value) => {
      input.value = String(value);
      shown.textContent = text(value);
    },
  };
}

/** This function makes a select of a list of numbers with a unit. */
function choice(label: string, values: readonly number[], unit: string, pick: (value: number) => void): { readonly root: HTMLElement; readonly set: (value: number) => void } {
  const select = h("select", {}, ...values.map((value) => h("option", { value }, `${String(value)} ${unit}`)));
  select.addEventListener("change", () => pick(Number(select.value)));
  return {
    root: h("label", { class: "field" }, h("span", {}, label), select),
    set: (value) => {
      select.value = String(value);
    },
  };
}

/** This function makes the two buttons A and B of a choice between two circuits or two rooms. */
function pair(label: string, owner: string, pick: (index: 0 | 1) => void): { readonly root: HTMLElement; readonly set: (index: 0 | 1) => void } {
  const buttons = LETTERS.map((letter, index) => {
    const button = h("button", { type: "button", "aria-label": `${owner}: ${label} ${letter}` }, letter);
    button.addEventListener("click", () => pick(index === 1 ? 1 : 0));
    return button;
  });
  return {
    root: h("span", { class: "pair", role: "group", "aria-label": `${label} of ${owner}` }, h("span", { class: "pair-label" }, label), ...buttons),
    set: (index) => {
      buttons.forEach((button, at) => button.setAttribute("aria-pressed", String(at === index)));
    },
  };
}

/** This function sets the chip of the verdict of a circuit or a room. */
function setBadge(badge: HTMLElement, verdict: Verdict): void {
  badge.textContent = VERDICT_TEXT[verdict];
  badge.dataset["verdict"] = verdict;
}

/**
 * This function fills the site part of the page and draws it. The page uses `draw` of the result after each change of
 * the machine.
 *
 * @param options - The machine of the configurator, the state from the hash and the hook of a change
 * @returns The site part of the page
 */
export function mountSite(options: SitePageOptions): SitePage {
  const first = SITE_PRESETS[0];
  if (first === undefined) throw new Error("The demo has no site preset.");
  let state: SiteState = options.initial ?? first.state;
  let presetId: string | undefined = options.initial === undefined ? first.id : undefined;

  const change = (next: SiteState, preset?: string): void => {
    state = next;
    presetId = preset;
    options.changed();
    draw();
  };
  const editCircuit = (index: 0 | 1, edit: Partial<CircuitState>): void => {
    const circuits: [CircuitState, CircuitState] = [state.circuits[0], state.circuits[1]];
    circuits[index] = { ...circuits[index], ...edit };
    change({ ...state, circuits });
  };
  const editRoom = (index: 0 | 1, edit: Partial<RoomState>): void => {
    const rooms: [RoomState, RoomState] = [state.rooms[0], state.rooms[1]];
    rooms[index] = { ...rooms[index], ...edit };
    change({ ...state, rooms });
  };
  const editPlace = (copy: number, edit: Partial<CopyPlace>): void => {
    change({ ...state, places: state.places.map((place, index) => (index === copy ? { ...place, ...edit } : place)) });
  };

  // The presets.
  const presets = byId("site-presets");
  const presetButtons = SITE_PRESETS.map((preset) => {
    const button = h("button", { class: "preset", type: "button" }, preset.label);
    button.addEventListener("click", () => change(preset.state, preset.id));
    presets.append(button);
    return [preset.id, button] as const;
  });

  // The summary: the verdict, the measures of the site and the price.
  const verdict = byId("site-verdict");
  const tiles = [
    { measure: "power", label: "Power from the wall", text: (result: SiteResult) => watts(result.power) },
    { measure: "idle-power", label: "Power at idle", text: (result: SiteResult) => watts(result.idlePower) },
    { measure: "cost", label: "A month at full power", text: (result: SiteResult) => formatUsd(result.cost) },
    { measure: "idle-cost", label: "A month at idle", text: (result: SiteResult) => formatUsd(result.idleCost) },
  ].map((tile) => {
    const value = h("dd");
    byId("site-tiles").append(h("div", { class: "tile", title: sentences.get(tile.measure) ?? "" }, h("dt", {}, tile.label), value));
    return { value, text: tile.text };
  });
  const price = slider("Price of electricity", { min: 1, max: 100, step: 1 }, (cents) => `${String(cents)} ¢/kWh`, (cents) => change({ ...state, price: cents / 100 }));
  byId("site-summary").append(price.root);

  // The machines: a count, and the circuit and the room of each copy.
  const count = stepper("machine", { min: 0, max: MAX_COPIES, step: 1 }, (value) => {
    const last: CopyPlace = state.places.at(-1) ?? { circuit: 0, room: 0 };
    const places = value < state.places.length ? state.places.slice(0, value) : [...state.places, last];
    change({ ...state, places });
  });
  byId("copies-count").append(count.root);
  const copyRows = Array.from({ length: MAX_COPIES }, (_, index) => {
    const owner = copyId(index);
    const circuit = pair("Circuit", owner, (value) => editPlace(index, { circuit: value }));
    const room = pair("Room", owner, (value) => editPlace(index, { room: value }));
    const row = h("li", { class: "copy" }, h("span", { class: "copy-name" }, owner), h("span", { class: "copy-pairs" }, circuit.root, room.root));
    byId("copies").append(row);
    return { row, circuit, room };
  });
  const copiesEmpty = byId("copies-empty");

  // The circuits.
  const circuitCards = ([0, 1] as const).map((index) => {
    const root = byId(`circuit-${String(index)}`);
    const { label } = CIRCUITS[index];
    const badge = h("span", { class: "badge" });
    const voltage = choice("Voltage", VOLTAGES, "V", (value) => editCircuit(index, { voltage: value }));
    const breaker = choice("Breaker", BREAKERS, "A", (value) => editCircuit(index, { breaker: value }));
    const sockets = stepper(`free sockets of ${label}`, SITE_BOUNDS.sockets, (value) => editCircuit(index, { sockets: value }));
    const other = slider("Other loads", SITE_BOUNDS.otherLoad, (value) => watts(value), (value) => editCircuit(index, { otherLoad: value }));
    const load = gauge();
    const loadText = h("p", { class: "gauge-text" });
    const plugText = h("p", { class: "gauge-text" });
    root.append(
      h("div", { class: "card-head" }, h("h3", {}, label), badge),
      h("div", { class: "fields" }, voltage.root, breaker.root, h("div", { class: "field" }, h("span", {}, "Free sockets"), sockets.root)),
      other.root,
      h("p", { class: "gauge-label" }, "Load and limit"),
      load.root,
      loadText,
      plugText,
    );
    return (view: CircuitView): void => {
      const own = view.state;
      setBadge(badge, view.verdict);
      voltage.set(own.voltage);
      breaker.set(own.breaker);
      sockets.set(own.sockets);
      other.set(own.otherLoad);
      load.set(view.load, view.limit, breaks(view.findings, "circuit-load"));
      loadText.textContent =
        view.load === undefined
          ? "The load has no read."
          : `${watts(view.load)} of ${watts(view.limit)}: ${amps(view.current)} on a breaker of ${String(own.breaker)} A. At idle: ${watts(view.idleLoad)}.`;
      loadText.dataset["over"] = String(breaks(view.findings, "circuit-load"));
      plugText.dataset["over"] = String(breaks(view.findings, "circuit-plugs"));
      plugText.textContent = `Sockets: ${String(view.plugs ?? 0)} of ${String(own.sockets)}. Machines: ${names(view.copies)}.`;
    };
  });

  // The rooms.
  const roomCards = ([0, 1] as const).map((index) => {
    const root = byId(`room-${String(index)}`);
    const { label } = ROOMS[index];
    const badge = h("span", { class: "badge" });
    const places = stepper(`places of ${label}`, SITE_BOUNDS.places, (value) => editRoom(index, { places: value }));
    const heatLimit = slider("Heat limit", SITE_BOUNDS.heatLimit, (value) => watts(value), (value) => editRoom(index, { heatLimit: value }));
    const noiseLimit = slider("Noise limit", SITE_BOUNDS.noiseLimit, (value) => `${String(value)} dBA`, (value) => editRoom(index, { noiseLimit: value }));
    const heat = gauge();
    const noise = gauge();
    const heatText = h("p", { class: "gauge-text" });
    const noiseText = h("p", { class: "gauge-text" });
    const placeText = h("p", { class: "gauge-text" });
    root.append(
      h("div", { class: "card-head" }, h("h3", {}, label), badge),
      h("div", { class: "fields" }, h("div", { class: "field" }, h("span", {}, "Places for machines"), places.root)),
      heatLimit.root,
      noiseLimit.root,
      h("p", { class: "gauge-label" }, "Heat and limit"),
      heat.root,
      heatText,
      h("p", { class: "gauge-label" }, "Noise and limit"),
      noise.root,
      noiseText,
      placeText,
    );
    return (view: RoomView): void => {
      const own = view.state;
      const empty = view.copies.length === 0;
      setBadge(badge, view.verdict);
      places.set(own.places);
      heatLimit.set(own.heatLimit);
      noiseLimit.set(own.noiseLimit);
      heat.set(view.heat, own.heatLimit, breaks(view.findings, "room-heat"));
      noise.set(empty ? 0 : view.noise, own.noiseLimit, breaks(view.findings, "room-noise"));
      heatText.textContent = view.heat === undefined ? "The heat has no read." : `${watts(view.heat)} of ${watts(own.heatLimit)}. At idle: ${watts(view.idleHeat)}.`;
      noiseText.textContent = empty ? "No machine makes a sound here." : `${decibels(view.noise)} at 1 m, of ${String(own.noiseLimit)} dBA.`;
      heatText.dataset["over"] = String(breaks(view.findings, "room-heat"));
      noiseText.dataset["over"] = String(breaks(view.findings, "room-noise"));
      placeText.dataset["over"] = String(breaks(view.findings, "room-places"));
      placeText.textContent = `Places: ${String(view.machines ?? view.copies.length)} of ${String(own.places)}. Machines: ${names(view.copies)}.`;
    };
  });

  // The site rules.
  const rules = byId("site-rules");
  const only = byId<HTMLInputElement>("site-only");
  only.addEventListener("change", () => draw());

  function drawRules(result: SiteResult): void {
    rules.replaceChildren();
    for (const finding of result.findings) {
      if (only.checked && finding.verdict === "fits") continue;
      const where = labels.get(finding.id) ?? finding.id;
      const body = h(
        "div",
        { class: "rule-body" },
        h("p", { class: "rule-id" }, `Rule ${finding.rule} at ${where}`),
        finding.detail !== undefined && h("p", { class: "detail" }, finding.detail),
        h("p", { class: "rule-label" }, "Its Vex program:"),
        h("pre", { class: "program" }, programs.get(finding.rule) ?? ""),
      );
      const summary = h("summary", {}, h("span", { class: "chip" }, VERDICT_TEXT[finding.verdict]), h("span", { class: "sentence" }, `${where}: ${finding.sentence}`));
      rules.append(h("li", { class: `rule ${finding.verdict}` }, h("details", {}, summary, body)));
    }
    if (rules.childElementCount === 0) rules.append(h("li", { class: "rule empty" }, "Each rule fits."));
  }

  function draw(next?: SiteState): void {
    if (next !== undefined) {
      state = next;
      presetId = undefined;
    }
    const result = siteResultOf(options.machine(), state);
    verdict.textContent = headlineOf(result, "The site fits");
    verdict.dataset["verdict"] = result.verdict;
    tiles.forEach((tile) => {
      tile.value.textContent = tile.text(result);
    });
    price.set(Math.round(state.price * 100));
    count.set(state.places.length);
    copyRows.forEach(({ row, circuit, room }, index) => {
      const place = state.places[index];
      row.hidden = place === undefined;
      if (place === undefined) return;
      circuit.set(place.circuit);
      room.set(place.room);
    });
    copiesEmpty.hidden = state.places.length > 0;
    result.circuits.forEach((view, index) => circuitCards[index]?.(view));
    result.rooms.forEach((view, index) => roomCards[index]?.(view));
    drawRules(result);
    for (const [id, button] of presetButtons) button.setAttribute("aria-pressed", String(id === presetId));
    byId("site-preset-sentence").textContent = SITE_PRESETS.find((preset) => preset.id === presetId)?.sentence ?? "Your own site.";
  }

  draw();
  return { state: () => state, draw };
}
