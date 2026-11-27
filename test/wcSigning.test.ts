import { parseExtendedJson } from "../src/utils/utils";
import { cashNinjaJsonString0, cashNinjaJsonString1, cauldronWithdrawJsonString } from "./fixtures/wcFixtures";
import { createSignedWcTransaction, sessionSigningKeys } from "../src/utils/dapp/wcSigning";
import { encodeLockingBytecodeP2pkh, binToHex, hexToBin, decodeTransaction, createVirtualMachineBch } from "@bitauth/libauth"
import type { WcSignTransactionRequest } from "@bch-wc2/interfaces";
import { DefaultProvider, HDWallet, Wallet } from "@cashonize/bch-wallet-lib";

// const throwAwayTestKey = generatePrivateKey()
// const throwAwayTestKeyWif = encodePrivateKeyWif(throwAwayTestKey, "mainnet")
const throwAwayTestKeyWif = 'L15RRkJJdgWARpbwHaZV4a99ciHhKEmWz8bR8aQ5T94FqhfAw3Ac'

// a wallet subscribes to its address as it is constructed, so it gets a server that is never
// there, and is stopped at once: only its keys are used
DefaultProvider.servers.mainnet = ["wss://127.0.0.1:1"];
const throwAwayWallet = await Wallet.fromWIF(throwAwayTestKeyWif);
await throwAwayWallet.stop();
const walletLockingBytecode = encodeLockingBytecodeP2pkh(throwAwayWallet.publicKeyHash);
const walletLockingBytecodeHex = binToHex(walletLockingBytecode);

// signs a cash-ninja request whose input 1 is tweaked to be this wallet's P2PKH coin, and decodes it
function signCashNinja(jsonString: string, describeOtherInput?: (sourceOutput: WcSignTransactionRequest['sourceOutputs'][number]) => void) {
  const wcTransactionObj = parseExtendedJson(jsonString) as WcSignTransactionRequest;
  const userInput = wcTransactionObj.sourceOutputs[1]
  if(userInput && 'lockingBytecode' in userInput) userInput.lockingBytecode = walletLockingBytecode
  const trueSourceOutputs = [...wcTransactionObj.sourceOutputs];
  if (describeOtherInput) wcTransactionObj.sourceOutputs[0] = { ...wcTransactionObj.sourceOutputs[0]! };
  describeOtherInput?.(wcTransactionObj.sourceOutputs[0]!);

  const signedTransaction = decodeTransaction(createSignedWcTransaction(wcTransactionObj, signingInfo, walletLockingBytecodeHex));
  if (typeof signedTransaction === "string") throw new Error(signedTransaction);
  return { signedTransaction, trueSourceOutputs };
}

const signingInfo = {
  privateKey: throwAwayWallet.privateKey,
  pubkeyCompressed: throwAwayWallet.publicKeyCompressed!,
};

describe('test createSignedWcTransaction', () => {
  it('signs the wallet input of a request, with the transaction as an object or as hex', () => {
    for (const jsonString of [cashNinjaJsonString0, cashNinjaJsonString1]) {
      const { signedTransaction, trueSourceOutputs } = signCashNinja(jsonString);
      expect(createVirtualMachineBch(true).verify({ transaction: signedTransaction, sourceOutputs: trueSourceOutputs })).toBe(true);
    }
  })
  // A dapp can describe another input of the transaction falsely, so the dialog doesn't count it as the
  // wallet's, then get that coin signed in a second request: the wallet's signature must not survive the lie
  it('gives a dapp that misdescribes another input a signature that is invalid on the real transaction', () => {
    const { signedTransaction, trueSourceOutputs } = signCashNinja(cashNinjaJsonString0, (otherInput) => {
      otherInput.lockingBytecode = hexToBin('76a914' + '00'.repeat(20) + '88ac');
    });
    const result = createVirtualMachineBch(true).verify({ transaction: signedTransaction, sourceOutputs: trueSourceOutputs });
    expect(result).toContain('index 1');
  })
  it('refuses a request whose sourceOutputs do not match its inputs', () => {
    const wcTransactionObj = parseExtendedJson(cashNinjaJsonString0) as WcSignTransactionRequest;
    wcTransactionObj.sourceOutputs.pop();
    expect(() => createSignedWcTransaction(wcTransactionObj, signingInfo, walletLockingBytecodeHex)).toThrow('length mismatch');
  })
  it('should sign a contract input by filling the sig and pubkey placeholders (Cauldron pool withdrawal)', () => {
    const wcTransactionObj = parseExtendedJson(cauldronWithdrawJsonString) as WcSignTransactionRequest;

    const encodedTransaction = createSignedWcTransaction(wcTransactionObj, signingInfo, walletLockingBytecodeHex);
    const signedTransaction = decodeTransaction(encodedTransaction);
    if (typeof signedTransaction === "string") throw new Error(signedTransaction);

    const vm = createVirtualMachineBch(true);
    const result = vm.verify({ transaction: signedTransaction, sourceOutputs: wcTransactionObj.sourceOutputs });
    expect(result).toBe(true);

    // unlocking bytecode: <push sig> <push pubkey> <redeemScript>; the sig's last byte is the hashType,
    // SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID
    const unlockingBytecode = signedTransaction.inputs[0]!.unlockingBytecode;
    expect(unlockingBytecode[0]).toBe(65);
    expect(unlockingBytecode[65]).toBe(0x61);
  })
})
describe("the key a WalletConnect session signs with", () => {
  const otherAddress = "bitcoincash:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2";

  it("is the single-address wallet's own, for a session on its address", () => {
    const keys = sessionSigningKeys(throwAwayWallet, throwAwayWallet.getDepositAddress());
    expect(keys.privateKey).toEqual(throwAwayWallet.privateKey);
    expect(keys.publicKeyHash).toEqual(throwAwayWallet.publicKeyHash);
  });

  it("is refused to a single-address wallet for a session on another wallet's address", () => {
    expect(() => sessionSigningKeys(throwAwayWallet, otherAddress)).toThrow(otherAddress);
  });

  it("is refused for a session that names no address", () => {
    expect(() => sessionSigningKeys(throwAwayWallet, undefined)).toThrow("No address found for session");
  });

  it("is the key of the session's address in an HD wallet, and refused for an address it does not have", () => {
    const { privateKey, publicKeyCompressed: publicKey, publicKeyHash } = throwAwayWallet;
    const cache = new Map([[throwAwayWallet.getDepositAddress(), { privateKey, publicKey, publicKeyHash }]]);
    const hdWallet = Object.assign(Object.create(HDWallet.prototype) as HDWallet, { walletCache: cache });

    expect(sessionSigningKeys(hdWallet, throwAwayWallet.getDepositAddress()).privateKey).toEqual(privateKey);
    expect(() => sessionSigningKeys(hdWallet, otherAddress)).toThrow(otherAddress);
  });
});
