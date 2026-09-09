// A contract the portfolio finds is described rather than implemented. A manifest says where its
// positions sit, how one is read, and what proves one is yours; the wallet ships a bundle of them
// and a user can add another of the same shape, so a protocol is a file rather than a module.
//
// A manifest describes a shape, never an instance, because a bundle has to be addable before its
// contracts exist. That is why a script is a template of bytecode with its variable parts named:
// written that way it runs both directions, generating a script from parameters and reading
// parameters back out of one.
// Nothing here is evaluated. A manifest names bytes, offsets, lengths and bounds, and that is the
// whole of what it can say.

import { z } from "zod";
import { opReturnChunks } from "src/utils/history/txDirection";
import {
  bigIntToVmNumber,
  binToHex,
  decodeBase58Address,
  decodeCashAddress,
  encodeDataPush,
  hexToBin,
  vmNumberToBigInt,
} from "@bitauth/libauth";

const identifier = z.string().min(1).max(64);
const hexString = z.string().regex(/^([0-9a-fA-F]{2})+$/);

// A run of bytes at a known offset, for a parameter carried in an NFT commitment
const byteFieldSchema = z.object({
  at: z.number().int().min(0).max(519),
  bytes: z.number().int().min(1).max(520),
  as: z.enum(['hex', 'uint16le', 'uint32le']),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
});

// One push of an OP_RETURN, for a parameter an announcement carries
const pushFieldSchema = z.object({
  push: z.number().int().min(0).max(15),
  // utf8word takes the first space-separated word, since creating software appends a version
  // addressHash reads a p2sh address as the hash it commits to, so which encoding the
  // announcing software wrote it in stops mattering
  as: z.enum(['hex', 'utf8', 'utf8word', 'utf8int', 'vmnumber', 'addressHash']),
  // a push the announcement pins to one value: the platform key an escrow enforces, or a field
  // left empty because this manifest describes only the offer that leaves it so
  equals: z.string().max(200).optional(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
});

// A hole in a script template. Every parameter of a p2sh contract is pushed, so a hole is always
// one push and its opcode follows from the value; bytes is a length the value must have, not a
// run to consume.
const scriptFieldSchema = z.object({
  as: z.enum(['hex', 'vmnumber']),
  bytes: z.number().int().min(1).max(520).optional(),
});

// Positions sit at one address the manifest names, and an NFT there carries who they belong to
const findAtAddressSchema = z.object({
  kind: z.literal('address'),
  address: z.string().min(10).max(120),
  token: z.object({
    category: hexString.length(64),
    capability: z.enum(['none', 'mutable', 'minting']).optional(),
  }).optional(),
  commitment: z.object({
    bytes: z.number().int().min(1).max(520),
    fields: z.record(identifier, byteFieldSchema),
  }).optional(),
});

// Positions are announced by an OP_RETURN on a transaction of the wallet's own history
const findByAnnouncementSchema = z.object({
  kind: z.literal('announcement'),
  output: z.number().int().min(0).max(15),
  prefix: hexString,
  pushes: z.number().int().min(1).max(16),
  fields: z.record(identifier, pushFieldSchema),
  // Where the position sits. Absent, it is the address a field names and the contract is looked
  // up there; given, it is an output of the announcing transaction itself, which is live for as
  // long as that one output stays unspent.
  position: z.object({ output: z.number().int().min(0).max(15) }).optional(),
});

const scriptSchema = z.object({
  template: z.string().min(2).max(4000).regex(/^([0-9a-fA-F]|<[A-Za-z][A-Za-z0-9]*>|\s)+$/),
  addressType: z.enum(['p2sh20', 'p2sh32']),
  fields: z.record(identifier, scriptFieldSchema),
});

// What proves a position is the wallet's: a decoded field is one of its public key hashes, or
// rebuilding the contract from one of them reproduces the address the announcement named
const ownerSchema = z.union([
  z.object({ kind: z.literal('field'), field: identifier }),
  z.object({ kind: z.literal('rebuild'), ownerField: identifier, matches: identifier }),
]);

export const ContractManifestSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(64),
  description: z.string().max(600).optional(),
  ownership: z.enum(['owned', 'encumbered', 'shared', 'claim']),
  find: z.union([findAtAddressSchema, findByAnnouncementSchema]),
  script: scriptSchema.optional(),
  owner: ownerSchema,
});

export const ContractBundleSchema = z.object({
  format: z.literal(1),
  name: z.string().min(1).max(80),
  description: z.string().max(600).optional(),
  contracts: z.array(ContractManifestSchema).min(1).max(50),
});

export type ContractManifest = z.infer<typeof ContractManifestSchema>;
export type ContractBundle = z.infer<typeof ContractBundleSchema>;
export type FieldValue = string | number;
export type Fields = Record<string, FieldValue>;

function bounded(value: FieldValue, field: { min?: number | undefined, max?: number | undefined }) {
  if (typeof value !== 'number') return true;
  if (field.min !== undefined && value < field.min) return false;
  if (field.max !== undefined && value > field.max) return false;
  return true;
}

// The parameters an NFT commitment carries, when it is the right length to be this contract's
export function readCommitment(
  commitment: string,
  layout: { bytes: number, fields: Record<string, z.infer<typeof byteFieldSchema>> },
): Fields | undefined {
  if (!/^([0-9a-fA-F]{2})*$/.test(commitment) || commitment.length !== layout.bytes * 2) return undefined;
  const bytes = hexToBin(commitment);
  const fields: Fields = {};
  for (const [name, field] of Object.entries(layout.fields)) {
    if (field.at + field.bytes > bytes.length) return undefined;
    const slice = bytes.slice(field.at, field.at + field.bytes);
    let value: FieldValue;
    if (field.as === 'hex') value = binToHex(slice);
    else if (field.as === 'uint16le') value = slice[0]! | (slice[1]! << 8);
    else value = (slice[0]! | (slice[1]! << 8) | (slice[2]! << 16)) + (slice[3]! * 0x1000000);
    if (!bounded(value, field)) return undefined;
    fields[name] = value;
  }
  return fields;
}

// A p2sh address as its hash, written as a legacy base58 address, a cashaddr, or a cashaddr
// without its prefix, which are the three forms creating software uses
function addressToHash(address: string) {
  const named = address.split(" ")[0]!;
  if (named.startsWith("3")) {
    const decoded = decodeBase58Address(named);
    // 5 is the P2SH version byte of legacy mainnet addresses
    if (typeof decoded === "string" || decoded.version !== 5) return undefined;
    return binToHex(decoded.payload);
  }
  const decoded = decodeCashAddress(named.includes(":") ? named : "bitcoincash:" + named);
  // a p2sh20 hash and a p2sh32 one, since a manifest may name either and the address says which
  if (typeof decoded === "string") return undefined;
  if (decoded.payload.length !== 20 && decoded.payload.length !== 32) return undefined;
  return binToHex(decoded.payload);
}

// The parameters an announcement carries, when it is this contract's announcement at all
export function readAnnouncement(
  opReturnHex: string,
  find: z.infer<typeof findByAnnouncementSchema>,
): Fields | undefined {
  if (!/^([0-9a-fA-F]{2})+$/.test(opReturnHex)) return undefined;
  if (!opReturnHex.toLowerCase().startsWith(find.prefix.toLowerCase())) return undefined;
  // The wallet's own reader rather than a length walk of the bytes, because a push can be empty:
  // a TapSwap listing asking plain BCH leaves three of its want fields so, and a reader that
  // stops at the first of them reads the offer wrong rather than not at all.
  const chunks = opReturnChunks(opReturnHex);
  if (!chunks || chunks.length !== find.pushes) return undefined;

  const fields: Fields = {};
  for (const [name, field] of Object.entries(find.fields)) {
    // push 0 is the marker the prefix matched, which is how the protocols number their own
    const chunk = chunks[field.push];
    if (!chunk) return undefined;
    let value: FieldValue | undefined;
    if (field.as === 'hex') value = binToHex(chunk);
    else if (field.as === 'vmnumber') {
      const number = vmNumberToBigInt(chunk);
      value = typeof number === 'string' ? undefined : Number(number);
    } else {
      const text = new TextDecoder().decode(chunk);
      if (field.as === 'utf8') value = text;
      else if (field.as === 'utf8word') value = text.split(" ")[0]!;
      else if (field.as === 'addressHash') value = addressToHash(text);
      else value = /^\d+$/.test(text) ? Number(text) : undefined;
    }
    if (value === undefined || !bounded(value, field)) return undefined;
    if (field.equals !== undefined && String(value) !== field.equals) return undefined;
    fields[name] = value;
  }
  return fields;
}

// The script this contract has for the given parameters. Undefined when a parameter is missing or
// does not encode the way the template says, which is a manifest that does not fit its own inputs.
export function buildScript(script: z.infer<typeof scriptSchema>, fields: Fields): string | undefined {
  let built = "";
  for (const piece of script.template.replace(/\s+/g, '').split(/(<[A-Za-z][A-Za-z0-9]*>)/)) {
    if (piece === '') continue;
    if (!piece.startsWith('<')) {
      if (piece.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(piece)) return undefined;
      built += piece.toLowerCase();
      continue;
    }
    const name = piece.slice(1, -1);
    const field = script.fields[name];
    const value = fields[name];
    if (!field || value === undefined) return undefined;

    let data: Uint8Array;
    if (field.as === 'vmnumber') {
      if (typeof value !== 'number') return undefined;
      data = bigIntToVmNumber(BigInt(value));
    } else {
      if (typeof value !== 'string' || !/^([0-9a-fA-F]{2})+$/.test(value)) return undefined;
      data = hexToBin(value);
    }
    if (field.bytes !== undefined && data.length !== field.bytes) return undefined;
    // libauth's encoding rather than a length byte, because a compiler writes OP_1 for a one and
    // OP_0 for nothing, so a hand-rolled push would derive a different address for any parameter
    // of sixteen or less and match nothing
    built += binToHex(encodeDataPush(data));
  }
  return built;
}


