import { Notify } from "quasar";
import { parseBip21Uri } from "../src/utils/payments/bip21";
import { buildPaymentRequestUri, parsePayProParams, getPaymentRequestValidationError, parseTokenPaymentRequest } from "../src/utils/payments/paymentRequest";

vi.mock("quasar", () => ({ Notify: { create: vi.fn() } }));

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
    expect(parsed.satoshis).toBe(123_456_789n);
    expect(parsed.message).toBe("Order #7 & tip");
  });

  it("should never produce a uri the send flow rejects", () => {
    const uri = buildPaymentRequestUri({ address: testAddress, satoshis: 1n, message: "req-test=1&amount=999" });
    const parsed = parseBip21Uri(uri);
    expect(parsed.hasUnknownRequired).toBe(false);
    expect(parsed.hasDuplicateKeys).toBeUndefined();
    expect(parsed.hasInvalidAmount).toBeUndefined();
    expect(parsed.satoshis).toBe(1n);
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

  it("should read the parameters in uppercase too", () => {
    expect(paramsOf(`C=${category}&F=250`)).toEqual({ category, fungibleAmount: 250n });
  });

  it("should leave both undefined for a plain bch request", () => {
    expect(paramsOf("amount=0.05")).toEqual({ category: undefined, fungibleAmount: undefined });
  });
});

describe("getPaymentRequestValidationError", () => {
  const errorOf = (query: string) => getPaymentRequestValidationError(parseBip21Uri(`${testAddress}?${query}`));
  // 2023-05-15T12:00:00Z, the expiration in the PayPro spec's examples
  const expiration = 1684152000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime((expiration - 60) * 1000);
  });
  afterEach(() => { vi.useRealTimers(); });

  it("should accept a valid request", () => {
    expect(errorOf("amount=1&message=Hi")).toBeNull();
  });

  it("should refuse each BIP21 error", () => {
    expect(errorOf("req-unknown=1")).toBe("Unsupported payment request");
    expect(errorOf("amount=1&amount=2")).toBe("Invalid payment request: duplicate parameters");
    expect(errorOf("amount=1e3")).toBe("Payment request has invalid amount format");
  });

  it("should accept a request before its expiration", () => {
    expect(errorOf(`amount=1&e=${expiration}`)).toBeNull();
  });

  it("should refuse a request once its expiration has passed", () => {
    vi.setSystemTime(expiration * 1000);
    expect(errorOf(`amount=1&e=${expiration}`)).toBe("This payment request has expired");
    expect(errorOf(`amount=1&E=${expiration}`)).toBe("This payment request has expired");
  });

  it("should refuse a malformed expiration", () => {
    expect(errorOf("amount=1&e=tomorrow")).toBe("Payment request has an invalid expiration");
    expect(errorOf("amount=1&e=1.5e9")).toBe("Payment request has an invalid expiration");
    expect(errorOf("amount=1&e=")).toBe("Payment request has an invalid expiration");
  });
});

describe("parseTokenPaymentRequest", () => {
  const tokenAddress = "bitcoincash:zr7fzmep8g7h7ymfxy74lgc0v950j3r295z4y4gq0v";
  const category = "3a29bd2fe2ca319181035844dcff236c518bae26f417911043dc653b1a9dedc7";
  const otherCategory = "b".repeat(64);

  beforeEach(() => { vi.mocked(Notify.create).mockClear(); });

  it("should return the address and token params of a request for this token", () => {
    expect(parseTokenPaymentRequest(`${tokenAddress}?c=${category}&f=250`, category))
      .toEqual({ address: tokenAddress, category, fungibleAmount: 250n });
    expect(Notify.create).not.toHaveBeenCalled();
  });

  it("should leave a plain address alone", () => {
    expect(parseTokenPaymentRequest(tokenAddress, category)).toBeUndefined();
    expect(Notify.create).not.toHaveBeenCalled();
  });

  it("should refuse a request for another token, with a notice", () => {
    expect(parseTokenPaymentRequest(`${tokenAddress}?c=${otherCategory}&f=1`, category)).toBeUndefined();
    expect(Notify.create).toHaveBeenCalledOnce();
  });

  it("should refuse an expired request, with a notice", () => {
    expect(parseTokenPaymentRequest(`${tokenAddress}?c=${category}&f=1&e=1684152000`, category)).toBeUndefined();
    expect(Notify.create).toHaveBeenCalledWith(expect.objectContaining({ message: "This payment request has expired" }));
  });
});
