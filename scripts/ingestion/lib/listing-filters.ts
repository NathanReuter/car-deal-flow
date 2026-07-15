export type ListingFilterInput = {
  url?: string;
  title?: string;
  comitente?: string;
  recoveryType?: string;
  excludeInsurer?: boolean;
};

export type ListingFilterResult = {
  skip: boolean;
  reason?: string;
};

const BATIDOS_SLUG =
  /\b(batidos|sucatas|sinistrados|recuperados-e-sucata|veiculos-batidos)\b/i;

const INSURER_COMITENTE =
  /\b(mapfre|porto\s*seguro|allianz|hdi|tokio\s*marine|zurich|liberty\s*seguros|sompo|alfa\s*seguros|it[aá]u\s*seguros|bradesco\s*seguros|suhai|sul\s*america|sulamerica)\b/i;

export function isBatidosAuction(url: string, title: string): boolean {
  const blob = `${url} ${title}`;
  return BATIDOS_SLUG.test(blob);
}

export function isInsurerComitente(text: string): boolean {
  return INSURER_COMITENTE.test(text);
}

export function isBradescoSinistrado(recoveryType: string): boolean {
  return /sinistrado/i.test(recoveryType.trim());
}

export function shouldSkipListing(input: ListingFilterInput): ListingFilterResult {
  if (input.url || input.title) {
    if (isBatidosAuction(input.url ?? "", input.title ?? "")) {
      return { skip: true, reason: "batidos_auction" };
    }
  }

  if (input.recoveryType && isBradescoSinistrado(input.recoveryType)) {
    return { skip: true, reason: "sinistrado_recovery" };
  }

  if (input.excludeInsurer && input.comitente && isInsurerComitente(input.comitente)) {
    return { skip: true, reason: "insurer_comitente" };
  }

  return { skip: false };
}
