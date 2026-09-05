// The Chaingraph queries are typed from the schema rather than by hand-mirroring each response.
// The scalar map says how Chaingraph serves what postgres stores: bytea as a \x-prefixed hex
// string, bigint and timestamp as decimal strings, _text as a postgres array literal.
// The introspection is committed so a clone type checks without reaching a server. Taken from
// https://gql.chaingraph.pat.mn/v1/graphql on 2026-09-01; `pnpm generate:chaingraph` refreshes it.

import { initGraphQLTada } from 'gql.tada';
import type { introspection } from 'src/generated/graphql-env';

export const graphql = initGraphQLTada<{
  introspection: introspection;
  scalars: {
    bytea: string;
    bigint: string;
    timestamp: string;
    _text: string;
    enum_nonfungible_token_capability: 'none' | 'mutable' | 'minting';
  };
}>();

export type { ResultOf, VariablesOf, TadaDocumentNode } from 'gql.tada';
