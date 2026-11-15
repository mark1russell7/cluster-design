/**
 * The formulas and the rules of a site, as Vex programs. A site has circuits and rooms. The machines of a design
 * plug into the circuits and stand in the rooms. Each program evaluates at a key of the tree of a site: the site, a
 * circuit or a room. The programs of a machine evaluate at each machine in the tree, so a site and a machine agree.
 */
import { convert, quantity } from "@mark1russell7/quantity";
import { app, axes, each, let_, lit, origin, parent, ref, v, type Addr, type Axis, type Expr } from "@mark1russell7/vex";
import {
  FREE_MEMORY,
  FREE_THREADS,
  levelOf,
  NOISE_ENERGY,
  RUNNER_SLOTS,
  WALL_IDLE_POWER,
  WALL_POWER,
  WORK_MEMORY,
  WORK_THREADS,
  workCapacity,
  workUnits,
} from "./formulas.ts";
import type { WorkClass } from "./variables.ts";
import { countOf, STRICT } from "./program.ts";

/** The name of the variable that holds the continuous load limit of a circuit, as a ratio of its rating. */
export const CONTINUOUS_LOAD = "continuousLoad";

/** This type is the level of a key in the tree of a site. */
export type SiteLevel = "site" | "circuit" | "room";

/** The hours of a mean month of the Gregorian calendar: 730.485. */
export const HOURS_PER_MONTH: number = convert(quantity(1, "mo"), "h").value;

/** This expression tells if the record at the focus has the kind `name`. */
const isKind = (name: "machine" | SiteLevel): Expr => app("eq", ref("kind"), lit(name));

/** This expression gives the sum of `body` at each target of the axis, from the address `at`. */
const sumOver = (axis: Axis, body: Expr, at?: Addr): Expr => app("sum", each(axis, body, at), STRICT);

/** This axis gives the machines that plug into the circuit at the focus. */
const circuitMachines: Axis = axes.where(axes.children, isKind("machine"));

/** This axis gives the machines of the site at the focus. */
const siteMachines: Axis = axes.where(axes.descendants, isKind("machine"));

/** This axis gives the machines that stand in the room at the origin. It starts at the site, the parent of the room. */
const roomMachines: Axis = axes.where(axes.descendants, app("and", isKind("machine"), app("eq", ref("room"), ref("id", [origin]))));

/** This expression gives the sum of `body` at each machine of the room at the origin. */
const sumInRoom = (body: Expr): Expr => sumOver(roomMachines, body, [parent]);

// The circuit.

/** This program gives the most power of a circuit in watts: the power from the wall of each machine on it, and its other load. */
export const CIRCUIT_LOAD: Expr = app("add", sumOver(circuitMachines, WALL_POWER), ref("otherLoad"));

/** This program gives the power of a circuit at idle in watts: each machine at idle, and its other load. */
export const CIRCUIT_IDLE_LOAD: Expr = app("add", sumOver(circuitMachines, WALL_IDLE_POWER), ref("otherLoad"));

/** This program gives the most current of a circuit in amperes: its most power divided by its voltage. */
export const CIRCUIT_CURRENT: Expr = app("divide", CIRCUIT_LOAD, ref("voltage"));

/**
 * This program gives the continuous load limit of a circuit in watts: its voltage times the rating of its breaker,
 * times the variable `continuousLoad`. A machine that runs CI jobs for hours is a continuous load.
 */
export const CIRCUIT_LIMIT: Expr = app("multiply", app("multiply", ref("voltage"), ref("breaker")), v(CONTINUOUS_LOAD));

/** This program gives the plugs of the machines on a circuit: one plug for each power supply. */
export const CIRCUIT_PLUGS: Expr = sumOver(circuitMachines, countOf("psu"));

// The room.

/** This program gives the most heat of the machines in a room in watts. Each watt from the wall becomes heat in the room. */
export const ROOM_HEAT: Expr = sumInRoom(WALL_POWER);

/** This program gives the heat of the machines in a room at idle, in watts. */
export const ROOM_IDLE_HEAT: Expr = sumInRoom(WALL_IDLE_POWER);

/** This program gives the count of the machines in a room. */
export const ROOM_MACHINES: Expr = sumInRoom(lit(1));

/**
 * This program gives the most sound level of the machines in a room in dBA, at 1 m from each machine. It adds the
 * sound energy of the machines. A room with no machine has the level 0.
 */
export const ROOM_NOISE: Expr = let_(
  { energy: sumInRoom(NOISE_ENERGY) },
  app("if", app("gt", v("energy"), lit(0)), levelOf(v("energy")), lit(0)),
);

// The site.

/** This program gives the most power of the machines of a site from the wall, in watts. */
export const SITE_POWER: Expr = sumOver(siteMachines, WALL_POWER);

/** This program gives the power of the machines of a site from the wall at idle, in watts. */
export const SITE_IDLE_POWER: Expr = sumOver(siteMachines, WALL_IDLE_POWER);

/** This program gives the CI jobs that the machines of a site run at one time: the sum of the runner slots of each machine. */
export const SITE_RUNNER_SLOTS: Expr = sumOver(siteMachines, RUNNER_SLOTS);

/** This program gives the threads of the work lines of the machines of a site. */
export const SITE_WORK_THREADS: Expr = sumOver(siteMachines, WORK_THREADS);

/** This program gives the memory of the work lines of the machines of a site, in GiB. */
export const SITE_WORK_MEMORY: Expr = sumOver(siteMachines, WORK_MEMORY);

/** This program gives the sum of the free threads of the machines of a site. */
export const SITE_FREE_THREADS: Expr = sumOver(siteMachines, FREE_THREADS);

/** This program gives the sum of the free memory of the machines of a site, in GiB. */
export const SITE_FREE_MEMORY: Expr = sumOver(siteMachines, FREE_MEMORY);

/** This expression gives the cost of a month at a power in watts, at the price of the site in USD per kWh. */
const monthlyCost = (power: Expr): Expr => app("multiply", app("multiply", app("divide", power, lit(1000)), lit(HOURS_PER_MONTH)), ref("price"));

/** This program gives the cost of the electricity of a site for a month in USD, when each machine takes its most power. */
export const SITE_COST: Expr = monthlyCost(SITE_POWER);

/** This program gives the cost of the electricity of the machines of a site for a month at idle, in USD. */
export const SITE_IDLE_COST: Expr = monthlyCost(SITE_IDLE_POWER);

/** This record is one rule of a site: its id, the sentence that it holds, the level of its keys and its program. */
export interface SiteRule {
  readonly id: string;
  readonly sentence: string;
  readonly level: SiteLevel;
  readonly program: Expr;
}

/** These are the rules of a site, in the order of the check. */
export const SITE_RULES: readonly SiteRule[] = [
  {
    id: "circuit-load",
    sentence: "The most power of a circuit is not more than its continuous load limit.",
    level: "circuit",
    program: app("lte", CIRCUIT_LOAD, CIRCUIT_LIMIT),
  },
  {
    id: "circuit-plugs",
    sentence: "The power supplies on a circuit are not more than its free sockets.",
    level: "circuit",
    program: app("lte", CIRCUIT_PLUGS, ref("sockets")),
  },
  {
    id: "room-heat",
    sentence: "The most heat of the machines in a room is not more than the heat limit of the room.",
    level: "room",
    program: app("lte", ROOM_HEAT, ref("heatLimit")),
  },
  {
    id: "room-noise",
    sentence: "The most sound level of the machines in a room is not more than the noise limit of the room.",
    level: "room",
    program: app("lte", ROOM_NOISE, ref("noiseLimit")),
  },
  {
    id: "room-places",
    sentence: "The machines in a room are not more than the places of the room.",
    level: "room",
    program: app("lte", ROOM_MACHINES, ref("places")),
  },
];

/** This record is one measure of a site: its id, the sentence that tells it, its unit, the level of its keys and its program. */
export interface SiteMeasure {
  readonly id: string;
  readonly sentence: string;
  readonly unit: string;
  readonly level: SiteLevel;
  readonly program: Expr;
}

/** These are the measures of a site. */
export const SITE_MEASURES: readonly SiteMeasure[] = [
  { id: "power", sentence: "The most power of the machines from the wall.", unit: "W", level: "site", program: SITE_POWER },
  { id: "idle-power", sentence: "The power of the machines from the wall at idle.", unit: "W", level: "site", program: SITE_IDLE_POWER },
  { id: "cost", sentence: "The most cost of the electricity for a month.", unit: "USD", level: "site", program: SITE_COST },
  { id: "idle-cost", sentence: "The cost of the electricity for a month at idle.", unit: "USD", level: "site", program: SITE_IDLE_COST },
  { id: "runner-slots", sentence: "The CI jobs that the machines of the site run at one time.", unit: "count", level: "site", program: SITE_RUNNER_SLOTS },
  { id: "work-threads", sentence: "The threads of the work lines of the machines.", unit: "count", level: "site", program: SITE_WORK_THREADS },
  { id: "work-memory", sentence: "The memory of the work lines of the machines.", unit: "GiB", level: "site", program: SITE_WORK_MEMORY },
  { id: "free-threads", sentence: "The free threads of the machines.", unit: "count", level: "site", program: SITE_FREE_THREADS },
  { id: "free-memory", sentence: "The free memory of the machines.", unit: "GiB", level: "site", program: SITE_FREE_MEMORY },
  { id: "load", sentence: "The most power of the circuit.", unit: "W", level: "circuit", program: CIRCUIT_LOAD },
  { id: "idle-load", sentence: "The power of the circuit at idle.", unit: "W", level: "circuit", program: CIRCUIT_IDLE_LOAD },
  { id: "current", sentence: "The most current of the circuit.", unit: "A", level: "circuit", program: CIRCUIT_CURRENT },
  { id: "limit", sentence: "The continuous load limit of the circuit.", unit: "W", level: "circuit", program: CIRCUIT_LIMIT },
  { id: "plugs", sentence: "The plugs of the power supplies on the circuit.", unit: "count", level: "circuit", program: CIRCUIT_PLUGS },
  { id: "heat", sentence: "The most heat of the machines in the room.", unit: "W", level: "room", program: ROOM_HEAT },
  { id: "idle-heat", sentence: "The heat of the machines in the room at idle.", unit: "W", level: "room", program: ROOM_IDLE_HEAT },
  { id: "noise", sentence: "The most sound level of the machines in the room, at 1 m.", unit: "dBA", level: "room", program: ROOM_NOISE },
  { id: "machines", sentence: "The machines in the room.", unit: "count", level: "room", program: ROOM_MACHINES },
];

/**
 * This function gives two measures of a site for each class of work. The measure `work-<id>` gives the units of the
 * class on the machines. The measure `capacity-<id>` gives the sum of the capacity of each machine for the class.
 *
 * @param classes - The classes of work
 * @returns The measures, two for each class, in the order of the classes
 */
export function siteWorkMeasures(classes: readonly WorkClass[]): readonly SiteMeasure[] {
  return classes.flatMap((work): SiteMeasure[] => [
    { id: `work-${work.id}`, sentence: `The units of the work class ${work.id} on the machines.`, unit: "count", level: "site", program: sumOver(siteMachines, workUnits(work.id)) },
    {
      id: `capacity-${work.id}`,
      sentence: `The units of the work class ${work.id} that the machines run, each machine in its own free share.`,
      unit: "count",
      level: "site",
      program: sumOver(siteMachines, workCapacity(work)),
    },
  ]);
}
