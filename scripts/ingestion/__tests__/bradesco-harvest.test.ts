import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { harvestBradescoLots } from "../bradesco-harvest";

describe("harvestBradescoLots", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-run tallies parsed leads without writing", async () => {
    const root = mkdtempSync(join(tmpdir(), "bradesco-harvest-"));
    dirs.push(root);
    const listPath = join(root, "list.json");
    const detailsDir = join(root, "details");
    mkdirSync(detailsDir, { recursive: true });

    const list = {
      lots: [
        {
          guid: "aaa-111",
          slug: "vw-t-cross-sense-tsi-2022-2022-9_2",
          name: "VOLKSWAGEN - T CROSS SENSE TSI - 2022 / 2022",
          price: 47000,
          category: "Carro",
          description: "Vw, T Cross Sense Tsi, 2022, 2022, Preta, Flex, Km 116406",
        },
      ],
    };
    writeFileSync(listPath, JSON.stringify(list), "utf8");
    writeFileSync(
      join(detailsDir, "aaa-111.json"),
      JSON.stringify({
        guid: "aaa-111",
        slug: "vw-t-cross-sense-tsi-2022-2022-9_2",
        name: "VOLKSWAGEN - T CROSS SENSE TSI - 2022 / 2022",
        price: 47000,
        description: "Vw, T Cross Sense Tsi, 2022, 2022, Preta, Flex, Km 116406",
        vehicle_type_of_recovery: "Retomado",
        auctioneer: { name: "Freitas Leiloeiro" },
      }),
      "utf8",
    );

    const summary = await harvestBradescoLots({
      listPath,
      detailsDir,
      dryRun: true,
      summaryOut: join(root, "summary.json"),
    });

    expect(summary.scanned).toBe(1);
    expect(summary.written.created + summary.written.updated + summary.written.merged).toBe(1);
    expect(summary.skipped).toEqual({});
  });
});
