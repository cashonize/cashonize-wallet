import { parseBip21Uri, isBip21Uri, addressFromUri, formatSatoshisAsBch } from "../src/utils/payments/bip21";

const testAddress = "bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv";

describe("parseBip21Uri", () => {
  describe("basic address parsing", () => {
    it("should parse a simple bitcoincash address", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv");
      expect(result.address).toBe("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv");
      expect(result.amount).toBeUndefined();
      expect(result.label).toBeUndefined();
      expect(result.message).toBeUndefined();
      expect(result.hasUnknownRequired).toBe(false);
    });

    it("should parse a bchtest address", () => {
      const result = parseBip21Uri("bchtest:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgspcw7ktl");
      expect(result.address).toBe("bchtest:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgspcw7ktl");
      expect(result.hasUnknownRequired).toBe(false);
    });

  });

  describe("amount parameter", () => {
    it("should parse integer amount", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=1");
      expect(result.amount).toBe(1);
    });

    it("should parse decimal amount", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=1.5");
      expect(result.amount).toBe(1.5);
    });

    it("should parse small decimal amount", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=0.00000001");
      expect(result.amount).toBe(0.00000001);
    });

    it("should parse large amount", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=21000000");
      expect(result.amount).toBe(21000000);
    });

    it("should reject amount with comma and flag as invalid (BIP21 requirement)", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=1,000");
      expect(result.amount).toBeUndefined();
      expect(result.hasInvalidAmount).toBe(true);
    });

    it("should reject negative amount and flag as invalid", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=-1");
      expect(result.amount).toBeUndefined();
      expect(result.hasInvalidAmount).toBe(true);
    });

    it("should reject invalid amount string and flag as invalid", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=abc");
      expect(result.amount).toBeUndefined();
      expect(result.hasInvalidAmount).toBe(true);
    });

    it("should flag empty amount as invalid", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=");
      expect(result.amount).toBeUndefined();
      expect(result.hasInvalidAmount).toBe(true);
    });
  });

  describe("label and message parameters", () => {
    it("should parse label parameter", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?label=Luke-Jr");
      expect(result.label).toBe("Luke-Jr");
    });

    it("should parse message parameter", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?message=Donation");
      expect(result.message).toBe("Donation");
    });

    it("should parse URL-encoded label", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?label=My%20Shop");
      expect(result.label).toBe("My Shop");
    });

    it("should parse URL-encoded message", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?message=Donation%20for%20project%20xyz");
      expect(result.message).toBe("Donation for project xyz");
    });

    it("should handle special characters in message", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?message=Order%20%23123%20%26%20more");
      expect(result.message).toBe("Order #123 & more");
    });
  });

  describe("multiple parameters", () => {
    it("should parse all standard parameters together", () => {
      const result = parseBip21Uri(
        "bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=50&label=Luke-Jr&message=Donation%20for%20project%20xyz"
      );
      expect(result.address).toBe("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv");
      expect(result.amount).toBe(50);
      expect(result.label).toBe("Luke-Jr");
      expect(result.message).toBe("Donation for project xyz");
      expect(result.hasUnknownRequired).toBe(false);
    });

    it("should handle parameters in any order", () => {
      const result = parseBip21Uri(
        "bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?message=Test&amount=1&label=Shop"
      );
      expect(result.amount).toBe(1);
      expect(result.label).toBe("Shop");
      expect(result.message).toBe("Test");
    });
  });

  describe("unknown parameters", () => {
    it("should collect unknown non-required parameters in otherParams", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?custom=value");
      expect(result.otherParams).toEqual({ custom: "value" });
      expect(result.hasUnknownRequired).toBe(false);
    });

    it("should flag unknown req-* parameters", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?req-unknown=value");
      expect(result.hasUnknownRequired).toBe(true);
    });

    it("should still parse valid parameters when unknown req-* is present", () => {
      const result = parseBip21Uri(
        "bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=1&req-unknown=value&label=Test"
      );
      expect(result.amount).toBe(1);
      expect(result.label).toBe("Test");
      expect(result.hasUnknownRequired).toBe(true);
    });

    it("should collect CashToken params (c=, ft=, nft=) in otherParams", () => {
      const result = parseBip21Uri(
        "bitcoincash:zr7fzmep8g7h7ymfxy74lgc0v950j3r295z4y4gq0v?c=abc123&ft=100&nft=deadbeef"
      );
      expect(result.otherParams?.c).toBe("abc123");
      expect(result.otherParams?.ft).toBe("100");
      expect(result.otherParams?.nft).toBe("deadbeef");
      expect(result.hasUnknownRequired).toBe(false);
    });
  });

  describe("error cases", () => {
    it("should throw on empty string", () => {
      expect(() => parseBip21Uri("")).toThrow("URI must be a non-empty string");
    });

    it("should throw on invalid scheme", () => {
      expect(() => parseBip21Uri("bitcoin:1234")).toThrow("Invalid URI scheme");
    });

    it("should throw on missing address", () => {
      expect(() => parseBip21Uri("bitcoincash:")).toThrow("URI must contain an address");
    });

    it("should throw on only query params", () => {
      expect(() => parseBip21Uri("bitcoincash:?amount=1")).toThrow("URI must contain an address");
    });
  });

  describe("edge cases", () => {
    it("should handle trailing question mark with no params", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?");
      expect(result.address).toBe("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv");
      expect(result.amount).toBeUndefined();
    });

    it("should handle amount=0", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=0");
      expect(result.amount).toBe(0);
    });
  });

  describe("duplicate key detection", () => {
    it("should flag duplicate amount parameters", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=1&amount=100");
      expect(result.hasDuplicateKeys).toBe(true);
    });

    it("should flag duplicate label parameters", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?label=a&label=b");
      expect(result.hasDuplicateKeys).toBe(true);
    });

    it("should flag duplicate custom parameters", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?c=abc&c=def");
      expect(result.hasDuplicateKeys).toBe(true);
    });

    it("should not flag unique parameters", () => {
      const result = parseBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=1&label=test");
      expect(result.hasDuplicateKeys).toBeUndefined();
    });
  });
});

describe("isBip21Uri", () => {
  it("should return true for bitcoincash: URI", () => {
    expect(isBip21Uri("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv")).toBe(true);
  });

  it("should return true for bchtest: URI", () => {
    expect(isBip21Uri("bchtest:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgspcw7ktl")).toBe(true);
  });

  it("should return false for bitcoin: (BTC) URI", () => {
    expect(isBip21Uri("bitcoin:1234")).toBe(false);
  });

  it("should return false for plain address", () => {
    expect(isBip21Uri("qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isBip21Uri("")).toBe(false);
  });

  it("should return false for non-string", () => {
    expect(isBip21Uri(null as unknown as string)).toBe(false);
    expect(isBip21Uri(undefined as unknown as string)).toBe(false);
  });
});

describe("addressFromUri", () => {
  it("should strip the query params off a uri", () => {
    expect(addressFromUri(`${testAddress}?amount=1.5&message=Order+123`)).toBe(testAddress);
  });

  it("should leave a uri without params alone", () => {
    expect(addressFromUri(testAddress)).toBe(testAddress);
  });

  it("should leave a plain address alone", () => {
    expect(addressFromUri("qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv"))
      .toBe("qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv");
  });

  it("should return the input unchanged when the uri does not parse", () => {
    // the caller then judges the whole input as an address and reports it as invalid itself
    expect(addressFromUri("bitcoincash:?amount=1")).toBe("bitcoincash:?amount=1");
  });
});

describe("formatSatoshisAsBch", () => {
  it("should format whole bch amounts without decimals", () => {
    expect(formatSatoshisAsBch(100_000_000n)).toBe("1");
    expect(formatSatoshisAsBch(2_100_000_000_000_000n)).toBe("21000000");
  });

  it("should strip trailing zeros from the fractional part", () => {
    expect(formatSatoshisAsBch(5_000_000n)).toBe("0.05");
    expect(formatSatoshisAsBch(150_000_000n)).toBe("1.5");
  });

  it("should format a single satoshi", () => {
    expect(formatSatoshisAsBch(1n)).toBe("0.00000001");
  });

  it("should format amounts a float would round badly", () => {
    // 0.1 + 0.2 in float bch math gives 0.30000000000000004
    expect(formatSatoshisAsBch(30_000_000n)).toBe("0.3");
    expect(formatSatoshisAsBch(123_456_789n)).toBe("1.23456789");
  });

  it("should format zero", () => {
    expect(formatSatoshisAsBch(0n)).toBe("0");
  });
});

describe("full URI parsing", () => {
  it("should parse a complete URI with all parameters", () => {
    const parsed = parseBip21Uri(
      "bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv?amount=1.5&label=Test+Shop&message=Order+123"
    );
    expect(parsed.address).toBe("bitcoincash:qz2qya9a8s7f0vs0m68fxlkdfse2gj8wpgsw5szafv");
    expect(parsed.amount).toBe(1.5);
    expect(parsed.label).toBe("Test Shop");
    expect(parsed.message).toBe("Order 123");
  });
});
