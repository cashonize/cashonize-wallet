import { parseExtendedJson } from "../src/utils/utils";
import { cashNinjaJsonString0, cashNinjaJsonString1 } from "./fixtures/wcFixtures";
import { createSignedWcTransaction } from "../src/utils/wcSigning";
import { encodeLockingBytecodeP2pkh, binToHex } from "@bitauth/libauth"
import type { WcSignTransactionRequest } from "@bch-wc2/interfaces";
import { Wallet } from "mainnet-js";

// const throwAwayTestKey = generatePrivateKey()
// const throwAwayTestKeyWif = encodePrivateKeyWif(throwAwayTestKey, "mainnet")
const throwAwayTestKeyWif = 'L15RRkJJdgWARpbwHaZV4a99ciHhKEmWz8bR8aQ5T94FqhfAw3Ac'

const throwAwayWallet = await Wallet.fromWIF(throwAwayTestKeyWif);
const walletLockingBytecode = encodeLockingBytecodeP2pkh(throwAwayWallet.publicKeyHash);
const walletLockingBytecodeHex = binToHex(walletLockingBytecode);

const signingInfo = {
  privateKey: throwAwayWallet.privateKey,
  pubkeyCompressed: throwAwayWallet.publicKeyCompressed
};

describe('test createSignedWcTransaction', () => {
  it('should create a signed transaction from wc info using stringified transaction value', () => {
    const wcTransactionObj = parseExtendedJson(cashNinjaJsonString0) as WcSignTransactionRequest;

    // inputs in 'cashNinjaJsonString' need to be tweaked for the test to be spendable by the throwAway key
    const userInput = wcTransactionObj.sourceOutputs[1]
    if(userInput && 'lockingBytecode' in userInput) userInput.lockingBytecode = walletLockingBytecode

    const encodedTransaction = createSignedWcTransaction(wcTransactionObj, signingInfo, walletLockingBytecodeHex);
    const expectedResult = "02000000021662e68cb471cef702a3f0bc5227737887ce790714e7c45ffb6f215ef01b806200000000a7004ca4028713141b07ddefd36439f60bf596c4f891f8f6ce3dbe20011903404b4c5479009c63c0009d00cf8176557aa169c453a16900cd00c78800d100ce8876537a9300d28800cc00c6537a939d51cc02e8039d51d28800ce01207f7551d188c4539c6352d10088686d5167547a519d5579a9537a88537a547aadc3519d00cf81537aa163c4529d00cd00c78800d100ce8800d200cf8851d1008867c4519d00d10088686d5168feffffffd94402d4efa7621faee88109bd4f9044f4d87f47cf0a60170a58ce8ae4a71ed10000000064412e21e0e38026951bdea6c683619a9add0e2202e7588230d9c8fdd7f0c7de2cf0f80f5d59886272149f5d104542dddc99888ef2b510331b13d6b87eb71324de5a412102c29f6061f6aac2e3c04e24896fb102bb8f9b916fb7d0757bdd00b0dec3c127a0feffffff03284f4c000000000048efacd8c6620010efc41558a398a6bf2e90ea3a32ef4a3840c392237ca01054a9776202f406aa203e7393b927649d62674dfa9883b0faa27188730ee7b4086fa5861b2df915142a87e8030000000000003eefacd8c6620010efc41558a398a6bf2e90ea3a32ef4a3840c392237ca01054a9776002db0676a9148ee26d6c9f58369f94864dc3630cdeb17fae2f2d88acbf50bf07000000001976a9148ee26d6c9f58369f94864dc3630cdeb17fae2f2d88ac00000000"

    expect(binToHex(encodedTransaction)).toEqual(expectedResult);
  })
  it('should create a signed transaction from wc info using transaction hex string value', () => {
    const wcTransactionObj = parseExtendedJson(cashNinjaJsonString1) as WcSignTransactionRequest;

    // inputs in 'cashNinjaJsonString' need to be tweaked for the test to be spendable by the throwAway key
    const userInput = wcTransactionObj.sourceOutputs[1]
    if(userInput && 'lockingBytecode' in userInput) userInput.lockingBytecode = walletLockingBytecode

    const encodedTransaction = createSignedWcTransaction(wcTransactionObj, signingInfo, walletLockingBytecodeHex);
    const expectedResult = "02000000021662e68cb471cef702a3f0bc5227737887ce790714e7c45ffb6f215ef01b806200000000a7004ca4028713141b07ddefd36439f60bf596c4f891f8f6ce3dbe20011903404b4c5479009c63c0009d00cf8176557aa169c453a16900cd00c78800d100ce8876537a9300d28800cc00c6537a939d51cc02e8039d51d28800ce01207f7551d188c4539c6352d10088686d5167547a519d5579a9537a88537a547aadc3519d00cf81537aa163c4529d00cd00c78800d100ce8800d200cf8851d1008867c4519d00d10088686d5168feffffffd94402d4efa7621faee88109bd4f9044f4d87f47cf0a60170a58ce8ae4a71ed10000000064412e21e0e38026951bdea6c683619a9add0e2202e7588230d9c8fdd7f0c7de2cf0f80f5d59886272149f5d104542dddc99888ef2b510331b13d6b87eb71324de5a412102c29f6061f6aac2e3c04e24896fb102bb8f9b916fb7d0757bdd00b0dec3c127a0feffffff03284f4c000000000048efacd8c6620010efc41558a398a6bf2e90ea3a32ef4a3840c392237ca01054a9776202f406aa203e7393b927649d62674dfa9883b0faa27188730ee7b4086fa5861b2df915142a87e8030000000000003eefacd8c6620010efc41558a398a6bf2e90ea3a32ef4a3840c392237ca01054a9776002db0676a9148ee26d6c9f58369f94864dc3630cdeb17fae2f2d88acbf50bf07000000001976a9148ee26d6c9f58369f94864dc3630cdeb17fae2f2d88ac00000000"

    expect(binToHex(encodedTransaction)).toEqual(expectedResult);
  })
})