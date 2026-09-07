import { describe, expect, it } from "vitest";
import { parseHodlAnnouncement, hodlContractsFromHistory } from "../src/utils/defi/hodlContracts";
import { historyItem, opReturnOutput, p2pkhOutput } from "./mocks/history.mocks";

// Real mainnet announcements: a plugin-era one with a legacy base58 address and version suffix,
// and a newer one with a prefixed cashaddr and no version. The second contract's owner is the
// second pkh below.
const legacyAnnouncement = "6a04686f646c243332636757766b314b34326262333232695379784572514c43657453736f72637943203106373135353537";
const legacyOwnerPkh = "edaab961e6daaa47574fc875b67d9e5c88d4a9a6";
const legacyScriptHash = "0a2642fad2942bc98c6e2c4999505c7d42a4fbf0";
const cashaddrAnnouncement = "6a04686f646c36626974636f696e636173683a707068307878357563386c7068756a6d73726a7965683565737963667a63337776356572737565766e3906383836363632";
const cashaddrOwnerPkh = "8ee26d6c9f58369f94864dc3630cdeb17fae2f2d";
const cashaddrScriptHash = "6ef31a9cc1fe1bf25b80e44cde99813091622e65";

describe('parseHodlAnnouncement', () => {
  it('should parse a legacy-address announcement with version suffix', () => {
    expect(parseHodlAnnouncement(legacyAnnouncement)).toEqual({
      scriptHash: legacyScriptHash, locktime: 715557
    });
  })
  it('should parse a cashaddr announcement without version suffix', () => {
    expect(parseHodlAnnouncement(cashaddrAnnouncement)).toEqual({
      scriptHash: cashaddrScriptHash, locktime: 886662
    });
  })
  it('should parse a cashaddr announcement without the bitcoincash: prefix', () => {
    // the real announcement with the prefix stripped from the pushed address
    const prefixless = cashaddrAnnouncement.replace("36626974636f696e636173683a", "2a");
    expect(parseHodlAnnouncement(prefixless)).toEqual({
      scriptHash: cashaddrScriptHash, locktime: 886662
    });
  })
  it('should reject other OP_RETURN outputs', () => {
    expect(parseHodlAnnouncement("6a0450555348")).toBeUndefined();
  })
  it('should reject an announcement with a malformed locktime', () => {
    const badLocktime = cashaddrAnnouncement.replace("06383836363632", "0631323334F536");
    expect(parseHodlAnnouncement(badLocktime)).toBeUndefined();
  })
})

// A funding transaction of the wallet's carrying the given announcement at output 0
function fundingItem(announcementHex: string, txByte: string) {
  return historyItem(txByte.repeat(32), [opReturnOutput(announcementHex), p2pkhOutput()]);
}

describe('hodlContractsFromHistory', () => {
  it('should find a contract whose announced address a wallet pkh rebuilds', () => {
    const candidates = hodlContractsFromHistory(
      [fundingItem(cashaddrAnnouncement, "ab")], [cashaddrOwnerPkh]
    );
    expect(candidates).toEqual([{ scriptHash: cashaddrScriptHash, locktime: 886662 }]);
  })
  it('should also rebuild legacy-announced contracts', () => {
    const candidates = hodlContractsFromHistory(
      [fundingItem(legacyAnnouncement, "ab")], [legacyOwnerPkh]
    );
    expect(candidates).toEqual([{ scriptHash: legacyScriptHash, locktime: 715557 }]);
  })
  it('should skip a contract the wallet only funded but does not own', () => {
    const candidates = hodlContractsFromHistory(
      [fundingItem(cashaddrAnnouncement, "ab")], [legacyOwnerPkh]
    );
    expect(candidates).toEqual([]);
  })
  it('should report a contract announced by several transactions once', () => {
    const candidates = hodlContractsFromHistory(
      [fundingItem(cashaddrAnnouncement, "ab"), fundingItem(cashaddrAnnouncement, "cd")],
      [cashaddrOwnerPkh]
    );
    expect(candidates.length).toBe(1);
  })
  it('should ignore an announcement anywhere but output 0', () => {
    const candidates = hodlContractsFromHistory(
      [historyItem("ab".repeat(32), [p2pkhOutput(), opReturnOutput(cashaddrAnnouncement)])], [cashaddrOwnerPkh]
    );
    expect(candidates).toEqual([]);
  })
})
