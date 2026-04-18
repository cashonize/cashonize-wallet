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

const nftSchema = z.object({
  capability: z.enum(["none", "mutable", "minting"]),
  commitment: stringifiedUint8ArraySchema,
});

const tokenSchema = z.object({
  amount: stringifiedBigIntSchema,
  category: stringifiedUint8ArraySchema,
  nft: z.optional(nftSchema),
});

// The contract schema only validates the fields Cashonize uses (contractName, abiFunction.name, redeemScript/bytecode).
// Extra fields from the WC2-BCH spec (e.g. artifact.source, artifact.abi) are not required,
// so dapps can trim their WalletConnect payloads for efficiency.
//
// redeemScript is deprecated in CashScript v0.13 — bytecode serves as a fallback for dapps using v0.13+,
// which is a Cashonize extension to future-proof against CashScript changes (not a dapp workaround).
// wcSigning throws at runtime if neither is present.
// Spec: https://github.com/mainnet-pat/wc2-bch-bcr
const strictContractSchema = z.object({
  abiFunction: z.object({ name: z.string() }),
  redeemScript: z.optional(stringifiedUint8ArraySchema),
  bytecode: z.optional(z.string()),
  artifact: z.object({ contractName: z.string() }),
});

// Loose contract schema: strict plus tolerances for known dapp deviations from the spec.
//   - redeemScript should be a stringified Uint8Array per the spec, but the FundMe.cash dapp passes the raw
//     CashScript Script type (OpOrData[]) instead of converting it with scriptToBytecode() first,
//     so we also allow an array of script chunks.
//   - abiFunction should be a single { name } object per the spec, but FundMe.cash passes the full artifact
//     abi (AbiFunction[]) instead of just the invoked function, so we also allow an array.
const looseContractSchema = strictContractSchema.extend({
  abiFunction: z.union([z.object({ name: z.string() }), z.array(z.any())]),
  redeemScript: z.optional(z.union([stringifiedUint8ArraySchema, z.array(z.any())])),
});

// WC source outputs are transmitted using libauth's stringify, since they contain UInt8Array and BigInt.
const strictWcSourceOutputSchema = z.object({
  outpointIndex: z.number(),
  outpointTransactionHash: stringifiedUint8ArraySchema,
  sequenceNumber: z.number(),
  lockingBytecode: stringifiedUint8ArraySchema,
  unlockingBytecode: stringifiedUint8ArraySchema,
  valueSatoshis: stringifiedBigIntSchema,
  token: z.optional(tokenSchema),
  contract: z.optional(strictContractSchema),
});

const looseWcSourceOutputSchema = strictWcSourceOutputSchema.extend({
  contract: z.optional(looseContractSchema),
});

const hexEncodedStringSchema = z.string().regex(/^[0-9a-fA-F]+$/, "Must be a hex-encoded string");

export const StrictEncodedWcTransactionObjSchema = z.object({
  transaction: z.union([hexEncodedStringSchema, simpleTransactionCommonSchema]),
  sourceOutputs: z.array(strictWcSourceOutputSchema),
  broadcast: z.optional(z.boolean()),
  userPrompt: z.optional(z.string()),
});

export const LooseEncodedWcTransactionObjSchema = StrictEncodedWcTransactionObjSchema.extend({
  sourceOutputs: z.array(looseWcSourceOutputSchema),
});

// Type is inferred from the loose schema (superset of strict).
export type encodedWcTransactionObj = z.infer<typeof LooseEncodedWcTransactionObjSchema>;

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
    decimals: z.number().int().nonnegative().max(18).optional(),
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
    decimals: z.number().int().nonnegative().max(18).optional(),
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
