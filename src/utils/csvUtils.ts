import type { TransactionHistoryItem } from "mainnet-js";
import type { BcmrTokenMetadata } from "src/interfaces/interfaces";
import { i18n } from "src/boot/i18n";

const { t } = i18n.global;

const SATS_PER_BCH = 100_000_000;

type TokenAmountChange = TransactionHistoryItem["tokenAmountChanges"][number];

// Quote a field (and double any embedded quotes) when it contains a comma, quote or
// newline, so it survives as a single cell. Follows RFC 4180.
export function csvEscape(field: string): string {
  return /[",\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

// Token symbols come from attacker-controlled metadata. A cell starting with = + - @ is
// treated as a formula by spreadsheet apps, so restrict symbols to plainly safe characters.
function sanitizeSymbol(symbol: string): string {
  return symbol.replace(/[^a-zA-Z0-9._-]/g, "");
}

// Prefix positive amounts with "+" so the direction of every change is explicit.
function withSign(amount: number | bigint): string {
  return amount > 0 ? `+${amount}` : `${amount}`;
}

// Render one token's fungible and/or NFT change as e.g. "+123.45 FURU; -1 FURU NFT".
function formatTokenChange(
  tokenChange: TokenAmountChange,
  bcmrRegistries: Record<string, BcmrTokenMetadata> | undefined
): string {
  const tokenMetadata = bcmrRegistries?.[tokenChange.category]?.token;
  const categoryPrefix = tokenChange.category.slice(0, 8);
  const symbol = sanitizeSymbol(tokenMetadata?.symbol ?? categoryPrefix) || categoryPrefix;
  const decimals = tokenMetadata?.decimals ?? 0;

  const parts: string[] = [];
  // Show the fungible change for any nonzero amount. When there is no NFT change either,
  // still show it (as "0 SYMBOL") so an entry never renders as an empty cell.
  if (tokenChange.amount !== 0n || tokenChange.nftAmount === 0n) {
    const amount = Number(tokenChange.amount) / 10 ** decimals;
    parts.push(`${withSign(amount)} ${symbol}`);
  }
  if (tokenChange.nftAmount !== 0n) {
    parts.push(`${withSign(tokenChange.nftAmount)} ${symbol} NFT`);
  }
  return parts.join("; ");
}

export function historyToCsv(
  history: TransactionHistoryItem[],
  bcmrRegistries: Record<string, BcmrTokenMetadata> | undefined,
  bchUnit: string
): string {
  const header = [
    t("history.csv.date"),
    t("history.csv.transactionId"),
    t("history.csv.amount", { unit: bchUnit }),
    t("history.csv.balance", { unit: bchUnit }),
    t("history.csv.tokenChanges"),
  ];
  const rows = history.map(tx => [
    tx.timestamp ? new Date(tx.timestamp * 1000).toISOString() : t("history.pending"),
    tx.hash,
    (tx.valueChange / SATS_PER_BCH).toFixed(8),
    (tx.balance / SATS_PER_BCH).toFixed(8),
    tx.tokenAmountChanges.map(change => formatTokenChange(change, bcmrRegistries)).join("; "),
  ]);
  return [header, ...rows]
    .map(row => row.map(csvEscape).join(","))
    .join("\r\n");
}
