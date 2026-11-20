// Contract discovery: bundles the user added next to the built-in one, so the portfolio finds
// their positions in protocols the wallet does not ship. A bundle is inert data (see
// contractManifest.ts): it cannot name a destination for funds, and what it finds is display only.
// What it can do is show a position that is not what it claims, so the portfolio keeps these
// positions apart from its total. Kept app-wide in localStorage, like a setting, and used only
// while the developer option is on.

import type { AppNetwork } from "src/utils/wallet/networks";
import { ContractBundleSchema, type ContractBundle, type ContractManifest } from "./contractManifest";
import { builtinBundle } from "./builtins";

const STORAGE_KEY = "discoveryBundles";
const OPTION_KEY = "contractDiscovery";
// each derived manifest costs a lookup per wallet key on every portfolio visit
export const MAX_DISCOVERY_BUNDLES = 5;
export const MAX_BUNDLE_JSON_LENGTH = 100_000;

export type BundleProblem =
  | { kind: 'notJson' | 'tooLarge' | 'tooMany' | 'heldUnsupported' }
  | { kind: 'invalid', detail: string }
  | { kind: 'nameTaken' | 'idTaken', name: string };

export function loadDiscoveryBundles(): ContractBundle[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    const bundles: ContractBundle[] = [];
    for (const entry of JSON.parse(stored) as unknown[]) {
      // a bundle an earlier version accepted and this one would not is left out, not run
      const parsed = ContractBundleSchema.safeParse(entry);
      if (parsed.success) bundles.push(parsed.data);
    }
    return bundles;
  } catch {
    return [];
  }
}

// Reads a bundle the user pasted, against the bundles already there. Returns the bundle, or why
// it is refused.
export function readBundle(json: string, existing: ContractBundle[]): { bundle: ContractBundle } | { problem: BundleProblem } {
  if (json.length > MAX_BUNDLE_JSON_LENGTH) return { problem: { kind: 'tooLarge' } };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { problem: { kind: 'notJson' } };
  }
  const parsed = ContractBundleSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return { problem: { kind: 'invalid', detail: where + (issue?.message ?? '') } };
  }
  const bundle = parsed.data;
  // a held position is valued from parsed NFT fields by rows only the built-in protocols have
  if (bundle.contracts.some(contract => contract.find.kind === 'held')) return { problem: { kind: 'heldUnsupported' } };
  // adding a bundle of a name already there replaces it
  const others = existing.filter(other => other.name !== bundle.name);
  if (bundle.name === builtinBundle.name) return { problem: { kind: 'nameTaken', name: bundle.name } };
  if (others.length >= MAX_DISCOVERY_BUNDLES) return { problem: { kind: 'tooMany' } };
  // a position is traced back to its manifest by id
  const takenIds = [builtinBundle, ...others].flatMap(other => other.contracts.map(contract => contract.id));
  const taken = bundle.contracts.find(contract => takenIds.includes(contract.id));
  if (taken) return { problem: { kind: 'idTaken', name: taken.id } };
  // nor may a contract pass for one the wallet ships
  const builtinNames = builtinBundle.contracts.map(contract => contract.name.toLowerCase());
  const passingFor = bundle.contracts.find(contract => builtinNames.includes(contract.name.trim().toLowerCase()));
  if (passingFor) return { problem: { kind: 'nameTaken', name: passingFor.name } };
  return { bundle };
}

// Fresh read-modify-write, so a bundle another tab added meanwhile is kept
export function saveDiscoveryBundle(bundle: ContractBundle): ContractBundle[] {
  const bundles = [...loadDiscoveryBundles().filter(other => other.name !== bundle.name), bundle];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bundles));
  return bundles;
}

export function deleteDiscoveryBundle(name: string): ContractBundle[] {
  const bundles = loadDiscoveryBundles().filter(bundle => bundle.name !== name);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bundles));
  return bundles;
}

// The bundles in use: none while the developer option is off, though they are kept
export function activeDiscoveryBundles(): ContractBundle[] {
  if (localStorage.getItem(OPTION_KEY) !== "true") return [];
  return loadDiscoveryBundles();
}

// The added manifests that apply on a network, each with the bundle it came from
export function discoveryManifests(bundles: ContractBundle[], network: AppNetwork) {
  const manifests: { bundleName: string, manifest: ContractManifest }[] = [];
  for (const bundle of bundles) {
    if ((bundle.network ?? 'mainnet') !== network) continue;
    for (const manifest of bundle.contracts) manifests.push({ bundleName: bundle.name, manifest });
  }
  return manifests;
}
