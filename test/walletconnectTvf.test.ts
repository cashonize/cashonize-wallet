import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// sign-client is a transitive dependency, so it is resolved from walletkit. Both bundles carry
// the pnpm patch: the app loads the ESM build, CommonJS consumers the other one
const requireFromWalletKit = createRequire(createRequire(import.meta.url).resolve("@reown/walletkit"));
const cjsEntry = requireFromWalletKit.resolve("@walletconnect/sign-client");
const esmEntry = path.join(path.dirname(cjsEntry), "index.js");

type SignClientModule = {
  SignClient: new (opts: { projectId: string; logger: string }) => {
    engine: { extractTxHashesFromResult(request: { method: string; params: unknown[] }, result: unknown): string[] };
  };
};

const bundles: [string, SignClientModule][] = [
  ["ESM", await import(pathToFileURL(esmEntry).href) as SignClientModule],
  ["CommonJS", requireFromWalletKit(cjsEntry) as SignClientModule],
];

describe.each(bundles)("sign-client TVF tx hashes (%s)", (_name, { SignClient }) => {
  // the constructor does not touch the network, only init() does
  const client = new SignClient({ projectId: "test", logger: "silent" });
  const extract = (method: string, result: unknown) =>
    client.engine.extractTxHashesFromResult({ method, params: [] }, result);
  const signature = "H+K3iUFtnOz0pAUvTLW3ohH3eVcDrQrWHcQmTRWz7uPPAPdrbqTWHAuVbGM/EOnpKcl7bmrpdmh7aCJOjhRw6Fs=";

  it("does not report a bch_signMessage signature as a tx hash", () => {
    expect(extract("bch_signMessage", signature)).toEqual([]);
  });

  it("does not report a personal_sign signature as a tx hash", () => {
    expect(extract("personal_sign", signature)).toEqual([]);
  });

  it("still reports the tx hash of a method in its TVF list", () => {
    const txHash = "0x" + "ab".repeat(32);
    expect(extract("eth_sendTransaction", txHash)).toEqual([txHash]);
  });
});
