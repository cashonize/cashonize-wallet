import type { ParseResult } from 'src/parsing/nftParsing'
import { i18n } from 'src/boot/i18n'
import { parseEmeraldKeycard } from 'src/utils/defi/emeraldDao'
import { formatBch, formatFiatAmount, satsToBch } from 'src/utils/utils'

// An Emerald DAO keycard as the token list shows a parsed NFT: its number and the BCH locked in
// its safebox, the same reading of the commitment the portfolio values it by
export function emeraldKeycardParseResult(
  commitment: string | undefined,
  exchangeRate: number | undefined,
  currency: Parameters<typeof formatFiatAmount>[1]
): ParseResult | undefined {
  const keycard = parseEmeraldKeycard(commitment);
  if (!keycard) return undefined;
  const { t } = i18n.global;
  let lockedValue = formatBch(keycard.satoshis, 'mainnet');
  if (exchangeRate !== undefined) {
    lockedValue += ` (≈ ${formatFiatAmount(satsToBch(keycard.satoshis) * exchangeRate, currency)})`;
  }
  return {
    success: true,
    namedFields: [
      { name: t('tokenItem.keycard'), value: `#${keycard.serial}` },
      { name: t('portfolio.lockedValue'), value: lockedValue },
    ],
  };
}
