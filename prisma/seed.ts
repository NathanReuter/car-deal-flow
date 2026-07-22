import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { requireDatabaseUrl } from "../scripts/lib/database-url";

const adapter = new PrismaBetterSqlite3({ url: requireDatabaseUrl() });
const prisma = new PrismaClient({ adapter });

async function main() {
  const existing = await prisma.buyingGoal.findFirst({ where: { active: true } });
  if (existing) {
    console.log(`Active goal already present: ${existing.name}`);
    return;
  }
  // Mirrors the live production goal (goal-01) as of 2026-07-22. This is only a
  // bootstrap default for a fresh DB with no active goal yet — the /goal UI page
  // is the source of truth going forward. Keep preferredBodyTypes SUV-only:
  // computeGoalFit hard-rejects any body type outside this list (see
  // src/lib/scoring/goalFit.ts), so re-adding "hatch"/"sedan" here would let
  // entry-segment cars back into new_lead/parked on a fresh environment.
  await prisma.buyingGoal.create({
    data: {
      name: "Family SUV/Hatch upgrade — 2026 H2",
      active: true,
      budgetMinBRL: 60_000,
      budgetMaxBRL: 100_000,
      minYear: 2022,
      maxMileageKm: 70_000,
      requiredFeatures: JSON.stringify(["Reverse Camera", "Bluetooth/CarPlay"]),
      preferredBodyTypes: JSON.stringify(["suv"]),
      preferredBrands: JSON.stringify(["Toyota", "Honda", "Volkswagen", "Hyundai", "Chevrolet", "Byd"]),
      excludedBrandsModels: JSON.stringify(["Jeep Renegade"]),
      fuelEconomyThresholdKmL: 9,
      minResaleLiquidityScore: 55,
      familySpaceRequired: true,
    },
  });
  console.log("Seeded active buying goal.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
