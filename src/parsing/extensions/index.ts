import type { Output } from "@bitauth/libauth";
import type { ExtensionRegistry, ElectrumClient } from "./types";
import type { IdentitySnapshot } from "../bcmr-v2.schema";

// Import extension handlers
import { fetchLoanState } from "./parityusd";

const parityusdHandlers = { fetchLoanState };

/**
 * Registry of all available extensions
 */
export const extensions: ExtensionRegistry = {
  parityusd: parityusdHandlers,
  pusd: parityusdHandlers,
  paryonusd: parityusdHandlers,
};

/**
 * Invoke extensions declared in a BCMR identity
 *
 * Extensions are called in order and can modify the UTXO before NFT parsing.
 * Common use case: Fetch on-chain data and transplant into UTXO commitment.
 *
 * @param utxo - The UTXO to process
 * @param identitySnapshot - BCMR identity snapshot containing extensions config
 * @param electrumClient - Electrum client for blockchain data fetching
 * @param networkPrefix - Network prefix ("bitcoincash" or "bchtest")
 * @param extensionsEnabled - Optional map of extension names to enabled status
 * @returns Modified UTXO with extension processing applied
 */
export async function invokeExtensions(
  utxo: Output,
  identitySnapshot: IdentitySnapshot,
  electrumClient: ElectrumClient,
  networkPrefix: string,
  extensionsEnabled?: Record<string, boolean>,
): Promise<Output> {
  if (!identitySnapshot.extensions) {
    return utxo;
  }

  let modifiedUtxo = utxo;

  // Iterate through all extensions in the identity
  for (const [extensionName, extensionConfig] of Object.entries(
    identitySnapshot.extensions,
  )) {
    // Check if this extension is enabled (default to true if not specified)
    const isEnabled = extensionsEnabled?.[extensionName] ?? true;
    if (!isEnabled) {
      console.log(`Extension ${extensionName} is disabled, skipping`);
      continue;
    }

    const extensionHandlers = extensions[extensionName];
    if (!extensionHandlers) {
      console.warn(`Unknown extension: ${extensionName}`);
      continue;
    }

    // Iterate through all methods in this extension
    for (const methodName of Object.keys(extensionConfig as object)) {
      const handler = extensionHandlers[methodName];
      if (!handler) {
        console.warn(
          `Unknown method ${methodName} in extension ${extensionName}`,
        );
        continue;
      }

      console.log(
        `Invoking extension: ${extensionName}.${methodName}`,
      );

      try {
        modifiedUtxo = await handler(
          modifiedUtxo,
          identitySnapshot,
          electrumClient,
          networkPrefix,
        );
      } catch (error) {
        console.error(
          `Error invoking extension ${extensionName}.${methodName}:`,
          error,
        );
        // Continue with unmodified UTXO on error
      }
    }
  }

  return modifiedUtxo;
}

// Re-export types for convenience
export type {
  ElectrumClient,
  ElectrumUtxo,
  ExtensionHandler,
} from "./types";
