import {
  ChaingraphAuthHeadSchema,
} from "src/utils/zodValidation";
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

async function queryChainGraph(queryReq:string, chaingraphUrl:string, variables: Record<string, unknown> = {}){
    const jsonObj = {
        "operationName": null,
        "variables": variables,
        "query": queryReq
    };
    const response = await fetch(chaingraphUrl, {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        redirect: "follow",
        referrerPolicy: "no-referrer",
        body: JSON.stringify(jsonObj),
    });
    if (!response.ok) throw new Error(t('chaingraph.errors.requestFailed', { status: response.status }));
    return await response.json();
}

// Chaingraph returns bytea values as \x-prefixed hex strings
export function byteaToHex(bytea: string) {
  return bytea.replace(/^\\x/, "");
}

export async function queryAuthHead(tokenId:string, chaingraphUrl:string) {
  const queryReqAuthHead = `query {
    transaction(
      where: {
        hash: {
          _eq: "\\\\x${tokenId}"
        }
      }
    ) {
      authchains {
        authhead {
          hash,
          identity_output {
            fungible_token_amount
          }
        }
      }
    }
  }`;
  const jsonRespAuthHead = await queryChainGraph(queryReqAuthHead, chaingraphUrl);
  const parsed = ChaingraphAuthHeadSchema.parse(jsonRespAuthHead);
  const transaction = parsed.data.transaction[0];
  if (!transaction) throw new Error(t('chaingraph.errors.tokenNotFound'));
  return transaction;
}

export async function queryAuthHeadTxid(tokenId:string, chaingraphUrl:string){
  const authHeadObj = await queryAuthHead(tokenId, chaingraphUrl);
  const authchain = authHeadObj.authchains[0];
  if (!authchain) throw new Error(t('chaingraph.errors.authchainNotFound'));
  return byteaToHex(authchain.authhead.hash);
}

// Bigint values arrive as decimal strings, like the bytea values arrive as hex strings
export interface ChaingraphSpentOutput {
  spent_by: {
    transaction: {
      hash: string;
      outputs: {
        output_index: string;
        locking_bytecode: string;
        token_category: string | null;
        nonfungible_token_commitment: string | null;
        fungible_token_amount: string | null;
        spent_by: { input_index: string }[];
      }[];
    };
  }[];
}

interface SpentOutputsResponse {
  data: { search_output: ChaingraphSpentOutput[] };
}

// The spent outputs at the given locking bytecodes, each with the spending transaction's
// outputs 0 and 1 and whether those are spent themselves. This is the shape the TapSwap
// listing lookup needs (utils/defi/tapswapListings.ts).
export async function querySpentOutputs(lockingBytecodesHex: string[], chaingraphUrl: string) {
  const querySpent = `query WalletSpentOutputs($lockingBytecodes: _text!) {
    search_output(
      args: { locking_bytecode_hex: $lockingBytecodes }
      where: { spent_by: {} }
    ) {
      spent_by {
        transaction {
          hash
          outputs(where: { output_index: { _in: ["0", "1"] } }) {
            output_index
            locking_bytecode
            token_category
            nonfungible_token_commitment
            fungible_token_amount
            spent_by { input_index }
          }
        }
      }
    }
  }`;
  // search_output takes its locking bytecodes as a postgres text-array literal
  const lockingBytecodes = `{${lockingBytecodesHex.join(",")}}`;
  const response = await queryChainGraph(querySpent, chaingraphUrl, { lockingBytecodes }) as SpentOutputsResponse;
  return response.data.search_output;
}
