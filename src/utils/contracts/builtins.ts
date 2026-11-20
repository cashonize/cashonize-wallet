// The manifests the wallet ships. Validated at import by the same schema a user's bundle is held
// to, so a malformed built-in fails the test run rather than a wallet open, and so the built-ins
// stay honest examples of the shape a user has to write.

import builtinContracts from "./builtinContracts.json";
import { ContractBundleSchema, matchesHeld, type ContractManifest } from "./contractManifest";

export const builtinBundle = ContractBundleSchema.parse(builtinContracts);

// The manifests whose positions are liquidity pools, the rows the portfolio shows as a pool
export const LIQUIDITY_POOL_MANIFESTS = [
  'cauldron-pool', 'guanaco-pool-1bp', 'guanaco-pool-5bp', 'guanaco-pool-30bp', 'guanaco-pool-100bp',
];

export function builtinManifest(id: string): ContractManifest {
  const manifest = builtinBundle.contracts.find(contract => contract.id === id);
  if (!manifest) throw new Error(`No built-in contract manifest '${id}'`);
  return manifest;
}

// The token whose icon stands for a manifest's positions, where the manifest names one. A
// protocol with no token of its own has no icon to borrow and needs one of its own, which the
// format does not carry yet.
export function manifestTokenCategory(manifest: ContractManifest) {
  if (manifest.find.kind === 'held') return manifest.find.categories?.[0];
  return manifest.find.kind === 'address' ? manifest.find.token?.category : undefined;
}

// The built-in manifest a held NFT is a position of, if any, and of which kind of value
export function heldManifestFor(
  valueKind: 'loan' | 'stake',
  nft: { category: string, capability: string | undefined },
  registryExtensions: string[],
) {
  return builtinBundle.contracts.find(manifest =>
    manifest.find.kind === 'held' && manifest.value?.kind === valueKind
    && matchesHeld(manifest.find, nft, registryExtensions));
}
