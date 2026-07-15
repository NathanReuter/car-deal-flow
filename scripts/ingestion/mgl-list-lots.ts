// Lists lot URLs for an MGL auction via ApiEngine/GetLotesLeilao (POST).
// Same Playwright+stealth stack as mgl-fetch. Does not interpret lot fields.
//
//   ./node_modules/.bin/tsx scripts/ingestion/mgl-list-lots.ts <auctionUrl> --out /tmp/mgl-lots.json

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import {
  assertFinalUrlAllowed,
  assertHttpOk,
  assertNotCloudflareBlock,
  assertSafeOutPath,
  isCliEntry,
  parseUrlAndOptionalOut,
} from "./fetch-guards";
import { assertAllowedMglUrl, MGL_ALLOWED_HOSTS, MglFetchError } from "./mgl-fetch";

chromium.use(stealth());

type LotRow = {
  ID_Leiloes_Lote?: number;
  URLlote?: string;
  Titulo?: string;
  Descricao?: string;
  Categoria?: string;
  ValorVendaDireta?: number;
  ValorAvaliacao?: number;
  GetLoteRealTime?: Array<{
    StatusLote?: string;
    StatusLeilao?: string;
    Lote_SubStatus_Label?: string;
    PracaAtual?: number;
    ProximoLance?: number;
    ValorAvaliacao?: number;
    ValorMinimoLancePrimeiraPraca?: number;
    ValorMinimoLanceSegundaPraca?: number;
    ValorMinimoLanceTerceiraPraca?: number;
    IsVendaDireta?: boolean;
  }>;
};

type LotsPage = {
  Lotes?: LotRow[] | null;
  PageIndexMax?: number;
  ShowPaginacao?: boolean;
  Index?: number;
};

export async function listMglAuctionLots(auctionUrl: string): Promise<{
  auctionId: number;
  lots: Array<{
    id: number;
    url: string;
    titulo: string;
    categoria: string;
    statusLote: string;
    statusLeilao: string;
    statusLabel: string;
    valorMinimo: number | null;
    valorVendaDireta: number | null;
    valorAvaliacao: number | null;
    isVendaDireta: boolean;
  }>;
}> {
  const parsed = assertAllowedMglUrl(auctionUrl);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const response = await page.goto(parsed.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);
    try {
      assertFinalUrlAllowed(page.url(), MGL_ALLOWED_HOSTS, "MGL");
      assertNotCloudflareBlock(await page.content(), parsed.toString());
      assertHttpOk(response, parsed.toString());
    } catch (e) {
      throw new MglFetchError(e instanceof Error ? e.message : String(e));
    }

    const auctionId = await page.evaluate(() => {
      const el = document.getElementById("ID_Leilao") as HTMLInputElement | null;
      return parseInt(el?.value ?? "0", 10);
    });
    if (!auctionId) {
      throw new MglFetchError(`No ID_Leilao on ${parsed.toString()}`);
    }

    const lots: Array<{
      id: number;
      url: string;
      titulo: string;
      categoria: string;
      statusLote: string;
      statusLeilao: string;
      statusLabel: string;
      valorMinimo: number | null;
      valorVendaDireta: number | null;
      valorAvaliacao: number | null;
      isVendaDireta: boolean;
    }> = [];
    const seen = new Set<number>();

    const pickMinBid = (row: LotRow): number | null => {
      const rt = row.GetLoteRealTime?.[0];
      const positive = (v: unknown): number | null =>
        typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
      // Prefer live next bid; never prefer 3ª praça just because it is lowest
      // (often a deeply discounted unused praca).
      const proximo = positive(rt?.ProximoLance);
      if (proximo) return proximo;
      const praca = rt?.PracaAtual ?? 1;
      if (praca === 3) {
        return (
          positive(rt?.ValorMinimoLanceTerceiraPraca) ??
          positive(rt?.ValorMinimoLanceSegundaPraca) ??
          positive(rt?.ValorMinimoLancePrimeiraPraca)
        );
      }
      if (praca === 2) {
        return (
          positive(rt?.ValorMinimoLanceSegundaPraca) ??
          positive(rt?.ValorMinimoLancePrimeiraPraca)
        );
      }
      const primeira = positive(rt?.ValorMinimoLancePrimeiraPraca);
      if (primeira) return primeira;
      if (rt?.IsVendaDireta) return positive(row.ValorVendaDireta);
      return positive(row.ValorVendaDireta);
    };

    // Site infinite-scroll: Pagina stays 1; PaginaIndex advances; IndexOut =
    // how many lots already loaded. Do NOT trust PageIndexMax alone — it often
    // reports 1 while more pages still return lots; stop on empty batch.
    let pageIndex = 1;
    let indexOut = 0;
    const hardCap = 200;
    while (pageIndex <= hardCap) {
      const payload = await page.evaluate(
        async ({ id, paginaIndex, indexOut }) => {
          const token = (
            document.querySelector(
              'input[name="__RequestVerificationToken"]',
            ) as HTMLInputElement | null
          )?.value;
          const filter = {
            ID_Estado: 0,
            ID_Cidade: 0,
            Busca: "",
          };
          const res = await fetch(
            `https://www.mgl.com.br/ApiEngine/GetLotesLeilao/${id}/1/${paginaIndex}/${indexOut}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                ...(token ? { __RVT: token } : {}),
              },
              body: JSON.stringify(filter),
              credentials: "same-origin",
            },
          );
          const text = await res.text();
          return { status: res.status, text };
        },
        { id: auctionId, paginaIndex: pageIndex, indexOut },
      );

      if (payload.status < 200 || payload.status >= 300) {
        throw new MglFetchError(
          `GetLotesLeilao HTTP ${payload.status} pageIndex=${pageIndex}`,
        );
      }

      let data: LotsPage;
      try {
        data = JSON.parse(payload.text) as LotsPage;
      } catch {
        throw new MglFetchError(
          `GetLotesLeilao non-JSON pageIndex=${pageIndex}: ${payload.text.slice(0, 200)}`,
        );
      }

      const batch = data.Lotes ?? [];
      if (batch.length === 0) break;
      let added = 0;
      for (const row of batch) {
        const id = row.ID_Leiloes_Lote;
        const path = row.URLlote;
        if (!id || !path || seen.has(id)) continue;
        seen.add(id);
        added += 1;
        const rt = row.GetLoteRealTime?.[0];
        const vendaDireta =
          typeof row.ValorVendaDireta === "number" && row.ValorVendaDireta > 0
            ? row.ValorVendaDireta
            : null;
        const avaliacao =
          typeof row.ValorAvaliacao === "number" && row.ValorAvaliacao > 0
            ? row.ValorAvaliacao
            : typeof rt?.ValorAvaliacao === "number" && rt.ValorAvaliacao > 0
              ? rt.ValorAvaliacao
              : null;
        lots.push({
          id,
          url: path.startsWith("http")
            ? path
            : `https://www.mgl.com.br/${path.replace(/^\//, "")}`,
          titulo: row.Titulo ?? row.Descricao ?? "",
          categoria: row.Categoria ?? "",
          statusLote: rt?.StatusLote ?? "",
          statusLeilao: rt?.StatusLeilao ?? "",
          statusLabel: rt?.Lote_SubStatus_Label ?? "",
          valorMinimo: pickMinBid(row),
          valorVendaDireta: vendaDireta,
          valorAvaliacao: avaliacao,
          isVendaDireta: Boolean(rt?.IsVendaDireta),
        });
      }
      // Duplicate-only page → stop to avoid infinite loop
      if (added === 0) break;
      indexOut = seen.size;
      pageIndex += 1;
    }

    return { auctionId, lots };
  } finally {
    await browser.close();
  }
}

async function main() {
  const { url, out } = parseUrlAndOptionalOut(process.argv.slice(2));
  if (!out) {
    throw new MglFetchError("Missing --out <file>");
  }
  const result = await listMglAuctionLots(url);
  const safeOut = assertSafeOutPath(out);
  mkdirSync(dirname(safeOut), { recursive: true });
  writeFileSync(safeOut, JSON.stringify(result, null, 2), "utf-8");
  console.log(
    `Wrote ${result.lots.length} lots (auction ${result.auctionId}) to ${safeOut}`,
  );
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
