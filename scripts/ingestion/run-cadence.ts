import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { sourcesDueOn } from "./lib/cadence-schedule";

export interface CadenceCommand {
  name: string;
  args: string[];
}

export function planCommands(date: Date): CadenceCommand[] {
  const harvests = sourcesDueOn(date).map((source) => ({
    name: `harvest:${source}`,
    args: ["scripts/ingestion/harvest.ts", "--source", source],
  }));
  return [
    ...harvests,
    { name: "cleanup", args: ["scripts/ingestion/post-harvest-cleanup.ts"] },
    { name: "fipe-sync", args: ["scripts/ingestion/fipe-sync.ts"] },
    { name: "goal-filter", args: ["scripts/ingestion/apply-goal-filter.ts"] },
    { name: "deal-alert", args: ["scripts/ingestion/deal-alert.ts"] },
  ];
}

function parseDate(argv: string[]): Date {
  const i = argv.indexOf("--date");
  if (i === -1) return new Date();
  const parsed = new Date(`${argv[i + 1]}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid --date: ${argv[i + 1]}`);
  return parsed;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const date = parseDate(argv);
  const projectRoot = path.resolve(import.meta.dirname, "../..");
  const tsxBin = path.join(projectRoot, "node_modules/.bin/tsx");
  const commands = planCommands(date);

  mkdirSync(path.join(projectRoot, "logs"), { recursive: true });
  console.log(`[cadence] ${date.toDateString()} — ${commands.length} steps`);

  const failures: string[] = [];
  for (const cmd of commands) {
    console.log(`\n[cadence] step: ${cmd.name}`);
    if (dryRun) {
      console.log(`[cadence] would run: tsx ${cmd.args.join(" ")}`);
      continue;
    }
    // A failed step (e.g. expired VIP login session) must not block the rest
    // of the chain — cleanup/filter/alert still run on whatever harvested.
    const result = spawnSync(tsxBin, cmd.args, { cwd: projectRoot, stdio: "inherit" });
    if (result.status !== 0) {
      failures.push(cmd.name);
      console.error(`[cadence] step FAILED: ${cmd.name} (exit ${result.status})`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n[cadence] finished with failures: ${failures.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`\n[cadence] all steps completed`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
