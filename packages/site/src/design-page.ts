/**
 * The page code of the view of the design space. It sends each sweep to a worker, so the page stays live. It draws the
 * designs of the result as a chart of two goals, with the front of those goals. It also shows the chosen design and a
 * list of the front. A visitor opens a design in the builder above with one click.
 */
import { byId, h } from "@mark1russell7/site-pages/chrome";
import { CATALOG, CLASS_LABELS, VERDICT_TEXT, workText, type DemoState } from "./demo.ts";
import { CIRCUITS, ROOMS, type SiteState } from "./site-demo.ts";
import {
  axesOf,
  axisOf,
  breakCounts,
  builderHashOf,
  countsOf,
  firstChoice,
  frontLine,
  frontOn,
  MAX_SEED,
  nameOf,
  ruleSentence,
  SAMPLE_SIZES,
  sweepView,
  viewInputOf,
  type Axis,
  type AxisId,
  type ViewPoint,
  type ViewResult,
  type ViewState,
  whereOf,
  withWork,
} from "./design-view.ts";
import type { SweepAnswer, SweepRequest } from "./design-worker.ts";

/** This record is the view part of the page: its state, and the function that takes a change of its input. */
export interface DesignPage {
  /** This function gives the view state of the page. */
  readonly state: () => ViewState;
  /** This function starts a new sweep when the input changed. With a state, the view takes that state first. */
  readonly update: (next?: ViewState) => void;
}

/** This record is the input of the view part: the state of the demos above, the first state and two hooks. */
export interface DesignPageOptions {
  readonly inputs: () => { readonly demo: DemoState; readonly site: SiteState };
  readonly initial: ViewState;
  /** The hook of a change of the view state, for the hash of the address. */
  readonly changed: () => void;
  /** The hook that opens a design in the builder, with the hash of the design. */
  readonly open: (hash: string) => void;
}

const SVG = "http://www.w3.org/2000/svg";
const MARGIN = { left: 52, right: 30, top: 10, bottom: 26 } as const;
/** The largest distance in pixels from the pointer to a design that the pointer finds. */
const REACH = 24;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string | number>> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** This record is the scale of one axis: its bounds and its ticks. */
interface Scale {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly ticks: readonly number[];
}

/** This function gives a scale with round ticks that holds each value. A goal of whole numbers gets whole ticks. */
function scaleOf(values: readonly number[], whole: boolean): Scale {
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (!Number.isFinite(low) || !Number.isFinite(high)) [low, high] = [0, 1];
  if (low === high) [low, high] = [low - 1, high + 1];
  const raw = (high - low) / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const step = Math.max((unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power, whole ? 1 : 0);
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return { min, max, step, ticks };
}

/** This function gives the text of a tick. A cost has a dollar sign, and the axis title gives each other unit. */
function tickText(axis: Axis, value: number, step: number): string {
  const digits = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  const text = value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return axis.unit === "USD" ? `$${text}` : text;
}

const goalText = (axis: Axis): string => (axis.goal === "min" ? "less is better" : "more is better");
/** This function gives the title of an axis. A label that ends with the unit gets no unit in brackets. */
const titleOf = (axis: Axis): string => `${axis.label}${axis.label.toLowerCase().endsWith(axis.unit.toLowerCase()) ? "" : ` (${axis.unit})`}, ${goalText(axis)}`;
const ruleLabel = (rule: string): string => rule.replaceAll("-", " ");
const placeText = (point: ViewPoint, index: number): string => {
  const place = point.places[index];
  return place === undefined ? "" : `Machine ${String(index + 1)}: ${CIRCUITS[place.circuit].label}, ${ROOMS[place.room].label}`;
};

/** This record is a select of the page: its root, the function that sets its value and the function that sets its options. */
interface Choice<T extends string> {
  readonly root: HTMLElement;
  readonly set: (value: T) => void;
  readonly options: (options: readonly (readonly [T, string])[]) => void;
}

/** This function makes a select of the page, with a label above it. */
function choice<T extends string>(label: string, first: readonly (readonly [T, string])[], pick: (value: T) => void): Choice<T> {
  let current = first;
  const select = h("select", {});
  const fill = (options: readonly (readonly [T, string])[]): void => {
    current = options;
    select.replaceChildren(...options.map(([value, text]) => h("option", { value }, text)));
  };
  fill(first);
  select.addEventListener("change", () => {
    const found = current.find(([value]) => value === select.value);
    if (found !== undefined) pick(found[0]);
  });
  return {
    root: h("label", { class: "field" }, h("span", {}, label), select),
    set: (value) => {
      select.value = value;
    },
    options: fill,
  };
}

/** This function gives the options of an axis select: each goal of a view with or without the split of work. */
const axisOptionsOf = (work: boolean): readonly (readonly [AxisId, string])[] => axesOf(work).map((axis) => [axis.id, axis.label] as const);

/** This function gives a text with its first letter in upper case. */
const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** This function makes a mark of the legend: a small chart of one kind of mark. */
function legendMark(kind: "front" | "fits" | "breaks"): SVGSVGElement {
  const root = svg("svg", { viewBox: "0 0 22 12", "aria-hidden": "true" });
  if (kind === "front") root.append(svg("path", { class: "front-line", d: "M1 6 H21" }), svg("circle", { class: "dot-front", cx: 11, cy: 6, r: 4.5 }));
  if (kind === "fits") root.append(svg("circle", { class: "dot-fits", cx: 11, cy: 6, r: 4 }));
  if (kind === "breaks") root.append(svg("circle", { class: "dot-breaks", cx: 11, cy: 6, r: 3.5 }));
  return root;
}

/**
 * This function mounts the view of the design space on the page. The page has the elements with the ids
 * `design-controls`, `design-status`, `design-legend`, `design-chart`, `design-detail` and `design-front`.
 *
 * @param options - The input of the demos above, the first state and the hooks
 * @returns The view part of the page
 */
export function mountDesigns(options: DesignPageOptions): DesignPage {
  let state: ViewState = options.initial;
  let result: ViewResult | undefined;
  let chosen: string | undefined;
  let hover: string | undefined;
  let showBreaks = true;
  let worker: Worker | undefined;
  let ticket = 0;
  let pending = false;
  let lastKey = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let drawn: readonly { readonly point: ViewPoint; readonly x: number; readonly y: number }[] = [];

  const change = (next: ViewState): void => {
    state = next;
    options.changed();
  };

  // The controls: the two goals, the count of designs, a new draw, the designs that break and the split of work.
  let shownWork = state.work;
  const across = choice<AxisId>("Across", axisOptionsOf(shownWork), (x) => {
    change({ ...state, x, y: x === state.y ? state.x : state.y });
    draw();
  });
  const up = choice<AxisId>("Up", axisOptionsOf(shownWork), (y) => {
    change({ ...state, y, x: y === state.x ? state.y : state.x });
    draw();
  });
  const sizes = choice<string>(
    "Count of designs",
    SAMPLE_SIZES.map((n) => [String(n), `${String(n)} designs`] as const),
    (value) => {
      change({ ...state, n: Number(value) });
      schedule(0);
    },
  );
  const again = h("button", { type: "button" }, "Draw other designs");
  again.addEventListener("click", () => {
    change({ ...state, seed: (state.seed % MAX_SEED) + 1 });
    schedule(0);
  });
  const breaksBox = h("input", { type: "checkbox", checked: true });
  breaksBox.addEventListener("change", () => {
    showBreaks = breaksBox.checked;
    drawChart();
  });
  const workBox = h("input", { type: "checkbox", checked: state.work });
  workBox.addEventListener("change", () => {
    change(withWork(state, workBox.checked));
    schedule(0);
    draw();
  });
  byId("design-controls").append(
    across.root,
    up.root,
    sizes.root,
    again,
    h("label", { class: "check" }, breaksBox, "Show the designs that break a rule"),
    h("label", { class: "check" }, workBox, "Give each new machine sessions and services next to its CI jobs"),
  );

  byId("design-legend").append(
    h("li", {}, legendMark("front"), "The front"),
    h("li", {}, legendMark("fits"), "Other designs that fit"),
    h("li", {}, legendMark("breaks"), "Designs that break a rule"),
  );

  // The chart: a title of each goal, the plot and the tip of the pointer.
  const chartRoot = byId("design-chart");
  const upTitle = h("p", { class: "axis-title" });
  const acrossTitle = h("p", { class: "axis-title across" });
  const plot = svg("svg", { role: "img" });
  const tip = h("div", { class: "chart-tip", hidden: true });
  chartRoot.append(upTitle, plot, acrossTitle, tip);

  const points = (): readonly ViewPoint[] => (result?.ok === true ? result.points : []);
  const find = (id: string | undefined): ViewPoint | undefined => points().find((point) => point.id === id);

  const nearest = (event: PointerEvent): ViewPoint | undefined => {
    const box = plot.getBoundingClientRect();
    const scale = box.width === 0 ? 1 : plot.viewBox.baseVal.width / box.width;
    const x = (event.clientX - box.left) * scale;
    const y = (event.clientY - box.top) * scale;
    let best: { readonly point: ViewPoint; readonly distance: number } | undefined;
    for (const mark of drawn) {
      const distance = Math.hypot(mark.x - x, mark.y - y);
      if (distance <= REACH * scale && (best === undefined || distance <= best.distance)) best = { point: mark.point, distance };
    }
    return best?.point;
  };
  plot.addEventListener("pointermove", (event) => {
    const found = nearest(event)?.id;
    if (found === hover) return;
    hover = found;
    drawChart();
  });
  plot.addEventListener("pointerleave", () => {
    hover = undefined;
    drawChart();
  });
  plot.addEventListener("click", (event) => {
    const found = nearest(event);
    if (found === undefined) return;
    chosen = found.id;
    draw();
  });
  new ResizeObserver(() => drawChart()).observe(chartRoot);

  function drawChart(): void {
    const x = axisOf(state.x);
    const y = axisOf(state.y);
    upTitle.textContent = `Up: ${titleOf(y)}`;
    acrossTitle.textContent = `Across: ${titleOf(x)}`;
    const front = frontOn(points(), x, y);
    const shown = points().filter((point) => (point.status === "fits" || (showBreaks && point.status === "breaks")) && point.values[x.id] !== undefined && point.values[y.id] !== undefined);
    const width = Math.max(280, Math.round(chartRoot.clientWidth || 640));
    const height = width < 520 ? 280 : 340;
    plot.setAttribute("viewBox", `0 0 ${String(width)} ${String(height)}`);
    plot.setAttribute("width", String(width));
    plot.setAttribute("height", String(height));
    const fits = shown.filter((point) => point.status === "fits").length;
    plot.setAttribute("aria-label", `A chart of ${String(shown.length)} designs, ${String(fits)} of them fit. ${String(front.size)} designs are on the front. The list of the front below gives their values.`);
    plot.replaceChildren();
    if (shown.length === 0) {
      drawn = [];
      tip.hidden = true;
      return;
    }
    const sx = scaleOf(shown.map((point) => point.values[x.id] ?? 0), x.unit === "slots");
    const sy = scaleOf(shown.map((point) => point.values[y.id] ?? 0), y.unit === "slots");
    const left = MARGIN.left;
    const right = width - MARGIN.right;
    const top = MARGIN.top;
    const bottom = height - MARGIN.bottom;
    const px = (value: number): number => left + ((value - sx.min) / (sx.max - sx.min)) * (right - left);
    const py = (value: number): number => bottom - ((value - sy.min) / (sy.max - sy.min)) * (bottom - top);

    const grid = svg("g", { "aria-hidden": "true" });
    for (const tick of sy.ticks) {
      grid.append(svg("line", { class: "grid", x1: left, x2: right, y1: py(tick), y2: py(tick) }));
      const label = svg("text", { class: "tick", x: left - 6, y: py(tick), "text-anchor": "end", "dominant-baseline": "middle" });
      label.textContent = tickText(y, tick, sy.step);
      grid.append(label);
    }
    const every = Math.max(1, Math.ceil(sx.ticks.length / Math.max(2, Math.floor((right - left) / 64))));
    sx.ticks.forEach((tick, index) => {
      grid.append(svg("line", { class: "grid", x1: px(tick), x2: px(tick), y1: top, y2: bottom }));
      if (index % every !== 0) return;
      const label = svg("text", { class: "tick", x: px(tick), y: bottom + 16, "text-anchor": "middle" });
      label.textContent = tickText(x, tick, sx.step);
      grid.append(label);
    });
    plot.append(grid);

    const order = (point: ViewPoint): number => (front.has(point.id) ? 2 : point.status === "fits" ? 1 : 0);
    const marks = [...shown].sort((a, b) => order(a) - order(b)).map((point) => ({ point, x: px(point.values[x.id] ?? 0), y: py(point.values[y.id] ?? 0) }));
    const dots = svg("g", { "aria-hidden": "true" });
    for (const mark of marks.filter((entry) => order(entry.point) < 2)) {
      const fitsMark = mark.point.status === "fits";
      dots.append(svg("circle", { class: fitsMark ? "dot-fits" : "dot-breaks", cx: mark.x, cy: mark.y, r: fitsMark ? 4 : 3.5 }));
    }
    const line = frontLine(
      shown.filter((point) => front.has(point.id)),
      x,
      y,
    );
    if (line.length > 1) dots.append(svg("path", { class: "front-line", d: line.map(([vx, vy], index) => `${index === 0 ? "M" : "L"}${px(vx).toFixed(1)} ${py(vy).toFixed(1)}`).join(" ") }));
    for (const mark of marks.filter((entry) => order(entry.point) === 2)) dots.append(svg("circle", { class: "dot-front", cx: mark.x, cy: mark.y, r: 5.5 }));
    const ring = (id: string | undefined, className: string, r: number): void => {
      const mark = marks.find((entry) => entry.point.id === id);
      if (mark !== undefined) dots.append(svg("circle", { class: className, cx: mark.x, cy: mark.y, r }));
    };
    ring(chosen, "dot-chosen", 9);
    if (hover !== chosen) ring(hover, "dot-hover", 8.5);
    plot.append(dots);
    drawn = marks;
    drawTip(marks.find((entry) => entry.point.id === hover), x, y, width);
  }

  function drawTip(mark: { readonly point: ViewPoint; readonly x: number; readonly y: number } | undefined, x: Axis, y: Axis, width: number): void {
    if (mark === undefined) {
      tip.hidden = true;
      return;
    }
    const { point } = mark;
    const value = (axis: Axis): HTMLElement => {
      const number = point.values[axis.id];
      return h("div", {}, h("strong", {}, number === undefined ? "–" : axis.format(number)), ` ${axis.label}`);
    };
    const status = point.status === "breaks" ? `Breaks: ${point.breaks.map(ruleLabel).join(", ")}` : VERDICT_TEXT[point.status];
    tip.replaceChildren(value(y), value(x), h("div", { class: "tip-quiet" }, nameOf(point)), h("div", { class: "tip-quiet" }, whereOf(point)), h("div", { class: "tip-quiet" }, status));
    const box = plot.getBoundingClientRect();
    const root = chartRoot.getBoundingClientRect();
    const scale = width === 0 ? 1 : box.width / width;
    // The tip is visible before the measure, so its width is the width of its text.
    tip.hidden = false;
    const half = Math.min(box.width / 2, tip.offsetWidth / 2 + 4);
    tip.style.left = `${String(box.left - root.left + Math.min(Math.max(mark.x * scale, half), box.width - half))}px`;
    tip.style.top = `${String(box.top - root.top + mark.y * scale)}px`;
    tip.hidden = false;
  }

  // The chosen design: its verdict, its values, its parts, its places, the rules that break and the button to open it.
  const detail = byId("design-detail");
  function drawDetail(): void {
    const point = find(chosen);
    if (point === undefined) {
      detail.replaceChildren(h("h3", {}, "The chosen design"), h("p", { class: "tiles-note" }, "Choose a design in the chart or in the list of the front."));
      return;
    }
    const open = h("button", { type: "button", class: "open" }, "Open it in the builder");
    open.addEventListener("click", () => {
      const { demo, site } = options.inputs();
      options.open(builderHashOf(point, demo, site, state));
    });
    const tiles = h(
      "dl",
      { class: "tiles" },
      axesOf(state.work).map((axis) => {
        const number = point.values[axis.id];
        return h("div", { class: "tile" }, h("dt", {}, axis.label), h("dd", {}, number === undefined ? "–" : axis.format(number)));
      }),
    );
    const parts = point.lines.map((line) => {
      const part = CATALOG.get(line.part);
      return h("li", {}, `${part === undefined ? line.part : CLASS_LABELS[part.class]}: ${String(line.count)} × ${part?.name ?? line.part}`);
    });
    const broken =
      point.breaks.length === 0
        ? []
        : [
            h("h4", {}, "The rules that break"),
            h(
              "ul",
              {},
              point.breaks.map((rule) => h("li", {}, ruleSentence(rule))),
            ),
          ];
    detail.replaceChildren(
      h("div", { class: "card-head" }, h("h3", {}, "The chosen design"), h("span", { class: point.status }, h("span", { class: "chip" }, VERDICT_TEXT[point.status]))),
      h("p", { class: "detail-name" }, nameOf(point)),
      tiles,
      h("h4", {}, "The parts of each machine"),
      h("ul", {}, parts),
      ...(state.work ? [h("h4", {}, "The other work of each machine"), h("p", {}, capitalize(workText(point.work)))] : []),
      h("h4", {}, "The places"),
      h(
        "ul",
        {},
        point.places.map((_, index) => h("li", {}, placeText(point, index))),
      ),
      ...broken,
      open,
    );
  }

  // The list of the front, in the order of the goal across. It is the table view of the chart.
  const frontList = byId("design-front");
  function drawFront(): void {
    const x = axisOf(state.x);
    const y = axisOf(state.y);
    const front = frontOn(points(), x, y);
    const rows = points()
      .filter((point) => front.has(point.id))
      .sort((a, b) => (a.values[x.id] ?? 0) - (b.values[x.id] ?? 0));
    frontList.replaceChildren(
      ...rows.map((point) => {
        const button = h(
          "button",
          { type: "button", class: "front-item", "aria-pressed": String(point.id === chosen) },
          h("span", { class: "front-values" }, h("strong", {}, x.format(point.values[x.id] ?? 0)), ` ${x.label} · `, h("strong", {}, y.format(point.values[y.id] ?? 0)), ` ${y.label}`),
          h("span", { class: "front-name" }, `${nameOf(point)} · ${whereOf(point)}`),
        );
        button.addEventListener("click", () => {
          chosen = point.id;
          draw();
        });
        return h("li", {}, button);
      }),
    );
    if (rows.length === 0) frontList.append(h("li", { class: "tiles-note" }, "No design fits, so the front is empty."));
  }

  const status = byId("design-status");
  function drawStatus(): void {
    if (pending) {
      status.textContent = `The worker checks ${String(state.n)} designs…`;
      return;
    }
    if (result === undefined) return;
    if (!result.ok) {
      status.textContent = `The search has a problem: ${result.problems.join(" ")}`;
      return;
    }
    const counts = countsOf(result.points);
    const front = frontOn(result.points, axisOf(state.x), axisOf(state.y));
    const most = breakCounts(result.points)
      .slice(0, 3)
      .map(([rule, count]) => `${ruleLabel(rule)} (${String(count)})`);
    const unread = counts.unread > 0 ? `, ${String(counts.unread)} have no read` : "";
    status.textContent =
      `${String(result.draws)} draws gave ${String(result.points.length)} different designs: ${String(counts.fits)} fit, ${String(counts.breaks)} break a rule${unread}. ` +
      `${String(front.size)} are on the front of these two goals.` +
      (most.length > 0 ? ` The rules that break the most designs: ${most.join(", ")}.` : "");
  }

  function draw(): void {
    if (shownWork !== state.work) {
      shownWork = state.work;
      across.options(axisOptionsOf(shownWork));
      up.options(axisOptionsOf(shownWork));
    }
    workBox.checked = state.work;
    across.set(state.x);
    up.set(state.y);
    sizes.set(String(state.n));
    chartRoot.dataset["busy"] = String(pending);
    drawStatus();
    drawChart();
    drawDetail();
    drawFront();
  }

  function finish(next: ViewResult): void {
    pending = false;
    result = next;
    if (find(chosen) === undefined) chosen = next.ok ? firstChoice(next.points)?.id : undefined;
    draw();
  }

  function makeWorker(): Worker | undefined {
    if (typeof Worker === "undefined") return undefined;
    const made = new Worker(new URL("./design-worker.ts", import.meta.url), { type: "module" });
    made.addEventListener("message", (event: MessageEvent<SweepAnswer>) => {
      if (event.data.ticket === ticket) finish(event.data.result);
    });
    made.addEventListener("error", (event) => {
      if (pending) finish({ ok: false, problems: [event.message || "The worker stopped."] });
    });
    return made;
  }

  function start(): void {
    const { demo, site } = options.inputs();
    const input = viewInputOf(site, demo.psuLoad, state);
    const key = JSON.stringify(input);
    if (key === lastKey) return;
    lastKey = key;
    ticket += 1;
    if (pending && worker !== undefined) {
      worker.terminate();
      worker = undefined;
    }
    pending = true;
    draw();
    worker ??= makeWorker();
    if (worker === undefined) {
      const mine = ticket;
      setTimeout(() => {
        if (mine === ticket) finish(sweepView(input));
      }, 0);
      return;
    }
    const request: SweepRequest = { ticket, input };
    worker.postMessage(request);
  }

  function schedule(delay = 300): void {
    clearTimeout(timer);
    timer = setTimeout(start, delay);
  }

  draw();
  schedule(0);
  return {
    state: () => state,
    update: (next) => {
      if (next !== undefined) {
        state = next;
        draw();
      }
      schedule();
    },
  };
}
