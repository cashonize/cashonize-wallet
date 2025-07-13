import { z } from "zod";

const hexEncodedStringSchema = z.string().regex(/^[0-9a-fA-F]+$/, "Must be a hex-encoded string");
// TODO: could try to make this more strict
// need to consider if there is a easy way to fully validate against the libauth TransactionBCH type
// also the deeply nested UInt8Array and BigInts are stringified so not the original types yet
const simpleTransactionCommonSchema = z.object({
  inputs: z.array(z.any()),
  locktime: z.number(),
  outputs: z.array(z.any()),
  version: z.number(),
});

// TODO: could try to make this more strict
// especially the token and contract fields as these are nested objects
// Source outputs are transmitted using libauth's stringify, since they contain UInt8Array and BigInt.
const simpleSourceOutputSchema = z.object({
  outpointIndex: z.number(),
  outpointTransactionHash: z.string(), // stringified UInt8Array
  sequenceNumber: z.number(),
  lockingBytecode: z.string(), // stringified UInt8Array
  unlockingBytecode: z.string(), // stringified UInt8Array
  valueSatoshis: z.string(), // stringified BigInt
  token: z.optional(z.any()),
  contract: z.optional(z.any()),
});

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
