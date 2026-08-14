import { transferAllAssets, type TransferProgress } from "../src/utils/tools/transferAssets";
import type { WalletType } from "../src/interfaces/interfaces";

const destinationAddress = "bitcoincash:zzd7ucdmlvkarqr3ytft3trl94007r6dr53jj2x88s";

function bchUtxo(satoshis: bigint) {
  return { txid: "00".repeat(32), vout: 0, satoshis };
}
function fungibleTokenUtxo(category: string, amount: bigint) {
  return { txid: "11".repeat(32), vout: 0, satoshis: 1000n, token: { category, amount } };
}
function nftUtxo(category: string, commitment: string) {
  return {
    txid: "22".repeat(32),
    vout: 0,
    satoshis: 1000n,
    token: { category, amount: 0n, nft: { commitment, capability: "none" as const } },
  };
}

// Records the order of the wallet calls the transfer makes, plus the outputs of each send
function createFakeWallet(utxos: unknown[]) {
  const callOrder: string[] = [];
  const sendCalls: { category: string, commitment?: string }[][] = [];
  const wallet = {
    getUtxos: () => Promise.resolve(utxos),
    send: (requests: { category: string, nft?: { commitment: string } }[]) => {
      callOrder.push("send");
      sendCalls.push(requests.map(request => ({
        category: request.category,
        ...(request.nft ? { commitment: request.nft.commitment } : {}),
      })));
      return Promise.resolve({});
    },
    sendMax: (address: string) => {
      callOrder.push(`sendMax:${address}`);
      return Promise.resolve({});
    },
  };
  return { wallet: wallet as unknown as WalletType, callOrder, sendCalls };
}

describe('test transferAllAssets', () => {
  it('should move fungible tokens first, then nfts, then the remaining bch', async () => {
    const { wallet, callOrder } = createFakeWallet([
      bchUtxo(100_000n),
      fungibleTokenUtxo("cat1", 500n),
      nftUtxo("cat2", "aa"),
    ]);

    await transferAllAssets(wallet, destinationAddress);

    // bch has to go last, the token transactions need it to pay their fees
    expect(callOrder).toEqual(["send", "send", `sendMax:${destinationAddress}`]);
  })

  it('should send one transaction per fungible token category', async () => {
    const { wallet, sendCalls } = createFakeWallet([
      bchUtxo(100_000n),
      fungibleTokenUtxo("cat1", 500n),
      fungibleTokenUtxo("cat2", 700n),
    ]);

    await transferAllAssets(wallet, destinationAddress);

    expect(sendCalls).toEqual([
      [{ category: "cat1" }],
      [{ category: "cat2" }],
    ]);
  })

  it('should batch all nfts of one category into a single transaction', async () => {
    const { wallet, sendCalls } = createFakeWallet([
      bchUtxo(100_000n),
      nftUtxo("cat1", "aa"),
      nftUtxo("cat1", "bb"),
      nftUtxo("cat2", "cc"),
    ]);

    await transferAllAssets(wallet, destinationAddress);

    expect(sendCalls).toEqual([
      [{ category: "cat1", commitment: "aa" }, { category: "cat1", commitment: "bb" }],
      [{ category: "cat2", commitment: "cc" }],
    ]);
  })

  it('should report progress for each phase', async () => {
    const { wallet } = createFakeWallet([
      bchUtxo(100_000n),
      fungibleTokenUtxo("cat1", 500n),
      fungibleTokenUtxo("cat2", 700n),
    ]);

    const progressUpdates: TransferProgress[] = [];
    await transferAllAssets(wallet, destinationAddress, (update) => progressUpdates.push(update));

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

    await expect(transferAllAssets(wallet, destinationAddress)).rejects.toThrow();
    expect(callOrder).toEqual([]);
  })
})
