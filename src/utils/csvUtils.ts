import type { TransactionHistoryItem } from "mainnet-js";
import type { BcmrTokenMetadata } from "src/interfaces/interfaces";

export function csvEscape(field: string): string {
  return /[",\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

function tokenChangesText(
  tokenAmountChanges: TransactionHistoryItem["tokenAmountChanges"],
  bcmrRegistries: Record<string, BcmrTokenMetadata> | undefined
): string {
  return tokenAmountChanges.map(tokenChange => {
    // strip formula-injection characters from attacker-controlled token symbols (CSV cells starting with = + - @ can execute in spreadsheet apps)
    const rawSymbol = bcmrRegistries?.[tokenChange.category]?.token?.symbol ?? tokenChange.category.slice(0, 8);
    const symbol = rawSymbol.replace(/[^a-zA-Z0-9._-]/g, "") || tokenChange.category.slice(0, 8);
    const decimals = bcmrRegistries?.[tokenChange.category]?.token.decimals ?? 0;
    const changes: string[] = [];
    if (tokenChange.amount !== 0n || tokenChange.nftAmount == 0n) {
      const amount = Number(tokenChange.amount) / 10 ** decimals;
      changes.push(`${amount > 0 ? '+' : ''}${amount} ${symbol}`);
    }
    if (tokenChange.nftAmount) {
      changes.push(`${tokenChange.nftAmount > 0n ? '+' : ''}${tokenChange.nftAmount} ${symbol} NFT`);
    }
    return changes.join("; ");
  }).join("; ");
}

export function historyToCsv(
  history: TransactionHistoryItem[],
  bcmrRegistries: Record<string, BcmrTokenMetadata> | undefined,
  bchUnit: string
): string {
  const header = ["Date (UTC)", "Transaction Id", `Amount (${bchUnit})`, `Balance (${bchUnit})`, "Token Changes"];
  const rows = history.map(tx => [
    tx.timestamp ? new Date(tx.timestamp * 1000).toISOString() : "pending",
    tx.hash,
    (tx.valueChange / 100_000_000).toFixed(8),
    (tx.balance / 100_000_000).toFixed(8),
    tokenChangesText(tx.tokenAmountChanges, bcmrRegistries)
  ]);
  return [header, ...rows].map(row => row.map(csvEscape).join(",")).join("\r\n");
}
