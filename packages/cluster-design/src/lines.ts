/**
 * The lines of a machine in a tree: its part lines and its work lines. The tree of a design and the tree of a site
 * use the same lines. The module `machine.ts` exports the records of the lines.
 */
import { valueIn } from "@mark1russell7/quantity";
import type { Machine } from "./machine.ts";
import { PART_CLASSES, type FieldSpec, type Part } from "./parts.ts";
import type { WorkClass } from "./variables.ts";

/** The kind of the record of a work line in the tree. Its class is also `work`, so a test of a part class gives false for it. */
export const WORK_KIND = "work";

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
 * This function gives the record of a work line in the tree. The record has the kind `work` and the class `work`.
 * Its field `work` has the id of the work class. It also has the count, and the threads and the memory of one unit.
 */
export function workRecord(work: WorkClass, count: number): Readonly<Record<string, unknown>> {
  return { kind: WORK_KIND, class: WORK_KIND, work: work.id, count, threads: work.threads, memory: work.memory };
}


/**
 * This function adds the part lines and the work lines of a machine to a tree. Each line is a child of the key of
 * the machine. A part that is not in the catalog and a work class that the classes do not have are problems.
 */
export function addLines(
  tree: { readonly records: Record<string, unknown>; readonly parents: Record<string, string | null> },
  key: string,
  machine: Machine,
  catalog: ReadonlyMap<string, Part>,
  classes: ReadonlyMap<string, WorkClass>,
  problems: string[],
): void {
  machine.lines.forEach((line, l) => {
    const part = catalog.get(line.part);
    if (part === undefined) {
      problems.push(`The machine ${machine.id} names the part ${line.part}, but the catalog does not have it.`);
      return;
    }
    const lineKey = `${key}.${String(l)}`;
    tree.records[lineKey] = lineRecord(part, line.count);
    tree.parents[lineKey] = key;
  });
  (machine.work ?? []).forEach((line, w) => {
    const work = classes.get(line.class);
    if (work === undefined) {
      problems.push(`The machine ${machine.id} names the work class ${line.class}, but the options do not have it.`);
      return;
    }
    const workKey = `${key}.w${String(w)}`;
    tree.records[workKey] = workRecord(work, line.count);
    tree.parents[workKey] = key;
  });
}

/** This function gives the work classes by their ids. */
export const workClassesById = (classes: readonly WorkClass[] = []): ReadonlyMap<string, WorkClass> => new Map(classes.map((work) => [work.id, work]));

