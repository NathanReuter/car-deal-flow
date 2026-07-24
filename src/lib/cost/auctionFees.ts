/** Copart-style leiloeiro commission (fixed %). */
export const AUCTION_COMMISSION_RATE = 0.05;

/** Mid of DETRAN SC transfer range 600–1800. */
export const DETRAN_TRANSFER_SC_MID_BRL = 1200;

/**
 * Vistoria cautelar mid 400 + revisão mid 800 + bateria mid 500.
 * Pneus/estética excluded until condition signals exist.
 */
export const POST_ARREMATE_BUFFER_BRL = 1700;

export function auctionCommissionBRL(lanceBRL: number): number {
  return lanceBRL * AUCTION_COMMISSION_RATE;
}
