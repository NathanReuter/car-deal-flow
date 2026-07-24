import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

/** Next.js loads .env for the app; CLI scripts that import aggregate→db need this. */
function resolveDatabaseUrl(): string {
  let url = process.env.DATABASE_URL?.trim();
  if (!url) {
    const root = process.cwd();
    loadEnv({ path: resolve(root, ".env"), quiet: true });
    loadEnv({ path: resolve(root, ".env.local"), override: true, quiet: true });
    url = process.env.DATABASE_URL?.trim();
  }
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env (e.g. DATABASE_URL="file:./dev.db").',
    );
  }
  return url;
}

const url = resolveDatabaseUrl();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
