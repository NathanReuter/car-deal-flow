import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  const existing = await prisma.buyingGoal.findFirst({ where: { active: true } });
  if (existing) {
    console.log(`Active goal already present: ${existing.name}`);
    return;
  }
  await prisma.buyingGoal.create({
    data: {
      name: "Primary buy — prefer T-Cross / Nivus / HR-V / BYD / RAV4",
      active: true,
      budgetMinBRL: 60_000,
      budgetMaxBRL: 1_000_000,
      minYear: 2021,
      maxMileageKm: 90_000,
      requiredFeatures: JSON.stringify([]),
      preferredBodyTypes: JSON.stringify(["hatch", "sedan", "suv"]),
      preferredBrands: JSON.stringify([]),
      excludedBrandsModels: JSON.stringify([]),
      fuelEconomyThresholdKmL: 10,
      minResaleLiquidityScore: 50,
      familySpaceRequired: false,
    },
  });
  console.log("Seeded active buying goal.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
