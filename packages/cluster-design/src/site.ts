/**
 * The site of a design, as data: its circuits, its rooms, the place of each machine and the price of electricity.
 * The site record has no home facts in this package. A user gives the site as input data.
 */
import type { Quantity } from "@mark1russell7/quantity";
import { space, type Space } from "@mark1russell7/vex";
import { z } from "zod";
import { fieldValue, lineRecord, type Machine } from "./machine.ts";
import { fieldSchema, type FieldSpec, type Part } from "./parts.ts";

/** The format of a site record. */
export const SITE_FORMAT = "site/1";

/**
 * This table has the fields of the site, of a circuit and of a room. The programs of a site read each amount as a
 * number in the unit that its field spec names. A breaker has its rating in amperes.
 *
 * The field `otherLoad` is the power of the other loads on a circuit. The field `sockets` is the free sockets of a
 * circuit. The heat limit of a room is the heat that its cooling takes away. The field `places` is the count of places
 * for a machine in a room.
 */
export const SITE_FIELDS = {
  site: {
    price: { kind: "amount", quantity: "energy-price", unit: "USD/kWh" },
  },
  circuit: {
    voltage: { kind: "amount", quantity: "voltage", unit: "V" },
    breaker: { kind: "amount", quantity: "current", unit: "A" },
    sockets: { kind: "count" },
    otherLoad: { kind: "amount", quantity: "power", unit: "W" },
  },
  room: {
    places: { kind: "count" },
    heatLimit: { kind: "amount", quantity: "power", unit: "W" },
    noiseLimit: { kind: "amount", quantity: "level", unit: "dBA" },
  },
} as const;

// The type checker holds that each field of the table is a field spec. A declared type of the table loses its literal types.
SITE_FIELDS satisfies Readonly<Record<"site" | "circuit" | "room", Readonly<Record<string, FieldSpec>>>>;

/** This record is one circuit of a site: its id, its voltage, the rating of its breaker, its free sockets and its other load. */
export interface Circuit {
  readonly id: string;
  readonly voltage: Quantity;
  readonly breaker: Quantity;
  readonly sockets: number;
  readonly otherLoad: Quantity;
}

/** This record is one room of a site: its id, its places for machines, its heat limit and its noise limit. */
export interface Room {
  readonly id: string;
  readonly places: number;
  readonly heatLimit: Quantity;
  readonly noiseLimit: Quantity;
}

/** This record is the place of one machine: the circuit that it plugs into, and the room that it stands in. */
export interface Place {
  readonly machine: string;
  readonly circuit: string;
  readonly room: string;
}

/** This record is a site: the price of electricity, the circuits, the rooms and the place of each machine. */
export interface Site {
  readonly format: typeof SITE_FORMAT;
  readonly price: Quantity;
  readonly circuits: readonly Circuit[];
  readonly rooms: readonly Room[];
  readonly places: readonly Place[];
}

const id = z.string().trim().min(1);
const fieldsOf = (fields: Readonly<Record<string, FieldSpec>>): Record<string, z.ZodType> =>
  Object.fromEntries(Object.entries(fields).map(([name, spec]) => [name, fieldSchema(spec)]));

/** This schema accepts a site. An amount has a unit of the kind of its field, and a field that the site does not have is a problem. */
export const siteSchema: z.ZodType<Site> = z.strictObject({
  format: z.literal(SITE_FORMAT),
  ...fieldsOf(SITE_FIELDS.site),
  circuits: z.array(z.strictObject({ id, ...fieldsOf(SITE_FIELDS.circuit) })),
  rooms: z.array(z.strictObject({ id, ...fieldsOf(SITE_FIELDS.room) })),
  places: z.array(z.strictObject({ machine: id, circuit: id, room: id })),
}) as unknown as z.ZodType<Site>;

/** This record is a site, or the problems of the site data. */
export type SiteResult = { readonly ok: true; readonly value: Site } | { readonly ok: false; readonly problems: readonly string[] };

/**
 * This function reads a site from data. Each issue of the schema gives one problem with its path.
 *
 * @param value - The site as data
 * @returns The site, or the problems
 */
export function readSite(value: unknown): SiteResult {
  const parsed = siteSchema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const problems = parsed.error.issues.map((issue) => {
    const where = issue.path.length === 0 ? "" : ` at ${issue.path.join(".")}`;
    return `The site is not valid${where}: ${issue.message}.`;
  });
  return { ok: false, problems };
}

/** The key of the root of the tree of a site. */
export const SITE_KEY = "site";

/** This record is the tree of a site, and the key of each circuit, room and machine in the tree by its id. */
export interface SiteTree {
  readonly space: Space<string, unknown>;
  readonly circuits: ReadonlyMap<string, string>;
  readonly rooms: ReadonlyMap<string, string>;
  readonly machines: ReadonlyMap<string, string>;
}

/** This record is the tree of a site, or the problems of the site and the machines. */
export type SiteTreeResult = { readonly ok: true; readonly value: SiteTree } | { readonly ok: false; readonly problems: readonly string[] };

const recordOf = (kind: string, fields: Readonly<Record<string, FieldSpec>>, value: object): Record<string, unknown> => {
  const record: Record<string, unknown> = { kind };
  if ("id" in value) record["id"] = value.id;
  const values = value as Readonly<Record<string, unknown>>;
  for (const [name, spec] of Object.entries(fields)) record[name] = fieldValue(spec, values[name]);
  return record;
};

const keysOf = (ids: readonly string[], prefix: string, label: string, problems: string[]): Map<string, string> => {
  const keys = new Map<string, string>();
  ids.forEach((value, index) => {
    if (keys.has(value)) problems.push(`The id ${value} is on two ${label}.`);
    else keys.set(value, `${prefix}${String(index)}`);
  });
  return keys;
};

/**
 * This function makes the tree of a site. The root is the site. Its children are the circuits and the rooms. The
 * children of a circuit are the machines that plug into it, and the children of a machine are its part lines. Each
 * machine has the id of its room. Each machine of the design has one place, and each place names a machine, a
 * circuit and a room of the input.
 *
 * @param site - The site
 * @param machines - The machines of the design
 * @param catalog - The parts by their ids
 * @returns The tree, or the problems
 */
export function siteTree(site: Site, machines: readonly Machine[], catalog: ReadonlyMap<string, Part>): SiteTreeResult {
  const problems: string[] = [];
  const circuits = keysOf(
    site.circuits.map((circuit) => circuit.id),
    "c",
    "circuits",
    problems,
  );
  const rooms = keysOf(
    site.rooms.map((room) => room.id),
    "r",
    "rooms",
    problems,
  );
  const machineKeys = keysOf(
    machines.map((machine) => machine.id),
    "m",
    "machines",
    problems,
  );

  const records: Record<string, unknown> = { [SITE_KEY]: recordOf("site", SITE_FIELDS.site, site) };
  const parents: Record<string, string | null> = { [SITE_KEY]: null };
  site.circuits.forEach((circuit) => {
    const key = circuits.get(circuit.id);
    if (key === undefined || key in records) return;
    records[key] = recordOf("circuit", SITE_FIELDS.circuit, circuit);
    parents[key] = SITE_KEY;
  });
  site.rooms.forEach((room) => {
    const key = rooms.get(room.id);
    if (key === undefined || key in records) return;
    records[key] = recordOf("room", SITE_FIELDS.room, room);
    parents[key] = SITE_KEY;
  });

  const placeOf = new Map<string, Place>();
  for (const place of site.places) {
    if (!machineKeys.has(place.machine)) problems.push(`A place names the machine ${place.machine}, but the design does not have it.`);
    if (!circuits.has(place.circuit)) problems.push(`The place of ${place.machine} names the circuit ${place.circuit}, but the site does not have it.`);
    if (!rooms.has(place.room)) problems.push(`The place of ${place.machine} names the room ${place.room}, but the site does not have it.`);
    if (placeOf.has(place.machine)) problems.push(`The machine ${place.machine} has two places.`);
    else placeOf.set(place.machine, place);
  }

  for (const machine of machines) {
    const key = machineKeys.get(machine.id);
    const place = placeOf.get(machine.id);
    if (place === undefined) problems.push(`The machine ${machine.id} has no place.`);
    const circuit = place === undefined ? undefined : circuits.get(place.circuit);
    if (key === undefined || key in records || place === undefined || circuit === undefined) continue;
    records[key] = { kind: "machine", id: machine.id, room: place.room };
    parents[key] = circuit;
    machine.lines.forEach((line, l) => {
      const part = catalog.get(line.part);
      if (part === undefined) {
        problems.push(`The machine ${machine.id} names the part ${line.part}, but the catalog does not have it.`);
        return;
      }
      const lineKey = `${key}.${String(l)}`;
      records[lineKey] = lineRecord(part, line.count);
      parents[lineKey] = key;
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { space: space.tree(records, parents), circuits, rooms, machines: machineKeys } };
}
