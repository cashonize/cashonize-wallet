import {
  base58AddressToLockingBytecode,
  binToHex,
  cashAddressToLockingBytecode,
  hexToBin,
  isHex,
  lockingBytecodeToAddressContents,
  lockingBytecodeToBase58Address,
  lockingBytecodeToCashAddress,
  type CashAddressNetworkPrefix,
} from "@bitauth/libauth";
import { legacyVersionPrefixes } from "src/utils/addressValidation";

type Prefix = `${CashAddressNetworkPrefix}`;

export interface ConvertedAddress {
  type: 'P2PKH' | 'P2SH20' | 'P2SH32';
  prefix: Prefix;
  cashAddress: string;
  tokenAddress: string;
  // P2SH32 has no legacy form
  legacyAddress: string | undefined;
  // a locking bytecode names no network, so it was read on the active one
  networkAssumed: boolean;
  lockingBytecode: string;
}

const knownPrefixes: Prefix[] = ['bitcoincash', 'bchtest', 'bchreg'];

// The input as a locking bytecode and the network it names. A locking bytecode names none, so it is
// read on the given network.
function toLockingBytecode(input: string, defaultPrefix: Prefix): { bytecode: Uint8Array, prefix: Prefix, networkAssumed?: boolean } | undefined {
  const lowerInput = input.toLowerCase();
  if (knownPrefixes.some(prefix => lowerInput.startsWith(`${prefix}:`))) {
    const decoded = cashAddressToLockingBytecode(input);
    if (typeof decoded === 'string') return undefined;
    return { bytecode: decoded.bytecode, prefix: decoded.prefix };
  }
  const legacy = base58AddressToLockingBytecode(input);
  if (typeof legacy !== 'string') {
    const prefix = legacyVersionPrefixes.get(legacy.version);
    if (!prefix) return undefined;
    return { bytecode: legacy.bytecode, prefix };
  }
  // a cashaddr starts with q, p, z or r, none of which is a hex digit, so the two never overlap
  if (isHex(input)) return { bytecode: hexToBin(input), prefix: defaultPrefix, networkAssumed: true };
  // The checksum covers the prefix, so only the network the address was made for decodes it: the
  // active network is tried first. The prefix added has to match the case of an uppercase address,
  // as QR codes often encode it.
  const isUpperCase = input === input.toUpperCase();
  for (const prefix of [defaultPrefix, ...knownPrefixes.filter(candidate => candidate !== defaultPrefix)]) {
    const decoded = cashAddressToLockingBytecode(`${isUpperCase ? prefix.toUpperCase() : prefix}:${input}`);
    if (typeof decoded !== 'string') return { bytecode: decoded.bytecode, prefix: decoded.prefix };
  }
  return undefined;
}

// Every form of an address, derived from its locking bytecode. Returns undefined for anything
// that is not a P2PKH or P2SH address, like an OP_RETURN, a bare script or a typo.
export function convertAddress(input: string, defaultPrefix: Prefix): ConvertedAddress | undefined {
  const trimmedInput = input.trim();
  if (!trimmedInput) return undefined;
  const parsed = toLockingBytecode(trimmedInput, defaultPrefix);
  if (!parsed) return undefined;
  const { bytecode, prefix, networkAssumed = false } = parsed;

  // P2PK has no address form, and anything else is no standard output at all
  const { type } = lockingBytecodeToAddressContents(bytecode);
  if (type !== 'P2PKH' && type !== 'P2SH20' && type !== 'P2SH32') return undefined;

  const cashAddress = lockingBytecodeToCashAddress({ bytecode, prefix });
  const tokenAddress = lockingBytecodeToCashAddress({ bytecode, prefix, tokenSupport: true });
  if (typeof cashAddress === 'string' || typeof tokenAddress === 'string') return undefined;

  // regtest uses the testnet legacy versions
  const legacyNetwork = prefix === 'bitcoincash' ? 'mainnet' : 'testnet';
  const legacy = lockingBytecodeToBase58Address(bytecode, legacyNetwork);
  const legacyAddress = typeof legacy === 'string' ? legacy : undefined;

  return {
    type,
    prefix,
    cashAddress: cashAddress.address,
    tokenAddress: tokenAddress.address,
    legacyAddress,
    lockingBytecode: binToHex(bytecode),
    networkAssumed,
  };
}
