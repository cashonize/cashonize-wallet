import { txDirection, isCombined, isDappInteraction, isSelfSend, receiptsToAnnounce } from "../src/utils/history/txDirection";
import type { TransactionHistoryItem, Utxo } from "@cashonize/bch-wallet-lib";

const category = "aabbccdd".repeat(8);

const makeTx = (overrides: Partial<TransactionHistoryItem>): TransactionHistoryItem => ({
  hash: "txhash123",
  blockHeight: 800000,
  timestamp: 1700000000,
  size: 250,
  fee: 300,
  balance: 150_000_000,
  valueChange: -50_000_000,
  inputs: [],
  outputs: [],
  tokenAmountChanges: [],
  ...overrides,
});

const input = (address: string) => ({ address, value: 10_000 } as TransactionHistoryItem["inputs"][number]);

describe('txDirection', () => {
  it('should classify a plain BCH receive as received', () => {
    expect(txDirection(makeTx({ valueChange: 100_000 }))).toBe('received');
  });

  it('should classify a plain BCH send as sent', () => {
    expect(txDirection(makeTx({ valueChange: -100_000 }))).toBe('sent');
  });

  it('should classify a token receive with dust as received', () => {
    const tx = makeTx({ valueChange: 1000, tokenAmountChanges: [{ category, amount: 5n, nftAmount: 0n }] });
    expect(txDirection(tx)).toBe('received');
  });

  it('should classify a token send paying the fee as sent', () => {
    const tx = makeTx({ valueChange: -500, tokenAmountChanges: [{ category, amount: -5n, nftAmount: 0n }] });
    expect(txDirection(tx)).toBe('sent');
  });

  it('should classify BCH in with tokens out as combined', () => {
    const tx = makeTx({ valueChange: 349_321_793, tokenAmountChanges: [{ category, amount: -540n, nftAmount: -1n }] });
    expect(txDirection(tx)).toBe('combined');
    expect(isCombined(tx)).toBe(true);
  });

  it('should classify BCH out with tokens in as combined', () => {
    const tx = makeTx({ valueChange: -1000, tokenAmountChanges: [{ category, amount: 0n, nftAmount: 1n }] });
    expect(txDirection(tx)).toBe('combined');
  });

  it('should classify a token for token trade as combined', () => {
    const tx = makeTx({ valueChange: -500, tokenAmountChanges: [
      { category, amount: 10n, nftAmount: 0n },
      { category: "11223344".repeat(8), amount: -3n, nftAmount: 0n },
    ]});
    expect(txDirection(tx)).toBe('combined');
  });
});

describe('isDappInteraction', () => {
  const ownAddress = "bitcoincash:qq1234ownaddress";
  const hasWalletAddress = (address: string) => address === ownAddress;

  it('should detect a cosigned transaction spending a P2SH input', () => {
    const tx = makeTx({ inputs: [input("bitcoincash:pp1234contract"), input(ownAddress)] });
    expect(isDappInteraction(tx, hasWalletAddress)).toBe(true);
  });

  it('should detect the token-aware P2SH address variant', () => {
    const tx = makeTx({ inputs: [input("bitcoincash:rr1234contract"), input(ownAddress)] });
    expect(isDappInteraction(tx, hasWalletAddress)).toBe(true);
  });

  // a P2S contract has no address; the library names it by its bytecode instead
  it('should detect a cosigned transaction spending a P2S input', () => {
    const tx = makeTx({ inputs: [input("SCRIPT: 51935287"), input(ownAddress)] });
    expect(isDappInteraction(tx, hasWalletAddress)).toBe(true);
  });

  it('should not flag a third party paying from a P2SH wallet', () => {
    const tx = makeTx({ inputs: [input("bitcoincash:pp1234exchange")] });
    expect(isDappInteraction(tx, hasWalletAddress)).toBe(false);
  });

  it('should not flag plain P2PKH transactions', () => {
    const tx = makeTx({ inputs: [input("bitcoincash:qq1234other"), input(ownAddress)] });
    expect(isDappInteraction(tx, hasWalletAddress)).toBe(false);
  });

  it('should handle the coinbase pseudo address', () => {
    const tx = makeTx({ inputs: [input("coinbase")] });
    expect(isDappInteraction(tx, hasWalletAddress)).toBe(false);
  });
});

describe('isSelfSend', () => {
  const own = "bitcoincash:qown";
  const ownChange = "bitcoincash:qownchange";
  const isOwn = (address: string) => address === own || address === ownChange;
  const consolidation = { valueChange: -300, inputs: [input(own), input(ownChange)], outputs: [input(own)] };

  it('should recognise a send between the wallet\'s own addresses', () => {
    expect(isSelfSend(makeTx(consolidation), isOwn)).toBe(true);
  });

  it('should allow an OP_RETURN output', () => {
    const opReturn = { ...input("OP_RETURN: 6a0442434d52"), lockingBytecode: "6a0442434d52" };
    const tx = makeTx({ ...consolidation, outputs: [input(own), opReturn] });
    expect(isSelfSend(tx, isOwn)).toBe(true);
  });

  it('should not count a send with an output to someone else', () => {
    const tx = makeTx({ ...consolidation, outputs: [input(own), input("bitcoincash:qsomeoneelse")] });
    expect(isSelfSend(tx, isOwn)).toBe(false);
  });

  it('should not count a transaction with an input of someone else', () => {
    const tx = makeTx({ ...consolidation, valueChange: 5_000, inputs: [input(own), input("bitcoincash:qsomeoneelse")] });
    expect(isSelfSend(tx, isOwn)).toBe(false);
  });

  it('should not count a token burn', () => {
    const tx = makeTx({ ...consolidation, tokenAmountChanges: [{ category, amount: -100n, nftAmount: 0n }] });
    expect(isSelfSend(tx, isOwn)).toBe(false);
  });
});

describe('receiptsToAnnounce', () => {
  const own = 'bitcoincash:qown';
  const isOwn = (address: string) => address === own;
  const io = (address: string, value: number, token?: TransactionHistoryItem["outputs"][number]["token"]) =>
    ({ address, value, ...(token ? { token } : {}) } as TransactionHistoryItem["outputs"][number]);
  const coin = (hash: string) => ({ txid: hash } as Utxo);
  const nft = { category, amount: 0n, nft: { capability: 'none' as const, commitment: '01' } };

  it('announces a payment once per transaction, also when its coins come over two calls', () => {
    const payment = makeTx({ hash: 'bb', inputs: [io('bitcoincash:qother', 9000)], outputs: [io(own, 4000), io(own, 3000)] });
    const announced = new Set<string>();
    expect(receiptsToAnnounce([payment], [coin('bb')], announced, isOwn)).toEqual([{ satoshis: 7000n, tokenType: undefined }]);
    expect(receiptsToAnnounce([payment], [coin('bb')], announced, isOwn)).toEqual([]);
  });

  it('announces an NFT without its dust as received BCH', () => {
    const tx = makeTx({ hash: 'bb', inputs: [io('bitcoincash:qother', 3000)], outputs: [io(own, 1000, nft)],
      tokenAmountChanges: [{ category, amount: 0n, nftAmount: 1n }] });
    expect(receiptsToAnnounce([tx], [coin('bb')], new Set(), isOwn)).toEqual([{ satoshis: 0n, tokenType: 'NFT' }]);
  });

  // the same keys open elsewhere: the change of a send made there has an input of the wallet
  it('does not announce the change of a send from this wallet', () => {
    const send = makeTx({ hash: 'bb', inputs: [io(own, 10_000)], outputs: [io('bitcoincash:qother', 1000), io(own, 8000)] });
    expect(receiptsToAnnounce([send], [coin('bb')], new Set(), isOwn)).toEqual([]);
  });

  it('does not announce an older receipt in the history that brought none of the added coins', () => {
    const older = makeTx({ hash: 'dd', inputs: [io('bitcoincash:qother', 9000)], outputs: [io(own, 8000)] });
    expect(receiptsToAnnounce([older], [coin('bb')], new Set(), isOwn)).toEqual([]);
  });
});
