/**
 * The cost of a design: the price of the parts to buy, and the cost of the electricity over a horizon. The prices are
 * input data. The best offer of each part in `@mark1russell7/market` can give them, but this package reads no seller.
 *
 * The purchase takes the parts from a pool. The machines that the user owns already need no part. The other machines
 * take their parts from the stock first, and the user buys the rest. Each program is a Vex program, and the prices,
 * the stock and the owned machines are variables of the evaluation.
 */
import { quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import { quantitySchema } from "@mark1russell7/quantity/schema";
import { app, axes, each, let_, lit, parent, ref, v, vexList, type Axis, type Expr, type VexList } from "@mark1russell7/vex";
import { z } from "zod";
import type { Measure } from "./measure.ts";
import type { Machine, PartLine } from "./machine.ts";
import type { Part } from "./parts.ts";
import { contains, STRICT, totalOfCount } from "./program.ts";
import { SITE_COST, SITE_IDLE_COST, SITE_RUNNER_SLOTS, type SiteMeasure } from "./site-formulas.ts";

/** The format of a price list. */
export const PRICES_FORMAT = "prices/1";

/** The currency of the prices. The programs add the prices and the cost of the electricity, so both use this currency. */
export const PRICE_UNIT = "USD";

/** This record is the price of one part: the id of the part in the catalog, its price, and the source of the price. */
export interface PriceLine {
  readonly part: string;
  readonly price: Quantity;
  /** The source of the price, for example the id of an offer or the address of a page. */
  readonly source?: string;
}

/** This record is a price list: the price of each part to buy. */
export interface PriceList {
  readonly format: typeof PRICES_FORMAT;
  readonly prices: readonly PriceLine[];
}

const id = z.string().trim().min(1);

/** This schema accepts a price list. A price is an amount of money in `USD`, and a field that the list does not have is a problem. */
export const priceListSchema: z.ZodType<PriceList> = z.strictObject({
  format: z.literal(PRICES_FORMAT),
  prices: z.array(z.strictObject({ part: id, price: quantitySchema("money", { nonnegative: true }), source: id.optional() })),
}) as unknown as z.ZodType<PriceList>;

/** This record is a price list, or the problems of the data. */
export type PriceListResult = { readonly ok: true; readonly value: PriceList } | { readonly ok: false; readonly problems: readonly string[] };

const issuesOf = (error: z.ZodError, what: string): string[] =>
  error.issues.map((issue) => `${what} is not valid${issue.path.length === 0 ? "" : ` at ${issue.path.join(".")}`}: ${issue.message}.`);

/**
 * This function reads a price list from data. Each issue of the schema gives one problem with its path.
 *
 * @param value - The price list as data
 * @returns The price list, or the problems
 */
export function readPrices(value: unknown): PriceListResult {
  const parsed = priceListSchema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, problems: issuesOf(parsed.error, "The price list") };
}

/** The name of the variable that holds the price of each part, as a Vex list by the id of the part. */
export const PRICES = "prices";

/** The name of the variable that holds the count of each part in stock, as a Vex list by the id of the part. */
export const STOCK = "stock";

/** The name of the variable that holds the ids of the machines that the user owns already. */
export const OWNED = "owned";

/** The name of the variable that holds the horizon of the cost, in months. */
export const HORIZON = "horizon";

/** The name of the variable that holds the busy share: the share of the time that each machine takes its most power. */
export const BUSY = "busy";

/** The default horizon of the cost: 36 months, the term of a common warranty of a computer. */
export const DEFAULT_HORIZON: Quantity = quantity(36, "mo");

/**
 * The default busy share: 1. Thus each machine takes its most power at each hour, and the cost of the electricity is a
 * bound, not an estimate.
 */
export const DEFAULT_BUSY = 1;

/** These options give the input of the cost of a design. */
export interface CostOptions {
  /** The price of each part to buy. A part with no price gives no cost. */
  readonly prices?: PriceList;
  /** The spare parts that the user has. A part line here is free for a machine that is not owned. */
  readonly stock?: readonly PartLine[];
  /** The ids of the machines that the user owns already. The purchase has no part of these machines. */
  readonly owned?: readonly string[];
  /** The horizon of the cost of the electricity. The default is `DEFAULT_HORIZON`. */
  readonly horizon?: Quantity;
  /** The share of the time that each machine takes its most power, from 0 to 1. The default is `DEFAULT_BUSY`. */
  readonly busy?: number;
}

const listOf = (values: ReadonlyMap<string, unknown>): VexList =>
  vexList([...values].map(([key, value]) => ({ key, result: { ok: true as const, value } })));

const timeSchema = quantitySchema("time", { nonnegative: true });
const stockSchema = z.array(z.strictObject({ part: id, count: z.number().int().positive() }));

/**
 * This function gives the problems of the cost options of a design, and the variables of the cost programs. The stock
 * has an item for each part of the catalog, with 0 for a part that the stock does not have. Two stock lines of one part
 * add their counts.
 *
 * @param options - The cost options, or no options
 * @param catalog - The parts by their ids
 * @param machines - The machines of the design
 * @returns The problems, and the variables
 */
export function costVariables(
  options: CostOptions | undefined,
  catalog: ReadonlyMap<string, Part>,
  machines: readonly Machine[],
): { readonly problems: readonly string[]; readonly vars: Readonly<Record<string, unknown>> } {
  const problems: string[] = [];
  const prices = new Map<string, number>();
  if (options?.prices !== undefined) {
    const read = readPrices(options.prices);
    if (read.ok) {
      for (const line of read.value.prices) {
        if (!catalog.has(line.part)) problems.push(`The price list names the part ${line.part}, but the catalog does not have it.`);
        else if (prices.has(line.part)) problems.push(`The part ${line.part} has two prices.`);
        else prices.set(line.part, valueIn(line.price, PRICE_UNIT));
      }
    } else problems.push(...read.problems);
  }
  const stock = new Map<string, number>([...catalog.keys()].map((part) => [part, 0]));
  const lines = stockSchema.safeParse(options?.stock ?? []);
  if (lines.success) {
    for (const line of lines.data) {
      const have = stock.get(line.part);
      if (have === undefined) problems.push(`The stock names the part ${line.part}, but the catalog does not have it.`);
      else stock.set(line.part, have + line.count);
    }
  } else problems.push(...issuesOf(lines.error, "The stock"));
  const ids = new Set(machines.map((machine) => machine.id));
  const owned = options?.owned ?? [];
  for (const machine of owned) if (!ids.has(machine)) problems.push(`The owned machine ${machine} is not a machine of the design.`);
  const horizon = timeSchema.safeParse(options?.horizon ?? DEFAULT_HORIZON);
  if (!horizon.success) problems.push(...issuesOf(horizon.error, "The horizon"));
  const busy = options?.busy ?? DEFAULT_BUSY;
  if (!(busy >= 0 && busy <= 1)) problems.push(`The busy share ${String(busy)} is not from 0 to 1.`);
  const vars = {
    [PRICES]: listOf(prices),
    [STOCK]: listOf(stock),
    [OWNED]: [...owned],
    [HORIZON]: horizon.success ? valueIn(horizon.data, "mo") : Number.NaN,
    [BUSY]: busy,
  };
  return { problems, vars };
}

/** This expression gives the price of the part of the line at the focus. A part with no price gives the error `#N/A`. */
const priceOfLine: Expr = app("get", v(PRICES), ref("part"));

// The machine.

/** This program gives the price of the parts of a machine in USD, when the user buys each part. */
export const PARTS_PRICE: Expr = totalOfCount(axes.children, priceOfLine);

// The site.

/** This expression tells if the line at the focus is a line of a machine that the user does not own. */
const isBought: Expr = app(
  "and",
  app("eq", ref("kind"), lit("line")),
  let_({ machine: ref("id", [parent]) }, app("not", contains(v(OWNED), v("machine")))),
);

/** This axis gives the lines of the machines that the user does not own. */
const boughtLines: Axis = axes.where(axes.descendants, isBought);

/**
 * This program gives the price of the parts to buy for a site, in USD. The lines of the machines that the user does not
 * own make one group for each part. The count to buy is the count of the group less the stock, and not less than 0.
 * A part costs its price times the count to buy. A part with no count to buy needs no price.
 */
export const PURCHASE: Expr = let_(
  { groups: app("group", each(boughtLines, ref("count")), each(boughtLines, ref("part"))) },
  let_(
    { parts: app("keys", v("groups")) },
    app(
      "sum",
      each(
        axes.list(v("groups")),
        let_(
          { part: app("nth", v("parts"), v("index")) },
          let_(
            { bought: app("subtract", app("sum", v("counts"), STRICT), app("get", v(STOCK), v("part"))) },
            app("if", app("gt", v("bought"), lit(0)), app("multiply", v("bought"), app("get", v(PRICES), v("part"))), lit(0)),
          ),
        ),
        undefined,
        ["counts", "index"],
      ),
      STRICT,
    ),
  ),
);

/**
 * This program gives the cost of the electricity of a site over the horizon, in USD. In a month, each machine takes
 * its power at idle, and its most power for the busy share of the time.
 */
export const ENERGY_COST: Expr = app(
  "multiply",
  v(HORIZON),
  app("add", SITE_IDLE_COST, app("multiply", v(BUSY), app("subtract", SITE_COST, SITE_IDLE_COST))),
);

/** This program gives the cost of a site over the horizon in USD: the purchase and the electricity. */
export const TOTAL_COST: Expr = app("add", PURCHASE, ENERGY_COST);

/** This program gives the cost of one CI job slot over the horizon in USD: the cost of the site divided by its runner slots. */
export const SLOT_COST: Expr = app("divide", TOTAL_COST, SITE_RUNNER_SLOTS);

/** These are the cost measures of a machine. */
export const MACHINE_COST_MEASURES: readonly Measure[] = [
  { id: "price", sentence: "The price of the parts of the machine, when the user buys each part.", unit: PRICE_UNIT, program: PARTS_PRICE },
];

/** These are the cost measures of a site. */
export const SITE_COST_MEASURES: readonly SiteMeasure[] = [
  { id: "purchase", sentence: "The price of the parts to buy.", unit: PRICE_UNIT, level: "site", program: PURCHASE },
  { id: "energy-cost", sentence: "The cost of the electricity over the horizon.", unit: PRICE_UNIT, level: "site", program: ENERGY_COST },
  { id: "total-cost", sentence: "The cost of the parts to buy and of the electricity over the horizon.", unit: PRICE_UNIT, level: "site", program: TOTAL_COST },
  { id: "slot-cost", sentence: "The cost of one CI job slot over the horizon.", unit: PRICE_UNIT, level: "site", program: SLOT_COST },
];
