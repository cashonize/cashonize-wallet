import { binToHex, cashAddressToLockingBytecode } from "@bitauth/libauth";
import type { TransactionHistoryItem } from "mainnet-js";
import { toPrefixedAddress } from "src/utils/addressValidation";

// The history searches by address on locking bytecode: an address and its token-aware form
// (q... and z...) are different strings for the same script. Returns the bytecode of a query
// that is a whole cashaddr, prefixed or not, and undefined for anything else.
export function addressQueryBytecode(query: string): string | undefined {
  const address = toPrefixedAddress(query);
  if (!address) return undefined;
  const result = cashAddressToLockingBytecode(address);
  if (typeof result === "string") return undefined;
  return binToHex(result.bytecode);
}

// mainnet-js records the locking bytecode of every input and output except a coinbase input
export function txInvolvesBytecode(tx: TransactionHistoryItem, lockingBytecodes: Set<string>): boolean {
  return [...tx.inputs, ...tx.outputs].some(inOutput =>
    inOutput.lockingBytecode !== undefined && lockingBytecodes.has(inOutput.lockingBytecode)
  );
}

// The wallet's own addresses whose label contains the query, as locking bytecode
export function labelledAddressBytecodes(addressLabels: Record<string, string>, query: string): string[] {
  return Object.entries(addressLabels)
    .filter(([, label]) => label.toLowerCase().includes(query))
    .flatMap(([address]) => {
      const bytecode = addressQueryBytecode(address);
      return bytecode ? [bytecode] : [];
    });
}
