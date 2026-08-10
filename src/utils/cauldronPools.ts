// Discovery of Cauldron liquidity pools owned by the wallet.
//
// A Cauldron pool is a contract written in raw BCH Script, not CashScript, and the only variable
// part of it is the 20-byte public key hash of the pool owner. All pools of one owner therefore
// sit at the same p2sh32 address, so listing an owner's pools is a UTXO lookup on that address.
// Deriving it needs the script template below and nothing else: there is no artifact and no
// CashScript contract instance, which would only be needed to build transactions spending a pool.

import {
  decodeCashAddress,
  binToHex,
  hexToBin,
  hash160,
  hash256,
  encodeLockingBytecodeP2sh32,
  lockingBytecodeToCashAddress,
  deriveSeedFromBip39Mnemonic,
  deriveHdPrivateNodeFromSeed,
  deriveHdPath,
  deriveHdPublicNode,
  deriveHdPublicNodeChild,
} from "@bitauth/libauth";
import type { Utxo } from "mainnet-js";

// The wallet's provider reaches this through a reactive store ref, which strips the private
// members off the ElectrumNetworkProvider class type, so it is matched structurally instead
interface ElectrumProvider {
  getUtxos(cashaddr: string): Promise<Utxo[]>;
}

// Pool lookups are pipelined over the same electrum connection in batches
const LOOKUP_BATCH_SIZE = 10;

// OP_DEPTH OP_IF OP_DUP OP_HASH160 OP_PUSHBYTES_20
const CAULDRON_SCRIPT_PREFIX = "746376a914";
// OP_EQUALVERIFY OP_CHECKSIG OP_ELSE <the constant-product swap conditions> OP_ENDIF
const CAULDRON_SCRIPT_SUFFIX = "88ac67c0d1c0ce88c25288c0cdc0c788c0c6c0d095c0c6c0cc9490539502e80396c0cc7c94c0d3957ca268";

export interface CauldronPool {
  ownerPkh: string;
  txid: string;
  vout: number;
  satoshis: bigint;
  tokenId: string;
  tokenAmount: bigint;
}

// The token-aware address of the contract holding all Cauldron pools of one owner
export function cauldronPoolAddress(ownerPkh: string, networkPrefix: string): string {
  const contractScript = hexToBin(CAULDRON_SCRIPT_PREFIX + ownerPkh + CAULDRON_SCRIPT_SUFFIX);
  const lockingBytecode = encodeLockingBytecodeP2sh32(hash256(contractScript));
  const result = lockingBytecodeToCashAddress({
    bytecode: lockingBytecode,
    prefix: networkPrefix as "bitcoincash" | "bchtest" | "bchreg",
    tokenSupport: true,
  });
  if (typeof result === "string") throw new Error(`Failed to derive Cauldron pool address: ${result}`);
  return result.address;
}

// Chain index of the HD wallet's dapp chain, shared with dapps over WizardConnect as 'defi'.
// A dapp creating a pool owns it with a key on this chain, so pools made through WizardConnect
// belong to addresses the wallet itself never hands out and never has history for.
const CAULDRON_CHAIN_INDEX = 7;

// Public key hashes of the first 'count' addresses on the wallet's dapp chain. Derived through
// the chain's public node, so no private keys for these addresses are created along the way.
// The libauth derivation functions throw on invalid input rather than returning an error.
export function cauldronChainPublicKeyHashes(mnemonic: string, parentDerivation: string, count: number): string[] {
  const seed = deriveSeedFromBip39Mnemonic(mnemonic);
  const chainNode = deriveHdPath(deriveHdPrivateNodeFromSeed(seed), `${parentDerivation}/${CAULDRON_CHAIN_INDEX}`);
  const chainPublicNode = deriveHdPublicNode(chainNode);

  const publicKeyHashes: string[] = [];
  for (let index = 0; index < count; index++) {
    const addressNode = deriveHdPublicNodeChild(chainPublicNode, index);
    publicKeyHashes.push(binToHex(hash160(addressNode.publicKey)));
  }
  return publicKeyHashes;
}

export function publicKeyHashFromAddress(address: string): string | undefined {
  const decoded = decodeCashAddress(address);
  if (typeof decoded === "string") return undefined;
  return binToHex(decoded.payload);
}

// Look up the pools owned by each of the given public key hashes. A lookup that fails is logged
// and skipped, so one unreachable request does not hide the pools found for the other addresses.
//
// The lookups go to the wallet's own electrum server, which already sees every wallet address,
// and ask for the derived contract address rather than the public key hash behind it. The
// Cauldron indexer answers the same question from an owner public key hash, but that would hand
// the wallet's list of addresses to a third party.
export async function fetchCauldronPools(
  provider: ElectrumProvider,
  ownerPkhs: string[],
  networkPrefix: string
): Promise<CauldronPool[]> {
  async function lookupPools(ownerPkh: string) {
    try {
      const utxos = await provider.getUtxos(cauldronPoolAddress(ownerPkh, networkPrefix));
      // a pool always holds a fungible token amount, anything else at the address is not one
      return utxos
        .filter((utxo) => utxo.token?.amount && !utxo.token.nft)
        .map((utxo) => ({
          ownerPkh,
          txid: utxo.txid,
          vout: utxo.vout,
          satoshis: utxo.satoshis,
          tokenId: utxo.token!.category,
          tokenAmount: utxo.token!.amount,
        }));
    } catch (error) {
      console.error(`Failed to fetch Cauldron pools for ${ownerPkh}:`, error);
      return [];
    }
  }

  const pools: CauldronPool[] = [];
  for (let i = 0; i < ownerPkhs.length; i += LOOKUP_BATCH_SIZE) {
    const batch = ownerPkhs.slice(i, i + LOOKUP_BATCH_SIZE);
    const batchPools = await Promise.all(batch.map(lookupPools));
    pools.push(...batchPools.flat());
  }
  return pools;
}
