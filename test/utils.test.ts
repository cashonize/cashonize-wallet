import { parseExtendedJson } from "../src/utils/utils";
import { cashNinjaJsonString, cashNinjaDecodedObj } from "./fixtures/wcFixtures";

describe('test parseExtendedJson', () => {
  it('should parse jsonString correctly', async() => {
    const parsedObject = parseExtendedJson(cashNinjaJsonString);
    const expectedResult = cashNinjaDecodedObj
    expect(parsedObject).toMatchObject(expectedResult);
  })
})