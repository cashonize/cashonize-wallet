import { hexToBin, binToHex, encodeLockingBytecodeP2pkh } from "@bitauth/libauth";
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global
const CHAINGRAPH_REQUEST_TIMEOUT_MS = 10_000;

export class ChaingraphRequestError extends Error {}

async function queryChainGraph(queryReq:string, chaingraphUrl:string, variables: Record<string, unknown> = {}){
    const jsonObj = {
        "operationName": null,
        "variables": variables,
        "query": queryReq
    };
    let response: Response;
    const timeoutSignal = AbortSignal.timeout(CHAINGRAPH_REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(chaingraphUrl, {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          redirect: "follow",
          referrerPolicy: "no-referrer",
          signal: timeoutSignal,
          body: JSON.stringify(jsonObj),
      });
    } catch {
      if (timeoutSignal.aborted) {
        throw new ChaingraphRequestError(t('chaingraph.errors.timeout', { seconds: CHAINGRAPH_REQUEST_TIMEOUT_MS / 1000 }));
      }
      throw new ChaingraphRequestError(t('chaingraph.errors.unreachable'));
    }
    if (!response.ok) {
      throw new ChaingraphRequestError(t('chaingraph.errors.requestFailed', { status: response.status }));
    }
    let jsonResponse: unknown;
    try {
      jsonResponse = await response.json();
    } catch {
      if (timeoutSignal.aborted) {
        throw new ChaingraphRequestError(t('chaingraph.errors.timeout', { seconds: CHAINGRAPH_REQUEST_TIMEOUT_MS / 1000 }));
      }
      throw new ChaingraphRequestError(t('chaingraph.errors.invalidResponse'));
    }
    if (jsonResponse && typeof jsonResponse === "object" && "errors" in jsonResponse) {
      const errors = (jsonResponse as { errors?: { message?: unknown }[] }).errors;
      if (errors?.length) {
        const reason = typeof errors[0]?.message === "string" ? errors[0].message : t('common.errors.somethingWentWrong');
        throw new ChaingraphRequestError(t('chaingraph.errors.rejected', { reason }));
      }
    }
    return jsonResponse;
}

// OP_RETURN followed by a push of "BCMR", which is what makes an output a metadata publication
const BCMR_OUTPUT_PREFIX = "6a0442434d52";

// Chaingraph returns bytea values as \x-prefixed hex strings
export function byteaToHex(bytea: string) {
  return bytea.replace(/^\\x/, "");
}

// The smallest meaningful query, used to check that a server is a working Chaingraph instance
export async function queryBlockHeight(chaingraphUrl: string) {
  const queryReqBlockHeight = `query {
    block(limit: 1, order_by: { height: desc }) {
      height
    }
  }`;
  const response = await queryChainGraph(queryReqBlockHeight, chaingraphUrl) as
    { data?: { block?: { height: string }[] } };
  const height = response.data?.block?.[0]?.height;
  if (height === undefined) throw new ChaingraphRequestError(t('chaingraph.errors.invalidResponse'));
  return Number(height);
}

// Bigint values arrive as decimal strings and bytea values as hex strings, as everywhere here
interface AuthHeadResponse {
  data: {
    transaction: {
      authchains: {
        authhead: {
          hash: string;
          identity_output: { fungible_token_amount: string | null }[];
          // every output of the authhead transaction, so the BCMR publication among them can be
          // recognised by its locking bytecode
          outputs: { output_index: string; locking_bytecode: string }[];
        };
      }[];
    }[];
  };
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
          },
          outputs {
            output_index,
            locking_bytecode
          }
        }
      }
    }
  }`;
  const response = await queryChainGraph(queryReqAuthHead, chaingraphUrl) as AuthHeadResponse;
  const transaction = response.data.transaction[0];
  if (!transaction) throw new Error(t('chaingraph.errors.tokenNotFound'));
  return transaction;
}

// The authhead's txid and, when its transaction carries one, the metadata publication it made.
// Both come out of the one query: the publication is an output of that same transaction, and the
// identity card wants the two together.
export async function queryAuthHeadWithPublication(tokenId:string, chaingraphUrl:string){
  const authHeadObj = await queryAuthHead(tokenId, chaingraphUrl);
  const authchain = authHeadObj.authchains[0];
  if (!authchain) throw new Error(t('chaingraph.errors.authchainNotFound'));
  const publicationOutput = (authchain.authhead.outputs ?? [])
    // by output index, since the spec takes the first matching output of the transaction
    .sort((left, right) => Number(left.output_index) - Number(right.output_index))
    .map(output => byteaToHex(output.locking_bytecode))
    .find(lockingBytecode => lockingBytecode.startsWith(BCMR_OUTPUT_PREFIX));
  return {
    txid: byteaToHex(authchain.authhead.hash),
    publicationOutput,
  };
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

// Chaingraph instances cap the rows a single query returns (5,000 on the default instance),
// truncating silently, so paged queries fetch until a page comes back short
const CHAINGRAPH_PAGE_SIZE = 1000;

// The spent outputs at the given pkhs' addresses, each with the spending transaction's
// outputs 0 and 1 and whether those are spent themselves. This is the shape the TapSwap and
// hodl lookups share: their announcements sit at outputs 1 and 0 of the transactions that
// spent the wallet's outputs (utils/defi/tapswapListings.ts, utils/defi/hodlContracts.ts).
export async function querySpentOutputs(ownerPkhs: string[], chaingraphUrl: string) {
  if (!ownerPkhs.length) return [];
  const querySpent = `query WalletSpentOutputs($lockingBytecodes: _text!, $limit: Int!, $offset: Int!) {
    search_output(
      args: { locking_bytecode_hex: $lockingBytecodes }
      where: { spent_by: {} }
      limit: $limit
      offset: $offset
      order_by: [{ transaction_hash: asc }, { output_index: asc }]
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
  const lockingBytecodesHex = ownerPkhs.map((pkh) => binToHex(encodeLockingBytecodeP2pkh(hexToBin(pkh))));
  const lockingBytecodes = `{${lockingBytecodesHex.join(",")}}`;
  const spentOutputs: ChaingraphSpentOutput[] = [];
  for (let offset = 0; ; offset += CHAINGRAPH_PAGE_SIZE) {
    const response = await queryChainGraph(querySpent, chaingraphUrl, {
      lockingBytecodes, limit: CHAINGRAPH_PAGE_SIZE, offset,
    }) as SpentOutputsResponse;
    const page = response.data.search_output;
    spentOutputs.push(...page);
    if (page.length < CHAINGRAPH_PAGE_SIZE) break;
  }
  return spentOutputs;
}
