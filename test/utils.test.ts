import { chaingraphGraphqlUrl, electrumWssUrl, staleTipHours, parseExtendedJson, formatTokenAmount, formatTokenAmountFromBigInt, formatTokenAmountWithSymbol, parseTokenAmountToBigInt, sameTokenList, typedAmountToSatoshis, satoshisToTypedAmount, newTokenItems } from "../src/utils/utils";
import type { Utxo } from "@cashonize/bch-wallet-lib";
import type { BcmrTokenMetadata } from "../src/interfaces/interfaces";
import { numberFormat, decimalMark, formatDecimal } from "../src/utils/numberFormat";
import { cashNinjaJsonString0, cashNinjaDecodedObj0, cashNinjaJsonString1, cashNinjaDecodedObj1 } from "./fixtures/wcFixtures";

describe('test electrumWssUrl', () => {
  it('should assume the conventional wss port for a bare hostname', () => {
    expect(electrumWssUrl("electrum.imaginary.cash")).toBe("wss://electrum.imaginary.cash:50004");
  })
  it('should keep a specified port', () => {
    expect(electrumWssUrl("fulcrum.pat.mn:443")).toBe("wss://fulcrum.pat.mn:443");
    expect(electrumWssUrl("127.0.0.1:50004")).toBe("wss://127.0.0.1:50004");
  })
  it('should take an unencrypted ws:// server on this machine only', () => {
    expect(electrumWssUrl("ws://127.0.0.1:60104")).toBe("ws://127.0.0.1:60104");
    expect(electrumWssUrl("ws://localhost:60104")).toBe("ws://localhost:60104");
    expect(electrumWssUrl("ws://electrum.example.com:50003")).not.toMatch(/^ws:\/\//);
  })
})

describe('test chaingraphGraphqlUrl', () => {
  it('should append the conventional GraphQL path to a bare host', () => {
    expect(chaingraphGraphqlUrl("chaingraph.example.com")).toBe("https://chaingraph.example.com/v1/graphql");
    expect(chaingraphGraphqlUrl("http://localhost:8080")).toBe("http://localhost:8080/v1/graphql");
  })
  it('should preserve an explicitly supplied path', () => {
    expect(chaingraphGraphqlUrl("https://chaingraph.example.com/graphql"))
      .toBe("https://chaingraph.example.com/graphql");
  })
})

describe('formatTokenAmountWithSymbol', () => {
  it('groups the whole part and keeps the fraction exact', () => {
    expect(formatTokenAmountWithSymbol(130_900_000_000n, { token: { symbol: 'DOGECASH' } })).toBe('130,900,000,000 DOGECASH');
    expect(formatTokenAmountWithSymbol(150n, { token: { decimals: 2, symbol: 'X' } })).toBe('1.5 X');
  });

  // a bare number reads as satoshis or as NFTs just as easily, so an amount whose metadata names
  // no symbol still says what it counts
  it('falls back to the generic unit', () => {
    expect(formatTokenAmountWithSymbol(123_456_789n, { token: { decimals: 4 } })).toBe('12,345.6789 tokens');
    expect(formatTokenAmountWithSymbol(5n, undefined)).toBe('5 tokens');
    expect(formatTokenAmountWithSymbol(1n, undefined)).toBe('1 token');
  });
});

describe('formatTokenAmount', () => {
  it('groups the whole part and keeps the fraction', () => {
    expect(formatTokenAmount(50_000_000n, 2)).toBe('500,000');
    expect(formatTokenAmount(1005n, 1)).toBe('100.5');
    expect(formatTokenAmount(1234567n, 0)).toBe('1,234,567');
  })
  it('keeps the sign of a negative amount', () => {
    expect(formatTokenAmount(-1234567n, 0)).toBe('-1,234,567');
    expect(formatTokenAmount(-50n, 2)).toBe('-0.5');
  })
  it('treats absent decimals as none', () => {
    expect(formatTokenAmount(1234567n, undefined)).toBe('1,234,567');
  })
})

describe('number format setting', () => {
  afterEach(() => { numberFormat.value = 'en-US'; });

  it('groups and marks decimals the way each format is shown in the settings', () => {
    const shown = { 'en-US': '1,234,567.89', 'de-DE': '1.234.567,89', 'fr-FR': '1\u202f234\u202f567,89', 'de-CH': "1'234'567.89" };
    for (const [format, expected] of Object.entries(shown)) {
      expect(formatDecimal(1234567.89, {}, format as keyof typeof shown)).toBe(expected);
    }
  })
  it('keeps every digit of a token amount, with the format\'s decimal mark', () => {
    numberFormat.value = 'de-DE';
    expect(decimalMark()).toBe(',');
    expect(formatTokenAmount(90_071_992_547_409_931n, 2)).toBe('900.719.925.474.099,31');
    expect(formatTokenAmount(-50n, 2)).toBe('-0,5');
    numberFormat.value = 'de-CH';
    expect(formatTokenAmount(123_456_789n, 4)).toBe("12'345.6789");
  })
  it('leaves the amounts machines read with a dot', () => {
    numberFormat.value = 'de-DE';
    expect(formatTokenAmountFromBigInt(150n, 2)).toBe('1.5');
  })
})

describe('test formatTokenAmountFromBigInt', () => {
  it('should return the base units unchanged for a token without decimals', () => {
    expect(formatTokenAmountFromBigInt(1000n, 0)).toBe("1000");
  })
  it('should place the decimal point and strip trailing zeros', () => {
    expect(formatTokenAmountFromBigInt(10_000_000n, 8)).toBe("0.1");
    expect(formatTokenAmountFromBigInt(150n, 2)).toBe("1.5");
    expect(formatTokenAmountFromBigInt(100n, 2)).toBe("1");
  })
  it('should keep amounts a number cannot hold exactly', () => {
    expect(formatTokenAmountFromBigInt(9_007_199_254_740_993n, 0)).toBe("9007199254740993");
    expect(formatTokenAmountFromBigInt(90_071_992_547_409_931n, 2)).toBe("900719925474099.31");
  });

  // history changes are signed, so the sign has to survive the string math and the grouping
  it('keeps the sign of a negative amount', () => {
    expect(formatTokenAmountFromBigInt(-150n, 2)).toBe("-1.5");
    expect(formatTokenAmount(-123_456_789n, 4)).toBe("-12,345.6789");
    // below one whole token the whole part is "-0", which BigInt would turn into 0
    expect(formatTokenAmount(-50n, 2)).toBe("-0.5");
    expect(formatTokenAmountFromBigInt(-50n, 2)).toBe("-0.5");
  })
  it('should round-trip with parseTokenAmountToBigInt', () => {
    for (const decimals of [0, 8, 18]) {
      const baseUnits = 123_456_789_012_345_678n;
      expect(parseTokenAmountToBigInt(formatTokenAmountFromBigInt(baseUnits, decimals), decimals)).toBe(baseUnits);
    }
  })
})

// A typed amount takes a dot as its only separator, in every language
describe('parseTokenAmountToBigInt', () => {
  it('reads a dot as the decimal separator', () => {
    expect(parseTokenAmountToBigInt('0.5', 8)).toBe(50_000_000n);
    expect(parseTokenAmountToBigInt('.5', 2)).toBe(50n);
    expect(parseTokenAmountToBigInt(' 12 ', 0)).toBe(12n);
  })
  // dropping the comma once read "0,5" as 5 whole tokens
  it('reads a comma as the decimal mark, never as grouping', () => {
    expect(parseTokenAmountToBigInt('0,5', 8)).toBe(50_000_000n);
    expect(parseTokenAmountToBigInt('1,5', 2)).toBe(150n);
    for (const input of ['1,000', '1,234.5']) {
      expect(() => parseTokenAmountToBigInt(input, 8)).toThrow();
    }
  })
  it('takes no separator at all for a token without decimals', () => {
    expect(() => parseTokenAmountToBigInt('5.0', 0)).toThrow('whole number');
    expect(() => parseTokenAmountToBigInt('1.000', 0)).toThrow('whole number');
  })
})

describe('test parseExtendedJson', () => {
  it('should parse jsonString correctly - cashNinjaJsonString0', () => {
    const parsedObject = parseExtendedJson(cashNinjaJsonString0);
    const expectedResult = cashNinjaDecodedObj0
    expect(parsedObject).toMatchObject(expectedResult);
  })
  it('should parse jsonString correctly - cashNinjaJsonString1', () => {
    const parsedObject = parseExtendedJson(cashNinjaJsonString1);
    const expectedResult = cashNinjaDecodedObj1
    expect(parsedObject).toMatchObject(expectedResult);
  })
})

// the genesis block header, timestamped 2009-01-03 18:15:05 UTC
const genesis = {
  height: 0,
  hex: '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c',
}
const genesisMs = 1231006505 * 1000
const hourMs = 60 * 60 * 1000

describe('staleTipHours', () => {
  it('reads the timestamp out of the raw header', () => {
    expect(staleTipHours(genesis, genesisMs + 5 * hourMs)).toBe(5)
  })

  // an hour between blocks happens every few days, so it must not read as a stuck server
  it('keeps a tip of a few hours old current', () => {
    expect(staleTipHours(genesis, genesisMs + 10 * 60 * 1000)).toBeUndefined()
    expect(staleTipHours(genesis, genesisMs + 2.9 * hourMs)).toBeUndefined()
  })

  it('calls a tip stale from three hours', () => {
    expect(staleTipHours(genesis, genesisMs + 3 * hourMs)).toBe(3)
  })

  // a device clock behind the chain makes the tip look newer, never stale
  it('keeps a tip from the future current', () => {
    expect(staleTipHours(genesis, genesisMs - hourMs)).toBeUndefined()
  })
})

describe('typedAmountToSatoshis', () => {
  it('converts bch amounts exactly, with either decimal mark', () => {
    expect(typedAmountToSatoshis('1', 'bch')).toBe(100_000_000n);
    expect(typedAmountToSatoshis('0.3', 'bch')).toBe(30_000_000n);
    expect(typedAmountToSatoshis('0,3', 'bch')).toBe(30_000_000n);
    expect(typedAmountToSatoshis('0.00000001', 'bch')).toBe(1n);
    expect(typedAmountToSatoshis('20999999.99999999', 'bch')).toBe(2_099_999_999_999_999n);
  });

  it('refuses a bch amount with more than 8 decimals instead of rounding it', () => {
    expect(() => typedAmountToSatoshis('0.000000015', 'bch')).toThrow();
    expect(() => typedAmountToSatoshis('1.123456789', 'bch')).toThrow();
  });

  it('refuses more bch than will ever exist', () => {
    expect(() => typedAmountToSatoshis('21000001', 'bch')).toThrow();
  });

  // in sats a separator can only be grouping, so 1.000 is never read as one satoshi
  it('takes whole satoshis without any separator', () => {
    expect(typedAmountToSatoshis('1500', 'sat')).toBe(1500n);
    expect(() => typedAmountToSatoshis('1.5', 'sat')).toThrow();
    expect(() => typedAmountToSatoshis('1.000', 'sat')).toThrow();
  });

  it('refuses zero, a sign and empty input in either unit', () => {
    for (const unit of ['bch', 'sat'] as const) {
      for (const input of ['0', '-1', '', '1e5']) expect(() => typedAmountToSatoshis(input, unit)).toThrow();
    }
  });

  it('round-trips what the app fills into the field, in a comma format too', () => {
    for (const format of ['en-US', 'de-DE'] as const) {
      numberFormat.value = format;
      for (const satoshis of [150_000_000n, 1_234n, 123_456_789n]) {
        expect(typedAmountToSatoshis(satoshisToTypedAmount(satoshis, 'bch'), 'bch')).toBe(satoshis);
      }
    }
    numberFormat.value = 'en-US';
  });
});

describe('sameTokenList', () => {
  const category = '0123456789abcdef'.repeat(4)
  const nft = { txid: 'cc'.repeat(32), vout: 0, satoshis: 1000n, address: 'bitcoincash:qtest', token: { category, amount: 0n, nft: { capability: 'none' as const, commitment: '01' } } }

  it('is the same for a rebuilt list with the same entries', () => {
    expect(sameTokenList(
      [{ category, amount: 5n }, { category: 'ab'.repeat(32), nfts: [nft] }],
      [{ category, amount: 5n }, { category: 'ab'.repeat(32), nfts: [{ ...nft }] }],
    )).toBe(true)
  })

  it('differs on an amount, an NFT coin or the order', () => {
    const other = { category: 'ab'.repeat(32), amount: 1n }
    expect(sameTokenList([{ category, amount: 5n }], [{ category, amount: 6n }])).toBe(false)
    expect(sameTokenList(
      [{ category, nfts: [nft] }],
      [{ category, nfts: [{ ...nft, vout: 1 }] }],
    )).toBe(false)
    expect(sameTokenList([{ category, amount: 5n }, other], [other, { category, amount: 5n }])).toBe(false)
  })
})

describe('newTokenItems', () => {
  const category = '0123456789abcdef'.repeat(4)
  const coin = (token?: Utxo['token']) => ({ txid: 'cc'.repeat(32), vout: 0, satoshis: 1000n, address: 'bitcoincash:qtest', ...(token ? { token } : {}) }) as Utxo
  const nft = (commitment: string) => coin({ category, amount: 0n, nft: { capability: 'none', commitment } })
  const held = [{ category, nfts: [nft('01')] }]
  const registries = { [category]: { nfts: { '01': {} } } } as unknown as Record<string, BcmrTokenMetadata>

  it('fetches a category the wallet did not hold', () => {
    expect(newTokenItems([coin(), coin({ category, amount: 5n })], [], undefined)).toEqual([{ category, amount: 5n }])
  })

  it('skips a held category, unless the coin is an NFT commitment without metadata', () => {
    expect(newTokenItems([coin({ category, amount: 5n }), nft('01')], held, registries)).toEqual([])
    expect(newTokenItems([nft('02')], held, registries)).toEqual([
      { category, nfts: [{ token: { nft: { capability: 'none', commitment: '02' } } }] },
    ])
  })
})
