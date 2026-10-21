import { type Output, decodeTransaction, hexToBin } from "@bitauth/libauth";

// The output an outpoint spends, read off its transaction's raw hex: libauth's own form, with exact
// satoshis and token data, which a dApp library verifying a signature needs
export function outputOfRawTransaction(rawTransactionHex: string, outpointIndex: number): Output {
  const transaction = decodeTransaction(hexToBin(rawTransactionHex));
  if (typeof transaction === "string") throw new Error(`Could not decode the source transaction: ${transaction}`);
  const output = transaction.outputs[outpointIndex];
  if (!output) throw new Error(`The source transaction has no output ${outpointIndex}`);
  return output;
}
