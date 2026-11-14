import { FIT_RULES, MACHINE_MEASURES } from "@mark1russell7/cluster-design";
import { byId, copyText, setupTheme } from "@mark1russell7/site-pages/chrome";
import {
  CLASS_LABELS,
  factsOf,
  formatMeasure,
  hashOf,
  headlineOf,
  machineOf,
  MAX_COUNT,
  partsByClass,
  PRESETS,
  resultOf,
  stateOf,
  TILE_LABELS,
  VERDICT_TEXT,
  type DemoResult,
  type DemoState,
} from "./demo.ts";
import { siteHashOf, siteStateOf } from "./site-demo.ts";
import { mountSite } from "./site-page.ts";

setupTheme(byId<HTMLButtonElement>("theme"), "theme");

const copy = byId<HTMLButtonElement>("copy");
copy.addEventListener("click", () => {
  void copyText(copy, byId("install").textContent ?? "");
});

const first = PRESETS[0];
if (first === undefined) throw new Error("The demo has no preset.");

let state: DemoState = stateOf(location.hash) ?? first.state;
let presetId: string | undefined = stateOf(location.hash) === undefined ? first.id : undefined;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const programs = new Map(FIT_RULES.map((rule) => [rule.id, JSON.stringify(rule.program, null, 1)]));

const presets = byId("presets");
const presetButtons = PRESETS.map((preset) => {
  const button = el("button", "preset", preset.label);
  button.type = "button";
  button.addEventListener("click", () => {
    presetId = preset.id;
    update(preset.state);
  });
  presets.append(button);
  return [preset.id, button] as const;
});

const counters = new Map<string, { readonly output: HTMLOutputElement; readonly less: HTMLButtonElement; readonly more: HTMLButtonElement; readonly row: HTMLElement }>();
const partsRoot = byId("parts");
for (const [name, parts] of partsByClass()) {
  const group = el("fieldset", "group");
  group.append(el("legend", undefined, CLASS_LABELS[name]));
  for (const part of parts) {
    const row = el("div", "part");
    const text = el("div", "part-text");
    text.append(el("span", "part-name", part.name), el("span", "part-facts", factsOf(part).join(" · ")));
    const stepper = el("div", "stepper");
    const less = el("button", "step", "−");
    const more = el("button", "step", "+");
    const output = el("output", "count");
    less.type = "button";
    more.type = "button";
    less.setAttribute("aria-label", `One less: ${part.name}`);
    more.setAttribute("aria-label", `One more: ${part.name}`);
    const step = (delta: number) => {
      const counts = new Map(state.counts);
      counts.set(part.id, Math.min(MAX_COUNT, Math.max(0, (counts.get(part.id) ?? 0) + delta)));
      presetId = undefined;
      update({ ...state, counts });
    };
    less.addEventListener("click", () => step(-1));
    more.addEventListener("click", () => step(1));
    stepper.append(less, output, more);
    row.append(text, stepper);
    group.append(row);
    counters.set(part.id, { output, less, more, row });
  }
  partsRoot.append(group);
}

const load = byId<HTMLInputElement>("load");
load.addEventListener("input", () => {
  presetId = undefined;
  update({ ...state, psuLoad: Number(load.value) / 100 });
});

const only = byId<HTMLInputElement>("only");
only.addEventListener("change", () => draw(resultOf(state)));

const watts = (value: number) => `${String(Math.round(value))} W`;

function drawMeter(result: DemoResult): void {
  const fill = byId("meter-fill");
  const limit = byId("meter-limit");
  const text = byId("meter-text");
  const { power, limit: cap, output } = result;
  if (power === undefined || cap === undefined || output === undefined) {
    fill.style.width = "0";
    limit.hidden = true;
    text.textContent = power === undefined ? "The power has no read." : `The parts take up to ${watts(power)}. The machine has no power supply.`;
    return;
  }
  const scale = Math.max(output, power);
  fill.style.width = `${String((power / scale) * 100)}%`;
  fill.dataset["over"] = String(power > cap);
  limit.hidden = false;
  limit.style.left = `${String((cap / scale) * 100)}%`;
  text.textContent = `The parts take up to ${watts(power)}. The limit is ${watts(cap)}, ${String(Math.round(state.psuLoad * 100))} percent of ${watts(output)}.`;
}

const sentences = new Map(MACHINE_MEASURES.map((measure) => [measure.id, measure.sentence]));

function drawTiles(result: DemoResult): void {
  const tiles = byId("tiles");
  tiles.replaceChildren();
  for (const [id, label] of Object.entries(TILE_LABELS)) {
    const value = result.measures.find((entry) => entry.measure === id);
    if (value === undefined) continue;
    const tile = el("div", "tile");
    tile.title = value.detail ?? sentences.get(id) ?? "";
    tile.append(el("dt", undefined, label), el("dd", undefined, formatMeasure(value)));
    tiles.append(tile);
  }
}

function drawRules(result: DemoResult): void {
  const list = byId("rules");
  list.replaceChildren();
  for (const finding of result.findings) {
    if (only.checked && finding.verdict === "fits") continue;
    const item = el("li", `rule ${finding.verdict}`);
    const details = el("details");
    const summary = el("summary");
    summary.append(el("span", "chip", VERDICT_TEXT[finding.verdict]), el("span", "sentence", finding.sentence));
    details.append(summary);
    const body = el("div", "rule-body");
    body.append(el("p", "rule-id", `Rule ${finding.rule}`));
    if (finding.detail !== undefined) body.append(el("p", "detail", finding.detail));
    body.append(el("p", "rule-label", "Its Vex program:"), el("pre", "program", programs.get(finding.rule) ?? ""));
    details.append(body);
    item.append(details);
    list.append(item);
  }
  if (list.childElementCount === 0) list.append(el("li", "rule empty", "Each rule fits."));
}

function draw(result: DemoResult): void {
  const verdict = byId("verdict");
  verdict.textContent = headlineOf(result);
  verdict.dataset["verdict"] = result.verdict;
  drawMeter(result);
  drawTiles(result);
  drawRules(result);
  byId("load-value").textContent = `${String(Math.round(state.psuLoad * 100))}%`;
  load.value = String(Math.round(state.psuLoad * 100));
  for (const [id, counter] of counters) {
    const count = state.counts.get(id) ?? 0;
    counter.output.textContent = String(count);
    counter.less.disabled = count === 0;
    counter.more.disabled = count >= MAX_COUNT;
    counter.row.classList.toggle("chosen", count > 0);
  }
  for (const [id, button] of presetButtons) button.setAttribute("aria-pressed", String(id === presetId));
  byId("preset-sentence").textContent = PRESETS.find((preset) => preset.id === presetId)?.sentence ?? "Your own machine.";
}

// The site part follows the machine of the configurator. The hash holds the machine, then the site.
const site = mountSite({
  machine: () => machineOf(state),
  initial: siteStateOf(location.hash),
  changed: () => writeHash(),
});

function writeHash(): void {
  history.replaceState(null, "", `${hashOf(state)}&${siteHashOf(site.state())}`);
}

function update(next: DemoState): void {
  state = next;
  writeHash();
  draw(resultOf(state));
  site.draw();
}

window.addEventListener("hashchange", () => {
  const read = stateOf(location.hash);
  if (read === undefined) return;
  state = read;
  presetId = undefined;
  draw(resultOf(state));
  site.draw(siteStateOf(location.hash));
});

draw(resultOf(state));
