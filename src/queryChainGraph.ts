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

// One identity's whole authchain, with the outputs of every link. Asked for only when a card's
// history is opened: it is the one query here that grows with a chain's length.
export interface AuthchainLink {
  hash: string;
  timestamp?: number;
  outputs: {
    output_index: string;
    locking_bytecode: string;
    token_category: string | null;
    fungible_token_amount: string | null;
  }[];
}

interface AuthchainLinksResponse {
  data: {
    transaction: {
      authchains: {
        migrations: {
          transaction: {
            hash: string;
            block_inclusions: { block: { timestamp: string } }[];
            outputs: AuthchainLink['outputs'];
          }[];
        }[];
      }[];
    }[];
  };
}

export async function queryAuthchainLinks(tokenId: string, chaingraphUrl: string): Promise<AuthchainLink[]> {
  const queryLinks = `query AuthchainLinks($hash: bytea!) {
    transaction(where: { hash: { _eq: $hash } }) {
      authchains {
        migrations {
          transaction {
            hash
            block_inclusions { block { timestamp } }
            outputs {
              output_index
              locking_bytecode
              token_category
              fungible_token_amount
            }
          }
        }
      }
    }
  }`;
  const response = await queryChainGraph(queryLinks, chaingraphUrl, {
    hash: `\\x${tokenId}`,
  }) as AuthchainLinksResponse;
  const authchain = response.data.transaction[0]?.authchains[0];
  if (!authchain) throw new Error(t('chaingraph.errors.authchainNotFound'));
  // migrations come back oldest first, from the authbase to the authhead
  return authchain.migrations.flatMap(migration => migration.transaction.map(transaction => {
    const timestamp = transaction.block_inclusions?.[0]?.block?.timestamp;
    return {
      hash: byteaToHex(transaction.hash),
      ...(timestamp ? { timestamp: Number(timestamp) } : {}),
      outputs: transaction.outputs,
    };
  }));
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
        // every transaction of the chain, oldest first: the authbase, then each update, ending at
        // the authhead. Free here, since the query is already asking about this authchain.
        migrations: { transaction: { hash: string }[] }[];
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
        },
        migrations {
          transaction {
            hash
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

// The authhead's txid and the locking bytecodes of its transaction's outputs, in output order.
// Both come out of the one query: a metadata publication is an output of that same transaction,
// and recognising it among these belongs to the module that owns the publication format.
export async function queryAuthHeadWithOutputs(tokenId:string, chaingraphUrl:string){
  const authHeadObj = await queryAuthHead(tokenId, chaingraphUrl);
  const authchain = authHeadObj.authchains[0];
  if (!authchain) throw new Error(t('chaingraph.errors.authchainNotFound'));
  const outputs = (authchain.authhead.outputs ?? [])
    .sort((left, right) => Number(left.output_index) - Number(right.output_index))
    .map(output => byteaToHex(output.locking_bytecode));
  // the chain's transactions, which is what lets the history recognise an identity operation
  const links = (authchain.migrations ?? []).flatMap(
    migration => migration.transaction.map(transaction => byteaToHex(transaction.hash))
  );
  return { txid: byteaToHex(authchain.authhead.hash), outputs, links };
}

// Bigint values arrive as decimal strings, like the bytea values arrive as hex strings
export interface ChaingraphSpentOutput {
  // the wallet's own output that was spent, which a genesis marker is read against: a category
  // equal to the txid of a spent vout-0 outpoint is a token genesised by these keys
  transaction_hash: string;
  output_index: string;
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

// OP_RETURN followed by a push of "BCMR". bytea has no prefix operator, but it is ordered, so a
// prefix is the range from it up to the next value at the same length. Verified against a live
// publication; the alternative, fetching every output and filtering here, would carry far more.
const bcmrPrefixRange = { from: "6a0442434d52", to: "6a0442434d53" };

interface SpentOutputsResponse {
  data: { search_output: ChaingraphSpentOutput[] };
}

// Chaingraph instances cap the rows a single query returns (5,000 on the default instance),
// truncating silently, so paged queries fetch until a page comes back short
const CHAINGRAPH_PAGE_SIZE = 1000;

// The spent outputs at the given pkhs' addresses, each with the spending transaction's outputs
// and whether those are spent themselves. Three readings share this one walk: TapSwap and hodl
// announcements sit at outputs 1 and 0 (utils/defi/tapswapListings.ts, utils/defi/hodlContracts.ts),
// and a metadata publication or token genesis these keys made is read off the same transactions
// (utils/tools/identityDetection.ts). Outputs are fetched by position for the first two and by
// the publication prefix for the third, so widening the reading costs no extra query.
export async function querySpentOutputs(ownerPkhs: string[], chaingraphUrl: string) {
  if (!ownerPkhs.length) return [];
  const querySpent = `query WalletSpentOutputs($lockingBytecodes: _text!, $limit: Int!, $offset: Int!, $bcmrFrom: bytea!, $bcmrTo: bytea!) {
    search_output(
      args: { locking_bytecode_hex: $lockingBytecodes }
      where: { spent_by: {} }
      limit: $limit
      offset: $offset
      order_by: [{ transaction_hash: asc }, { output_index: asc }]
    ) {
      transaction_hash
      output_index
      spent_by {
        transaction {
          hash
          outputs(where: { _or: [
            { output_index: { _in: ["0", "1"] } },
            { locking_bytecode: { _gte: $bcmrFrom, _lt: $bcmrTo } }
          ] }) {
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
      lockingBytecodes,
      limit: CHAINGRAPH_PAGE_SIZE,
      offset,
      bcmrFrom: `\\x${bcmrPrefixRange.from}`,
      bcmrTo: `\\x${bcmrPrefixRange.to}`,
    }) as SpentOutputsResponse;
    const page = response.data.search_output;
    spentOutputs.push(...page);
    if (page.length < CHAINGRAPH_PAGE_SIZE) break;
  }
  return spentOutputs;
}
