import { z } from "zod/v4";

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

// see the BCH wallet connect spec at https://github.com/mainnet-pat/wc2-bch-bcr
// Source outputs are transmitted using libauth's stringify, since they contain UInt8Array and BigInt.
export const EncodedWcTransactionObjSchema = z.object({
  transaction: z.union([hexEncodedStringSchema, simpleTransactionCommonSchema]),
  sourceOutputs: z.string(),
  broadcast: z.optional(z.boolean()),
  userPrompt: z.optional(z.string()),
});

export type encodedWcTransactionObj = z.infer<typeof EncodedWcTransactionObjSchema>;
