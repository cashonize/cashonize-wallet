import { z } from "zod";
import { hexToBin } from "@bitauth/libauth";

/* WcMessageObjSchema */

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
const stringifiedBigIntSchema = z.string()
  .regex(/^<bigint: \d+n>$/, "Must be a stringified BigInt")
  .transform((val) => {
    const match = val.match(/^<bigint: (?<bigint>\d+)n>$/);
    return match?.groups?.bigint !== undefined ? BigInt(match.groups.bigint) : val;
  });

// Stringified Uint8Array: "<Uint8Array: 0xdeadbeef>"
const stringifiedUint8ArraySchema = z.string()
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
  address: z.optional(z.string()), // no longer used but kept in the interface as dapps might still send it
  account: z.optional(z.string()), // no longer used but kept in the interface as dapps might still send it
});

export type WcMessageObj = z.infer<typeof WcMessageObjSchema>;


/* BcmrIndexerResponseSchema */

const Hex64Schema = z.string().regex(/^[0-9a-f]{64}$/i);

const BcmrUrisSchema = z.record(z.string(), z.string());

const BcmrExtensionsSchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.record(z.string(), z.string()),
    z.record(z.string(), z.record(z.string(), z.string())),
  ])
);

const BcmrNftMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  uris: BcmrUrisSchema.optional(),
  extensions: BcmrExtensionsSchema.optional(),
});

// Schemas for NFT parse info returned by the Paytaca indexer
const BcmrFieldEncodingSchema = z.union([
  z.object({
    type: z.enum(["binary", "boolean", "hex", "https-url", "ipfs-cid", "utf8", "locktime"]),
  }),
  z.object({
    type: z.literal("number"),
    aggregate: z.enum(["add"]).optional(),
    decimals: z.number().int().nonnegative().optional(),
    unit: z.string().optional(),
  }),
]);

const BcmrNftFieldSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  encoding: BcmrFieldEncodingSchema,
  uris: BcmrUrisSchema.optional(),
  extensions: BcmrExtensionsSchema.optional(),
});

const BcmrNftTypeSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  fields: z.array(z.string()).optional(),
  uris: BcmrUrisSchema.optional(),
  extensions: BcmrExtensionsSchema.optional(),
});

const BcmrNftParseSchema = z.union([
  z.object({
    bytecode: z.string(),
    types: z.record(z.string(), BcmrNftTypeSchema),
  }),
  z.object({
    types: z.record(z.string(), BcmrNftTypeSchema),
  }),
]);

const BcmrTokenNftsSchema = z.object({
  description: z.string().optional(),
  fields: z.record(z.string(), BcmrNftFieldSchema).optional(),
  parse: BcmrNftParseSchema,
});

const BcmrTokenResponseSchema = z.object({
  name: z.string(),
  description: z.string(),
  token: z.object({
    category: Hex64Schema,
    decimals: z.number().int().nonnegative().optional(),
    symbol: z.string(),
    nfts: BcmrTokenNftsSchema.optional(),
  }),
  is_nft: z.boolean().optional(),
  nft_type: z.enum(["parsable", "sequential"]).optional(),
  type_metadata: BcmrNftMetadataSchema.optional(),
  uris: BcmrUrisSchema.optional(),
  extensions: BcmrExtensionsSchema.optional(),
});

const ErrorSchema = z.object({
  category: Hex64Schema,
  error: z.string(),
});

export type BcmrTokenResponse = z.infer<typeof BcmrTokenResponseSchema>;
export const BcmrIndexerResponseSchema = z.union([BcmrTokenResponseSchema, ErrorSchema]);
export type BcmrIndexerResponse = z.infer<typeof BcmrIndexerResponseSchema>;


/* BitpayRatesSchema */

export const BitpayRatesSchema = z.object({
  data: z.array(z.object({
    code: z.string(),
    rate: z.number()
  }))
});


/* CoinGeckoRatesSchema */

export const CoinGeckoRatesSchema = z.object({
  "bitcoin-cash": z.record(z.string(), z.number())
});


/* CoinbaseRatesSchema */

export const CoinbaseRatesSchema = z.object({
  data: z.object({
    currency: z.string(),
    rates: z.record(z.string(), z.string())
  })
});


/* Chaingraph response schemas */

export const ChaingraphTotalSupplyFTSchema = z.object({
  data: z.object({
    transaction: z.array(z.object({
      outputs: z.array(z.object({
        fungible_token_amount: z.string()
      }))
    }))
  })
});

export const ChaingraphOutputArraySchema = z.object({
  data: z.object({
    output: z.array(z.object({
      locking_bytecode: z.string()
    }))
  })
});

export const ChaingraphAuthHeadSchema = z.object({
  data: z.object({
    transaction: z.array(z.object({
      authchains: z.array(z.object({
        authhead: z.object({
          hash: z.string(),
          identity_output: z.array(z.object({
            fungible_token_amount: z.string().nullable()
          }))
        })
      }))
    }))
  })
});


/* CauldronValueLockedSchema */

// Cauldron DEX valuelocked endpoint response
export const CauldronValueLockedSchema = z.object({
  satoshis: z.number(),
  token_amount: z.number()
});
export type CauldronValueLocked = z.infer<typeof CauldronValueLockedSchema>;
