/**
 * Resolve DATABASE_URL for CLI scripts (tsx / npm run harvest:*).
 * Node does not auto-load .env; Next.js does, so the app can omit this helper.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

let loaded = false;

export function loadScriptEnv(): void {
  if (loaded) return;
  const root = process.cwd();
  // quiet: avoid spamming dotenv tips on every spawned write-lead subprocess
  loadEnv({ path: resolve(root, ".env"), quiet: true });
  // .env.local overrides for local secrets (same convention as Next.js)
  loadEnv({ path: resolve(root, ".env.local"), override: true, quiet: true });
  loaded = true;
}

export function requireDatabaseUrl(): string {
  loadScriptEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env (e.g. DATABASE_URL="file:./dev.db") — scripts no longer fall back to prisma/dev.db.',
    );
  }
  return url;
}
