import { parseBip21Uri } from "../src/utils/payments/bip21";
import { buildPaymentRequestUri, parsePayProParams } from "../src/utils/payments/paymentRequest";

const testAddress = "bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv";

describe("buildPaymentRequestUri", () => {
  it("should return the bare address when nothing is requested", () => {
    expect(buildPaymentRequestUri({ address: testAddress })).toBe(testAddress);
  });

  it("should add the amount in whole bch", () => {
    expect(buildPaymentRequestUri({ address: testAddress, satoshis: 5_000_000n }))
      .toBe(`${testAddress}?amount=0.05`);
  });

  it("should leave out a zero amount", () => {
    expect(buildPaymentRequestUri({ address: testAddress, satoshis: 0n })).toBe(testAddress);
  });

  it("should url-encode the message", () => {
    expect(buildPaymentRequestUri({ address: testAddress, message: "Order #123 & more" }))
      .toBe(`${testAddress}?message=Order%20%23123%20%26%20more`);
  });

  it("should combine amount and message", () => {
    expect(buildPaymentRequestUri({ address: testAddress, satoshis: 100_000n, message: "Invoice 1041" }))
      .toBe(`${testAddress}?amount=0.001&message=Invoice%201041`);
  });

  it("should build chipnet requests", () => {
    const chipnetAddress = "bchtest:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgspcw7ktl";
    expect(buildPaymentRequestUri({ address: chipnetAddress, satoshis: 100_000_000n }))
      .toBe(`${chipnetAddress}?amount=1`);
  });
});

describe("buildPaymentRequestUri for token requests", () => {
  const tokenAddress = "bitcoincash:zr7fzmep8g7h7ymfxy74lgc0v950j3r295z4y4gq0v";
  const category = "3a29bd2fe2ca319181035844dcff236c518bae26f417911043dc653b1a9dedc7";

  it("should add the category", () => {
    expect(buildPaymentRequestUri({ address: tokenAddress, category }))
      .toBe(`${tokenAddress}?c=${category}`);
  });

  it("should add the fungible amount in base units as the spec named f", () => {
    expect(buildPaymentRequestUri({ address: tokenAddress, category, fungibleAmount: 10_000_000n }))
      .toBe(`${tokenAddress}?c=${category}&f=10000000`);
  });

  it("should keep base unit amounts too large for a number exact", () => {
    const hugeAmount = 9_007_199_254_740_993n;
    expect(buildPaymentRequestUri({ address: tokenAddress, category, fungibleAmount: hugeAmount }))
      .toBe(`${tokenAddress}?c=${category}&f=9007199254740993`);
  });

  it("should leave out a zero token amount", () => {
    expect(buildPaymentRequestUri({ address: tokenAddress, category, fungibleAmount: 0n }))
      .toBe(`${tokenAddress}?c=${category}`);
  });

  it("should not emit a token amount without a category", () => {
    expect(buildPaymentRequestUri({ address: tokenAddress, fungibleAmount: 100n })).toBe(tokenAddress);
  });

  it("should combine the token request with a message", () => {
    expect(buildPaymentRequestUri({ address: tokenAddress, category, fungibleAmount: 100n, message: "Invoice 1041" }))
      .toBe(`${tokenAddress}?c=${category}&f=100&message=Invoice%201041`);
  });

  it("should parse back into the params the token send form reads", () => {
    const uri = buildPaymentRequestUri({ address: tokenAddress, category, fungibleAmount: 250n, message: "Order #7" });
    const parsed = parseBip21Uri(uri);
    expect(parsed.address).toBe(tokenAddress);
    expect(parsePayProParams(parsed)).toEqual({ category, fungibleAmount: 250n });
    expect(parsed.message).toBe("Order #7");
    expect(parsed.hasUnknownRequired).toBe(false);
    expect(parsed.hasDuplicateKeys).toBeUndefined();
  });
});

// Every request we generate must be payable by our own send flow
describe("generated requests round-trip through the parser", () => {
  it("should parse back the amount and message unchanged", () => {
    const uri = buildPaymentRequestUri({ address: testAddress, satoshis: 123_456_789n, message: "Order #7 & tip" });
    const parsed = parseBip21Uri(uri);
    expect(parsed.address).toBe(testAddress);
    expect(parsed.amount).toBe(1.23456789);
    expect(parsed.message).toBe("Order #7 & tip");
  });

  it("should never produce a uri the send flow rejects", () => {
    const uri = buildPaymentRequestUri({ address: testAddress, satoshis: 1n, message: "req-test=1&amount=999" });
    const parsed = parseBip21Uri(uri);
    expect(parsed.hasUnknownRequired).toBe(false);
    expect(parsed.hasDuplicateKeys).toBeUndefined();
    expect(parsed.hasInvalidAmount).toBeUndefined();
    expect(parsed.amount).toBe(0.00000001);
    expect(parsed.message).toBe("req-test=1&amount=999");
  });
});

describe("parsePayProParams", () => {
  const tokenAddress = "bitcoincash:zr7fzmep8g7h7ymfxy74lgc0v950j3r295z4y4gq0v";
  const category = "3a29bd2fe2ca319181035844dcff236c518bae26f417911043dc653b1a9dedc7";
  const paramsOf = (query: string) => parsePayProParams(parseBip21Uri(`${tokenAddress}?${query}`));

  it("should read the category and fungible amount", () => {
    expect(paramsOf(`c=${category}&f=250`)).toEqual({ category, fungibleAmount: 250n });
  });

  it("should accept ft as the alias for the amount", () => {
    expect(paramsOf(`c=${category}&ft=250`)).toEqual({ category, fungibleAmount: 250n });
  });

  it("should prefer the spec named f over the ft alias", () => {
    expect(paramsOf(`c=${category}&f=1&ft=2`)).toEqual({ category, fungibleAmount: 1n });
  });

  it("should keep base unit amounts too large for a number exact", () => {
    expect(paramsOf(`c=${category}&f=9007199254740993`).fungibleAmount).toBe(9_007_199_254_740_993n);
  });

  it("should ignore an amount that is not a plain integer", () => {
    expect(paramsOf(`c=${category}&f=2.5`).fungibleAmount).toBeUndefined();
    expect(paramsOf(`c=${category}&f=-1`).fungibleAmount).toBeUndefined();
    expect(paramsOf(`c=${category}&f=abc`).fungibleAmount).toBeUndefined();
  });

  it("should leave both undefined for a plain bch request", () => {
    expect(paramsOf("amount=0.05")).toEqual({ category: undefined, fungibleAmount: undefined });
  });
});
