import type { Output } from "@bitauth/libauth";
import type { IdentitySnapshot } from "../bcmr-v2.schema";
import {
  hexToBin,
  binToHex,
  decodeTransaction,
  lockingBytecodeToCashAddress,
} from "@bitauth/libauth";
import type { ElectrumClient } from "./types";

/**
 * ParityUSD extension: fetchLoanState
 *
 * This extension handles loan key NFTs that have empty commitments.
 * It fetches the actual loan UTXO data by:
 * 1. Getting the sidecar locking bytecode from the registry
 * 2. Fetching all UTXOs for that locking bytecode
 * 3. Finding the sidecar UTXO with matching token category
 * 4. Fetching the full transaction containing the sidecar
 * 5. Extracting the loan UTXO (output before the sidecar)
 * 6. Transplanting the loan's commitment and value into the loan key UTXO
 */
export async function fetchLoanState(
  utxo: Output,
  identitySnapshot: IdentitySnapshot,
  electrumClient: ElectrumClient,
  networkPrefix: string,
): Promise<Output> {
  console.log("[fetchLoanState] Fetching loan state");

  try {
    // Step 1: Get the sidecar locking bytecode from the registry
    const parityusd = identitySnapshot.extensions?.parityusd;
    const fetchLoanStateConfig =
      typeof parityusd === "object" && parityusd !== null
        ? (parityusd as Record<string, unknown>)["fetchLoanState"]
        : undefined;
    const sidecarLockingBytecode =
      typeof fetchLoanStateConfig === "object" && fetchLoanStateConfig !== null
        ? (fetchLoanStateConfig as Record<string, string>)["lockingBytecode"]
        : undefined;

    if (!sidecarLockingBytecode) {
      console.warn("No lockingBytecode found in fetchLoanState extension");
      return utxo;
    }

    console.log(
      `[fetchLoanState] Sidecar locking bytecode: ${sidecarLockingBytecode}`,
    );

    // Step 2: Get the token category we're looking for
    const targetCategory = utxo.token?.category;
    if (!targetCategory) {
      console.warn("[fetchLoanState] UTXO has no token category");
      return utxo;
    }

    const targetCategoryHex = binToHex(targetCategory);
    console.log(
      `[fetchLoanState] Looking for sidecar with category: ${targetCategoryHex}`,
    );

    // Step 3: Fetch all UTXOs for the sidecar locking bytecode
    // Convert locking bytecode to cash address for Electrum
    const sidecarBytecode = hexToBin(sidecarLockingBytecode);
    const sidecarAddressResult = lockingBytecodeToCashAddress({
      bytecode: sidecarBytecode,
      prefix: networkPrefix as "bitcoincash" | "bchtest" | "bchreg",
      tokenSupport: true,
    });

    if (typeof sidecarAddressResult === "string") {
      console.error(
        `[fetchLoanState] Failed to convert locking bytecode to address: ${sidecarAddressResult}`,
      );
      return utxo;
    }

    const sidecarAddress = sidecarAddressResult.address;
    console.log(`[fetchLoanState] Sidecar address: ${sidecarAddress}`);

    const sidecarUtxos = await electrumClient.getUTXOs(sidecarAddress);

    console.log(
      `[fetchLoanState] Found ${sidecarUtxos.length} UTXOs with sidecar locking bytecode`,
    );

    // Step 4: Filter for sidecar UTXO with matching token category
    const matchingSidecar = sidecarUtxos.find(
      (sidecar) => sidecar.token_data?.category === targetCategoryHex,
    );

    if (!matchingSidecar) {
      console.warn(
        `[fetchLoanState] No sidecar found with matching category ${targetCategoryHex}`,
      );
      return utxo;
    }

    console.log(
      `[fetchLoanState] Found matching sidecar: ${matchingSidecar.tx_hash}:${matchingSidecar.tx_pos}`,
    );

    // Step 5: Fetch the full transaction containing the sidecar
    const rawTx = await electrumClient.getRawTransaction(
      matchingSidecar.tx_hash,
    );
    const txBin = hexToBin(rawTx);
    const decodedTx = decodeTransaction(txBin);

    if (typeof decodedTx === "string") {
      console.error(
        `[fetchLoanState] Failed to decode transaction: ${decodedTx}`,
      );
      return utxo;
    }

    console.log(
      `[fetchLoanState] Decoded transaction with ${decodedTx.outputs.length} outputs`,
    );

    // Step 6: Find the sidecar output index and get the loan output (previous output)
    const sidecarOutputIndex = matchingSidecar.tx_pos;

    if (sidecarOutputIndex === 0) {
      console.error(
        "[fetchLoanState] Sidecar is at index 0, no previous output available",
      );
      return utxo;
    }

    const loanOutputIndex = sidecarOutputIndex - 1;
    const loanOutput = decodedTx.outputs[loanOutputIndex];

    if (!loanOutput) {
      console.error(
        `[fetchLoanState] No output found at index ${loanOutputIndex}`,
      );
      return utxo;
    }

    console.log(
      `[fetchLoanState] Found loan output at index ${loanOutputIndex}`,
    );

    // Step 7: Extract the loan's NFT commitment and value
    if (!loanOutput.token?.nft) {
      console.warn("[fetchLoanState] Loan output has no NFT");
      return utxo;
    }

    const loanCommitment = loanOutput.token.nft.commitment;
    const loanValueSatoshis = loanOutput.valueSatoshis;

    console.log(
      `[fetchLoanState] Loan commitment length: ${loanCommitment.length} bytes`,
    );
    console.log(
      `[fetchLoanState] Loan value: ${loanValueSatoshis.toString()} satoshis`,
    );

    // Step 8: Transplant the commitment and value into the loan key UTXO
    const modifiedUtxo: Output = {
      ...utxo,
      valueSatoshis: loanValueSatoshis,
      token: {
        ...utxo.token!,
        nft: {
          ...utxo.token!.nft!,
          commitment: loanCommitment,
        },
      },
    };

    console.log(
      `[fetchLoanState] Successfully transplanted commitment (${loanCommitment.length} bytes) and value (${loanValueSatoshis.toString()} sats)`,
    );

    return modifiedUtxo;
  } catch (error) {
    console.error("[fetchLoanState] Error:", error);
    return utxo;
  }
}
