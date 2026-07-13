import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import type { CheckSeverity, CheckStatus, RiskCheckItem, RiskCheckKey } from "../../src/lib/types";

const VALID_STATUSES: CheckStatus[] = ["verified", "pending", "warning", "failed"];
const VALID_SEVERITIES: CheckSeverity[] = ["low", "medium", "high", "severe"];

export interface WriteResultInput {
  carId: string;
  key: RiskCheckKey;
  status: CheckStatus;
  severity: CheckSeverity;
  notes: string;
  evidenceUrl?: string;
}

export class WriteResultError extends Error {}

export async function writeResult(prisma: PrismaClient, input: WriteResultInput): Promise<void> {
  if (!VALID_STATUSES.includes(input.status)) {
    throw new WriteResultError(`Invalid status "${input.status}". Must be one of: ${VALID_STATUSES.join(", ")}`);
  }
  if (!VALID_SEVERITIES.includes(input.severity)) {
    throw new WriteResultError(`Invalid severity "${input.severity}". Must be one of: ${VALID_SEVERITIES.join(", ")}`);
  }

  const riskCheck = await prisma.riskCheck.findUnique({ where: { carId: input.carId } });
  if (!riskCheck) {
    throw new WriteResultError(`No RiskCheck row found for car "${input.carId}".`);
  }

  const items = JSON.parse(riskCheck.items) as RiskCheckItem[];
  const index = items.findIndex((i) => i.key === input.key);
  if (index === -1) {
    throw new WriteResultError(`Key "${input.key}" not found in RiskCheck items for car "${input.carId}".`);
  }

  items[index] = {
    ...items[index],
    status: input.status,
    severity: input.severity,
    notes: input.notes,
    evidenceUrl: input.evidenceUrl,
    checkedBy: "agent",
    checkedAt: new Date().toISOString(),
  };

  await prisma.riskCheck.update({
    where: { carId: input.carId },
    data: { items: JSON.stringify(items) },
  });
}

function parseArgs(argv: string[]): WriteResultInput {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };

  const carId = get("--car");
  const key = get("--key");
  const status = get("--status");
  const severity = get("--severity");
  const notes = get("--notes");
  const evidenceUrl = get("--evidence-url");

  if (!carId || !key || !status || !severity || !notes) {
    throw new WriteResultError(
      "Usage: write-result.ts --car <id> --key <key> --status <status> --severity <severity> --notes <text> [--evidence-url <url>]",
    );
  }

  return {
    carId,
    key: key as RiskCheckKey,
    status: status as CheckStatus,
    severity: severity as CheckSeverity,
    notes,
    evidenceUrl,
  };
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
  const prisma = new PrismaClient({ adapter });
  try {
    await writeResult(prisma, input);
    console.log(`Wrote ${input.key} for car ${input.carId}: ${input.status}/${input.severity}`);
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
