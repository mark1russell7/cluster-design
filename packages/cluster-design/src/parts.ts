/**
 * The classes of the parts of a computer, as data. Each class names its fields, and each field has a kind.
 * An amount has a kind of `@mark1russell7/quantity` and the unit that the fit rules read.
 */
import type { Kind, Quantity } from "@mark1russell7/quantity";
import { quantitySchema } from "@mark1russell7/quantity/schema";
import { z } from "zod";

/** This record is a field of a part class. */
export type FieldSpec =
  | { readonly kind: "text" }
  | { readonly kind: "texts" }
  | { readonly kind: "count" }
  | { readonly kind: "choice"; readonly options: readonly string[] }
  | { readonly kind: "amount"; readonly quantity: Kind; readonly unit: string };

/**
 * This table has the fields of each part class. The field `power` is the most power that one part takes.
 * A memory part is one kit: `modules` modules of `moduleSize` each.
 */
export const PART_CLASSES = {
  cpu: {
    socket: { kind: "text" },
    cores: { kind: "count" },
    threads: { kind: "count" },
    tdp: { kind: "amount", quantity: "power", unit: "W" },
    power: { kind: "amount", quantity: "power", unit: "W" },
  },
  board: {
    socket: { kind: "text" },
    sockets: { kind: "count" },
    formFactor: { kind: "text" },
    memoryType: { kind: "text" },
    memorySlots: { kind: "count" },
    maxMemory: { kind: "amount", quantity: "data", unit: "GiB" },
    m2Slots: { kind: "count" },
    sataPorts: { kind: "count" },
    power: { kind: "amount", quantity: "power", unit: "W" },
  },
  memory: {
    memoryType: { kind: "text" },
    modules: { kind: "count" },
    moduleSize: { kind: "amount", quantity: "data", unit: "GiB" },
    power: { kind: "amount", quantity: "power", unit: "W" },
  },
  storage: {
    interface: { kind: "choice", options: ["m.2", "sata"] },
    capacity: { kind: "amount", quantity: "data", unit: "GB" },
    power: { kind: "amount", quantity: "power", unit: "W" },
  },
  psu: {
    formFactor: { kind: "text" },
    output: { kind: "amount", quantity: "power", unit: "W" },
  },
  case: {
    boardFormFactors: { kind: "texts" },
    psuFormFactors: { kind: "texts" },
    gpuLength: { kind: "amount", quantity: "length", unit: "mm" },
    coolerHeight: { kind: "amount", quantity: "length", unit: "mm" },
  },
  cooler: {
    sockets: { kind: "texts" },
    height: { kind: "amount", quantity: "length", unit: "mm" },
    rating: { kind: "amount", quantity: "power", unit: "W" },
    power: { kind: "amount", quantity: "power", unit: "W" },
  },
  gpu: {
    length: { kind: "amount", quantity: "length", unit: "mm" },
    power: { kind: "amount", quantity: "power", unit: "W" },
  },
} as const;

/** This type is the name of a part class. */
export type PartClass = keyof typeof PART_CLASSES;

/** This list has the names of the part classes, in the order of the table. */
export const PART_CLASS_NAMES: readonly PartClass[] = Object.keys(PART_CLASSES) as PartClass[];

/** This type is the value of a field of the kind `F`. */
export type FieldValue<F> = F extends { readonly kind: "text" }
  ? string
  : F extends { readonly kind: "texts" }
    ? readonly string[]
    : F extends { readonly kind: "count" }
      ? number
      : F extends { readonly kind: "choice"; readonly options: readonly (infer O)[] }
        ? O
        : Quantity;

/** This type is a part of the class `C`: its id, its name and the fields of its class. */
export type PartOf<C extends PartClass> = {
  readonly id: string;
  readonly class: C;
  readonly name: string;
} & { readonly [K in keyof (typeof PART_CLASSES)[C]]: FieldValue<(typeof PART_CLASSES)[C][K]> };

/** This type is a part of each class. */
export type Part = { [C in PartClass]: PartOf<C> }[PartClass];

const fieldSchema = (spec: FieldSpec): z.ZodType => {
  switch (spec.kind) {
    case "text":
      return z.string().trim().min(1);
    case "texts":
      return z.array(z.string().trim().min(1));
    case "count":
      return z.number().int().nonnegative();
    case "choice":
      return z.enum(spec.options as [string, ...string[]]);
    case "amount":
      return quantitySchema(spec.quantity, { nonnegative: true });
  }
};

const classSchema = (name: PartClass): z.ZodObject =>
  z.strictObject({
    id: z.string().trim().min(1),
    class: z.literal(name),
    name: z.string().trim().min(1),
    ...Object.fromEntries(Object.entries(PART_CLASSES[name]).map(([field, spec]) => [field, fieldSchema(spec)])),
  });

/** This schema accepts a part of each class. A field that is not in the class of the part is a problem. */
export const partSchema: z.ZodType<Part> = z.discriminatedUnion("class", PART_CLASS_NAMES.map(classSchema) as [z.ZodObject, ...z.ZodObject[]]) as unknown as z.ZodType<Part>;

/** This record is a catalog of parts by their ids, or the problems of the parts that are not valid. */
export type CatalogResult =
  | { readonly ok: true; readonly value: ReadonlyMap<string, Part> }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * This function reads a list of parts into a catalog. Each part that is not valid gives one problem, and an id
 * that two parts have gives one problem.
 *
 * @param values - The parts as data
 * @returns The catalog by id, or the problems
 */
export function readCatalog(values: readonly unknown[]): CatalogResult {
  const problems: string[] = [];
  const catalog = new Map<string, Part>();
  values.forEach((value, index) => {
    const parsed = partSchema.safeParse(value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue === undefined || issue.path.length === 0 ? "" : ` at ${issue.path.join(".")}`;
      problems.push(`The part ${String(index)} is not valid${where}: ${issue?.message ?? "no detail"}.`);
      return;
    }
    if (catalog.has(parsed.data.id)) {
      problems.push(`The id ${parsed.data.id} is on two parts.`);
      return;
    }
    catalog.set(parsed.data.id, parsed.data);
  });
  return problems.length === 0 ? { ok: true, value: catalog } : { ok: false, problems };
}
