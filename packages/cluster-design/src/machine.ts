/**
 * The machines of a design, and the tree that the fit rules read. The root of the tree is the cluster. Its children
 * are the machines, and the children of a machine are its part lines. A part line is one part and its count.
 */
import { valueIn } from "@mark1russell7/quantity";
import { space, type Space } from "@mark1russell7/vex";
import { z } from "zod";
import { PART_CLASSES, type FieldSpec, type Part } from "./parts.ts";

/** This record is one line of a machine: the id of a part in the catalog, and the count of that part. */
export interface PartLine {
  readonly part: string;
  readonly count: number;
}

/** This record is one machine of a design: its id, and its part lines. */
export interface Machine {
  readonly id: string;
  readonly lines: readonly PartLine[];
}

/** This schema accepts a machine. A count is a whole number of 1 or more. */
export const machineSchema: z.ZodType<Machine> = z.strictObject({
  id: z.string().trim().min(1),
  lines: z.array(z.strictObject({ part: z.string().trim().min(1), count: z.number().int().positive() })),
});

/** The key of the root of the tree of a design. */
export const CLUSTER_KEY = "cluster";

/** This record is the tree of a design, and the key of each machine in the tree by the id of the machine. */
export interface DesignTree {
  readonly space: Space<string, unknown>;
  readonly keys: ReadonlyMap<string, string>;
}

/** This record is the tree of a design, or the problems of the machines. */
export type DesignTreeResult =
  | { readonly ok: true; readonly value: DesignTree }
  | { readonly ok: false; readonly problems: readonly string[] };

/** This function gives the value of a field in the tree. An amount becomes a number in the unit of its field spec. */
export const fieldValue = (spec: FieldSpec, value: unknown): unknown =>
  spec.kind === "amount" ? valueIn(value as Parameters<typeof valueIn>[0], spec.unit) : value;

/**
 * This function gives the record of a part line in the tree. The record has the kind `line`, the class, the count and
 * each field of the part. An amount becomes a number in the unit that its field spec names, with an exact conversion.
 */
export function lineRecord(part: Part, count: number): Readonly<Record<string, unknown>> {
  const fields: Readonly<Record<string, FieldSpec>> = PART_CLASSES[part.class];
  const record: Record<string, unknown> = { kind: "line", part: part.id, class: part.class, count };
  for (const [name, spec] of Object.entries(fields)) record[name] = fieldValue(spec, (part as unknown as Record<string, unknown>)[name]);
  return record;
}

/**
 * This function makes the tree of a design from its machines and a catalog of parts. A machine id that two machines
 * have and a part that is not in the catalog are problems. The keys of the tree do not contain the ids, thus each id
 * is a valid id.
 *
 * @param machines - The machines of the design
 * @param catalog - The parts by their ids
 * @returns The tree, or the problems
 */
export function designTree(machines: readonly Machine[], catalog: ReadonlyMap<string, Part>): DesignTreeResult {
  const problems: string[] = [];
  const records: Record<string, unknown> = { [CLUSTER_KEY]: { kind: "cluster" } };
  const parents: Record<string, string | null> = { [CLUSTER_KEY]: null };
  const keys = new Map<string, string>();
  machines.forEach((machine, m) => {
    if (keys.has(machine.id)) {
      problems.push(`The id ${machine.id} is on two machines.`);
      return;
    }
    const key = `m${String(m)}`;
    keys.set(machine.id, key);
    records[key] = { kind: "machine", id: machine.id };
    parents[key] = CLUSTER_KEY;
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
  });
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { space: space.tree(records, parents), keys } };
}
