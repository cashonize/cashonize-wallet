import { BroadcastRejectedError } from "@cashonize/bch-wallet-lib";
import { transferAllAssets, type TransferProgress } from "../src/utils/tools/transferAssets";
import type { ReservedUtxos } from "../src/utils/wallet/reservedUtxos";
import type { WalletType } from "../src/interfaces/interfaces";

const destinationAddress = "bitcoincash:zzd7ucdmlvkarqr3ytft3trl94007r6dr53jj2x88s";
// real 32-byte categories, as the library refuses a token request with any other
const cat1 = "c1".repeat(32);
const cat2 = "c2".repeat(32);

// A vout apiece, so every coin here has an outpoint of its own to be held back by
let nextVout = 0;
function bchUtxo(satoshis: bigint) {
  return { txid: "00".repeat(32), vout: nextVout++, satoshis };
}
function fungibleTokenUtxo(category: string, amount: bigint) {
  return { txid: "11".repeat(32), vout: nextVout++, satoshis: 1000n, token: { category, amount } };
}
function nftUtxo(category: string, commitment: string) {
  return {
    txid: "22".repeat(32),
    vout: nextVout++,
    satoshis: 1000n,
    token: { category, amount: 0n, nft: { commitment, capability: "none" as const } },
  };
}

const held = (utxo: { txid: string, vout: number }): ReservedUtxos =>
  ({ [`${utxo.txid}:${utxo.vout}`]: 'manual' });

// Records the order of the wallet calls the transfer makes, the outputs of each send, and the
// pool each was narrowed to and the coins it excluded
function createFakeWallet(utxos: unknown[]) {
  const callOrder: string[] = [];
  const sendCalls: { category: string, commitment?: string }[][] = [];
  const pools: ({ txid: string, vout: number }[] | undefined)[] = [];
  const exclusions: (string[] | undefined)[] = [];
  const ensured: ({ txid: string, vout: number }[] | undefined)[] = [];
  const wallet = {
    getUtxos: () => Promise.resolve(utxos),
    send: (
      requests: { category: string, nft?: { commitment: string } }[],
      options?: { utxoIds?: { txid: string, vout: number }[], excludeUtxoIds?: string[], ensureUtxos?: { txid: string, vout: number }[] },
    ) => {
      callOrder.push("send");
      pools.push(options?.utxoIds);
      exclusions.push(options?.excludeUtxoIds);
      ensured.push(options?.ensureUtxos);
      sendCalls.push(requests.map(request => ({
        category: request.category,
        ...(request.nft ? { commitment: request.nft.commitment } : {}),
      })));
      return Promise.resolve({});
    },
    sendMax: (address: string, options?: { utxoIds?: { txid: string, vout: number }[], excludeUtxoIds?: string[] }) => {
      callOrder.push(`sendMax:${address}`);
      pools.push(options?.utxoIds);
      exclusions.push(options?.excludeUtxoIds);
      return Promise.resolve({});
    },
  };
  return { wallet: wallet as unknown as WalletType, utxos, callOrder, sendCalls, pools, exclusions, ensured };
}

describe('test transferAllAssets', () => {
  beforeEach(() => { nextVout = 0 });

  it('should move fungible tokens first, then nfts, then the remaining bch', async () => {
    const { wallet, callOrder } = createFakeWallet([
      bchUtxo(100_000n),
      fungibleTokenUtxo(cat1, 500n),
      nftUtxo(cat2, "aa"),
    ]);

    await transferAllAssets(wallet, destinationAddress, {});

    // bch has to go last, the token transactions need it to pay their fees
    expect(callOrder).toEqual(["send", "send", `sendMax:${destinationAddress}`]);
  })

  it('should send one transaction per fungible token category', async () => {
    const { wallet, sendCalls } = createFakeWallet([
      bchUtxo(100_000n),
      fungibleTokenUtxo(cat1, 500n),
      fungibleTokenUtxo(cat2, 700n),
    ]);

    await transferAllAssets(wallet, destinationAddress, {});

    expect(sendCalls).toEqual([
      [{ category: cat1 }],
      [{ category: cat2 }],
    ]);
  })

  it('should batch all nfts of one category into a single transaction', async () => {
    const { wallet, sendCalls } = createFakeWallet([
      bchUtxo(100_000n),
      nftUtxo(cat1, "aa"),
      nftUtxo(cat1, "bb"),
      nftUtxo(cat2, "cc"),
    ]);

    await transferAllAssets(wallet, destinationAddress, {});

    expect(sendCalls).toEqual([
      [{ category: cat1, commitment: "aa" }, { category: cat1, commitment: "bb" }],
      [{ category: cat2, commitment: "cc" }],
    ]);
  })

  // a fungible send can spend an NFT coin carrying tokens and return the NFT as change, so the
  // NFT send names the coins as they are once the fungible sends are done
  it('names the nft coins as read after the fungible sends', async () => {
    const nftWithTokens = { ...nftUtxo(cat1, "aa"), token: { category: cat1, amount: 10n, nft: { commitment: "aa", capability: "none" as const } } };
    const { wallet, utxos, ensured } = createFakeWallet([bchUtxo(100_000n), nftWithTokens]);
    const returned = nftUtxo(cat1, "aa");
    const send = wallet.send.bind(wallet);
    wallet.send = ((...args: Parameters<typeof wallet.send>) => {
      utxos.splice(1, 1, returned);
      return send(...args);
    });

    await transferAllAssets(wallet, destinationAddress, {});

    expect(ensured).toEqual([undefined, [returned]]);
  })

  it('should report progress for each phase', async () => {
    const { wallet } = createFakeWallet([
      bchUtxo(100_000n),
      fungibleTokenUtxo(cat1, 500n),
      fungibleTokenUtxo(cat2, 700n),
    ]);

    const progressUpdates: TransferProgress[] = [];
    await transferAllAssets(wallet, destinationAddress, {}, (update) => progressUpdates.push(update));

    expect(progressUpdates).toEqual([
      { phase: "fungibleTokens", completed: 0, total: 2 },
      { phase: "fungibleTokens", completed: 1, total: 2 },
      { phase: "fungibleTokens", completed: 2, total: 2 },
      { phase: "nfts", completed: 0, total: 0 },
      { phase: "bch", completed: 0, total: 1 },
      { phase: "bch", completed: 1, total: 1 },
    ]);
  })

  it('should throw instead of sending when the wallet is empty', async () => {
    const { wallet, callOrder } = createFakeWallet([]);

    await expect(transferAllAssets(wallet, destinationAddress, {})).rejects.toThrow();
    expect(callOrder).toEqual([]);
  })

  // this tool empties the wallet of everything a spend can reach, which is not everything it holds
  it('should leave a held back coin behind', async () => {
    const frozenNft = nftUtxo(cat1, "aa");
    const { wallet, sendCalls, pools, exclusions } = createFakeWallet([
      bchUtxo(100_000n),
      nftUtxo(cat1, "bb"),
      frozenNft,
    ]);

    await transferAllAssets(wallet, destinationAddress, held(frozenNft));

    expect(sendCalls).toEqual([[{ category: cat1, commitment: "bb" }]]);
    for (const pool of pools) {
      expect(pool?.some(utxo => utxo.vout === frozenNft.vout)).not.toBe(true);
    }
    // the library leaves the held back coin out of every send, whatever pool it is handed
    for (const excluded of exclusions) {
      expect(excluded).toEqual([`${frozenNft.txid}:${frozenNft.vout}`]);
    }
  })

  // a token coin swept as plain bch would burn its tokens; the library leaves them out on its own,
  // and the pool handed to it leaves them out as well
  it('should keep token coins out of the final bch sweep', async () => {
    const frozenToken = fungibleTokenUtxo(cat1, 500n);
    const { wallet, pools } = createFakeWallet([bchUtxo(100_000n), frozenToken]);

    await transferAllAssets(wallet, destinationAddress, held(frozenToken));

    expect(pools.at(-1)).toEqual([expect.objectContaining({ txid: "00".repeat(32) })]);
  })
})

describe('transferAllAssets and a refused broadcast', () => {
  beforeEach(() => { nextVout = 0 });

  it('stops at the refusal', async () => {
    const { wallet, callOrder } = createFakeWallet([bchUtxo(100_000n), fungibleTokenUtxo(cat1, 500n)]);
    wallet.send = (() => Promise.reject(
      new BroadcastRejectedError("txn-mempool-conflict", { reason: "txn-mempool-conflict", txid: "ab".repeat(32) })
    ));

    await expect(transferAllAssets(wallet, destinationAddress, {})).rejects.toBeInstanceOf(BroadcastRejectedError);
    expect(callOrder).toEqual([]);
  })
})
