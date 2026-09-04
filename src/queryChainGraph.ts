import { hexToBin, binToHex, encodeLockingBytecodeP2pkh } from "@bitauth/libauth";
import type { Utxo } from "mainnet-js";
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

// Chaingraph returns bytea values as \x-prefixed hex strings, and takes them the same way
export function byteaToHex(bytea: string) {
  return bytea.replace(/^\\x/, "");
}
function toBytea(hex: string) {
  return `\\x${hex}`;
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

// Chaingraph instances cap the rows a selection returns (1,000 on the default instance, nested
// selections included) and truncate silently, so paged queries fetch until a page comes back short
const CHAINGRAPH_PAGE_SIZE = 1000;

// One identity's whole authchain, with the outputs of every link. Asked for only when a card's
// history is opened: it is the one query here that grows with a chain's length.
const authchainLinksQuery = graphql(`query AuthchainLinks($hash: bytea!, $limit: Int!, $offset: Int!) {
    transaction(where: { hash: { _eq: $hash } }) {
      authchains {
        migrations(order_by: { migration_index: asc }, limit: $limit, offset: $offset) {
          transaction {
            hash
            block_inclusions { block { timestamp } }
            outputs(order_by: { output_index: asc }) {
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
  outputs: MigrationTransaction['outputs'];
}

export async function queryAuthchainLinks(tokenId: string, chaingraphUrl: string): Promise<AuthchainLink[]> {
  const links: AuthchainLink[] = [];
  for (let offset = 0; ; offset += CHAINGRAPH_PAGE_SIZE) {
    const response = await queryChainGraph(authchainLinksQuery, chaingraphUrl, {
      hash: toBytea(tokenId),
      limit: CHAINGRAPH_PAGE_SIZE,
      offset,
    });
    const authchain = response.data.transaction[0]?.authchains[0];
    if (!authchain) throw new Error(t('chaingraph.errors.authchainNotFound'));
    const page = authchain.migrations.flatMap(migration => (migration.transaction ?? []).map(transaction => {
      const timestamp = transaction.block_inclusions[0]?.block.timestamp;
      return {
        hash: byteaToHex(transaction.hash),
        ...(timestamp ? { timestamp: Number(timestamp) } : {}),
        outputs: transaction.outputs,
      };
    }));
    links.push(...page);
    if (authchain.migrations.length < CHAINGRAPH_PAGE_SIZE) break;
  }
  return links;
}

// OP_RETURN then a push of "BCMR". bytea has no prefix operator, but it is ordered, so a prefix
// is the range from it up to the next value at the same length.
export const BCMR_OUTPUT_PREFIX = "6a0442434d52";
const bcmrPrefixRange = { from: BCMR_OUTPUT_PREFIX, to: "6a0442434d53" };

// The transaction history recognises the wallet's own identity operations among these; a chain
// longer than this only loses the badge on its oldest operations
const RECENT_LINKS_LIMIT = 200;

// One request per batch of categories, since a public instance limits request size and rate. The
// selections that would grow with the chain are narrowed on the server, a nested selection being
// capped like a top-level one: the last link carrying a publication, the latest links. A category
// the server has no transaction for is absent from the map, which the caller reads as that one
// category unresolved rather than the batch failing.
const authHeadsQuery = graphql(`query AuthHeads(
    $hashes: [bytea!]!
    $bcmrFrom: bytea!
    $bcmrTo: bytea!
    $linksLimit: Int!
  ) {
    transaction(where: { hash: { _in: $hashes } }) {
      hash
      authchains {
        authchain_length
        authhead {
          hash
          outputs(where: { output_index: { _eq: "0" } }) {
            locking_bytecode
            value_satoshis
            token_category
            fungible_token_amount
            nonfungible_token_capability
            nonfungible_token_commitment
          }
        }
        genesis: migrations(where: { migration_index: { _eq: "1" } }) {
          transaction {
            outputs {
              output_index
              token_category
              fungible_token_amount
              nonfungible_token_capability
              nonfungible_token_commitment
            }
          }
        }
        lastPublication: migrations(
          where: { transaction: { outputs: { locking_bytecode: { _gte: $bcmrFrom, _lt: $bcmrTo } } } }
          order_by: { migration_index: desc }
          limit: 1
        ) {
          transaction {
            outputs(where: { locking_bytecode: { _gte: $bcmrFrom, _lt: $bcmrTo } }, order_by: { output_index: asc }) {
              locking_bytecode
            }
          }
        }
        recent: migrations(order_by: { migration_index: desc }, limit: $linksLimit) {
          transaction {
            hash
          }
        }
      }
    }
  }`);

// Output 0 of the authhead as the chain has it: whose address the identity sits at, or what
// script, and what it holds. Absent when the server does not report it.
export interface IdentityOutput {
  lockingBytecode: string; // hex
  satoshis: bigint;
  token?: NonNullable<Utxo['token']>; // the reserve and the NFT riding on the identity, in the wallet's own shape
}

export interface AuthHeadResult {
  txid: string;
  identityOutput?: IdentityOutput;
  publicationOutputs: string[]; // the BCMR-prefixed outputs of the last link carrying one, in output order
  chainLength: number; // every link of the chain, the authbase counted
  recentLinks: string[]; // the chain's latest links, oldest first, up to RECENT_LINKS_LIMIT
  isToken: boolean; // whether the genesis made tokens of this category at all
  fungibleSupply: boolean; // and fungible ones among them
  genesisSupply: bigint; // how many, the AuthGuard standard's genesis supply; fixed for the category's life
  keyCommitment?: string; // the commitment of the AuthKey the genesis minted at output 1, when it did
}

type AuthchainAnswer = ResultOf<typeof authHeadsQuery>['transaction'][number]['authchains'][number];

export async function queryAuthHeadsWithOutputs(tokenIds: string[], chaingraphUrl: string): Promise<Map<string, AuthHeadResult>> {
  const response = await queryChainGraph(authHeadsQuery, chaingraphUrl, {
    hashes: tokenIds.map(toBytea),
    bcmrFrom: toBytea(bcmrPrefixRange.from),
    bcmrTo: toBytea(bcmrPrefixRange.to),
    linksLimit: RECENT_LINKS_LIMIT,
  });
  const results = new Map<string, AuthHeadResult>();
  for (const transaction of response.data.transaction) {
    const tokenId = byteaToHex(transaction.hash);
    const authchain = transaction.authchains[0];
    if (!authchain?.authhead) continue;
    results.set(tokenId, readAuthHead(tokenId, authchain, authchain.authhead));
  }
  return results;
}

// The same answer for one category: a batch of one, so there is one query to keep right
export async function queryAuthHeadWithOutputs(tokenId: string, chaingraphUrl: string): Promise<AuthHeadResult> {
  const result = (await queryAuthHeadsWithOutputs([tokenId], chaingraphUrl)).get(tokenId);
  if (!result) throw new Error(t('chaingraph.errors.tokenNotFound'));
  return result;
}

function readAuthHead(
  tokenId: string,
  authchain: AuthchainAnswer,
  authhead: NonNullable<AuthchainAnswer['authhead']>,
): AuthHeadResult {
  // The identity's registry is the last publication its chain carries, which is not the authhead
  // whenever the operations since were transfers or reserve moves: those carry none, and they are
  // the ones this wallet makes. Which of the prefixed outputs is a publication is the format
  // module's call.
  const publicationOutputs = (authchain.lastPublication[0]?.transaction ?? [])
    .flatMap(transaction => transaction.outputs.map(output => byteaToHex(output.locking_bytecode)));
  const recentLinks = authchain.recent
    .flatMap(migration => (migration.transaction ?? []).map(transaction => byteaToHex(transaction.hash)))
    .reverse();
  // The queried transaction is the authbase, whose hash the category is, so it cannot carry the
  // category: only the genesis can, the link that spends its output 0. What that link made never
  // changes, so it decides whether the identity is a token's and whether the token has supply.
  const genesisOutputs = authchain.genesis[0]?.transaction?.[0]?.outputs ?? [];
  const categoryOutputs = genesisOutputs.filter(output =>
    output.token_category && byteaToHex(output.token_category) === tokenId
  );
  const isToken = categoryOutputs.length > 0;
  const genesisSupply = categoryOutputs.reduce((total, output) => total + BigInt(output.fungible_token_amount ?? 0), 0n);
  const fungibleSupply = genesisSupply > 0n;
  // The AuthGuard genesis setup mints the key at output 1, of the identity's own category, which
  // pins the key's commitment: without it every NFT of a collection guarded that way is a key
  const keyOutput = categoryOutputs.find(output => output.output_index === "1");
  const mintedKey = keyOutput?.nonfungible_token_capability === "none" && BigInt(keyOutput.fungible_token_amount ?? 0) === 0n;
  const keyCommitment = mintedKey ? byteaToHex(keyOutput.nonfungible_token_commitment ?? "") : undefined;
  const output = authhead.outputs[0];
  let identityOutput: IdentityOutput | undefined;
  if (output) {
    identityOutput = { lockingBytecode: byteaToHex(output.locking_bytecode), satoshis: BigInt(output.value_satoshis) };
    if (output.token_category) {
      const capability = output.nonfungible_token_capability;
      identityOutput.token = {
        category: byteaToHex(output.token_category),
        amount: BigInt(output.fungible_token_amount ?? 0),
        ...(capability
          ? { nft: { capability, commitment: byteaToHex(output.nonfungible_token_commitment ?? "") } }
          : {}),
      };
    }
  }
  return {
    txid: byteaToHex(authhead.hash),
    ...(identityOutput ? { identityOutput } : {}),
    publicationOutputs,
    chainLength: authchain.authchain_length ?? 0,
    recentLinks,
    isToken,
    fungibleSupply,
    genesisSupply,
    ...(keyCommitment !== undefined ? { keyCommitment } : {}),
  };
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
      bcmrFrom: toBytea(bcmrPrefixRange.from),
      bcmrTo: toBytea(bcmrPrefixRange.to),
    });
    const page = response.data.search_output;
    spentOutputs.push(...page);
    if (page.length < CHAINGRAPH_PAGE_SIZE) break;
  }
  return spentOutputs;
}
