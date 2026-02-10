import {
  createVirtualMachineBCH,
  hexToBin,
  binToHex,
  vmNumberToBigInt,
  type AuthenticationProgramCommon,
  type TransactionCommon,
  type Output,
} from "@bitauth/libauth";

import type {
  Registry,
  NftCategoryField,
} from "./bcmr-v2.schema";

// Extract the field encoding type from the schema
type FieldEncoding = NftCategoryField[string]["encoding"];

export type ParsedValue =
  | {
      type: "number";
      formatted: string;
      value: bigint;
      decimals?: number;
      unit?: string;
      aggregate?: string;
    }
  | {
      type: "utf8";
      formatted: string;
    }
  | {
      type: "boolean";
      formatted: string;
      value: boolean;
    }
  | {
      type: "binary";
      formatted: string;
    }
  | {
      type: "hex";
      formatted: string;
    }
  | {
      type: "https-url";
      formatted: string;
      url: string;
    }
  | {
      type: "ipfs-cid";
      formatted: string;
      cid: string;
    }
  | {
      type: "locktime";
      formatted: string;
      timestamp?: number;
      blockHeight?: number;
    };

export interface ParsedField {
  name?: string;
  value: string;
  fieldId?: string;
  description?: string;
  parsedValue?: ParsedValue;
}

export interface ParseResult {
  success: boolean;
  nftType?: string;
  nftTypeName?: string;
  nftTypeDescription?: string;
  nftTypeIcon?: string;
  fields?: string[];
  namedFields?: ParsedField[];
  fullAltstack?: string[];
  error?: string;
}

// Helper function to get NFT parsing info from registry
export function getNftParsingInfo(registry?: Registry, category?: string) {
  if (!registry || !registry.identities || !category) return null;

  // Look for the identity that matches this category
  const identity = registry.identities[category];
  if (!identity) return null;

  // Get the most recent snapshot
  const timestamps = Object.keys(identity).sort().reverse();
  if (timestamps.length === 0) return null;

  const firstTimestamp = timestamps[0];
  if (!firstTimestamp) return null;
  const latestSnapshot = identity[firstTimestamp];
  if (!latestSnapshot) return null;

  // Check if it has token.nfts with parsing info
  const token = latestSnapshot.token;
  if (!token || !token.nfts) return null;

  return {
    nftCollection: token.nfts,
    parseBytecode:
      "parse" in token.nfts &&
      token.nfts.parse &&
      "bytecode" in token.nfts.parse
        ? token.nfts.parse.bytecode
        : null,
    nftTypes:
      "parse" in token.nfts && token.nfts.parse && "types" in token.nfts.parse
        ? token.nfts.parse.types || {}
        : {},
    identity: latestSnapshot,
  };
}

/**
 * Decode a VM number that may be padded (non-minimally encoded).
 * First tries strict decoding, then falls back to lenient decoding for fixed-length fields.
 */
function decodePotentiallyPaddedVmNumber(bytes: Uint8Array): bigint {
  // Try strict decoding first
  const strictResult = vmNumberToBigInt(bytes);
  if (typeof strictResult !== "string") {
    return strictResult;
  }

  // If strict decoding failed due to padding, decode manually
  // VM numbers are little-endian with sign bit in the high bit of the last byte
  if (bytes.length === 0) {
    return 0n;
  }

  let result = 0n;
  const lastByte = bytes[bytes.length - 1]!;
  const isNegative = (lastByte & 0x80) !== 0;

  // Process bytes in little-endian order
  for (let i = 0; i < bytes.length; i++) {
    const rawByte = bytes[i]!;
    const byte =
      i === bytes.length - 1 && isNegative
        ? rawByte & 0x7f // Clear sign bit from last byte
        : rawByte;
    result |= BigInt(byte) << BigInt(i * 8);
  }

  return isNegative ? -result : result;
}

// Helper function to parse individual field values based on encoding
export function parseFieldValue(
  fieldValue: string,
  encoding: FieldEncoding,
): ParsedValue | undefined {
  // Spec: boolean must be exactly 0x01 or 0x00; anything else means
  // the NFT is unparsable. Throw before the try/catch so the error
  // propagates to parseNft and fails the entire parse.
  if (encoding.type === "boolean") {
    if (fieldValue === "01") return { type: "boolean", formatted: "true", value: true };
    if (fieldValue === "00") return { type: "boolean", formatted: "false", value: false };
    throw new Error("Invalid boolean field value: must be exactly 0x00 or 0x01");
  }

  try {
    switch (encoding.type) {
      case "number": {
        const hexBytes = hexToBin(fieldValue);
        const bigintValue = decodePotentiallyPaddedVmNumber(hexBytes);
        const decimals = encoding.decimals || 0;

        let formatted: string;
        // Format with decimal point using bigint math (e.g. 1050n with 3 decimals → "1.05")
        // Handles negative values, leading zeros in fractional part, and trailing zero removal
        if (decimals > 0) {
          const isNegative = bigintValue < 0n;
          const absValue = isNegative ? -bigintValue : bigintValue;
          const divisor = 10n ** BigInt(decimals);
          const integerPart = absValue / divisor;
          const fractionalPart = absValue % divisor;
          const fractionalStr = fractionalPart.toString().padStart(decimals, "0");
          formatted = `${integerPart}.${fractionalStr}`;
          formatted = formatted.replace(/\.?0+$/, "");
          if (formatted === "") formatted = "0";
          if (isNegative) formatted = `-${formatted}`;
        } else {
          formatted = bigintValue.toString();
        }

        if (encoding.unit) formatted += ` ${encoding.unit}`;

        const result: ParsedValue = {
          type: "number",
          value: bigintValue,
          formatted,
          decimals,
        };
        if (encoding.unit) result.unit = encoding.unit;
        if (encoding.aggregate) result.aggregate = encoding.aggregate;
        return result;
      }

      case "utf8": {
        const hexBytes = hexToBin(fieldValue);
        const utf8String = new TextDecoder("utf-8").decode(hexBytes);
        return {
          type: "utf8",
          formatted: utf8String,
        };
      }

      case "binary": {
        const hexBytes = hexToBin(fieldValue);
        const binaryString = Array.from(hexBytes)
          .map((byte) => byte.toString(2).padStart(8, "0"))
          .join("");
        return {
          type: "binary",
          formatted: binaryString ? `0b${binaryString}` : "0b0",
        };
      }

      case "hex": {
        return {
          type: "hex",
          formatted: fieldValue ? `0x${fieldValue}` : "0x00",
        };
      }

      case "https-url": {
        const hexBytes = hexToBin(fieldValue);
        const percentEncoded = new TextDecoder("utf-8").decode(hexBytes);
        const decodedUrl = decodeURIComponent(percentEncoded);
        const fullUrl = `https://${decodedUrl}`;
        return {
          type: "https-url",
          formatted: fullUrl,
          url: fullUrl,
        };
      }

      case "ipfs-cid": {
        const hexBytes = hexToBin(fieldValue);
        const cidString = new TextDecoder("utf-8").decode(hexBytes);
        const ipfsUrl = `ipfs://${cidString}`;
        return {
          type: "ipfs-cid",
          formatted: ipfsUrl,
          cid: cidString,
        };
      }

      case "locktime": {
        const hexBytes = hexToBin(fieldValue);
        const vmNumberResult = vmNumberToBigInt(hexBytes);

        if (typeof vmNumberResult === "string") {
          throw new Error(vmNumberResult);
        }

        const locktime = Number(vmNumberResult);

        if (locktime < 500000000) {
          return {
            type: "locktime",
            formatted: `Block ${locktime.toString()}`,
            blockHeight: locktime,
          };
        } else {
          const date = new Date(locktime * 1000);
          return {
            type: "locktime",
            formatted: `${date.toISOString()}`,
            timestamp: locktime,
          };
        }
      }

      default:
        return undefined;
    }
  } catch (error) {
    console.warn(`Failed to parse ${encoding.type} field:`, error);
    return undefined;
  }
}

// Main NFT parsing function that works with full outputs
export function parseNft(
  nftOutput: Output,
  registry?: Registry,
  parsingBytecode?: Uint8Array,
): ParseResult {
  try {
    if (!nftOutput.token?.nft) {
      return {
        success: false,
        error: "No NFT found in output",
      };
    }

    const category = binToHex(nftOutput.token.category);

    // Get parsing info from registry
    const registryParsingInfo = getNftParsingInfo(registry, category);

    // Use provided bytecode, or fall back to registry bytecode
    let bytecodeToUse = parsingBytecode;
    if (!bytecodeToUse && registryParsingInfo?.parseBytecode) {
      try {
        bytecodeToUse = hexToBin(registryParsingInfo.parseBytecode);
      } catch (error) {
        console.warn("Invalid bytecode in registry", error);
      }
    }

    if (!bytecodeToUse) {
      return {
        success: false,
        error: "No parsing bytecode available",
      };
    }

    // Create source outputs with the NFT output and parsing script
    const sourceOutputs: Output[] = [
      nftOutput,
      {
        lockingBytecode: bytecodeToUse,
        valueSatoshis: BigInt(0),
      },
    ];

    // Create standardized parsing transaction
    const parsingTransaction: TransactionCommon = {
      version: 2,
      inputs: [
        {
          outpointIndex: 0,
          outpointTransactionHash: new Uint8Array(32),
          sequenceNumber: 0,
          unlockingBytecode: new Uint8Array(0),
        },
        {
          outpointIndex: 0,
          outpointTransactionHash: new Uint8Array(32),
          sequenceNumber: 0,
          unlockingBytecode: hexToBin("51"), // OP_1
        },
      ],
      outputs: [
        {
          lockingBytecode: hexToBin("6a"), // OP_RETURN
          valueSatoshis: BigInt(0),
        },
      ],
      locktime: 0,
    };

    const program: AuthenticationProgramCommon = {
      inputIndex: 1,
      sourceOutputs,
      transaction: parsingTransaction,
    };

    const vm = createVirtualMachineBCH();
    let result;

    try {
      result = vm.evaluate(program);
    } catch (error) {
      // Handle BigInt and other VM-level errors
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("BigInt")) {
        return {
          success: false,
          error:
            `VM Error: ${errorMessage}. This typically occurs when parsing ` +
            `bytecode mixes BigInt operations (like OP_UTXOVALUE) with regular ` +
            `numbers. Ensure all arithmetic operations use compatible types.`,
        };
      }
      return { success: false, error: `VM Error: ${errorMessage}` };
    }

    const finalState = Array.isArray(result)
      ? result[result.length - 1]
      : result;

    // Parse bytecodes may leave multiple items on the main stack, which the VM
    // reports as an error ("unexpected number of items on the stack").
    // This is expected — we only care about the altstack contents.
    // Only tolerate this specific benign error; treat all others as real
    // failures, since partial execution may leave unreliable data on the altstack.
    if (finalState.error) {
      const isBenignStackDepthError = String(finalState.error).includes(
        "unexpected number of items on the stack",
      );
      if (!isBenignStackDepthError) {
        return { success: false, error: `VM Error: ${finalState.error}` };
      }
    }

    if (finalState.alternateStack.length === 0) {
      return {
        success: false,
        error: "Altstack is empty - parsing failed",
      };
    }

    const altstack = finalState.alternateStack.map((item: Uint8Array) =>
      binToHex(item),
    );
    const nftType = altstack[0];
    const fields = altstack.slice(1);

    // Try to match against registry types
    let nftTypeName = nftType;
    let nftTypeDescription: string | undefined;
    let nftTypeIcon: string | undefined;
    let namedFields: ParsedField[] = [];

    if (registryParsingInfo?.nftTypes) {
      const typeDefinition = registryParsingInfo.nftTypes[nftType];
      if (typeDefinition) {
        nftTypeName = typeDefinition.name || nftType;
        nftTypeDescription = typeDefinition.description;

        // Only use type-specific icon if defined
        if (typeDefinition.uris?.icon) {
          nftTypeIcon = typeDefinition.uris.icon;
        }

        // Map all fields from altstack
        namedFields = fields.map((fieldValue: string, index: number) => {
          const fieldId = typeDefinition.fields?.[index];
          let fieldName: string | undefined = undefined;
          let fieldDescription: string | undefined = undefined;
          let parsedValue: ParsedValue | undefined = undefined;

          // Look up field definition in nfts.fields if we have a field ID
          if (fieldId && registryParsingInfo.nftCollection.fields?.[fieldId]) {
            const fieldDef = registryParsingInfo.nftCollection.fields[fieldId];
            fieldName = fieldDef.name;
            fieldDescription = fieldDef.description;

            if (fieldDef.encoding) {
              parsedValue = parseFieldValue(fieldValue, fieldDef.encoding);
            }
          }

          return {
            name: fieldName,
            value: fieldValue,
            fieldId,
            description: fieldDescription,
            parsedValue,
          };
        });
      } else {
        // Unknown type, use generic names
        namedFields = fields.map((fieldValue: string) => ({
          value: fieldValue,
        }));
      }
    } else {
      // No registry types available, use generic names
      namedFields = fields.map((fieldValue: string) => ({
        value: fieldValue,
      }));
    }

    const parseResult: ParseResult = {
      success: true,
      nftType,
      nftTypeName,
      fields,
      namedFields,
      fullAltstack: altstack,
    };
    if (nftTypeDescription) parseResult.nftTypeDescription = nftTypeDescription;
    if (nftTypeIcon) parseResult.nftTypeIcon = nftTypeIcon;
    return parseResult;
  } catch (error) {
    return {
      success: false,
      error: `Parsing error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
