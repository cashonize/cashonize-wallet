import { TokenSendRequest } from "mainnet-js";
import { tokenListFromUtxos } from "src/stores/storeUtils";
import { spendableFromUtxos, type ReservedUtxos } from "src/utils/wallet/reservedUtxos";
import type { WalletType } from "src/interfaces/interfaces";
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export type TransferPhase = "fungibleTokens" | "nfts" | "bch";

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
  reservedUtxos: ReservedUtxos,
  onProgress?: (progress: TransferProgress) => void
) {
  // Read fresh before each transaction rather than once up front: every transaction here spends
  // coins the next must no longer name, and a summary shown to the user can be minutes old anyway
  const spendablePool = async () => spendableFromUtxos(await sourceWallet.getUtxos(), reservedUtxos);

  const utxos = await spendablePool();
  if (!utxos.length) throw new Error(t('common.errors.nothingToTransfer'));
  const tokenList = tokenListFromUtxos(utxos);

  const fungibleTokens = tokenList.filter(item => "amount" in item);
  const nftTokens = tokenList.filter(item => "nfts" in item);

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
    ], { utxoIds: await spendablePool() });
    transferredFungibleTokens += 1;
    onProgress?.({ phase: "fungibleTokens", completed: transferredFungibleTokens, total: fungibleTokens.length });
  }

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
    if (nftOutputs.length) await sourceWallet.send(nftOutputs, { utxoIds: await spendablePool() });
    transferredNfts += 1;
    onProgress?.({ phase: "nfts", completed: transferredNfts, total: nftTokens.length });
  }

  onProgress?.({ phase: "bch", completed: 0, total: 1 });
  await sourceWallet.sendMax(destinationAddress, { utxoIds: await spendablePool() });
  onProgress?.({ phase: "bch", completed: 1, total: 1 });
}
