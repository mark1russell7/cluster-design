/**
 * A sample catalog and a sample machine for the tests and the demo. The parts are generic: no part names a maker.
 */
import { quantity } from "@mark1russell7/quantity";
import type { Machine } from "./machine.ts";
import type { Part } from "./parts.ts";

/** The parts of the sample: one part of each class, and parts that break a rule. */
export const SAMPLE_PARTS: readonly Part[] = [
  { id: "cpu-a", class: "cpu", name: "Processor A, 8 cores", socket: "S1", cores: 8, threads: 16, tdp: quantity(65, "W"), power: quantity(88, "W"), idlePower: quantity(10, "W") },
  { id: "cpu-hot", class: "cpu", name: "Processor H, 16 cores", socket: "S1", cores: 16, threads: 32, tdp: quantity(170, "W"), power: quantity(230, "W"), idlePower: quantity(20, "W") },
  { id: "cpu-s2", class: "cpu", name: "Processor B, other socket", socket: "S2", cores: 6, threads: 12, tdp: quantity(65, "W"), power: quantity(90, "W"), idlePower: quantity(9, "W") },
  {
    id: "board-a",
    class: "board",
    name: "Board A, micro ATX",
    socket: "S1",
    sockets: 1,
    formFactor: "micro-atx",
    memoryType: "ddr5",
    memorySlots: 4,
    maxMemory: quantity(192, "GiB"),
    m2Slots: 2,
    sataPorts: 4,
    power: quantity(30, "W"),
    idlePower: quantity(15, "W"),
  },
  { id: "ram-2x16", class: "memory", name: "Memory kit, 2 x 16 GiB", memoryType: "ddr5", modules: 2, moduleSize: quantity(16, "GiB"), power: quantity(6, "W"), idlePower: quantity(2, "W") },
  { id: "ram-ddr4", class: "memory", name: "Memory kit, DDR4", memoryType: "ddr4", modules: 2, moduleSize: quantity(16, "GiB"), power: quantity(6, "W"), idlePower: quantity(2, "W") },
  { id: "ssd-m2", class: "storage", name: "Drive, M.2, 1 TB", interface: "m.2", capacity: quantity(1, "TB"), power: quantity(8, "W"), idlePower: quantity(1, "W"), noise: quantity(0, "dBA") },
  { id: "hdd-sata", class: "storage", name: "Drive, SATA, 4 TB", interface: "sata", capacity: quantity(4, "TB"), power: quantity(9, "W"), idlePower: quantity(5, "W"), noise: quantity(28, "dBA") },
  {
    id: "psu-550",
    class: "psu",
    name: "Power supply, 550 W",
    formFactor: "atx",
    output: quantity(550, "W"),
    efficiency: quantity(90, "%"),
    idleEfficiency: quantity(80, "%"),
    noise: quantity(20, "dBA"),
  },
  {
    id: "psu-300",
    class: "psu",
    name: "Power supply, 300 W",
    formFactor: "atx",
    output: quantity(300, "W"),
    efficiency: quantity(85, "%"),
    idleEfficiency: quantity(75, "%"),
    noise: quantity(25, "dBA"),
  },
  {
    id: "case-a",
    class: "case",
    name: "Case A, tower",
    boardFormFactors: ["atx", "micro-atx", "mini-itx"],
    psuFormFactors: ["atx"],
    gpuLength: quantity(330, "mm"),
    coolerHeight: quantity(16, "cm"),
    fanSlots: 4,
  },
  {
    id: "cooler-a",
    class: "cooler",
    name: "Cooler A, tower",
    sockets: ["S1", "S2"],
    height: quantity(155, "mm"),
    rating: quantity(150, "W"),
    power: quantity(3, "W"),
    idlePower: quantity(1, "W"),
    noise: quantity(30, "dBA"),
  },
  { id: "fan-120", class: "fan", name: "Case fan, 120 mm", power: quantity(2, "W"), idlePower: quantity(1, "W"), noise: quantity(25, "dBA") },
  {
    id: "gpu-long",
    class: "gpu",
    name: "Graphics card, 340 mm",
    length: quantity(340, "mm"),
    power: quantity(200, "W"),
    idlePower: quantity(15, "W"),
    noise: quantity(35, "dBA"),
  },
];

/** A machine of the sample parts that fits each rule. */
export const SAMPLE_MACHINE: Machine = {
  id: "node-1",
  lines: [
    { part: "cpu-a", count: 1 },
    { part: "board-a", count: 1 },
    { part: "ram-2x16", count: 2 },
    { part: "ssd-m2", count: 1 },
    { part: "hdd-sata", count: 2 },
    { part: "psu-550", count: 1 },
    { part: "case-a", count: 1 },
    { part: "cooler-a", count: 1 },
    { part: "fan-120", count: 2 },
  ],
};
