// Establishes (or refreshes) the saved VIP Leilões session used by
// vip-leiloes-fetch.ts.
//
//   npx tsx scripts/ingestion/vip-leiloes-login.ts
//
// If VIP_LEILOES_LOGIN / VIP_LEILOES_SENHA are set (.env.local), logs in
// automatically, headless. Otherwise opens a REAL, VISIBLE browser window
// for you to log in yourself — this script only ever touches the password
// itself when you've explicitly put it in .env.local; the interactive path
// never sees it.
//
// minhaconta.vipleiloes.com.br sits behind Cloudflare bot detection that
// blocks a plain headless Playwright browser (verified: plain Playwright
// gets a 403 "Attention Required" page; playwright-extra + the stealth
// plugin gets a real 200 with the login form). Both this script and
// vip-leiloes-fetch.ts use the stealth-patched browser for that reason.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { STATE_PATH, LOGIN_URL, isLoggedIn } from "./vip-leiloes-session";

chromium.use(stealth());

class VipLoginError extends Error {}

async function loginWithCredentials(page: import("playwright").Page, login: string, senha: string): Promise<void> {
  await page.goto(LOGIN_URL, { waitUntil: "networkidle" });
  await page.fill("#Login", login);
  await page.fill("#Senha", senha);
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.click('button[type="submit"], input[type="submit"]'),
  ]);

  if (!(await isLoggedIn(page))) {
    throw new VipLoginError(
      "Login submitted but VIP Leilões still shows the login page — check VIP_LEILOES_LOGIN/VIP_LEILOES_SENHA in .env.local, or the account may need manual verification (CAPTCHA, email confirmation, etc). Run this script without those env vars set to log in interactively instead.",
    );
  }
}

async function loginInteractively(page: import("playwright").Page): Promise<void> {
  await page.goto(LOGIN_URL, { waitUntil: "networkidle" });

  console.log("\nA browser window has opened. Log into VIP Leilões yourself —");
  console.log("this script does not see your password, only the session it produces.");
  console.log("Waiting for you to finish logging in (up to 5 minutes)...\n");

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    if (await isLoggedIn(page)) return;
    await page.waitForTimeout(2000);
  }

  throw new VipLoginError("Timed out waiting for login (5 minutes). Run this script again when ready.");
}

async function main() {
  mkdirSync(dirname(STATE_PATH), { recursive: true });

  const login = process.env.VIP_LEILOES_LOGIN;
  const senha = process.env.VIP_LEILOES_SENHA;
  const automated = Boolean(login && senha);

  const browser = await chromium.launch({ headless: automated });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    if (automated) {
      console.log("VIP_LEILOES_LOGIN/SENHA found — logging in automatically (headless).");
      await loginWithCredentials(page, login!, senha!);
    } else {
      await loginInteractively(page);
    }

    await context.storageState({ path: STATE_PATH });
    console.log(`Logged in. Session saved to ${STATE_PATH}.`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
