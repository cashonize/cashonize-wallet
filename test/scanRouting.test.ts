import { encodeCashAddress, encodePrivateKeyWif, hexToBin } from "@bitauth/libauth";
import { routeScannedCode } from "../src/utils/scanRouting";
import { CASHCONNECT_SCHEME } from "../src/utils/dapp/dappUri";

const payload = hexToBin("9402f4bd3c3c97b20fde8e937ecd4c32a448ee0a");
const address = encodeCashAddress({ prefix: "bitcoincash", type: "p2pkh", payload }).address;
const tokenAddress = encodeCashAddress({ prefix: "bitcoincash", type: "p2pkhWithTokens", payload }).address;
const testnetAddress = encodeCashAddress({ prefix: "bchtest", type: "p2pkh", payload }).address;
const privateKey = hexToBin("01".repeat(32));
const mainnetWif = encodePrivateKeyWif(privateKey, "mainnet");
const testnetWif = encodePrivateKeyWif(privateKey, "testnet");
// the encrypted key of BIP38's first test vector
const bip38Key = "6PRVWUbkzzsbcVac2qwfssoUJAN1Xhrg6bNk8J7Nzm5H7kxEbn2Nh2ZoGg";
const walletConnectUri = `wc:${"ab".repeat(32)}@2?relay-protocol=irn&symKey=${"cd".repeat(32)}`;

const onMainnet = (content: string) => routeScannedCode(content, "mainnet", "bitcoincash");
const onChipnet = (content: string) => routeScannedCode(content, "chipnet", "bchtest");

describe("routeScannedCode", () => {
  it("sends an address or a payment request to the send form", () => {
    expect(onMainnet(address)).toEqual({ page: "send" });
    expect(onMainnet(tokenAddress)).toEqual({ page: "send" });
    expect(onMainnet(`${address}?amount=0.5`)).toEqual({ page: "send" });
    expect(onChipnet(testnetAddress)).toEqual({ page: "send" });
  });

  it("sends a pairing URI of each protocol to the connect page", () => {
    expect(onMainnet(walletConnectUri)).toEqual({ page: "connect" });
    expect(onMainnet(`${CASHCONNECT_SCHEME}anything`)).toEqual({ page: "connect" });
    expect(onMainnet("WIZ://%3FP%3DABC")).toEqual({ page: "connect" });
  });

  it("sends a private key to the sweep tool, with or without its scheme", () => {
    expect(onMainnet(mainnetWif)).toEqual({ page: "sweep" });
    expect(onMainnet(`bch-wif:${mainnetWif}`)).toEqual({ page: "sweep" });
    expect(onChipnet(testnetWif)).toEqual({ page: "sweep" });
    expect(onMainnet(bip38Key)).toEqual({ page: "sweep" });
  });

  it("refuses an address or key of another network with that reason", () => {
    expect(onMainnet(testnetAddress)).toEqual({ error: "Not a cashaddress on current network" });
    expect(onChipnet(address)).toEqual({ error: "Not a cashaddress on current network" });
    expect(onMainnet(testnetWif)).toEqual({ error: "Not a QR code encoding a Mainnet Private Key in WIF format" });
    expect(onChipnet(mainnetWif)).toEqual({ error: "Not a QR code encoding a chipnet Private Key in WIF format" });
  });

  it("refuses what the wallet has no page for", () => {
    const nothingToDo = { error: "Not a BCH address, payment request, dApp connection or private key" };
    expect(onMainnet("https://example.com")).toEqual(nothingToDo);
    expect(onMainnet("")).toEqual(nothingToDo);
    // a WalletConnect URI cut short is not handed to pairing
    expect(onMainnet("wc:abcd@2?relay-protocol=irn")).toEqual(nothingToDo);
  });
});
