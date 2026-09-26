import { decodeHeader, type HexHeaderI } from "mainnet-js"

// A three hour gap between blocks is exceedingly unlikely, leaving room for miner timestamps
// running behind and a device clock that is slightly off
const staleTipSeconds = 3 * 60 * 60;

// The whole hours the server's tip is behind the device clock, or undefined while it is current
export function staleTipHours(header: HexHeaderI, nowMs = Date.now()): number | undefined {
  const tipAgeSeconds = nowMs / 1000 - decodeHeader(header).timestamp;
  if (tipAgeSeconds < staleTipSeconds) return undefined;
  return Math.floor(tipAgeSeconds / 3600);
}
