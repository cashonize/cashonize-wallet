import { z } from "zod";
import { hexToBin } from "@bitauth/libauth";

/* WcMessageObjSchema */

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

// 32-byte variant, used for transaction hashes and token categories
const stringifiedUint8Array32Schema = stringifiedUint8ArraySchema.refine(
  (val) => val instanceof Uint8Array && val.length === 32,
  "Must be a stringified 32-byte Uint8Array",
);

const nonNegativeIntSchema = z.number().int().nonnegative();

const nftSchema = z.object({
  capability: z.enum(["none", "mutable", "minting"]),
  commitment: stringifiedUint8ArraySchema,
});

const tokenSchema = z.object({
  amount: stringifiedBigIntSchema,
  category: stringifiedUint8Array32Schema,
  nft: z.optional(nftSchema),
});

// The object form of the transaction mirrors libauth's Transaction type (Input/Output),
// transmitted with libauth's stringify so Uint8Array and BigInt fields arrive in stringified form.
// The full shape is validated because this object is what the user approves in the transaction
// dialog and what libauth encodes and signs — it must be well-formed before either happens.
const wcTransactionInputSchema = z.object({
  outpointIndex: nonNegativeIntSchema,
  outpointTransactionHash: stringifiedUint8Array32Schema,
  sequenceNumber: nonNegativeIntSchema,
  unlockingBytecode: stringifiedUint8ArraySchema,
});

const wcTransactionOutputSchema = z.object({
  lockingBytecode: stringifiedUint8ArraySchema,
  token: z.optional(tokenSchema),
  valueSatoshis: stringifiedBigIntSchema,
});

const wcTransactionSchema = z.object({
  inputs: z.array(wcTransactionInputSchema).min(1),
  locktime: nonNegativeIntSchema,
  outputs: z.array(wcTransactionOutputSchema).min(1),
  version: nonNegativeIntSchema,
});

// The contract schema only validates the fields Cashonize uses (contractName, abiFunction.name, redeemScript).
// Extra fields from the WC2-BCH spec (e.g. artifact.source, artifact.abi) are not required,
// so dapps can trim their WalletConnect payloads for efficiency.
// Spec: https://github.com/mainnet-pat/wc2-bch-bcr
const strictContractSchema = z.object({
  abiFunction: z.object({ name: z.string() }),
  redeemScript: stringifiedUint8ArraySchema,
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
  redeemScript: z.union([stringifiedUint8ArraySchema, z.array(z.any())]),
});

// WC source outputs are transmitted using libauth's stringify, since they contain UInt8Array and BigInt.
const strictWcSourceOutputSchema = z.object({
  outpointIndex: z.number(),
  outpointTransactionHash: stringifiedUint8Array32Schema,
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
  transaction: z.union([hexEncodedStringSchema, wcTransactionSchema]),
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


/* WizSignTransactionRequestSchema */

// WizardConnect's reference serializer transmits Uint8Array fields as plain hex strings,
// but the extended stringified form is also legal on the wire, so both are accepted.
const wizUint8ArraySchema = z.union([
  z.string()
    .regex(/^(?:[0-9a-fA-F]{2})*$/, "Must be a hex string")
    .transform((val) => hexToBin(val)),
  stringifiedUint8ArraySchema,
]);

const wizUint8Array32Schema = wizUint8ArraySchema.refine(
  (val) => val instanceof Uint8Array && val.length === 32,
  "Must be a 32-byte Uint8Array",
);

// bigint fields arrive as "<bigint: Xn>" from the reference serializer; plain numeric strings
// and safe integers are also accepted for robustness across dapp implementations
const wizBigIntSchema = z.union([
  stringifiedBigIntSchema,
  z.string().regex(/^\d+$/, "Must be a numeric string").transform(BigInt),
  z.number().int().nonnegative().transform(BigInt),
]);

// The reference serializer omits nft capability/commitment when undefined,
// so both are defaulted to match libauth's required token nft shape
const wizNftSchema = z.object({
  capability: z.optional(z.enum(["none", "mutable", "minting"])),
  commitment: z.optional(wizUint8ArraySchema),
}).transform((nft) => ({
  capability: nft.capability ?? "none" as const,
  commitment: nft.commitment ?? new Uint8Array(),
}));

const wizTokenSchema = z.object({
  amount: z.optional(wizBigIntSchema).transform((amount) => amount ?? 0n),
  category: wizUint8Array32Schema,
  nft: z.optional(wizNftSchema),
});

// Same fields as the WC2-BCH contract schema (contractName, abiFunction.name, redeemScript),
// with the WizardConnect byte encoding for redeemScript
const wizContractSchema = z.object({
  abiFunction: z.object({ name: z.string() }),
  redeemScript: wizUint8ArraySchema,
  artifact: z.object({ contractName: z.string() }),
});

const wizSourceOutputSchema = z.object({
  outpointIndex: nonNegativeIntSchema,
  outpointTransactionHash: wizUint8Array32Schema,
  sequenceNumber: nonNegativeIntSchema,
  lockingBytecode: wizUint8ArraySchema,
  unlockingBytecode: wizUint8ArraySchema,
  valueSatoshis: wizBigIntSchema,
  token: z.optional(wizTokenSchema),
  contract: z.optional(wizContractSchema),
});

const wizTransactionInputSchema = z.object({
  outpointIndex: nonNegativeIntSchema,
  outpointTransactionHash: wizUint8Array32Schema,
  sequenceNumber: nonNegativeIntSchema,
  unlockingBytecode: wizUint8ArraySchema,
});

const wizTransactionOutputSchema = z.object({
  lockingBytecode: wizUint8ArraySchema,
  token: z.optional(wizTokenSchema),
  valueSatoshis: wizBigIntSchema,
});

const wizTransactionSchema = z.object({
  inputs: z.array(wizTransactionInputSchema).min(1),
  locktime: nonNegativeIntSchema,
  outputs: z.array(wizTransactionOutputSchema).min(1),
  version: nonNegativeIntSchema,
});

// A sign_transaction_request message arriving over the WizardConnect relay. The transport
// (NIP-17 gift wrap) authenticates the sender, but the payload shape is fully untrusted.
export const WizSignTransactionRequestSchema = z.object({
  sequence: nonNegativeIntSchema,
  // [inputIndex, pathName, addressIndex] tuples: which HD key signs each input.
  // addressIndex is capped to the BIP32 non-hardened range.
  inputPaths: z.array(z.tuple([
    nonNegativeIntSchema,
    z.enum(["receive", "change", "defi"]),
    z.number().int().nonnegative().max(2 ** 31 - 1),
  ])).refine(
    (paths) => new Set(paths.map((path) => path[0])).size === paths.length,
    "Duplicate input index in inputPaths",
  ),
  transaction: z.object({
    transaction: z.union([hexEncodedStringSchema, wizTransactionSchema]),
    sourceOutputs: z.array(wizSourceOutputSchema).min(1),
    broadcast: z.optional(z.boolean()),
    userPrompt: z.optional(z.string()),
  }),
});

export type WizSignTransactionRequest = z.infer<typeof WizSignTransactionRequestSchema>;


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
