import { emeraldKeycardParseResult } from "../src/parsing/emeraldKeycard";

// keycard #206 from the U23 series: serial 0x00ce, then 10_113_392 satoshis, both little-endian
const keycardCommitment = "ce0070519a0000000000";

describe("emeraldKeycardParseResult", () => {
  it("reads the keycard number and the BCH locked in its safebox", () => {
    const result = emeraldKeycardParseResult(keycardCommitment, undefined, "usd");
    expect(result?.success).toBe(true);
    expect(result?.namedFields).toEqual([
      { name: "Keycard", value: "#206" },
      { name: "Locked value", value: "0.10113392 BCH" },
    ]);
  });

  it("adds the locked value in the user's currency when the exchange rate is known", () => {
    const result = emeraldKeycardParseResult(keycardCommitment, 300, "usd");
    expect(result?.namedFields?.[1]?.value).toBe("0.10113392 BCH (≈ $30.34)");
  });

  it("is undefined for a commitment that is not a keycard", () => {
    expect(emeraldKeycardParseResult("0200", 300, "usd")).toBeUndefined();
    expect(emeraldKeycardParseResult(undefined, 300, "usd")).toBeUndefined();
  });
});
