import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../../src/generated/prisma/client";

export interface TestDbContext {
  prisma: PrismaClient;
  cleanup: () => Promise<void>;
}

export function createTestDb(): TestDbContext {
  const dir = mkdtempSync(join(tmpdir(), "cdf-test-"));
  const dbPath = join(dir, "test.db");
  const databaseUrl = `file:${dbPath}`;

  execSync("npx prisma db push", {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
