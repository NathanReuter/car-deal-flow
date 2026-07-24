import {
  auctionCommissionBRL,
  DETRAN_TRANSFER_SC_MID_BRL,
  POST_ARREMATE_BUFFER_BRL,
} from "./auctionFees";
import { resolveFreightBRL, type FreteSource } from "./freight";

export type LandedCostInput = {
  askingPriceBRL: number;
  dealPhase?: string | null;
  city: string;
  state: string;
};

export type LandedCostResult = {
  landedCostBRL: number | null;
  baseCashBRL: number | null;
  components: {
    freteBRL: number;
    auctionCommissionBRL: number;
    detranTransferBRL: number;
    postArremateBufferBRL: number;
  };
  meta: {
    freteSource: FreteSource;
    notes: string[];
  };
};

export function computeLandedCost(input: LandedCostInput): LandedCostResult {
  const ask = input.askingPriceBRL;
  const freight = resolveFreightBRL(input.city, input.state);

  if (ask == null || !Number.isFinite(ask) || ask <= 0) {
    return {
      landedCostBRL: null,
      baseCashBRL: null,
      components: {
        freteBRL: freight.freteBRL,
        auctionCommissionBRL: 0,
        detranTransferBRL: 0,
        postArremateBufferBRL: 0,
      },
      meta: { freteSource: freight.freteSource, notes: [...freight.notes] },
    };
  }

  // Legacy rows omit dealPhase — treat as auction (matches Car type docs).
  const phase = input.dealPhase ?? "auction";
  const isAuction = phase === "auction";

  const commission = isAuction ? auctionCommissionBRL(ask) : 0;
  const detran = isAuction ? DETRAN_TRANSFER_SC_MID_BRL : 0;
  const buffer = isAuction ? POST_ARREMATE_BUFFER_BRL : 0;

  const landed = ask + freight.freteBRL + commission + detran + buffer;

  return {
    landedCostBRL: landed,
    baseCashBRL: ask,
    components: {
      freteBRL: freight.freteBRL,
      auctionCommissionBRL: commission,
      detranTransferBRL: detran,
      postArremateBufferBRL: buffer,
    },
    meta: { freteSource: freight.freteSource, notes: [...freight.notes] },
  };
}
