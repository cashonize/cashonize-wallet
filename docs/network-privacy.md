# Network privacy

What Cashonize sends over the network and to whom: analytics, the servers it talks to, dApp
relays and token images. On-chain privacy, what the blockchain itself reveals, is a separate
topic. Read this before adding a request to a new host, or changing what an existing one is sent.

## Analytics

**Only the web wallet counts visits, and only as one pageview per load.** `src/boot/plausible.ts`
posts to plausible.io with the URL stripped to origin and path, since a `?uri=` deep link can hold a
private key, and the referrer stripped to its origin. Nothing tracks what the user does in the
app. The desktop and Android apps send no analytics at all.

## Servers

**The servers that answer for the chain and the token data are the user's choice.** Electrum,
Chaingraph, the token metadata (BCMR) indexer, the Cauldron indexer, the IPFS gateway and the
exchange rate provider are selectable in the advanced settings, from predefined choices or, for
most, a custom URL. Each one sees the requests made of it: an electrum server learns every
address the wallet subscribes to, the indexers the tokens it looks up.

**A few hosts are fixed:**
- the desktop app checks GitHub's releases API for a newer version;
- the chipnet Cauldron indexer has no alternative to choose from;
- the dApp relays below.

## dApp relays

**Each dApp protocol talks through relays the user doesn't choose**, which see who connects,
when, and how much is sent, though not the encrypted content:
- **WalletConnect** uses Reown's relay, and looks up each dApp's domain with Reown's Verify
  service. Its telemetry, on by default, is turned off, including the start-up event (client id and
  user agent) that WalletKit sends to Reown's pulse service regardless of that setting.
- **CashConnect** uses a single Nostr relay, `nostr.infra.cash`, the library's default; pairing
  links naming another relay are refused.
- **WizardConnect** uses Nostr relays from the dApp's pairing link or the library's defaults.

**A WalletConnect message signature reaches Reown's relay unencrypted.** sign-client sends the
result of every request, outside the encrypted payload, as a "transaction hash" when it is a
string, which a `bch_signMessage` signature is. A signature over a known message reveals the
signing address. Tracked in #399.

## Token images and registries

**Token icons and NFT images come from hosts chosen by each token's issuer**, in its metadata.
IPFS images go through the configured gateway, but https images load straight from the issuer's
host, which then learns the user's IP and which token is shown. The "Disable token image loading"
setting turns off token icons and NFT images alike.

**The identities page fetches each identity's registry file** from the location its on-chain
publication names, over https or through the IPFS gateway, so that host sees the request too.
