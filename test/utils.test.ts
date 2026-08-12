import { electrumWssUrl, parseExtendedJson } from "../src/utils/utils";
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