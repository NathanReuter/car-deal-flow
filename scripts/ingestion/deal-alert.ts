import { execFileSync } from "node:child_process";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import { isSpecialDeal, totalCostBRL, type DealCar } from "./lib/deal-economics";

export interface AlertDeal {
  label: string;
  totalCostBRL: number;
  fipeValueBRL: number;
  pctOfFipe: number;
  sourceUrl: string;
}

export interface AlertReport {
  scanned: number;
  deals: AlertDeal[];
}

export function buildAlertReport(cars: (DealCar & { brand: string })[]): AlertReport {
  const deals = cars
    .filter(isSpecialDeal)
    .map((car) => {
      const total = totalCostBRL(car)!;
      return {
        label: `${car.brand} ${car.model} ${car.year}`.replace(/\s+/g, " ").trim(),
        totalCostBRL: total,
        fipeValueBRL: car.fipeValueBRL!,
        pctOfFipe: Math.round((1000 * total) / car.fipeValueBRL!) / 10,
        sourceUrl: car.sourceUrl,
      };
    })
    .sort((a, b) => a.pctOfFipe - b.pctOfFipe);
  return { scanned: cars.length, deals };
}

function notifyMac(report: AlertReport): void {
  if (report.deals.length === 0) return;
  const top = report.deals[0];
  const text = `${report.deals.length} special deal(s). Best: ${top.label} at ${top.pctOfFipe}% of FIPE`;
  try {
    execFileSync("osascript", ["-e", `display notification ${JSON.stringify(text)} with title "Car Deal Flow"`]);
  } catch {
    // Notification is best-effort; the JSON on stdout is the real output.
  }
}

async function main() {
  const notify = !process.argv.includes("--no-notify");
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
  const prisma = new PrismaClient({ adapter });
  try {
    const cars = await prisma.car.findMany({
      where: { pipelineStage: { in: ["new_lead", "researching", "parked"] } },
    });
    const report = buildAlertReport(cars);
    console.log(JSON.stringify(report, null, 2));
    if (notify) notifyMac(report);
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
