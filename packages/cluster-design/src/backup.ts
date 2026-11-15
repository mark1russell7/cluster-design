/**
 * The backup power of a site, as Vex programs. A backup record has loads and sources. A load is a device that needs
 * power when the power of the wall stops, for example a modem, a router or a phone. A source is a battery that
 * carries some of the loads, for example a UPS, a DC battery or a power bank.
 *
 * Each program evaluates at the key of a source. The backup record has no home facts in this package. A user gives it
 * as input data.
 *
 * The ceiling is the most minutes of a source: all of the energy of its battery reaches the loads. No source holds
 * longer. The estimate is less: the battery gives only its usable share, and the source uses some power itself. Two
 * runtime points of the maker give these two values.
 */
import { convert, quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import { quantitySchema } from "@mark1russell7/quantity/schema";
import { app, axes, call, each, evaluate, fn, let_, lit, ref, space, v, type Axis, type Expr, type Result, type Space } from "@mark1russell7/vex";
import { BoolDomain, NumDomain, TextDomain } from "@mark1russell7/vex-domains";
import { z } from "zod";
import { verdictOf, type Verdict } from "./check.ts";
import { amountOf } from "./measure.ts";
import { contains, STRICT } from "./program.ts";

/** The format of a backup record. */
export const BACKUP_FORMAT = "backup/1";

/** This record is a load: a device that needs power when the power of the wall stops. */
export interface BackupLoad {
  readonly id: string;
  /** The power of the load at its low end, for example at idle. */
  readonly low: Quantity;
  /** The most power of the load. */
  readonly high: Quantity;
  /** The plugs that the load takes, for example `ac`, `usb-c` or `dc-12v`. A source must have an output for one of them. */
  readonly plugs: readonly string[];
  /** The energy of the battery of the load, for a load that a source charges, for example a phone. */
  readonly charge?: Quantity;
}

/** This record is a runtime point of the maker of a source: the source holds the time `time` at the load `load`. */
export interface RuntimePoint {
  readonly load: Quantity;
  readonly time: Quantity;
}

/** This record is the capacity of a battery as its maker tells it: the charge at the voltage of its cells. */
export interface BatteryCapacity {
  readonly charge: Quantity;
  readonly voltage: Quantity;
}

/**
 * This record is a source of backup power: a battery that carries some of the loads. The calibration gives a value
 * that the input does not give. The energy comes from the capacity. The usable share and the own use come from the
 * runtime points.
 */
export interface BackupSource {
  readonly id: string;
  /** The need that the source serves, for example `internet`. A rank compares only the sources of one need. */
  readonly need: string;
  /** The rated power of the source: the most power of its outputs together. */
  readonly rated: Quantity;
  /** The plugs of the outputs of the source. */
  readonly outputs: readonly string[];
  /** The ids of the loads that the source carries. */
  readonly carries: readonly string[];
  /** The energy of the battery. */
  readonly energy?: Quantity;
  /** The capacity of the battery. The calibration gives the energy from it when the input gives no energy. */
  readonly capacity?: BatteryCapacity;
  /** The share of the energy of the battery that reaches the loads, more than 0 and not more than 1. */
  readonly usable?: number;
  /** The power that the source uses itself, for example the loss of its inverter. */
  readonly ownUse?: Quantity;
  /** Two runtime points of the maker at two different loads. The calibration gives the usable share and the own use from them. */
  readonly points?: readonly [RuntimePoint, RuntimePoint];
  /** The share of the rated power that the source gives for hours, more than 0 and not more than 1. The default is the option `continuousShare`. */
  readonly continuousShare?: number;
  /** The price of the source. */
  readonly price?: Quantity;
}

/** This record is the backup power of a site: the loads and the sources. */
export interface Backup {
  readonly format: typeof BACKUP_FORMAT;
  readonly loads: readonly BackupLoad[];
  readonly sources: readonly BackupSource[];
}

const id = z.string().trim().min(1);
const texts = z.array(id).min(1);
const amount = (kind: "power" | "energy" | "time" | "charge" | "voltage" | "money"): z.ZodType<Quantity> => quantitySchema(kind, { nonnegative: true });
const shareSchema = z.number().gt(0).lte(1);
const pointSchema = z.strictObject({ load: amount("power"), time: amount("time") });

/** This schema accepts a backup record. An amount has a unit of the kind of its field, and a field that the record does not have is a problem. */
export const backupSchema: z.ZodType<Backup> = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  loads: z.array(z.strictObject({ id, low: amount("power"), high: amount("power"), plugs: texts, charge: amount("energy").optional() })),
  sources: z.array(
    z.strictObject({
      id,
      need: id,
      rated: amount("power"),
      outputs: texts,
      carries: z.array(id),
      energy: amount("energy").optional(),
      capacity: z.strictObject({ charge: amount("charge"), voltage: amount("voltage") }).optional(),
      usable: shareSchema.optional(),
      ownUse: amount("power").optional(),
      points: z.tuple([pointSchema, pointSchema]).optional(),
      continuousShare: shareSchema.optional(),
      price: amount("money").optional(),
    }),
  ),
}) as unknown as z.ZodType<Backup>;

/** This record is a backup record, or the problems of its data. */
export type BackupResult = { readonly ok: true; readonly value: Backup } | { readonly ok: false; readonly problems: readonly string[] };

/**
 * This function reads a backup record from data. Each issue of the schema gives one problem with its path.
 *
 * @param value - The backup record as data
 * @returns The backup record, or the problems
 */
export function readBackup(value: unknown): BackupResult {
  const parsed = backupSchema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const problems = parsed.error.issues.map((issue) => {
    const where = issue.path.length === 0 ? "" : ` at ${issue.path.join(".")}`;
    return `The backup record is not valid${where}: ${issue.message}.`;
  });
  return { ok: false, problems };
}

/** The minutes of an hour: 60, from `@mark1russell7/quantity`. */
export const MINUTES_PER_HOUR: number = convert(quantity(1, "h"), "min").value;

/** The default share of the rated power that a source gives for hours: 0.8, so the rated power is 1.25 times the load. */
export const DEFAULT_CONTINUOUS_SHARE = 0.8;

/** This expression tells if the record at the focus has the kind `name`. */
const isKind = (name: "load" | "source"): Expr => app("eq", ref("kind"), lit(name));

/**
 * This axis gives the loads that the source carries. Inside the axis, a field reads at each target. Thus the program
 * reads the list of the source before the axis, as the name `carried`.
 */
const carriedLoads: Axis = axes.where(axes.all, app("and", isKind("load"), let_({ me: ref("id") }, contains(v("carried"), v("me")))));

/** This expression gives the sum of `body` at each load that the source at the focus carries. */
const overCarried = (body: Expr): Expr => let_({ carried: ref("carries") }, app("sum", each(carriedLoads, body), STRICT));

/** This program gives the power of the loads that the source carries in watts, at the low end of each load. */
export const BACKUP_LOAD_LOW: Expr = overCarried(ref("low"));

/** This program gives the most power of the loads that the source carries in watts. */
export const BACKUP_LOAD_HIGH: Expr = overCarried(ref("high"));

/** This program gives the energy of the batteries of the loads that the source charges, in watt-hours. */
export const BACKUP_CHARGE: Expr = overCarried(ref("charge"));

/** This function of the load `w` in watts gives the ceiling in minutes: the energy of the battery over the load. */
const ceilingAt = fn(["w"], app("multiply", app("divide", ref("energy"), v("w")), lit(MINUTES_PER_HOUR)));

/** This function of the load `w` in watts gives the estimate in minutes: the usable energy over the load and the own use. */
const minutesAt = fn(["w"], app("multiply", app("divide", app("multiply", ref("energy"), ref("usable")), app("add", v("w"), ref("ownUse"))), lit(MINUTES_PER_HOUR)));

/** This expression binds the functions `ceiling` and `minutes` for `body`. */
const withRuntime = (body: Expr): Expr => let_({ ceiling: ceilingAt, minutes: minutesAt }, body);

/** This program gives the ceiling at the most power of the loads, in minutes. No source holds longer at that load. */
export const BACKUP_CEILING_HIGH: Expr = withRuntime(call("ceiling", BACKUP_LOAD_HIGH));

/** This program gives the ceiling at the low end of the loads, in minutes. */
export const BACKUP_CEILING_LOW: Expr = withRuntime(call("ceiling", BACKUP_LOAD_LOW));

/** This program gives the estimate at the most power of the loads, in minutes. */
export const BACKUP_MINUTES_HIGH: Expr = withRuntime(call("minutes", BACKUP_LOAD_HIGH));

/** This program gives the estimate at the low end of the loads, in minutes. */
export const BACKUP_MINUTES_LOW: Expr = withRuntime(call("minutes", BACKUP_LOAD_LOW));

/** This program gives the load limit of the source in watts: its rated power times its continuous share. */
export const BACKUP_LIMIT: Expr = app("multiply", ref("rated"), ref("continuousShare"));

/** This program gives the most full charges of the batteries of the loads: the energy of the battery over their energy. */
export const BACKUP_CHARGES_CEILING: Expr = app("divide", ref("energy"), BACKUP_CHARGE);

/** This program gives the estimate of the full charges: the usable energy of the battery over the energy of the loads. */
export const BACKUP_CHARGES: Expr = app("divide", app("multiply", ref("energy"), ref("usable")), BACKUP_CHARGE);

/** This program tells if the source has an output for one of the plugs of each load that it carries. */
export const BACKUP_PLUGS: Expr = let_(
  { carried: ref("carries"), outs: ref("outputs") },
  app("all", each(carriedLoads, app("any", each(axes.list(ref("plugs")), contains(v("outs"), v("plug")), undefined, ["plug"]), STRICT)), STRICT),
);

/** This program gives the price of the source over the ceiling at the most power of the loads, in USD for each minute. */
export const BACKUP_PRICE_PER_MINUTE: Expr = app("divide", ref("price"), BACKUP_CEILING_HIGH);

/** This program gives the price of the source over the most full charges, in USD for each charge. */
export const BACKUP_PRICE_PER_CHARGE: Expr = app("divide", ref("price"), BACKUP_CHARGES_CEILING);

/**
 * This expression gives the rank of the source by `score` among the sources of its need. The rank is 1, plus the
 * count of the other sources of the need with a higher score. A source must keep the plugs rule to get a rank, and only these
 * sources count. A source with no rank gets the text `none`. Equal scores get the same rank.
 *
 * A source with no score gets the error of its score. When another source of the need has no score, the rank has no
 * value, because that source can have the higher score.
 */
const rankBy = (score: Expr): Expr => {
  const better = app("and", isKind("source"), app("eq", ref("need"), v("myNeed")), BACKUP_PLUGS, app("gt", score, v("mine")));
  return let_(
    { mine: score, myNeed: ref("need") },
    app("if", app("and", BACKUP_PLUGS, app("gte", v("mine"), lit(0))), app("add", lit(1), app("sum", each(axes.where(axes.others, better), lit(1)), STRICT)), lit("none")),
  );
};

/** This program gives the rank of the source by its ceiling at the most power of the loads. The ceiling needs no runtime points, so each source has it. */
export const BACKUP_RANK_BY_MINUTES: Expr = rankBy(BACKUP_CEILING_HIGH);

/** This program gives the rank of the source by its most full charges. */
export const BACKUP_RANK_BY_CHARGES: Expr = rankBy(BACKUP_CHARGES_CEILING);

// The calibration. The model of a source is t = 60 E u / (p + i): the minutes t at the load p, with the energy E,
// the usable share u and the own use i. Two points (p1, t1) and (p2, t2) with p1 < p2 give i = (t2 p2 - t1 p1) / (t1 - t2)
// and E u = t1 (p1 + i) / 60. The own use is not less than 0.

/** This program gives the own use of a source in watts, from its two runtime points `p1`, `t1`, `p2` and `t2` in watts and minutes. */
export const OWN_USE_FROM_POINTS: Expr = app(
  "max",
  lit(0),
  app("divide", app("subtract", app("multiply", ref("t2"), ref("p2")), app("multiply", ref("t1"), ref("p1"))), app("subtract", ref("t1"), ref("t2"))),
);

/** This program gives the usable share of a source from its two runtime points and the energy of its battery in watt-hours. */
export const USABLE_FROM_POINTS: Expr = app(
  "divide",
  app("divide", app("multiply", ref("t1"), app("add", ref("p1"), OWN_USE_FROM_POINTS)), lit(MINUTES_PER_HOUR)),
  ref("energy"),
);

/** This program gives the energy of a battery in watt-hours from its capacity: the charge in ampere-hours times the voltage in volts. */
export const ENERGY_FROM_CAPACITY: Expr = app("multiply", ref("charge"), ref("voltage"));

/** This record is one rule of backup power: its id, the sentence that it holds and its program at a source. */
export interface BackupRule {
  readonly id: string;
  readonly sentence: string;
  readonly program: Expr;
}

/** These are the rules of backup power, in the order of the check. */
export const BACKUP_RULES: readonly BackupRule[] = [
  { id: "source-load", sentence: "The most power of the carried loads is not more than the load limit of the source.", program: app("lte", BACKUP_LOAD_HIGH, BACKUP_LIMIT) },
  { id: "source-plugs", sentence: "The source has an output for a plug of each carried load.", program: BACKUP_PLUGS },
  { id: "usable-share", sentence: "The usable share of the battery is more than 0 and not more than 1.", program: app("and", app("gt", ref("usable"), lit(0)), app("lte", ref("usable"), lit(1))) },
];

/** This record is one measure of backup power: its id, the sentence that tells it, its unit and its program at a source. */
export interface BackupMeasure {
  readonly id: string;
  readonly sentence: string;
  readonly unit: string;
  readonly program: Expr;
}

/** These are the measures of backup power. */
export const BACKUP_MEASURES: readonly BackupMeasure[] = [
  { id: "load-low", sentence: "The power of the carried loads at their low end.", unit: "W", program: BACKUP_LOAD_LOW },
  { id: "load-high", sentence: "The most power of the carried loads.", unit: "W", program: BACKUP_LOAD_HIGH },
  { id: "limit", sentence: "The load limit of the source.", unit: "W", program: BACKUP_LIMIT },
  { id: "ceiling-high", sentence: "The most minutes at the most power of the loads.", unit: "min", program: BACKUP_CEILING_HIGH },
  { id: "ceiling-low", sentence: "The most minutes at the low end of the loads.", unit: "min", program: BACKUP_CEILING_LOW },
  { id: "minutes-high", sentence: "The estimate of the minutes at the most power of the loads.", unit: "min", program: BACKUP_MINUTES_HIGH },
  { id: "minutes-low", sentence: "The estimate of the minutes at the low end of the loads.", unit: "min", program: BACKUP_MINUTES_LOW },
  { id: "charge", sentence: "The energy of the batteries of the carried loads.", unit: "Wh", program: BACKUP_CHARGE },
  { id: "charges-ceiling", sentence: "The most full charges of the batteries of the carried loads.", unit: "count", program: BACKUP_CHARGES_CEILING },
  { id: "charges", sentence: "The estimate of the full charges of the batteries of the carried loads.", unit: "count", program: BACKUP_CHARGES },
  { id: "price-per-minute", sentence: "The price over the most minutes at the most power of the loads.", unit: "USD/min", program: BACKUP_PRICE_PER_MINUTE },
  { id: "price-per-charge", sentence: "The price over the most full charges.", unit: "USD/{charge}", program: BACKUP_PRICE_PER_CHARGE },
  { id: "rank-by-minutes", sentence: "The rank by the most minutes at the most power of the loads, among the sources of the need.", unit: "{rank}", program: BACKUP_RANK_BY_MINUTES },
  { id: "rank-by-charges", sentence: "The rank by the most full charges, among the sources of the need.", unit: "{rank}", program: BACKUP_RANK_BY_CHARGES },
];

/** This type tells where a value of a source comes from: the input, the capacity or the runtime points. */
export type Basis = "input" | "capacity" | "points";

/** This record is a source after the calibration. The field `basis` tells where each of the three values comes from. */
export interface CalibratedSource extends BackupSource {
  readonly continuousShare: number;
  readonly basis: { readonly energy?: Basis; readonly usable?: Basis; readonly ownUse?: Basis };
}

/** These options change the evaluation of backup power. */
export interface BackupOptions {
  /** The share of the rated power that a source gives for hours, when the source does not give it. The default is 0.8. */
  readonly continuousShare?: number;
}

/** This record is the sources after the calibration and the space of the programs, or the problems of the input. */
export type BackupSpaceResult =
  | { readonly ok: true; readonly sources: readonly CalibratedSource[]; readonly space: Space }
  | { readonly ok: false; readonly problems: readonly string[] };

const DOMAINS = [NumDomain, BoolDomain, TextDomain];

/** This function tells if a value is a share: a number more than 0 and not more than 1. */
const isShare = (value: number): boolean => Number.isFinite(value) && value > 0 && value <= 1;

/** This function gives the problems of a backup record that the schema does not find. An empty list tells that the record is valid. */
function problemsOf(backup: Backup, options: BackupOptions): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const loadIds = new Set(backup.loads.map((load) => load.id));
  for (const { id: value } of [...backup.loads, ...backup.sources]) {
    if (ids.has(value)) problems.push(`Two records have the id ${value}.`);
    ids.add(value);
  }
  const continuous = options.continuousShare ?? DEFAULT_CONTINUOUS_SHARE;
  if (!isShare(continuous)) problems.push(`The continuous share ${String(continuous)} is not more than 0 and not more than 1.`);
  for (const load of backup.loads) {
    if (valueIn(load.high, "W") < valueIn(load.low, "W")) problems.push(`The load ${load.id} has a most power less than its low power.`);
    if (load.charge !== undefined && !(valueIn(load.charge, "Wh") > 0)) problems.push(`The load ${load.id} has a charge of 0.`);
  }
  for (const source of backup.sources) {
    const at = `The source ${source.id}`;
    if (!(valueIn(source.rated, "W") > 0)) problems.push(`${at} has a rated power of 0.`);
    for (const carried of source.carries) if (!loadIds.has(carried)) problems.push(`${at} carries ${carried}, which is not a load.`);
    if (new Set(source.carries).size !== source.carries.length) problems.push(`${at} carries a load two times.`);
    if (source.energy === undefined && source.capacity === undefined) problems.push(`${at} has no energy and no capacity.`);
    if (source.energy !== undefined && !(valueIn(source.energy, "Wh") > 0)) problems.push(`${at} has an energy of 0.`);
    if (source.capacity !== undefined && !(valueIn(source.capacity.charge, "Ah") > 0 && valueIn(source.capacity.voltage, "V") > 0)) problems.push(`${at} has a capacity with a value of 0.`);
    if (source.points !== undefined) {
      const [one, two] = source.points.map((point) => ({ load: valueIn(point.load, "W"), time: valueIn(point.time, "min") })) as [{ load: number; time: number }, { load: number; time: number }];
      if (!(one.load > 0 && one.time > 0 && two.load > 0 && two.time > 0)) problems.push(`${at} has a runtime point with a value of 0.`);
      else if (!(one.load < two.load && one.time > two.time)) problems.push(`${at} has runtime points where the higher load does not give fewer minutes.`);
    }
  }
  return problems;
}

/** This function gives the number of a calibration program at one record, or the reason that it has no number. */
function calibrate(program: Expr, record: Readonly<Record<string, unknown>>): { readonly value?: number; readonly detail?: string } {
  return amountOf(evaluate(program, { space: space.record({ source: record }), origin: "source", domains: DOMAINS }));
}

/** This function gives the record of a load in the space: each amount is a number in the unit of its program. A load with no battery has the charge 0. */
const loadRecord = (load: BackupLoad): Record<string, unknown> => ({
  kind: "load",
  id: load.id,
  low: valueIn(load.low, "W"),
  high: valueIn(load.high, "W"),
  plugs: load.plugs,
  charge: load.charge === undefined ? 0 : valueIn(load.charge, "Wh"),
});

/**
 * This function gives the sources after the calibration, and the space of the programs. The energy comes from the
 * capacity, and the usable share and the own use come from the runtime points. A value of the input comes first.
 *
 * @param backup - The backup record
 * @param options - The default continuous share of a source
 * @returns The sources and the space, or the problems of the input
 */
export function backupSpace(backup: Backup, options: BackupOptions = {}): BackupSpaceResult {
  const problems = problemsOf(backup, options);
  if (problems.length > 0) return { ok: false, problems };
  const records: Record<string, Record<string, unknown>> = {};
  for (const load of backup.loads) records[load.id] = loadRecord(load);
  const calibrated: CalibratedSource[] = [];
  for (const source of backup.sources) {
    const values: { energy?: number; usable?: number; ownUse?: number } = {};
    const basis: { energy?: Basis; usable?: Basis; ownUse?: Basis } = {};
    if (source.energy !== undefined) {
      values.energy = valueIn(source.energy, "Wh");
      basis.energy = "input";
    } else if (source.capacity !== undefined) {
      const energy = calibrate(ENERGY_FROM_CAPACITY, { charge: valueIn(source.capacity.charge, "Ah"), voltage: valueIn(source.capacity.voltage, "V") });
      if (energy.value === undefined) problems.push(`The source ${source.id} has no energy from its capacity: ${energy.detail ?? ""}`);
      else {
        values.energy = energy.value;
        basis.energy = "capacity";
      }
    }
    if (source.usable !== undefined) {
      values.usable = source.usable;
      basis.usable = "input";
    }
    if (source.ownUse !== undefined) {
      values.ownUse = valueIn(source.ownUse, "W");
      basis.ownUse = "input";
    }
    if (source.points !== undefined) {
      const [one, two] = source.points;
      const point = { energy: values.energy, p1: valueIn(one.load, "W"), t1: valueIn(one.time, "min"), p2: valueIn(two.load, "W"), t2: valueIn(two.time, "min") };
      for (const [name, program] of [["ownUse", OWN_USE_FROM_POINTS], ["usable", USABLE_FROM_POINTS]] as const) {
        if (values[name] !== undefined) continue;
        const value = calibrate(program, point);
        if (value.value === undefined) problems.push(`The source ${source.id} has no ${name} from its runtime points: ${value.detail ?? ""}`);
        else {
          values[name] = value.value;
          basis[name] = "points";
        }
      }
    }
    const continuousShare = source.continuousShare ?? options.continuousShare ?? DEFAULT_CONTINUOUS_SHARE;
    calibrated.push({
      ...source,
      ...(values.energy === undefined ? {} : { energy: quantity(values.energy, "Wh") }),
      ...(values.usable === undefined ? {} : { usable: values.usable }),
      ...(values.ownUse === undefined ? {} : { ownUse: quantity(values.ownUse, "W") }),
      continuousShare,
      basis,
    });
    records[source.id] = {
      kind: "source",
      id: source.id,
      need: source.need,
      rated: valueIn(source.rated, "W"),
      outputs: source.outputs,
      carries: source.carries,
      continuousShare,
      ...values,
      ...(source.price === undefined ? {} : { price: valueIn(source.price, "USD") }),
    };
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, sources: calibrated, space: space.record(records) };
}

/** This record is the result of the program of one item at one source. */
export interface BackupEvaluation<T> {
  readonly source: string;
  readonly item: T;
  readonly result: Result<unknown>;
}

/** This record is the sources after the calibration and the evaluations, or the problems of the input. */
export type BackupEvaluationResult<T> =
  | { readonly ok: true; readonly sources: readonly CalibratedSource[]; readonly evaluations: readonly BackupEvaluation<T>[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * This function evaluates the program of each item at each source.
 *
 * @param backup - The backup record
 * @param items - The items, each with a Vex program
 * @param options - The default continuous share of a source
 * @returns The sources after the calibration and the evaluations in the order of the items and the sources, or the problems of the input
 */
export function evaluateBackup<T extends { readonly program: Expr }>(backup: Backup, items: readonly T[], options: BackupOptions = {}): BackupEvaluationResult<T> {
  const built = backupSpace(backup, options);
  if (!built.ok) return built;
  const evaluations: BackupEvaluation<T>[] = [];
  for (const item of items) {
    for (const source of built.sources) evaluations.push({ source: source.id, item, result: evaluate(item.program, { space: built.space, origin: source.id, domains: DOMAINS }) });
  }
  return { ok: true, sources: built.sources, evaluations };
}

/** This record is the value of one measure at one source. A value that the program cannot give has the reason in `detail`. */
export interface BackupMeasureValue {
  readonly source: string;
  readonly measure: string;
  readonly unit: string;
  readonly value?: number;
  readonly detail?: string;
}

/** These options change the measures of backup power. */
export interface BackupMeasureOptions extends BackupOptions {
  /** The measures. The default is `BACKUP_MEASURES`. */
  readonly measures?: readonly BackupMeasure[];
}

/** This record is the sources after the calibration and the values of the measures, or the problems of the input. */
export type BackupMeasureResult =
  | { readonly ok: true; readonly sources: readonly CalibratedSource[]; readonly values: readonly BackupMeasureValue[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * This function gives the value of each measure at each source.
 *
 * @param backup - The backup record
 * @param options - The default continuous share of a source and the measures
 * @returns The sources after the calibration and the values in the order of the measures and the sources, or the problems of the input
 */
export function measureBackup(backup: Backup, options: BackupMeasureOptions = {}): BackupMeasureResult {
  const evaluated = evaluateBackup(backup, options.measures ?? BACKUP_MEASURES, options);
  if (!evaluated.ok) return evaluated;
  const values = evaluated.evaluations.map(({ source, item, result }) => ({ source, measure: item.id, unit: item.unit, ...amountOf(result) }));
  return { ok: true, sources: evaluated.sources, values };
}

/** This record is the verdict of one rule at one source. An `unread` verdict has the reason in `detail`. */
export interface BackupFinding {
  readonly source: string;
  readonly rule: string;
  readonly sentence: string;
  readonly verdict: Verdict;
  readonly detail?: string;
}

/** These options change the check of backup power. */
export interface BackupCheckOptions extends BackupOptions {
  /** The rules of the check. The default is `BACKUP_RULES`. */
  readonly rules?: readonly BackupRule[];
}

/** This record is the findings of the check of backup power, or the problems of its input. */
export type BackupCheckResult = { readonly ok: true; readonly findings: readonly BackupFinding[] } | { readonly ok: false; readonly problems: readonly string[] };

/**
 * This function examines each source with each rule of backup power.
 *
 * @param backup - The backup record
 * @param options - The default continuous share of a source and the rules
 * @returns The findings in the order of the rules and the sources, or the problems of the input
 */
export function checkBackup(backup: Backup, options: BackupCheckOptions = {}): BackupCheckResult {
  const evaluated = evaluateBackup(backup, options.rules ?? BACKUP_RULES, options);
  if (!evaluated.ok) return evaluated;
  const findings = evaluated.evaluations.map(({ source, item, result }) => ({ source, rule: item.id, sentence: item.sentence, ...verdictOf(result) }));
  return { ok: true, findings };
}
