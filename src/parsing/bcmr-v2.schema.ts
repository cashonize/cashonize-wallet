/**
 * A mapping of identifiers to URIs associated with an entity. URI identifiers
 * may be widely-standardized or registry-specific. Values must be valid URIs,
 * including a protocol prefix – e.g. `https://` or `ipfs://`., Clients are only
 * required to support `https` and `ipfs` URIs, but any scheme may be specified.
 */
export type URIs = {
  [identifier: string]: string;
};

/**
 * A mapping of extension identifiers to extension definitions. Extensions may
 * be widely standardized or application-specific, and extension definitions
 * must be either:
 *
 * - `string`s,
 * - key-value mappings of `string`s, or
 * - two-dimensional, key-value mappings of `string`s.
 *
 * This limitation encourages safety and wider compatibility across
 * implementations.
 *
 * To encode an array, it is recommended that each value be assigned to a
 * numeric key indicating the item's index (beginning at `0`).
 * Numerically-indexed objects are often a more useful and resilient
 * data-transfer format than simple arrays because they simplify difference-only
 * transmission: only modified indexes need to be transferred, and shifts in
 * item order must be explicit, simplifying merges of conflicting updates.
 *
 * For encoding of more complex data, consider using base64 and/or
 * string-encoded JSON.
 */
export type Extensions = {
  [extensionIdentifier: string]:
    | string
    | { [key: string]: string }
    | { [keyA: string]: { [keyB: string]: string } };
};

/**
 * Tags allow registries to classify and group identities by a variety of
 * characteristics. Tags are standardized within a registry and may represent
 * either labels applied by that registry or designations by external
 * authorities (certification, membership, ownership, etc.) that are tracked by
 * that registry.
 *
 * Examples of possible tags include: `individual`, `organization`, `token`,
 * `wallet`, `exchange`, `staking`, `utility-token`, `security-token`,
 * `stablecoin`, `wrapped`, `collectable`, `deflationary`, `governance`,
 * `decentralized-exchange`, `liquidity-provider`, `sidechain`,
 * `sidechain-bridge`, `acme-audited`, `acme-endorsed`, etc.
 *
 * Tags may be used by clients in search, discovery, and filtering of
 * identities, and they can also convey information like accreditation from
 * investor protection organizations, public certifications by security or
 * financial auditors, and other designations that signal integrity and value
 * to users.
 */
export type Tag = {
  /**
   * The name of this tag for use in interfaces.
   *
   * In user interfaces with limited space, names should be hidden beyond
   * the first newline character or `20` characters until revealed by the user.
   *
   * E.g.:
   * - `Individual`
   * - `Token`
   * - `Audited by ACME, Inc.`
   */
  name: string;

  /**
   * A string describing this tag for use in user interfaces.
   *
   * In user interfaces with limited space, descriptions should be hidden beyond
   * the first newline character or `140` characters until revealed by the user.
   *
   * E.g.:
   * - `An identity maintained by a single individual.`
   * - `An identity representing a type of token.`
   * - `An on-chain application that has passed security audits by ACME, Inc.`
   */
  description?: string;

  /**
   * A mapping of identifiers to URIs associated with this tag. URI identifiers
   * may be widely-standardized or registry-specific. Values must be valid URIs,
   * including a protocol prefix (e.g. `https://` or `ipfs://`). Clients are
   * only required to support `https` and `ipfs` URIs, but any scheme may
   * be specified.
   *
   * The following identifiers are recommended for all tags:
   * - `icon`
   * - `web`
   *
   * The following optional identifiers are standardized:
   * - `blog`
   * - `chat`
   * - `forum`
   * - `icon-intro`
   * - `registry`
   * - `support`
   *
   * For details on these standard identifiers, see:
   * https://github.com/bitjson/chip-bcmr#uri-identifiers
   *
   * Custom URI identifiers allow for sharing social networking profiles, p2p
   * connection information, and other application-specific URIs. Identifiers
   * must be lowercase, alphanumeric strings, with no whitespace or special
   * characters other than dashes (as a regular expression: `/^[-a-z0-9]+$/`).
   *
   * For example, some common identifiers include: `discord`, `docker`,
   * `facebook`, `git`, `github`, `gitter`, `instagram`, `linkedin`, `matrix`,
   * `npm`, `reddit`, `slack`, `substack`, `telegram`, `twitter`, `wechat`,
   * `youtube`.
   */
  uris?: URIs;

  /**
   * A mapping of `Tag` extension identifiers to extension definitions.
   * {@link Extensions} may be widely standardized or application-specific.
   */
  extensions?: Extensions;
};

/**
 * A definition for one type of NFT within a token category.
 */
export type NftType = {
  /**
   * The name of this NFT type for use in interfaces. Names longer than `20`
   * characters may be elided in some interfaces.
   *
   * E.g. `Market Order Buys`, `Limit Order Sales`, `Pledge Receipts`,
   * `ACME Stadium Tickets`, `Sealed Votes`, etc.
   */
  name: string;

  /**
   * A string describing this NFT type for use in user interfaces.
   *
   * In user interfaces with limited space, names should be hidden beyond the
   * first newline character or `140` characters until revealed by the user.
   *
   * E.g.:
   * - "Receipts issued by the exchange to record details about purchases. After
   * settlement, these receipts are redeemed for the purchased tokens.";
   * - "Receipts issued by the crowdfunding campaign to document the value of
   * funds pledged. If the user decides to cancel their pledge before the
   * campaign completes, these receipts can be redeemed for a full refund.";
   * - "Tickets issued for events at ACME Stadium.";
   * - Sealed ballots certified by ACME decentralized organization during the
   * voting period. After the voting period ends, these ballots must be revealed
   * to reclaim the tokens used for voting."
   */
  description?: string;

  /**
   * A list of identifiers for fields contained in NFTs of this type. On
   * successful parsing evaluations, the bottom item on the altstack indicates
   * the matched NFT type, and the remaining altstack items represent NFT field
   * contents in the order listed (where `fields[0]` is the second-to-bottom
   * item, and the final item in `fields` is the top of the altstack).
   *
   * Fields should be ordered by recommended importance from most important to
   * least important; in user interfaces, clients should display fields at lower
   * indexes more prominently than those at higher indexes, e.g. if some fields
   * cannot be displayed in minimized interfaces, higher-importance fields can
   * still be represented. (Note, this ordering is controlled by the bytecode
   * specified in `token.nft.parse.bytecode`.)
   *
   * If this is a sequential NFT, (the category's `parse.bytecode` is
   * undefined), `fields` should be omitted or set to `undefined`.
   */
  fields?: string[];

  /**
   * A mapping of identifiers to URIs associated with this NFT type. URI
   * identifiers may be widely-standardized or registry-specific. Values must be
   * valid URIs, including a protocol prefix (e.g. `https://` or `ipfs://`).
   * Clients are only required to support `https` and `ipfs` URIs, but any
   * scheme may be specified.
   */
  uris?: URIs;

  /**
   * A mapping of NFT type extension identifiers to extension definitions.
   * {@link Extensions} may be widely standardized or application-specific.
   */
  extensions?: Extensions;
};

/**
 * A definition specifying a field that can be encoded in non-fungible tokens of
 * a token category.
 */
export type NftCategoryField = {
  [identifier: string]: {
    /**
     * The name of this field for use in interfaces. Names longer than `20`
     * characters may be elided in some interfaces.
     *
     * E.g.:
     * - `BCH Pledged`
     * - `Tokens Sold`
     * - `Settlement Locktime`
     * - `Seat Number`,
     * - `IPFS Content Identifier`
     * - `HTTPS URL`
     */
    name?: string;

    /**
     * A string describing how this identity uses NFTs (for use in user
     * interfaces). Descriptions longer than `160` characters may be elided in
     * some interfaces.
     *
     * E.g.:
     * - `The BCH value pledged at the time this receipt was issued.`
     * - `The number of tokens sold in this order.`
     * - `The seat number associated with this ticket.`
     */
    description?: string;

    /**
     * The expected encoding of this field when read from the parsing altstack
     * (see {@link ParsableNftCollection}). All encoding definitions must have a
     * `type`, and some encoding definitions allow for additional hinting about
     * display strategies in clients.
     *
     * Encoding types may be set to `binary`, `boolean`, `hex`, `number`,
     * or `utf8`:
     *
     * - `binary` types should be displayed as binary literals (e.g. `0b0101`)
     * - `boolean` types should be displayed as `true` if exactly `0x01` or
     * `false` if exactly `0x00`. If a boolean value does not match one of these
     * values, clients should represent the NFT as unable to be parsed
     * (e.g. simply display the full `commitment`).
     * - `hex` types should be displayed as hex literals (e.g.`0xabcd`).
     * - `https-url` types are percent encoded with the `https://` prefix
     * omitted; they may be displayed as URIs or as activatable links.
     * - `ipfs-cid` types are binary-encoded IPFS Content Identifiers; they may
     * be displayed as URIs or as activatable links.
     * - `locktime` types are `OP_TXLOCKTIME` results: integers from `0` to
     * `4294967295` (inclusive) where values less than `500000000` are
     * understood to be a block height (the current block number in the chain,
     * beginning from block `0`), and values greater than or equal to
     * `500000000` are understood to be a Median Time Past (BIP113) UNIX
     * timestamp. (Note, sequence age is not currently supported.)
     * - `number` types should be displayed according the their configured
     * `decimals` and `unit` values.
     * - `utf8` types should be displayed as utf8 strings.
     */
    encoding:
      | {
          type:
            | "binary"
            | "boolean"
            | "hex"
            | "https-url"
            | "ipfs-cid"
            | "utf8"
            | `locktime`;
        }
      | {
          type: "number";

          /**
           * The `aggregate` property indicates that aggregating this field from
           * multiple NFTs is desirable in user interfaces. For example, for a
           * field named `BCH Pledged` where `aggregate` is `add`, the client
           * can display a `Total BCH Pledged` in any user interface listing
           * more than one NFT.
           *
           * If specified, clients should aggregate the field from all NFTs, of
           * all NFT types within the category, within a particular view (e.g.
           * NFTs held by a single wallet, NFTs existing in a single
           * transaction's outputs, etc.) using the specified operation.
           *
           * Note, while aggregation could be performed using any commutative
           * operation – multiplication, bitwise AND, bitwise OR, bitwise XOR,
           * etc. – only `add` is currently supported.
           */
          aggregate?: "add";

          /**
           * An integer between `0` and `18` (inclusive) indicating the
           * divisibility of the primary unit of this token field.
           *
           * This is the number of digits that can appear after the decimal
           * separator in amounts. For a field with a `decimals` of `2`, a value
           * of `123456` should be displayed as `1234.56`.
           *
           * If omitted, defaults to `0`.
           */
          decimals?: number;

          /**
           * The unit in which this field is denominated, taking the `decimals`
           * value into account. If representing fungible token amount, this
           * will often be the symbol of the represented token category.
           *
           * E.g. `BCH`, `sats`, `AcmeUSD`, etc.
           *
           * If not provided, clients should not represent this field as having
           * a unit beyond the field's `name`.
           */
          unit?: string;
        };
    /**
     * A mapping of identifiers to URIs associated with this NFT field. URI
     * identifiers may be widely-standardized or registry-specific. Values must
     * be valid URIs, including a protocol prefix (e.g. `https://` or
     * `ipfs://`). Clients are only required to support `https` and `ipfs` URIs,
     * but any scheme may be specified.
     */
    uris?: URIs;

    /**
     * A mapping of NFT field extension identifiers to extension definitions.
     * {@link Extensions} may be widely standardized or application-specific.
     */
    extensions?: Extensions;
  };
};

/**
 * Interpretation information for a collection of sequential NFTs, a collection
 * in which each NFT includes only a sequential identifier within its on-chain
 * commitment. Note that {@link SequentialNftCollection}s differ from
 * {@link ParsableNftCollection}s in that sequential collections lack a
 * parsing `bytecode` with which to inspect each NFT commitment: the type of
 * each NFT is indexed by the full contents its commitment (interpreted as a
 * positive VM integer in user interfaces).
 */
export type SequentialNftCollection = {
  /**
   * A mapping of each NFT commitment (typically, a positive integer encoded as
   * a VM number) to metadata for that NFT type in this category.
   */
  types: {
    /**
     * Interpretation information for each type of NFT within the token
     * category, indexed by commitment hex. For sequential NFTs, the on-chain
     * commitment of each NFT is interpreted as a VM number to reference its
     * particular NFT type in user interfaces. Issuing a sequential NFT with a
     * negative or invalid VM number is discouraged, but clients may render the
     * commitment of such NFTs in hex-encoded form, prefixed with `X`.
     */
    [commitmentHex: string]: NftType;
  };
};

/**
 * Interpretation information for a collection of parsable NFTs, a collection
 * in which each NFT may include additional metadata fields beyond a sequential
 * identifier within its on-chain commitment. Note that
 * {@link ParsableNftCollection}s differ from {@link SequentialNftCollection}s
 * in that parsable collections require a parsing `bytecode` with which to
 * inspect each NFT commitment: the type of each NFT is indexed by the
 * hex-encoded contents the bottom item on the altstack following the evaluation
 * of the parsing bytecode.
 */
export type ParsableNftCollection = {
  /**
   * A segment of hex-encoded Bitcoin Cash VM bytecode that parses UTXOs
   * holding NFTs of this category, identifies the NFT's type within the
   * category, and returns a list of the NFT's field values via the
   * altstack. If undefined, this NFT Category includes only sequential NFTs,
   * with only an identifier and no NFT fields encoded in each NFT's
   * on-chain commitment.
   */
  bytecode: string;
  /**
   * A mapping of hex-encoded values to definitions of possible NFT types
   * in this category.
   */
  types: {
    /**
     * A definitions for each type of NFT within the token category. Parsable
     * NFT types are indexed by the hex-encoded value of the bottom altstack
     * item following evaluation of `NftCategory.parse.bytecode`. The remaining
     * altstack items are mapped to NFT fields according to the `fields`
     * property of the matching NFT type.
     */
    [bottomAltstackHex: string]: NftType;
  };
};

/**
 * A definition specifying the non-fungible token information for a
 * token category.
 */
export type NftCategory = {
  /**
   * A string describing how this identity uses NFTs (for use in user
   * interfaces). Descriptions longer than `160` characters may be elided in
   * some interfaces.
   */
  description?: string;

  /**
   * A mapping of field identifier to field definitions for the data fields
   * that can appear in NFT commitments of this category.
   */
  fields?: NftCategoryField;

  /**
   * Parsing and interpretation information for all NFTs of this category;
   * this enables generalized wallets to parse and display detailed
   * information about all NFTs held by the wallet.
   */
  parse: SequentialNftCollection | ParsableNftCollection;
};

/**
 * A definition specifying information about an identity's token category.
 */
export type TokenCategory = {
  /**
   * The current token category used by this identity.
   */
  category: string;

  /**
   * An abbreviation used to uniquely identity this token category.
   */
  symbol: string;

  /**
   * An integer between `0` and `18` (inclusive) indicating the divisibility
   * of the primary unit of this token category.
   */
  decimals?: number;

  /**
   * Display information for non-fungible tokens (NFTs) of this identity.
   * Omitted for token categories without NFTs.
   */
  nfts?: NftCategory;
};

/**
 * A snapshot of the metadata for a particular identity at a specific time.
 */
export type IdentitySnapshot = {
  name: string;
  description?: string;
  tags?: string[];
  migrated?: string;
  token?: TokenCategory;
  status?: "active" | "burned" | "inactive";
  splitId?: string;
  uris?: URIs;
  extensions?: Extensions;
};

/**
 * A snapshot of the metadata for a particular chain/network at a specific time.
 */
export type ChainSnapshot = Omit<IdentitySnapshot, "migrated" | "token"> & {
  token: {
    symbol: string;
    decimals?: number;
  };
};

export type RegistryTimestampKeyedValues<T> = {
  [timestamp: string]: T;
};

export type ChainHistory = RegistryTimestampKeyedValues<ChainSnapshot>;

export type IdentityHistory = RegistryTimestampKeyedValues<IdentitySnapshot>;

export type OffChainRegistryIdentity = Pick<
  IdentitySnapshot,
  "name" | "description" | "uris" | "tags" | "extensions"
>;

/**
 * A Bitcoin Cash Metadata Registry is an authenticated JSON file containing
 * metadata about tokens, identities, contract applications, and other on-chain
 * artifacts.
 */
export type Registry = {
  $schema?: string;
  version: {
    major: number;
    minor: number;
    patch: number;
  };
  latestRevision: string;
  registryIdentity: OffChainRegistryIdentity | string;
  identities?: {
    [authbase: string]: IdentityHistory;
  };
  tags?: {
    [identifier: string]: Tag;
  };
  defaultChain?: string;
  chains?: {
    [splitId: string]: ChainHistory;
  };
  license?: string;
  locales?: {
    [localeIdentifier: string]: Pick<
      Registry,
      "chains" | "extensions" | "identities" | "tags"
    >;
  };
  extensions?: Extensions;
};
