import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import type { RiskCheckItem, RiskCheckKey } from "../../src/lib/types";

export const AUTOMATABLE_KEYS: RiskCheckKey[] = [
  "recall_status",
  "registration_consistency",
  "chassis_consistency",
  "financing_lien",
  "judicial_restriction",
  "overdue_taxes_fines",
];

const ACTIVE_STAGES = ["new_lead", "researching", "waiting_docs", "inspected", "negotiating"];

export interface SyncTarget {
  carId: string;
  plate: string | null;
  chassis: string | null;
  brand: string;
  model: string;
  year: number;
  key: RiskCheckKey;
}

export interface ListTargetsOptions {
  carId?: string;
  staleDays?: number;
}

export async function listTargets(prisma: PrismaClient, options: ListTargetsOptions = {}): Promise<SyncTarget[]> {
  const staleDays = options.staleDays ?? 30;
  const staleCutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  const cars = await prisma.car.findMany({
    where: options.carId
      ? { id: options.carId }
      : { pipelineStage: { in: ACTIVE_STAGES } },
    include: { riskCheck: true },
  });

  const targets: SyncTarget[] = [];

  for (const car of cars) {
    if (!car.riskCheck) continue;
    const items = JSON.parse(car.riskCheck.items) as RiskCheckItem[];

    for (const key of AUTOMATABLE_KEYS) {
      const item = items.find((i) => i.key === key);
      if (!item) continue;

      const isPending = item.status === "pending";
      const isStaleAgentCheck =
        item.checkedBy === "agent" &&
        item.checkedAt !== undefined &&
        new Date(item.checkedAt).getTime() < staleCutoff;

      if (isPending || isStaleAgentCheck) {
        targets.push({
          carId: car.id,
          plate: car.plate,
          chassis: car.chassis,
          brand: car.brand,
          model: car.model,
          year: car.year,
          key,
        });
      }
    }
  }

  return targets;
}

function parseArgs(argv: string[]) {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const carId = get("--car");
  const staleDaysRaw = get("--stale-days");
  return {
    carId,
    staleDays: staleDaysRaw ? parseInt(staleDaysRaw, 10) : undefined,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
  const prisma = new PrismaClient({ adapter });
  try {
    const targets = await listTargets(prisma, options);
    console.log(JSON.stringify(targets, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
