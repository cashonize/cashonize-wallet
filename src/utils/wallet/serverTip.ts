import { decodeHeader, type HexHeaderI } from "mainnet-js"

// A tip block older than this means the server stopped following the chain. At ten minute blocks
// a three hour gap is about e^-18 per block, which leaves room for miner timestamps running behind
// and for a device clock that is off by a little.
const staleTipSeconds = 3 * 60 * 60;

// The whole hours the server's tip is behind the device clock, or undefined while it is current
export function staleTipHours(header: HexHeaderI, nowMs = Date.now()): number | undefined {
  const tipAgeSeconds = nowMs / 1000 - decodeHeader(header).timestamp;
  if (tipAgeSeconds < staleTipSeconds) return undefined;
  return Math.floor(tipAgeSeconds / 3600);
}
