const INR_SYMBOL = "\u20B9";

/**
 * Format an integer paise amount for display.
 * The stored and calculated value stays in paise. This string is presentation only.
 */
export function formatInrFromPaise(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new Error("Amount must be an integer number of paise.");
  }

  const sign = paise < 0 ? "-" : "";
  const absolute = Math.abs(paise);
  const rupees = Math.floor(absolute / 100);
  const remainder = absolute % 100;

  return `${sign}${INR_SYMBOL}${rupees}.${remainder.toString().padStart(2, "0")}`;
}
