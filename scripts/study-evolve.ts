/**
 * The study of the genetic search against a seeded sample, over the design space of the sample site.
 *
 * The truth is the sweep of the grid of the space at 4 levels: each config of the space. Its front is the set of the
 * distinct objective vectors of rank 1. For each budget and each seed, the script runs two arms with one count of
 * evaluations:
 *
 * - The sample arm sweeps a seeded sample of `budget` configs. A repeat of a config gets no evaluation.
 * - The genetic arm runs `evolveDesigns` with the count of the evaluations of the sample arm, and the same seed.
 *
 * The measure of an arm is its front recall: the share of the vectors of the true front among its feasible rows. The
 * noise is the SD of the recall of the sample arm over the seeds. A mean difference within 2 SD is no result.
 *
 * Run: node scripts/study-evolve.ts [--seeds 10] [--budgets 200,400] [--out study-evolve.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { mean, sd, signTest } from "@mark1russell7/rigor-statistics";
import {
  DESIGN_OBJECTIVES,
  designSpace,
  evolveDesigns,
  readCatalog,
  sweepDesigns,
  type DesignInput,
  type DesignSpace,
} from "../packages/cluster-design/src/index.ts";
import { SAMPLE_MACHINE, SAMPLE_PARTS, SAMPLE_SITE } from "../packages/cluster-design/src/sample.ts";

/** The fields of a row that the study reads. */
interface StudyRow {
  readonly status: string;
  readonly rank: number | null;
  readonly values: Readonly<Record<string, number | null>>;
}

/** The record of one arm at one seed. */
interface ArmRecord {
  readonly rows: number;
  readonly repeats: number;
  readonly feasible: number;
  readonly found: number;
  readonly recall: number;
  readonly generations?: number;
  readonly stop?: string;
}

const { values: args } = parseArgs({
  options: {
    seeds: { type: "string", default: "10" },
    budgets: { type: "string", default: "200,400" },
    out: { type: "string", default: "study-evolve.json" },
  },
});
const seedCount = Number(args.seeds);
const budgets = args.budgets.split(",").map(Number);
if (!Number.isInteger(seedCount) || seedCount < 2) throw new RangeError(`The count of the seeds is ${args.seeds}, and the noise needs 2 or more.`);
if (budgets.some((b) => !Number.isInteger(b) || b < 2)) throw new RangeError(`The budgets ${args.budgets} are not whole numbers of 2 or more.`);
const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);

const read = readCatalog(SAMPLE_PARTS);
if (!read.ok) throw new Error(read.problems.join(" "));
const input: DesignInput = { catalog: read.value, site: SAMPLE_SITE, fixed: [SAMPLE_MACHINE, { ...SAMPLE_MACHINE, id: "node-2" }] };
const made = designSpace(read.value, { site: input });
if (!made.ok) throw new Error(made.problems.join(" "));
const space: DesignSpace = made.value;

const names = DESIGN_OBJECTIVES.map((objective) => objective.name);
/** This function gives the key of the objective vector of a feasible row. */
const keyOf = (row: StudyRow): string => names.map((name) => (row.values[name] ?? Number.NaN).toPrecision(12)).join(" ");
const feasibleKeys = (rows: readonly StudyRow[]): Set<string> => new Set(rows.filter((row) => row.status === "feasible").map(keyOf));

const started = performance.now();
const grid = sweepDesigns(space, input, { enumerate: { mode: "grid", levels: 4 } });
if (!grid.ok) throw new Error(grid.problems.join(" "));
const front = new Set(grid.value.run.rows.filter((row) => row.status === "feasible" && row.rank === 1).map(keyOf));
if (front.size === 0) throw new Error("The grid has no feasible row, so the study has no front.");

/** This function gives the record of an arm: its rows, its feasible rows and its front recall. */
const armOf = (rows: readonly StudyRow[], repeats: number): ArmRecord => {
  const keys = feasibleKeys(rows);
  const found = [...front].filter((key) => keys.has(key)).length;
  return { rows: rows.length, repeats, feasible: rows.filter((row) => row.status === "feasible").length, found, recall: found / front.size };
};

const studies = budgets.map((budget) => {
  const runs = seeds.map((seed) => {
    const sampled = sweepDesigns(space, input, { enumerate: { mode: "sample", n: budget, seed } });
    if (!sampled.ok) throw new Error(sampled.problems.join(" "));
    const sample = armOf(sampled.value.run.rows, sampled.value.run.repeats);
    const evolved = evolveDesigns(space, input, { seed, evaluations: sample.rows });
    if (!evolved.ok) throw new Error(evolved.problems.join(" "));
    const { run } = evolved.value;
    const evolve: ArmRecord = { ...armOf(run.rows, run.repeats), generations: run.generations, stop: run.stop };
    return { seed, sample, evolve, difference: evolve.recall - sample.recall };
  });
  const differences = runs.map((r) => r.difference);
  const noise = sd(runs.map((r) => r.sample.recall));
  const meanDifference = mean(differences);
  const better = differences.filter((d) => d > 0).length;
  const worse = differences.filter((d) => d < 0).length;
  const result = meanDifference > 2 * noise ? "evolve-higher" : meanDifference < -2 * noise ? "sample-higher" : "within-noise";
  return {
    budget,
    sample: { mean: mean(runs.map((r) => r.sample.recall)), sd: noise },
    evolve: { mean: mean(runs.map((r) => r.evolve.recall)), sd: sd(runs.map((r) => r.evolve.recall)) },
    meanDifference,
    noise,
    better,
    worse,
    ties: differences.length - better - worse,
    signTestP: signTest(better, worse, 1),
    result,
    runs,
  };
});

const version = (name: string): string =>
  (JSON.parse(readFileSync(new URL(`../packages/cluster-design/node_modules/@mark1russell7/${name}/package.json`, import.meta.url), "utf8")) as { version: string }).version;
const record = {
  schema: "cluster-design-study-evolve/1",
  commit: process.env["GITHUB_SHA"] ?? null,
  versions: { "strategy-search": version("strategy-search"), "strategy-space": version("strategy-space") },
  measure: "front recall: the share of the distinct objective vectors of rank 1 of the grid at 4 levels among the feasible rows of an arm",
  rule: "evolve-higher when the mean difference (evolve - sample) is above 2 SD of the sample recall over the seeds, sample-higher below -2 SD, else within-noise",
  grid: { rows: grid.value.run.rows.length, feasible: grid.value.run.counts.feasible, front: front.size, evaluator: grid.value.run.evaluator },
  seeds,
  studies,
  seconds: Math.round((performance.now() - started) / 100) / 10,
};
writeFileSync(args.out, `${JSON.stringify(record, null, 2)}\n`);

console.log(`grid: ${String(record.grid.rows)} rows, ${String(record.grid.feasible)} feasible, a front of ${String(front.size)} vectors`);
for (const s of studies) {
  const fixed = (value: number): string => value.toFixed(3);
  console.log(
    `budget ${String(s.budget)}: sample ${fixed(s.sample.mean)} ± ${fixed(s.sample.sd)}, evolve ${fixed(s.evolve.mean)} ± ${fixed(s.evolve.sd)}, difference ${fixed(s.meanDifference)}, ` +
      `${String(s.better)} better ${String(s.worse)} worse, sign test p ${s.signTestP.toPrecision(3)}: ${s.result}`,
  );
}
console.log(`${args.out}: ${String(record.seconds)} s`);
