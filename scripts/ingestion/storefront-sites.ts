/**
 * Config-driven storefront site definitions.
 *
 * Supported sites:
 *   - Clube Repasse  (mode "html", paginated SSR HTML)
 *   - Compra Certa   (mode "json", single REST endpoint)
 *
 * CG Veículos (cgveiculos.com) was intentionally dropped — probe showed only 6 stale
 * vehicles on a static page-builder site with no active inventory.
 */

export type StorefrontMode = "html" | "json";

export interface StorefrontSite {
  /** Short identifier used in logs and source platform field. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Fetch strategy: "html" = paginated SSR pages, "json" = REST API endpoint. */
  mode: StorefrontMode;
  /** Base URL of the site (protocol + hostname). */
  baseUrl: string;
  /**
   * For mode "html": builds the URL for page n (1-indexed).
   * For mode "json": returns the single API endpoint (page param ignored).
   */
  listUrl: (page: number) => string;
  /**
   * For mode "html": estimated or observed total pages.
   * For mode "json": set to 1 (single endpoint returns all inventory).
   */
  totalPages: number;
  /** Default city for leads from this site (stored verbatim in write-lead). */
  city: string;
  /** Default state abbreviation (e.g. "DF", "GO"). */
  state: string;
  /** Source platform name passed to write-lead --source-platform. */
  sourcePlatform: string;
}

export const STOREFRONT_SITES: StorefrontSite[] = [
  {
    id: "cluberepasse",
    name: "Clube Repasse",
    mode: "html",
    baseUrl: "https://cluberepasse.com.br",
    // Homepage IS the catalog; pagination via ?page=N
    listUrl: (page) => `https://cluberepasse.com.br?page=${page}`,
    // ~183 pages observed 2026-07-20 (18 cards/page)
    totalPages: 183,
    city: "Brasília",
    state: "DF",
    sourcePlatform: "Clube Repasse",
  },
  {
    id: "compracerta",
    name: "Compra Certa Repasse",
    mode: "json",
    baseUrl: "https://compracertarepasse.com.br",
    listUrl: (_page) =>
      "https://compracertarepasse.com.br/wp-json/repasse/v1/veiculos?limite=999",
    totalPages: 1,
    city: "Goiânia",
    state: "GO",
    sourcePlatform: "Compra Certa Repasse",
  },
];
