import { electrumWssUrl, parseExtendedJson, formatTokenAmountFromBigInt, parseTokenAmountToBigInt } from "../src/utils/utils";
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