import { binToHex, encodeTransaction, lockingBytecodeToCashAddress, type Output, type Transaction } from "@bitauth/libauth"
import type { WcSourceOutput } from "@bch-wc2/interfaces";

type Token = NonNullable<Output['token']>;

// What a dapp-built transaction does to this wallet, as the sign dialog shows it. Whose coins are
// whose is decided by the caller's isWallet, from the scripts the request states for its inputs.
export interface DappTransactionSummary {
  bchBalanceChange: bigint;
  // what all the inputs pay over all the outputs, third party ones included
  fee: bigint;
  // the size once the wallet has signed, for the fee rate
  signedSize: number;
  ftNetChanges: Record<string, bigint>;
  nftsSpent: Token[];
  nftsReceived: Token[];
}

// The request holds an unsigned transaction, so its length is short by the signatures the wallet
// still has to add: for each of its own inputs that arrives empty, a 65 byte schnorr signature and
// a 33 byte public key, each behind a single byte push opcode
const signedInputSize = 100;

export function summarizeDappTransaction(
  transaction: Transaction,
  sourceOutputs: readonly WcSourceOutput[],
  isWallet: (lockingBytecode: Uint8Array) => boolean,
): DappTransactionSummary {
  let bchBalanceChange = 0n;
  let inputTotal = 0n;
  let outputTotal = 0n;
  let inputsAwaitingSignature = 0;
  const ftNetChanges: Record<string, bigint> = {};
  const nftsSpent: Token[] = [];
  const nftsReceived: Token[] = [];

  for (const input of sourceOutputs) {
    inputTotal += input.valueSatoshis;
    if (!isWallet(input.lockingBytecode)) continue;
    bchBalanceChange -= input.valueSatoshis;
    if (!input.unlockingBytecode?.length) inputsAwaitingSignature++;
    if (!input.token) continue;
    if (input.token.nft) nftsSpent.push(input.token);
    if (input.token.amount) {
      const category = binToHex(input.token.category);
      ftNetChanges[category] = (ftNetChanges[category] ?? 0n) - input.token.amount;
    }
  }
  for (const output of transaction.outputs) {
    outputTotal += output.valueSatoshis;
    if (!isWallet(output.lockingBytecode)) continue;
    bchBalanceChange += output.valueSatoshis;
    if (!output.token) continue;
    if (output.token.nft) nftsReceived.push(output.token);
    if (output.token.amount) {
      const category = binToHex(output.token.category);
      ftNetChanges[category] = (ftNetChanges[category] ?? 0n) + output.token.amount;
    }
  }

  return {
    bchBalanceChange,
    fee: inputTotal - outputTotal,
    signedSize: encodeTransaction(transaction).length + inputsAwaitingSignature * signedInputSize,
    ftNetChanges,
    nftsSpent,
    nftsReceived,
  };
}

// The address a script pays, or the script itself when it has no address (OP_RETURN, bare
// multisig, P2PK): a dapp can add any output, and the dialog has to show it rather than fail
export function scriptDisplay(lockingBytecode: Uint8Array, prefix: 'bitcoincash' | 'bchtest'): string {
  const hex = binToHex(lockingBytecode);
  if (hex.startsWith("6a")) return "opreturn:" + hex;
  const result = lockingBytecodeToCashAddress({ bytecode: lockingBytecode, prefix });
  if (typeof result == "string") return "script:" + hex;
  return result.address;
}
