import type { Output } from "@bitauth/libauth";
import type { IdentitySnapshot } from "../bcmr-v2.schema";
import {
  hexToBin,
  binToHex,
  decodeTransaction,
  lockingBytecodeToCashAddress,
} from "@bitauth/libauth";
import type { ElectrumClient, ElectrumUtxo } from "./types";

// Verbose step-by-step tracing of loan-state resolution. Reads from localStorage
// Toggle from the browser console: localStorage.debugParyonUsdExtension = "1" (and reload)
// Genuine failures still log via console.warn/console.error regardless.
function debugLog(...args: unknown[]) {
  if (globalThis.localStorage?.getItem("debugParyonUsdExtension")) {
    console.log(...args);
  }
}

/**
 * In-flight coalescing for the paryonusd extension's getUTXOs requests.
 *
 * Every loan-key NFT of a given token resolves to the same lookup address (it
 * is derived from the registry's lockingBytecode), so when many loan-key cards
 * render at once the extension fires the same getUTXOs request repeatedly.
 * Sharing the in-flight promise (keyed by address) collapses those concurrent
 * requests into a single electrum round-trip. The entry is dropped as soon as
 * the request settles, so a later refresh re-fetches live state — this is
 * coalescing, not caching.
 */
const inflightUtxoRequests = new Map<string, Promise<ElectrumUtxo[]>>();

function coalescedGetUTXOs(electrumClient: ElectrumClient, address: string) {
  const existing = inflightUtxoRequests.get(address);
  if (existing) return existing;

  const request = electrumClient
    .getUTXOs(address)
    .finally(() => inflightUtxoRequests.delete(address));
  inflightUtxoRequests.set(address, request);
  return request;
}

/**
 * ParyonUSD (paryonusd) extension: fetchLoanState
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
) {
  debugLog("[fetchLoanState] Fetching loan state");

  try {
    // Only transplant for owner loan keys (minting capability).
    // Management keys (non-minting) should not be modified.
    if (utxo.token?.nft?.capability !== "minting") {
      debugLog(
        "[fetchLoanState] UTXO is not a minting NFT, skipping transplant",
      );
      return utxo;
    }

    // Step 1: Get the sidecar locking bytecode from the registry
    const ext = identitySnapshot.extensions;
    const extensionConfig = (ext?.paryonusd ?? ext?.pusd) as Record<string, Record<string, string>> | undefined;
    const fetchLoanStateConfig = extensionConfig?.fetchLoanState;
    const sidecarLockingBytecode = fetchLoanStateConfig?.lockingBytecode;

    if (!sidecarLockingBytecode) {
      console.warn("No lockingBytecode found in fetchLoanState extension");
      return utxo;
    }

    debugLog(`[fetchLoanState] Sidecar locking bytecode: ${sidecarLockingBytecode}`);

    // Step 2: Get the token category we're looking for
    const targetCategory = utxo.token?.category;
    if (!targetCategory) {
      console.warn("[fetchLoanState] UTXO has no token category");
      return utxo;
    }

    const targetCategoryHex = binToHex(targetCategory);
    debugLog(`[fetchLoanState] Looking for sidecar with category: ${targetCategoryHex}`);

    // Step 3: Fetch all UTXOs for the sidecar locking bytecode
    // Convert locking bytecode to cash address for Electrum
    const sidecarBytecode = hexToBin(sidecarLockingBytecode);
    const sidecarAddressResult = lockingBytecodeToCashAddress({
      bytecode: sidecarBytecode,
      prefix: networkPrefix as "bitcoincash" | "bchtest" | "bchreg",
      tokenSupport: true,
    });

    if (typeof sidecarAddressResult === "string") {
      console.error(`[fetchLoanState] Failed to convert locking bytecode to address: ${sidecarAddressResult}`);
      return utxo;
    }

    const sidecarAddress = sidecarAddressResult.address;
    debugLog(`[fetchLoanState] Sidecar address: ${sidecarAddress}`);

    const sidecarUtxos = await coalescedGetUTXOs(electrumClient, sidecarAddress);
    debugLog(`[fetchLoanState] Found ${sidecarUtxos.length} UTXOs with sidecar locking bytecode`);

    // Step 4: Filter for sidecar UTXO with matching token category
    const matchingSidecar = sidecarUtxos.find(
      (sidecar) => sidecar.token_data?.category === targetCategoryHex,
    );

    if (!matchingSidecar) {
      console.warn(`[fetchLoanState] No sidecar found with matching category ${targetCategoryHex}`);
      return utxo;
    }

    debugLog(`[fetchLoanState] Found matching sidecar: ${matchingSidecar.tx_hash}:${matchingSidecar.tx_pos}`);

    // Step 5: Fetch the full transaction containing the sidecar
    const rawTx = await electrumClient.getRawTransaction(matchingSidecar.tx_hash);
    const txBin = hexToBin(rawTx);
    const decodedTx = decodeTransaction(txBin);

    if (typeof decodedTx === "string") {
      console.error(`[fetchLoanState] Failed to decode transaction: ${decodedTx}`);
      return utxo;
    }

    debugLog(`[fetchLoanState] Decoded transaction with ${decodedTx.outputs.length} outputs`);

    // Step 6: Find the sidecar output index and get the loan output (previous output)
    const sidecarOutputIndex = matchingSidecar.tx_pos;

    if (sidecarOutputIndex === 0) {
      console.error("[fetchLoanState] Sidecar is at index 0, no previous output available");
      return utxo;
    }

    const loanOutputIndex = sidecarOutputIndex - 1;
    const loanOutput = decodedTx.outputs[loanOutputIndex];

    if (!loanOutput) {
      console.error(`[fetchLoanState] No output found at index ${loanOutputIndex}`);
      return utxo;
    }

    debugLog(`[fetchLoanState] Found loan output at index ${loanOutputIndex}`);

    // Step 7: Extract the loan's NFT commitment and value
    if (!loanOutput.token?.nft) {
      console.warn("[fetchLoanState] Loan output has no NFT");
      return utxo;
    }

    const loanCommitment = loanOutput.token.nft.commitment;
    const loanValueSatoshis = loanOutput.valueSatoshis;

    debugLog(`[fetchLoanState] Loan commitment: ${loanCommitment.length} bytes, value: ${loanValueSatoshis.toString()} sats`);

    // Step 8: Transplant the commitment and value into the loan key UTXO
    const modifiedUtxo: Output = {
      ...utxo,
      valueSatoshis: loanValueSatoshis,
      token: {
        ...utxo.token,
        nft: {
          ...utxo.token.nft,
          commitment: loanCommitment,
        },
      },
    };

    debugLog(`[fetchLoanState] Successfully transplanted commitment (${loanCommitment.length} bytes) and value (${loanValueSatoshis.toString()} sats)`);

    return modifiedUtxo;
  } catch (error) {
    console.error("[fetchLoanState] Error:", error);
    return utxo;
  }
}
