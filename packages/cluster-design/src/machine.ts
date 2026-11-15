/**
 * The machines of a design, and the tree that the fit rules read. The root of the tree is the cluster. Its children
 * are the machines, and the children of a machine are its part lines and its work lines. A part line is one part and
 * its count. A work line is one class of work and the count of its units on the machine.
 */
import { space, type Space } from "@mark1russell7/vex";
import { z } from "zod";
import type { Part } from "./parts.ts";
import { addLines, workClassesById } from "./lines.ts";
import type { WorkClass } from "./variables.ts";

export { fieldValue, lineRecord, WORK_KIND, workRecord } from "./lines.ts";

/** This record is one line of a machine: the id of a part in the catalog, and the count of that part. */
export interface PartLine {
  readonly part: string;
  readonly count: number;
}

/** This record is one work line of a machine: the id of a class of work, and the count of its units on the machine. */
export interface WorkLine {
  readonly class: string;
  readonly count: number;
}

/** This record is one machine of a design: its id, its part lines, and its work lines. A machine with no work lines runs only CI jobs. */
export interface Machine {
  readonly id: string;
  readonly lines: readonly PartLine[];
  readonly work?: readonly WorkLine[];
}

/** This schema accepts a machine. A count is a whole number of 1 or more. */
export const machineSchema: z.ZodType<Machine> = z.strictObject({
  id: z.string().trim().min(1),
  lines: z.array(z.strictObject({ part: z.string().trim().min(1), count: z.number().int().positive() })),
  work: z.array(z.strictObject({ class: z.string().trim().min(1), count: z.number().int().positive() })).optional(),
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

/**
 * This function makes the tree of a design from its machines and a catalog of parts. A machine id that two machines
 * have and a part that is not in the catalog are problems. The keys of the tree do not contain the ids, thus each id
 * is a valid id.
 *
 * @param machines - The machines of the design
 * @param catalog - The parts by their ids
 * @param work - The classes of work that the work lines name
 * @returns The tree, or the problems
 */
export function designTree(machines: readonly Machine[], catalog: ReadonlyMap<string, Part>, work: readonly WorkClass[] = []): DesignTreeResult {
  const problems: string[] = [];
  const records: Record<string, unknown> = { [CLUSTER_KEY]: { kind: "cluster" } };
  const parents: Record<string, string | null> = { [CLUSTER_KEY]: null };
  const keys = new Map<string, string>();
  const classes = workClassesById(work);
  machines.forEach((machine, m) => {
    if (keys.has(machine.id)) {
      problems.push(`The id ${machine.id} is on two machines.`);
      return;
    }
    const key = `m${String(m)}`;
    keys.set(machine.id, key);
    records[key] = { kind: "machine", id: machine.id };
    parents[key] = CLUSTER_KEY;
    addLines({ records, parents }, key, machine, catalog, classes, problems);
  });
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { space: space.tree(records, parents), keys } };
}
