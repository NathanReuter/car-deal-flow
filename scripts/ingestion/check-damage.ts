/**
 * Check listing text for damage/sinistro signals (harvest preflight).
 *
 *   ./node_modules/.bin/tsx scripts/ingestion/check-damage.ts "<notes or description>"
 *   echo "Sinistro: COLISÃO" | ./node_modules/.bin/tsx scripts/ingestion/check-damage.ts
 */
import {
  detectDamageSignals,
  formatDamageRejection,
} from "../../src/lib/filters/damageSignals";

async function main() {
  let text = process.argv[2] ?? "";
  if (!text && !process.stdin.isTTY) {
    text = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on("data", (c) => chunks.push(c));
      process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      process.stdin.on("error", reject);
    });
  }

  const result = detectDamageSignals(text);
  console.log(
    JSON.stringify(
      {
        blocked: result.blocked,
        reasons: result.reasons,
        rejection: result.blocked ? formatDamageRejection(result.reasons) : null,
      },
      null,
      2,
    ),
  );
  process.exitCode = result.blocked ? 1 : 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
