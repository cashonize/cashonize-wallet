import { hexToBin, binToHex, encodeLockingBytecodeP2pkh } from "@bitauth/libauth";
import { print } from "@0no-co/graphql.web";
import { graphql, type ResultOf, type TadaDocumentNode } from "src/chainGraphSchema";
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global
const CHAINGRAPH_REQUEST_TIMEOUT_MS = 10_000;

export class ChaingraphRequestError extends Error {}

// One endpoint serves both networks: the instances in use index mainnet and chipnet together,
// and the identity queries are keyed by transaction hash, which is unambiguous across chains. An
// address-keyed query would mix chains and needs gating, as the spent-outputs walk is.
async function queryChainGraph<Result, Variables>(
    document: TadaDocumentNode<Result, Variables>,
    chaingraphUrl: string,
    variables: Variables,
) {
    const jsonObj = {
        "operationName": null,
        "variables": variables,
        "query": print(document)
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
    // A trusted server's response, taken as served like the rest of what it answers
    return jsonResponse as { data: Result };
}

// Chaingraph returns bytea values as \x-prefixed hex strings
export function byteaToHex(bytea: string) {
  return bytea.replace(/^\\x/, "");
}

// The smallest meaningful query, used to check that a server is a working Chaingraph instance
const blockHeightQuery = graphql(`query BlockHeight {
    block(limit: 1, order_by: { height: desc }) {
      height
    }
  }`);

export async function queryBlockHeight(chaingraphUrl: string) {
  const response = await queryChainGraph(blockHeightQuery, chaingraphUrl, {});
  // guarded rather than trusted: the types say what a Chaingraph answers, and this is the query
  // that asks whether the server is one
  const height = response.data?.block?.[0]?.height;
  if (height === undefined) throw new ChaingraphRequestError(t('chaingraph.errors.invalidResponse'));
  return Number(height);
}

// One identity's whole authchain, with the outputs of every link. Asked for only when a card's
// history is opened: it is the one query here that grows with a chain's length.
const authchainLinksQuery = graphql(`query AuthchainLinks($hash: bytea!) {
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
  }`);

// One transaction of the chain, as the query asks for it
type AuthchainMigration = ResultOf<typeof authchainLinksQuery>['transaction'][number]['authchains'][number]['migrations'][number];
type MigrationTransaction = NonNullable<AuthchainMigration['transaction']>[number];

export interface AuthchainLink {
  hash: string;
  timestamp?: number;
  outputs: NonNullable<MigrationTransaction['outputs']>;
}

export async function queryAuthchainLinks(tokenId: string, chaingraphUrl: string): Promise<AuthchainLink[]> {
  const response = await queryChainGraph(authchainLinksQuery, chaingraphUrl, {
    hash: `\\x${tokenId}`,
  });
  const authchain = response.data.transaction[0]?.authchains[0];
  if (!authchain) throw new Error(t('chaingraph.errors.authchainNotFound'));
  // migrations come back oldest first, from the authbase to the authhead
  return authchain.migrations.flatMap(migration => (migration.transaction ?? []).map(transaction => {
    const timestamp = transaction.block_inclusions?.[0]?.block?.timestamp;
    return {
      hash: byteaToHex(transaction.hash),
      ...(timestamp ? { timestamp: Number(timestamp) } : {}),
      outputs: transaction.outputs ?? [],
    };
  }));
}

// OP_RETURN followed by a push of "BCMR". bytea has no prefix operator, but it is ordered, so a
// prefix is the range from it up to the next value at the same length. Verified against a live
// publication; the alternative, fetching every output and filtering here, would carry far more.
const bcmrPrefixRange = { from: "6a0442434d52", to: "6a0442434d53" };

// Where an identity's authchain ends now. The authhead transaction's outputs come along, so the
// BCMR publication among them can be recognised by its locking bytecode, and so do the chain's
// transactions, oldest first, which the history reads to name the wallet's own identity operations.
const authHeadQuery = graphql(`query AuthHead(
    $hash: bytea!
    $bcmrFrom: bytea!
    $bcmrTo: bytea!
  ) {
    transaction(where: { hash: { _eq: $hash } }) {
      authchains {
        authhead {
          hash
        }
        migrations {
          transaction {
            hash
            outputs(where: { locking_bytecode: { _gte: $bcmrFrom, _lt: $bcmrTo } }) {
              locking_bytecode
            }
          }
        }
      }
    }
  }`);

export async function queryAuthHead(tokenId:string, chaingraphUrl:string) {
  const response = await queryChainGraph(authHeadQuery, chaingraphUrl, {
    hash: `\\x${tokenId}`,
    bcmrFrom: `\\x${bcmrPrefixRange.from}`,
    bcmrTo: `\\x${bcmrPrefixRange.to}`,
  });
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
  if (!authchain?.authhead) throw new Error(t('chaingraph.errors.authchainNotFound'));
  // The identity's registry is the last publication its chain carries, which is not the authhead
  // whenever the operations since were transfers or reserve moves: those carry none, and they are
  // the ones this wallet makes. Migrations come oldest first, so the last match wins.
  const links: string[] = [];
  let publicationOutputs: string[] = [];
  for (const migration of authchain.migrations ?? []) {
    for (const transaction of migration.transaction ?? []) {
      links.push(byteaToHex(transaction.hash));
      const published = (transaction.outputs ?? []).map(output => byteaToHex(output.locking_bytecode));
      if (published.length) publicationOutputs = published;
    }
  }
  return { txid: byteaToHex(authchain.authhead.hash), publicationOutputs, links };
}

const spentOutputsQuery = graphql(`query WalletSpentOutputs(
    $lockingBytecodes: _text!
    $limit: Int!
    $offset: Int!
    $bcmrFrom: bytea!
    $bcmrTo: bytea!
  ) {
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
  }`);

// One spent output of the wallet's, with the transaction that spent it. A genesis marker is read
// against it: a category equal to the txid of a spent vout-0 outpoint is a token these keys made.
export type ChaingraphSpentOutput = ResultOf<typeof spentOutputsQuery>['search_output'][number];

// Chaingraph instances cap the rows a single query returns (5,000 on the default instance),
// truncating silently, so paged queries fetch until a page comes back short
const CHAINGRAPH_PAGE_SIZE = 1000;

// The spent outputs at the given pkhs' addresses, with the transactions that spent them. One walk
// feeds three readings: TapSwap and hodl announcements sit at outputs 1 and 0, and the metadata
// publications and token genesises these keys made are found by the publication prefix.
export async function querySpentOutputs(ownerPkhs: string[], chaingraphUrl: string) {
  if (!ownerPkhs.length) return [];
  // search_output takes its locking bytecodes as a postgres text-array literal
  const lockingBytecodesHex = ownerPkhs.map((pkh) => binToHex(encodeLockingBytecodeP2pkh(hexToBin(pkh))));
  const lockingBytecodes = `{${lockingBytecodesHex.join(",")}}`;
  const spentOutputs: ChaingraphSpentOutput[] = [];
  for (let offset = 0; ; offset += CHAINGRAPH_PAGE_SIZE) {
    const response = await queryChainGraph(spentOutputsQuery, chaingraphUrl, {
      lockingBytecodes,
      limit: CHAINGRAPH_PAGE_SIZE,
      offset,
      bcmrFrom: `\\x${bcmrPrefixRange.from}`,
      bcmrTo: `\\x${bcmrPrefixRange.to}`,
    });
    const page = response.data.search_output;
    spentOutputs.push(...page);
    if (page.length < CHAINGRAPH_PAGE_SIZE) break;
  }
  return spentOutputs;
}
