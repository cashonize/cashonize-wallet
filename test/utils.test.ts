import { chaingraphGraphqlUrl, electrumWssUrl, parseExtendedJson, formatTokenAmount, formatTokenAmountFromBigInt, formatTokenAmountWithSymbol, parseTokenAmountToBigInt } from "../src/utils/utils";
import { cashNinjaJsonString0, cashNinjaDecodedObj0, cashNinjaJsonString1, cashNinjaDecodedObj1 } from "./fixtures/wcFixtures";

describe('test electrumWssUrl', () => {
  it('should assume the conventional wss port for a bare hostname', () => {
    expect(electrumWssUrl("electrum.imaginary.cash")).toBe("wss://electrum.imaginary.cash:50004");
  })
  it('should keep a specified port', () => {
    expect(electrumWssUrl("fulcrum.pat.mn:443")).toBe("wss://fulcrum.pat.mn:443");
    expect(electrumWssUrl("127.0.0.1:50004")).toBe("wss://127.0.0.1:50004");
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
    const baseUnits = 123_456_789_012_345_678n;
    expect(parseTokenAmountToBigInt(formatTokenAmountFromBigInt(baseUnits, 8), 8)).toBe(baseUnits);
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
