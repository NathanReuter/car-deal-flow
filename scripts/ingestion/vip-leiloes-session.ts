import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";

export const STATE_PATH = join(process.cwd(), ".claude/browser-profile/vip-leiloes-state.json");
export const LOGIN_URL = "https://minhaconta.vipleiloes.com.br/conta/entrar";
export const BASE_URL = "https://minhaconta.vipleiloes.com.br";

export class VipSessionError extends Error {}

export function requireVipSessionPath(): string {
  if (!existsSync(STATE_PATH)) {
    throw new VipSessionError(
      `Missing VIP session at ${STATE_PATH}. Run: ./node_modules/.bin/tsx scripts/ingestion/vip-leiloes-login.ts`,
    );
  }
  return STATE_PATH;
}

/** True once the account/dashboard loads instead of being redirected to /conta/entrar. */
export async function isLoggedIn(page: Page): Promise<boolean> {
  return !page.url().toLowerCase().includes("/conta/entrar");
}
