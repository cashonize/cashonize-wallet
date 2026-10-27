import { TokenSendRequest, type Utxo } from "@cashonize/bch-wallet-lib";
import { tokenListFromUtxos } from "src/stores/storeUtils";
import type { WalletType } from "src/interfaces/interfaces";
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export type TransferPhase = "fungibleTokens" | "nfts" | "bch";

// What the source wallet holds back from the transfer: the filter for a fresh read of its coins
// and the exclusions every send takes, the store's filterSpendableUtxos and spendExclusions
export interface TransferHold {
  filterSpendableUtxos: (utxos: Utxo[]) => Utxo[];
  excludeUtxoIds: string[];
  excludeAddresses: string[];
}

// A wallet with nothing held back, such as a swept key's
export const noHold: TransferHold = { filterSpendableUtxos: utxos => utxos, excludeUtxoIds: [], excludeAddresses: [] };

export interface TransferProgress {
  phase: TransferPhase;
  completed: number;
  total: number;
}

// Moves every asset of a wallet to a single destination address: fungible tokens first
// (one transaction per category), then NFTs (one transaction per category, all NFTs of a
// category together), then the remaining BCH. BCH goes last because the token transactions
// need it to pay their fees.
// The destination must be a token-aware address whenever the wallet holds tokens. Coins the
// wallet holds back stay behind, which is why this empties the wallet of everything else rather
// than of everything.
export async function transferAllAssets(
  sourceWallet: WalletType,
  destinationAddress: string,
  hold: TransferHold,
  onProgress?: (progress: TransferProgress) => void,
) {
  // The library applies the exclusions to the wallet's current coins on every send, so no
  // transaction names coins an earlier one here has spent
  const { excludeUtxoIds, excludeAddresses } = hold;
  const spendablePool = async () => {
    const allUtxos = await sourceWallet.getUtxos();
    return hold.filterSpendableUtxos(allUtxos);
  };

  const utxos = await spendablePool();
  if (!utxos.length) throw new Error(t('common.errors.nothingToTransfer'));
  const tokenList = tokenListFromUtxos(utxos);

  const fungibleTokens = tokenList.filter(item => "amount" in item);

  onProgress?.({ phase: "fungibleTokens", completed: 0, total: fungibleTokens.length });
  let transferredFungibleTokens = 0;
  for (const token of fungibleTokens) {
    if (!("amount" in token)) continue;
    await sourceWallet.send([
      new TokenSendRequest({
        cashaddr: destinationAddress,
        amount: token.amount,
        category: token.category,
      }),
    ], { excludeUtxoIds, excludeAddresses });
    transferredFungibleTokens += 1;
    onProgress?.({ phase: "fungibleTokens", completed: transferredFungibleTokens, total: fungibleTokens.length });
  }

  // read again: a fungible send can take an NFT coin carrying tokens and return the NFT as change
  const nftTokens = tokenListFromUtxos(await spendablePool()).filter(item => "nfts" in item);
  onProgress?.({ phase: "nfts", completed: 0, total: nftTokens.length });
  let transferredNfts = 0;
  for (const token of nftTokens) {
    if (!("nfts" in token)) continue;
    const nftUtxos = token.nfts.filter(utxo => utxo.token?.nft);
    const nftOutputs = nftUtxos.map(nftUtxo => {
      const nftInfo = nftUtxo.token!.nft!;
      return new TokenSendRequest({
        cashaddr: destinationAddress,
        category: token.category,
        nft: {
          commitment: nftInfo.commitment,
          capability: nftInfo.capability,
        },
      });
    });
    // named in ensureUtxos, so a mutable NFT gone since the read fails the send rather than being
    // minted anew off the minting NFT sent alongside it
    if (nftOutputs.length) {
      await sourceWallet.send(nftOutputs, { excludeUtxoIds, excludeAddresses, ensureUtxos: nftUtxos });
    }
    transferredNfts += 1;
    onProgress?.({ phase: "nfts", completed: transferredNfts, total: nftTokens.length });
  }

  onProgress?.({ phase: "bch", completed: 0, total: 1 });
  // the library already leaves token UTXOs out of a plain-BCH selection, named pool or not; this
  // wallet drops them itself as well, since a token UTXO swept as plain BCH would burn its tokens
  const bchPool = (await spendablePool()).filter(utxo => !utxo.token);
  await sourceWallet.sendMax(destinationAddress, { utxoIds: bchPool, excludeUtxoIds, excludeAddresses });
  onProgress?.({ phase: "bch", completed: 1, total: 1 });
}
