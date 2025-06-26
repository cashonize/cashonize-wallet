import type { Input, TransactionCommon } from "@bitauth/libauth";

export interface AbiInput {
  name: string;
  type: string;
}
export interface AbiFunction {
  name: string;
  covenant?: boolean;
  inputs: AbiInput[];
}
export interface Artifact {
  contractName: string;
  constructorInputs: AbiInput[];
  abi: AbiFunction[];
  bytecode: string;
  source: string;
  compiler: {
      name: string;
      version: string;
  };
  updatedAt: string;
}
export interface ContractInfo {
  contract?: {
    abiFunction: AbiFunction;
    redeemScript: Uint8Array;
    artifact: Partial<Artifact>;
  }
}

export interface LibauthOutput {
  lockingBytecode: Uint8Array;
  valueSatoshis: bigint;
  token?: LibauthTokenDetails;
}
export interface LibauthTokenDetails {
  amount: bigint;
  category: Uint8Array;
  nft?: {
      capability: 'none' | 'mutable' | 'minting';
      commitment: Uint8Array;
  };
}

export type WcSourceOutputs = (Input & LibauthOutput & ContractInfo)[];

export interface WcTransactionObj {
  transaction: TransactionCommon<Input> | string,
  sourceOutputs: WcSourceOutputs,
  broadcast?: boolean,
  userPrompt?: string
}