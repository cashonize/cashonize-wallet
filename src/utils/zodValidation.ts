import { z } from "zod";
import { hexToBin } from "@bitauth/libauth";

// TODO: could try to make this more strict
// need to consider if there is a easy way to fully validate against the libauth TransactionBCH type
// also the deeply nested UInt8Array and BigInts are stringified so not the original types yet
const simpleTransactionCommonSchema = z.object({
  inputs: z.array(z.any()),
  locktime: z.number(),
  outputs: z.array(z.any()),
  version: z.number(),
});

// Stringified BigInt: "<bigint: 123n>"
export const stringifiedBigIntSchema = z.string()
  .regex(/^<bigint: \d+n>$/, "Must be a stringified BigInt")
  .transform((val) => {
    const match = val.match(/^<bigint: (?<bigint>\d+)n>$/);
    return match?.groups?.bigint !== undefined ? BigInt(match.groups.bigint) : val;
  });

// Stringified Uint8Array: "<Uint8Array: 0xdeadbeef>"
export const stringifiedUint8ArraySchema = z.string()
  .regex(/^<Uint8Array: 0x[0-9a-fA-F]*>$/, "Must be a stringified Uint8Array")
  .transform((val) => {
    const match = val.match(/^<Uint8Array: 0x(?<hex>[0-9a-fA-F]*)>$/u);
    return match?.groups?.hex !== undefined ? hexToBin(match.groups.hex) : val;
  });

// TODO: could try to make this more strict
// especially the token and contract fields as these are nested objects
// Source outputs are transmitted using libauth's stringify, since they contain UInt8Array and BigInt.
const simpleSourceOutputSchema = z.object({
  outpointIndex: z.number(),
  outpointTransactionHash: stringifiedUint8ArraySchema,
  sequenceNumber: z.number(),
  lockingBytecode: stringifiedUint8ArraySchema,
  unlockingBytecode: stringifiedUint8ArraySchema,
  valueSatoshis: stringifiedBigIntSchema,
  token: z.optional(z.any()),
  contract: z.optional(z.any()),
});

const hexEncodedStringSchema = z.string().regex(/^[0-9a-fA-F]+$/, "Must be a hex-encoded string");
// see the BCH wallet connect spec at https://github.com/mainnet-pat/wc2-bch-bcr
export const EncodedWcTransactionObjSchema = z.object({
  transaction: z.union([hexEncodedStringSchema, simpleTransactionCommonSchema]),
  sourceOutputs: z.array(simpleSourceOutputSchema),
  broadcast: z.optional(z.boolean()),
  userPrompt: z.optional(z.string()),
});

export type encodedWcTransactionObj = z.infer<typeof EncodedWcTransactionObjSchema>;

// note: historically in Cashonize 'address' or 'account' was used and even required
export const WcMessageObjSchema = z.object({
  message: z.string(),
  userPrompt: z.optional(z.string()),
  address: z.optional(z.boolean()), // no longer used but kept in the interface as dapps might still send it
  account: z.optional(z.string()), // no longer used but kept in the interface as dapps might still send it
});

export type WcMessageObj = z.infer<typeof WcMessageObjSchema>;
