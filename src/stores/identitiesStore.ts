// Everything the wallet knows about the identities it follows: which ones are listed, where each
// one's authhead sits now, what its published metadata serves, and the AuthKeys and guards around it.
// Split out of the main store the way the dapp-connection stores are, reaching back to it for the
// wallet, its coins and the reservations - because holding a coin back is the main store's job,
// and deciding which coin that is, is this one's.

import { defineStore } from "pinia"
import { ref } from 'vue'
import { useStore } from "./store"
import { useSettingsStore } from "./settingsStore"
import {
  resolveIdentities,
  fetchAuthchainLinks,
  findPublication,
  type AuthchainBackends,
  describeChainLinks,
  identityBehindAuthKey,
  type IdentityState,
  type IdentityStatus,
  type DescribedLink,
} from "src/utils/tools/authchainIdentity"
import {
  loadIdentityList,
  addToIdentityList,
  removeFromIdentityList,
  saveIdentityList,
  clearIdentityList,
} from "src/utils/tools/identityLists"
import { checkPublicationUri, fetchVerifiedRegistry, registryAuthbases, type PublicationUriStatus } from "src/utils/tools/registryFile"
import { detectIdentities, type DetectedIdentity } from "src/utils/tools/identityDetection"
import { checkReservedInputs, type SignedInput, type SignedOutput } from "src/utils/dapp/reservedInputs"
import type { TransactionHistoryItem, Utxo } from "mainnet-js"
import { outpointOf, type Outpoint } from "src/utils/wallet/reservedUtxos"
import { isAuthKey, STUDIO_KEY_COMMITMENT } from "src/utils/tools/authGuard"
import { truncateHash } from "src/utils/utils"
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global


// How an identity the wallet holds back unasked came to be its own: made with these keys, held
// through its AuthKey, its coin found here, or a watched one arrived. The dialog reads the arrival
// for its title and the AuthKey for what it says is held back.
export type FoundSource = 'made' | 'key' | 'held' | 'arrived';

export const useIdentitiesStore = defineStore('identities', () => {
  const mainStore = useStore()
  const settingsStore = useSettingsStore()

  // The identities the wallet follows, by authbase: the ones it holds and the ones it only
  // watches, tokens or not. Only the categories persist; where each authhead sits now is
  // rebuilt from Chaingraph every time (see utils/tools/authchainIdentity.ts).
  const identityCategories = ref([] as string[]);
  // Categories the user took off the list, which the automatic detection must not put back
  const dismissedIdentities = ref([] as string[]);
  // Listed by the wallet itself and not yet seen: what the marker on the wallet tools entry is
  // for, and what marks the cards as found automatically on the visit that clears it
  const unseenIdentities = ref([] as string[]);
  // The listed identities held elsewhere at the last complete resolve. Kept so that a watched
  // identity whose authhead, or whose AuthKey, arrives while the app is closed is told as the arrival
  // it is; the resolve is the only writer and the only reader.
  const watchedIdentities = ref([] as string[]);
  // The wallet's own transactions that carried a metadata publication, read off the same walk, so
  // the history can tell a metadata update from the wallet's other identity operations
  const identityPublicationTxids = ref([] as string[]);
  const identities = ref(undefined as (IdentityState[] | undefined));
  // The identity of every token this wallet holds, followed passively: not listed, not reserved,
  // never news. What it is for is noticing an authhead arriving here, which promotes the identity
  // to the list.
  const tokenIdentities = ref(undefined as (IdentityState[] | undefined));
  // a first open on a wallet holding hundreds of categories does a bounded amount of work
  const followedPerOpenCap = 100;
  // What each listed identity's published registry locations actually serve, keyed by category.
  // Kept beside the identities rather than on them: resolution reads the chain, this reads the
  // hosting, and one can be present without the other.
  const publicationChecks = ref({} as Record<string, PublicationUriStatus[]>);
  const publicationChecksRunning = ref(false);
  // One resolve at a time: a pass writes the identities list and the 'auth' reservations derived
  // from it whole, so two overlapping passes would undo each other's result. A pass asked for
  // while one runs waits its turn rather than being dropped: an add, or the resolve after the
  // page's own operation, must happen however long the follow tier's lookups take.
  let resolveQueue: Promise<unknown> = Promise.resolve();
  function withResolveLock<T>(pass: () => Promise<T>): Promise<T> {
    const run = resolveQueue.then(pass);
    resolveQueue = run.catch(() => undefined);
    return run;
  }

  // The persisted lists are per wallet per network, so every write names the pair
  const walletKey = () => [mainStore.network, mainStore.wallet.name] as const;
  // authority over the identity, directly or through its AuthKey
  const heldStatuses: IdentityStatus[] = ['held', 'heldViaKey'];
  const listCategory = (category: string) => {
    identityCategories.value = addToIdentityList('categories', ...walletKey(), category);
  };

  // Called when a wallet becomes the active one: the lists are its own, and everything derived
  // from the chain starts empty rather than carrying the last wallet's answers.
  function loadForWallet(network: 'mainnet' | 'chipnet', walletName: string) {
    identityCategories.value = loadIdentityList('categories', network, walletName);
    dismissedIdentities.value = loadIdentityList('dismissed', network, walletName);
    unseenIdentities.value = loadIdentityList('unseen', network, walletName);
    watchedIdentities.value = loadIdentityList('watched', network, walletName);
    identities.value = undefined;
    tokenIdentities.value = undefined;
    identityPublicationTxids.value = [];
    announcement.value = undefined;
    openCheckError.value = undefined;
    publicationChecks.value = {};
    publicationsTried = [];
    identityHistories.value = {};
    // a pass still running belongs to the last wallet and writes nothing more; it must not hold
    // this wallet's first resolve back
    resolveQueue = Promise.resolve();
  }

  // Identities these keys made, found in the walk rather than asked for. This is the one place
  // the wallet lists something the user did not: the creator whose authhead sits here as an
  // anonymous coin is exactly the one who never opens the page, and an ordinary send spends it.
  // Deliberately amends the rule that only listed identities are reserved: the walk is evidence,
  // not a guess, and the coin is an authhead.
  function listDetectedIdentities(detected: DetectedIdentity[]) {
    const heldAuthheads = (mainStore.walletUtxos ?? []).filter(utxo => utxo.vout === 0);
    const found = detected.filter(identity => heldAuthheads.some(utxo => utxo.txid === identity.authheadTxid));
    const listed: string[] = [];
    for (const identity of found) {
      // a chain the markers cannot name is not listed: a non-token identity is listed by the
      // user adding its authbase, on each device
      if (!identity.category) continue;
      if (dismissedIdentities.value.includes(identity.category)) continue;
      if (identityCategories.value.includes(identity.category)) continue;
      listCategory(identity.category);
      listed.push(identity.category);
    }
    // news, cleared by the next visit
    if (listed.length) unseenIdentities.value = addToIdentityList('unseen', ...walletKey(), listed);
    return listed;
  }

  // What the wallet held back without being asked, to be told in a dialog with names, and how
  // each came to be this wallet's, since the dialog says the true thing per row: made with these
  // keys, held through its AuthKey, its coin here, or a watched one arrived. Set after the resolve so
  // the dialog can say what each carries; announcements close together accumulate, and the wallet
  // page opens one dialog for them and clears this.
  const announcement = ref<{ ids: string[]; sources: Record<string, FoundSource> } | undefined>(undefined);
  function announceFound(found: Record<string, FoundSource>) {
    const ids = Object.keys(found);
    if (!ids.length) return;
    const pending = announcement.value ?? { ids: [], sources: {} };
    announcement.value = {
      ids: [...pending.ids, ...ids.filter(id => !pending.ids.includes(id))],
      sources: { ...pending.sources, ...found },
    };
  }
  // what the dialog says, taken and cleared in one step
  function takeAnnouncement() {
    const pending = announcement.value;
    announcement.value = undefined;
    return pending;
  }
  // the dialog's Learn more opens the page on its learn text; the page takes the request on its visit
  let learnRequested = false;
  function requestLearn() { learnRequested = true; }
  function takeLearnRequest() {
    const requested = learnRequested;
    learnRequested = false;
    return requested;
  }
  // The token list points at one identity's card rather than at the page: an AuthKey row is a
  // pointer to what the identities page already does, so it lands where the work happens.
  let cardRequested: { category: string; action?: string } | undefined;
  function requestIdentityCard(category: string, action?: string) { cardRequested = { category, ...(action ? { action } : {}) }; }
  function takeCardRequest() {
    const requested = cardRequested;
    cardRequested = undefined;
    return requested;
  }

  // The registries of what is about to be shown, fetched so a dialog or the page can name it. A
  // fetch that fails leaves the id standing in for the name, which is honest, so it never throws.
  async function fetchMetadataFor(categories: string[]) {
    const missing = categories
      .filter(category => identityCategories.value.includes(category) && !mainStore.bcmrRegistries?.[category])
      .map(category => ({ category, amount: 0n }));
    if (!missing.length) return;
    try {
      await mainStore.fetchTokenMetadata(missing, false);
    } catch (error) {
      console.error("Failed to fetch metadata for identities:", error);
    }
  }

  // A publication whose identity output carries no token, an identity received by transfer say,
  // is named by the registry it commits to. The file is trusted for nothing: the hash proves its
  // bytes and the forward resolve proves the match. Only this wallet's own publications are
  // fetched, so the host reached is one the user published to.
  const namedPerRegistryCap = 20;
  // once per session, so a file no location serves is not asked for at every open
  let publicationsTried: string[] = [];
  async function nameFromPublications(detected: DetectedIdentity[]): Promise<DetectedIdentity[]> {
    const heldAuthheads = (mainStore.walletUtxos ?? []).filter(utxo => utxo.vout === 0).map(utxo => utxo.txid);
    // nothing to match against, so nothing to fetch
    if (!heldAuthheads.length) return [];
    const listedChains = identities.value ?? [];
    const unnamed = detected.filter(identity =>
      !identity.category && identity.publicationOutputs?.length && !publicationsTried.includes(identity.authheadTxid)
      && !listedChains.some(listed => listed.authheadTxid === identity.authheadTxid || listed.recentLinks?.includes(identity.authheadTxid))
    );
    const named: DetectedIdentity[] = [];
    for (const identity of unnamed) {
      publicationsTried.push(identity.authheadTxid);
      const publication = findPublication(identity.publicationOutputs ?? []);
      if (!publication) continue;
      const content = await fetchVerifiedRegistry(publication.uris, publication.hash, settingsStore.ipfsGateway);
      if (content === undefined) continue;
      const authbases = registryAuthbases(content)
        .filter(authbase => !identityCategories.value.includes(authbase) && !dismissedIdentities.value.includes(authbase))
        .slice(0, namedPerRegistryCap);
      if (!authbases.length) continue;
      // Chaingraph alone, like the followed tokens: chains nobody asked for are not walked at open
      const resolved = await resolve(authbases, { electrum: false, recentLinks: false });
      // any held coin, not the publication's own output: the identity may have moved since. A file
      // naming several identities held here names one of them, see the docs' future items
      const match = resolved.find(candidate => candidate.authheadTxid !== undefined && heldAuthheads.includes(candidate.authheadTxid));
      if (match?.authheadTxid) named.push({ authheadTxid: match.authheadTxid, category: match.category, marker: 'publication' });
    }
    return named;
  }

  // Protection first, so it never waits on naming; the announcement last, so it has names to say
  async function detectWalletIdentities(history: TransactionHistoryItem[]) {
    const started = mainStore.currentInitializationToken();
    const detected = detectIdentities(history);
    if (mainStore.walletSwitchedSince(started)) return;
    identityPublicationTxids.value = detected.publicationTxids;
    const unseenBefore = unseenIdentities.value;
    if (listDetectedIdentities(detected.identities).length) await refreshIdentities();
    // the chains the markers could not name, named from their files after the rest is held back
    const named = await nameFromPublications(detected.identities);
    if (mainStore.walletSwitchedSince(started)) return;
    if (listDetectedIdentities(named).length) await refreshIdentities();
    // what this pass added to the unseen list
    const toAnnounce = unseenIdentities.value.filter(id => !unseenBefore.includes(id));
    if (!toAnnounce.length) return;
    await fetchMetadataFor(toAnnounce);
    if (mainStore.walletSwitchedSince(started)) return;
    announceFound(Object.fromEntries(toAnnounce.map(id => [id, 'made' as const])));
  }

  // Where the chains are looked up, as the wallet is configured now. The electrum walk stands in
  // for Chaingraph where an answer is owed, and for the followed tokens only on a network with no
  // instance configured: those are many and nobody asked for them, so an instance that is down
  // is reported as an outage rather than walked around at every open until it is back.
  function authchainBackends(withElectrum = true): AuthchainBackends {
    return {
      chaingraphUrl: mainStore.chaingraph,
      ...(withElectrum ? { provider: mainStore.wallet.provider } : {}),
      prefix: mainStore.wallet.networkPrefix,
    };
  }

  // Every resolve in this store asks the same way, so only what varies is named: whether the
  // electrum walk stands in when Chaingraph does not answer, whether the recent links come along,
  // which only the listed identities need for the transaction history, and which view of the
  // wallet's coins to read, where a caller already holds the one it guarded on.
  function resolve(
    categories: string[],
    options: { electrum?: boolean; recentLinks?: boolean; utxos?: Utxo[] } = {},
  ) {
    const { electrum = true, recentLinks = true, utxos = mainStore.walletUtxos ?? [] } = options;
    return resolveIdentities(categories, authchainBackends(electrum), utxos, extraKeyCategories, recentLinks);
  }

  // An identity's own history, which is the chain itself: what each link did, and the reserve
  // read down the list, which is the issuance schedule. One query, and only when a card asks for
  // it: this is the one identity query that grows with a chain's length. Keyed by the authhead
  // the chain was fetched at, so once the authhead moves the entry is simply not the one asked for.
  const identityHistories = ref({} as Record<string, DescribedLink[]>);

  async function fetchIdentityHistory(identity: IdentityState) {
    const authhead = identity.authheadTxid;
    if (!authhead || identityHistories.value[authhead]) return;
    const links = await fetchAuthchainLinks(identity.category, authchainBackends());
    identityHistories.value = {
      ...identityHistories.value,
      [authhead]: describeChainLinks(links),
    };
  }

  // The page has been opened, so what it found on its own is no longer news
  function markIdentitiesSeen() {
    const unseen = unseenIdentities.value;
    clearIdentityList('unseen', ...walletKey());
    unseenIdentities.value = [];
    return unseen;
  }

  // Which AuthKey opens an identity's covenant, beyond its own category: an identity that adopted a
  // guard after its genesis names its AuthKey in the registry, and the indexer's copy carries that
  function extraKeyCategories(category: string): string[] {
    const authNft = mainStore.bcmrRegistries?.[category]?.extensions?.authNft;
    if (typeof authNft !== 'string' || !/^[0-9a-f]{64}$/i.test(authNft)) return [];
    return [authNft.toLowerCase()];
  }

  // Earlier versions listed an AuthKey's own category, which names nothing and publishes nothing.
  // The listing is corrected to the identity that AuthKey guards, quietly: what is on the list does
  // not change, only which of the two categories names it.
  async function relistAuthKeysAsIdentities(resolved: IdentityState[]): Promise<IdentityState[]> {
    const swaps = resolved.flatMap(identity => {
      const guarded = identityBehindAuthKey(identity);
      return guarded ? [{ key: identity.category, guarded }] : [];
    });
    if (!swaps.length) return resolved;
    const toResolve: string[] = [];
    for (const swap of swaps) {
      identityCategories.value = removeFromIdentityList('categories', ...walletKey(), swap.key);
      unseenIdentities.value = removeFromIdentityList('unseen', ...walletKey(), swap.key);
      if (dismissedIdentities.value.includes(swap.guarded)) continue;
      if (!identityCategories.value.includes(swap.guarded)) listCategory(swap.guarded);
      if (!toResolve.includes(swap.guarded)) toResolve.push(swap.guarded);
    }
    const corrected = toResolve.length
      ? await resolve(toResolve)
      : [];
    const replaced = swaps.map(swap => swap.key);
    return [...resolved.filter(identity => !replaced.includes(identity.category)), ...corrected];
  }

  // Re-resolved rather than restored: an authhead moves to a new outpoint whenever the metadata is
  // updated elsewhere. One owner for both the list and the 'auth' reservations rewritten from it.
  // Returns what it held back that the user did not ask for: a watched identity whose authhead,
  // or whose AuthKey, has arrived; the caller announces them. Watched means held elsewhere at the
  // last complete resolve, whichever session that was: the coin usually arrives while the app is
  // closed. An incomplete resolve says nothing about where anything is, so it leaves the record.
  async function resolveListedIdentities(): Promise<string[]> {
    const news: string[] = [];
    const currentUtxos = mainStore.walletUtxos;
    if (!currentUtxos) return news;
    if (!identityCategories.value.length) {
      identities.value = [];
      // a complete resolve of nothing: nothing is watched, and the sync still runs, clearing an
      // 'auth' reservation left behind by an identity no longer listed
      watchedIdentities.value = saveIdentityList('watched', ...walletKey(), []);
      await syncAuthReservations([]);
      return news;
    }
    const started = mainStore.currentInitializationToken();
    let resolved = await resolve(identityCategories.value, { utxos: currentUtxos });
    if (mainStore.walletSwitchedSince(started)) return news;
    resolved = await relistAuthKeysAsIdentities(resolved);
    if (mainStore.walletSwitchedSince(started)) return news;
    if (!resolved.some(identity => identity.status === 'unresolved')) {
      for (const identity of resolved) {
        if (heldStatuses.includes(identity.status) && watchedIdentities.value.includes(identity.category)) news.push(identity.category);
      }
      const watched = resolved.filter(identity => identity.status === 'notHeld').map(identity => identity.category);
      watchedIdentities.value = saveIdentityList('watched', ...walletKey(), watched);
    }
    // the checks answer for one publication, by position in its locations: once the publication
    // changed, they would land on the new locations, so they go until the next check runs
    const checks = { ...publicationChecks.value };
    for (const identity of resolved) {
      const before = identities.value?.find(listed => listed.category === identity.category);
      if (before?.publication?.hash !== identity.publication?.hash) delete checks[identity.category];
    }
    publicationChecks.value = checks;
    // an identity added while this pass ran keeps the state it was added with until the next pass
    const passed = resolved.map(identity => identity.category);
    const addedMeanwhile = (identities.value ?? []).filter(
      listed => identityCategories.value.includes(listed.category) && !passed.includes(listed.category)
    );
    identities.value = [...resolved, ...addedMeanwhile];
    await syncAuthReservations(resolved);
    return news;
  }

  // The news a resolve found is announced here, so every path that resolves tells the user the
  // same way; a caller inside a locked pass calls resolveListedIdentities itself
  async function refreshIdentities() {
    const news = await withResolveLock(resolveListedIdentities);
    if (news.length) {
      await fetchMetadataFor(news);
      announceFound(Object.fromEntries(news.map(id => [id, 'arrived' as const])));
    }
  }

  // Holds back every authhead this wallet has. A resolve adds protection and never releases a
  // coin the wallet still holds: a held authhead stays the authhead until spent, and Chaingraph
  // can be behind the wallet's own transaction. Nothing is released while an identity is
  // unresolved either. Every write checks for a wallet switch first.
  async function syncAuthReservations(resolved: IdentityState[]) {
    const started = mainStore.currentInitializationToken();
    const authOutpoints: Outpoint[] = [];
    for (const identity of resolved) {
      // the identity output when this wallet holds it, the AuthKey when a covenant does: either
      // way it is the coin the authority rides on, and one AuthKey can carry several identities
      const keyCoin = identity.authUtxo ?? identity.keyUtxo;
      if (keyCoin) authOutpoints.push(outpointOf(keyCoin));
    }
    // A reservation already made for another reason is left alone: the coin is held back either
    // way, and rewriting the reason would take it away from whatever made it
    const toReserve = authOutpoints.filter(outpoint => !mainStore.reservedUtxos[outpoint]);
    if (mainStore.walletSwitchedSince(started)) return;
    if (toReserve.length) await mainStore.reserveOutpoints(toReserve, 'auth');
    if (resolved.some(identity => identity.status === 'unresolved')) return;
    // Never dropped: the coins above, the coins the wallet holds, and every resolved identity's
    // output, whether the wallet's coins show it yet or not: its own view can trail the
    // transaction it just made
    const kept = [
      ...authOutpoints,
      ...(mainStore.walletUtxos ?? []).map(outpointOf),
      ...resolved.flatMap(identity => identity.authheadTxid ? [`${identity.authheadTxid}:0`] : []),
    ];
    for (const [outpoint, reason] of Object.entries(mainStore.reservedUtxos)) {
      if (reason !== 'auth') continue;
      if (kept.includes(outpoint)) continue;
      if (mainStore.walletSwitchedSince(started)) return;
      await mainStore.dropReservation(outpoint);
    }
  }

  // Every category failing the same way is the server being down, not a hundred separate
  // answers; the one reason is what the caller should show
  function outageReason(resolved: IdentityState[]) {
    if (!resolved.length || !resolved.every(identity => identity.status === 'unresolved')) return undefined;
    return resolved[0]?.unresolvedReason;
  }

  // The identities the resolved AuthKeys guard, resolved in their turn; the covenant is recognised
  // from the AuthKey this wallet holds. A chain that names itself is kept as it resolved.
  async function resolveBehindAuthKeys(resolvedKeys: IdentityState[], withElectrum: boolean): Promise<IdentityState[]> {
    const kept: IdentityState[] = [];
    const behind: string[] = [];
    for (const resolved of resolvedKeys) {
      const guarded = identityBehindAuthKey(resolved);
      if (!guarded) {
        kept.push(resolved);
        continue;
      }
      if (dismissedIdentities.value.includes(guarded) || identityCategories.value.includes(guarded)) continue;
      if (!behind.includes(guarded)) behind.push(guarded);
    }
    // a batch carrying both an AuthKey and its identity's own token resolved that identity already
    const missing = behind.filter(category => !kept.some(identity => identity.category === category));
    if (!missing.length) return kept;
    const resolved = await resolve(missing, { electrum: withElectrum, recentLinks: false });
    return [...kept, ...resolved];
  }

  // The identities of the tokens this wallet holds, followed: every held category at open, up to
  // the cap, and all of them on the page's visit. Resolving only what was never looked up would
  // leave the group half filled until the visit, since the states themselves are not persisted.
  // Nothing is listed or reserved here except an identity whose authhead, or whose AuthKey, turns
  // out to be in this wallet, which is promoted and announced.
  async function followTokenIdentities(scope: 'open' | 'all' | 'keys') {
    await withResolveLock(async () => {
      const currentUtxos = mainStore.walletUtxos;
      if (!currentUtxos) return;
      const held = (mainStore.tokenList ?? [])
        .map(token => token.category)
        .filter(category => !identityCategories.value.includes(category) && !dismissedIdentities.value.includes(category));
      // Which of them to ask: every held category on a visit, up to the cap at open, and with
      // following off only the categories a held NFT of a Studio AuthKey's shape belongs to, so an
      // AuthKey handed to this wallet is recognised and held back whatever the setting says.
      let categories = held;
      if (scope === 'open') categories = held.slice(0, followedPerOpenCap);
      if (scope === 'keys') {
        categories = held.filter(category => currentUtxos.some(utxo => isAuthKey(utxo, category, STUDIO_KEY_COMMITMENT)));
      }
      const started = mainStore.currentInitializationToken();
      const withElectrum = scope === 'keys' || !mainStore.chaingraph;
      let resolved: IdentityState[] = [];
      if (categories.length) {
        resolved = await resolve(categories, { electrum: withElectrum, recentLinks: false, utxos: currentUtxos });
        // An AuthKey's chain ends at the authhead of the identity it guards, so what was asked
        // about was the AuthKey and what comes back names the identity: it is that identity, with
        // its own metadata, that belongs on the list. In every scope, since a held AuthKey is a
        // held token category like any other and reaches the ordinary batch when following is on.
        resolved = await resolveBehindAuthKeys(resolved, withElectrum);
      }
      if (mainStore.walletSwitchedSince(started)) return;
      const outage = outageReason(resolved);
      if (outage && scope === 'open') openCheckError.value = outage;
      // what was not asked this time keeps its last answer, as long as the token is still held
      const next = (tokenIdentities.value ?? []).filter(
        identity => held.includes(identity.category) && !categories.includes(identity.category)
      );
      const promoted: Record<string, FoundSource> = {};
      for (const identity of resolved) {
        if (identity.status === 'unresolved' || !identity.authheadTxid) {
          const previous = tokenIdentities.value?.find(known => known.category === identity.category);
          if (previous) next.push(previous);
          continue;
        }
        // an identity whose output, or whose AuthKey, is here is this wallet's to look after
        if (heldStatuses.includes(identity.status)) {
          listCategory(identity.category);
          promoted[identity.category] = identity.status === 'heldViaKey' ? 'key' : 'held';
          continue;
        }
        next.push(identity);
      }
      if (mainStore.walletSwitchedSince(started)) return;
      tokenIdentities.value = next;
      const promotedIds = Object.keys(promoted);
      if (!promotedIds.length) return;
      unseenIdentities.value = addToIdentityList('unseen', ...walletKey(), promotedIds);
      // the same resolve can find a watched identity arrived, which is told with the promotions
      const arrived = await resolveListedIdentities();
      await fetchMetadataFor([...promotedIds, ...arrived]);
      if (mainStore.walletSwitchedSince(started)) return;
      announceFound({ ...promoted, ...Object.fromEntries(arrived.map(id => [id, 'arrived' as const])) });
    });
  }

  // The setting turned on: the lookups start now rather than on the page's next visit, and the
  // page says they are running until they are done rather than showing the keys-only answer
  async function startFollowingTokenIdentities() {
    tokenIdentities.value = undefined;
    try {
      await followTokenIdentities('all');
    } catch (error) {
      console.error("Failed to look up the identities of the held tokens:", error);
      tokenIdentities.value ??= [];
    }
  }

  // What went wrong in a pass the wallet ran on its own at open, shown on the page where the
  // result would be rather than toasted on every open; cleared by the next pass that runs
  const openCheckError = ref<string | undefined>(undefined);

  // The passes the wallet runs on its own once a wallet is up: the reading of its history for
  // the identities these keys made, and the followed token identities.
  // Outside the wallet's own failure path: a lookup failing here, an electrum server refusing a
  // guard address say, must not flag a wallet that did load, so it is reported where the
  // identities are. The resolve of what the wallet follows comes first, since the detection
  // lists against it.
  async function runChecksOnOpen() {
    const started = mainStore.currentInitializationToken();
    openCheckError.value = undefined;
    try {
      await refreshIdentities();
      const history = await mainStore.fullWalletHistory();
      if (mainStore.walletSwitchedSince(started)) return;
      await detectWalletIdentities(history);
      await followTokenIdentities(settingsStore.followTokenIdentities ? 'open' : 'keys');
    } catch (error) {
      console.error("Failed to look up the wallet's identities:", error);
      if (mainStore.walletSwitchedSince(started)) return;
      openCheckError.value = error instanceof Error ? error.message : String(error);
    }
  }

  // Fetches every listed identity's published locations and compares what they serve against the
  // hash on chain. Only ever on the user opening the page: this reaches out to the identity's
  // hosting, which is not something to do quietly in the background on every wallet start.
  async function checkPublications() {
    const listed = identities.value?.filter(identity => identity.publication) ?? [];
    if (!listed.length) return;
    publicationChecksRunning.value = true;
    try {
      const started = mainStore.currentInitializationToken();
      const checked = await Promise.all(listed.map(async identity => {
        const publication = identity.publication!;
        const checks = await Promise.all(publication.uris.map(
          uri => checkPublicationUri(uri, publication.hash, settingsStore.ipfsGateway)
        ));
        return [identity.category, checks] as const;
      }));
      if (mainStore.walletSwitchedSince(started)) return;
      publicationChecks.value = Object.fromEntries(checked);
    } finally {
      publicationChecksRunning.value = false;
    }
  }

  // The identities an AuthKey of this category guards, so the token list can render a key as what
  // it is rather than as an NFT with no metadata. Empty for anything that is not a confirmed AuthKey.
  function identitiesGuardedByKey(keyCategory: string) {
    return identities.value?.filter(
      identity => identity.keyUtxo?.token?.category === keyCategory
    ) ?? [];
  }

  // The identity of a token this wallet holds the authority over, directly or through an AuthKey, so
  // the token list can say so beside the token and point here. Nothing for a watched identity.
  function heldIdentityOf(category: string) {
    const identity = identities.value?.find(identity => identity.category === category);
    if (!identity) return undefined;
    return heldStatuses.includes(identity.status) ? identity : undefined;
  }

  // What the token list says beside such a token. Holding the identity's UTXO and holding its
  // AuthKey are both control, and which one it is belongs on the card rather than in a row; so
  // does the reserve, which the row's balance already leaves out.
  function heldIdentityLine(category: string): string | undefined {
    return heldIdentityOf(category) ? t('tokenItem.identity.held') : undefined;
  }

  // What the dapp signing paths ask before refusing a request that spends a held back coin: the
  // identity coins are named here, and the rule itself lives in utils/dapp/reservedInputs.ts.
  function checkDappReservedInputs(inputs: readonly SignedInput[], outputs: readonly SignedOutput[]) {
    const listed = identities.value ?? [];
    const identityKeys = listed.flatMap(identity => identity.keyUtxo ? [outpointOf(identity.keyUtxo)] : []);
    const authheads = listed.flatMap(identity => identity.authUtxo ? [outpointOf(identity.authUtxo)] : []);
    return checkReservedInputs(inputs, outputs, {
      reservedUtxos: mainStore.reservedUtxos,
      walletUtxos: mainStore.walletUtxos ?? [],
      identityKeys,
      authheads,
      allowIdentitySpends: settingsStore.allowDappIdentitySpends,
      ownsOutput: output => mainStore.ownsLockingBytecode(output.lockingBytecode),
    });
  }

  // What a dapp refusal or approval calls an identity coin: the identity's name, its category
  // failing that, and the unnamed label for a coin no listed identity accounts for
  function identityNameAt(outpoint: Outpoint): string {
    const identity = (identities.value ?? []).find(
      listed => listed.authUtxo && outpointOf(listed.authUtxo) === outpoint
    );
    if (!identity) return t('identities.unnamedIdentity');
    return mainStore.bcmrRegistries?.[identity.category]?.name ?? truncateHash(identity.category);
  }

  // Where an identity the user is about to add sits, before it is listed: the page says whether
  // it is held here, guarded, or somebody else's, and lists it on the user's word. An AuthKey's
  // category pasted here names the identity it guards, which is what gets listed.
  async function inspectCategory(category: string): Promise<IdentityState> {
    const [found] = await resolve([category], { recentLinks: false });
    if (!found) return { category, status: 'unresolved' };
    const guarded = identityBehindAuthKey(found);
    if (!guarded) return found;
    const [identity] = await resolve([guarded], { recentLinks: false });
    return identity ?? found;
  }

  // Listed and shown from the resolve the confirm was read from, so the card is there when the
  // dialog closes and its coin is held back from that answer; the pass this queues re-resolves
  // everything in its turn, behind whatever lookups are running, without the add waiting on it.
  async function addIdentity(category: string, found: IdentityState) {
    // adding by hand undoes a dismissal: the user changed their mind, which is the whole point
    dismissedIdentities.value = removeFromIdentityList('dismissed', ...walletKey(), category);
    listCategory(category);
    identities.value = [...(identities.value ?? []).filter(listed => listed.category !== category), found];
    const coin = found.authUtxo ?? found.keyUtxo;
    if (coin && !mainStore.reservedUtxos[outpointOf(coin)]) await mainStore.reserveOutpoints([outpointOf(coin)], 'auth');
    refreshIdentities().catch(error => console.error("Failed to resolve the added identity:", error));
  }

  // An identity this wallet just created, token or not: its authhead is output 0 of the
  // transaction, so the coin is held back straight away rather than when Chaingraph or this
  // wallet's own view catches up. The resolve after it is a lookup that can fail, and the
  // identity is listed and held back whether or not it does: a failure is not the caller's.
  async function listCreatedIdentity(category: string, authheadTxId: string) {
    dismissedIdentities.value = removeFromIdentityList('dismissed', ...walletKey(), category);
    listCategory(category);
    const outpoint = `${authheadTxId}:0`;
    if (!mainStore.reservedUtxos[outpoint]) await mainStore.reserveOutpoints([outpoint], 'auth');
    try {
      // the resolve reads the wallet's coins, which must include the one just made
      await mainStore.updateWalletUtxos();
      await refreshIdentities();
    } catch (error) {
      console.error("Failed to resolve the created identity:", error);
    }
  }

  // A removal is remembered, so the automatic detection does not put the identity back on the
  // next wallet open. Not after a transfer: the user gave the identity away rather than took it
  // off the list, and should it ever come back here, it is to be held back again like any find.
  async function removeIdentity(category: string, reason: 'dismissed' | 'transferred' = 'dismissed') {
    if (reason === 'dismissed') {
      dismissedIdentities.value = addToIdentityList('dismissed', ...walletKey(), category);
    }
    const removed = identities.value?.find(identity => identity.category === category);
    identityCategories.value = removeFromIdentityList('categories', ...walletKey(), category);
    identities.value = identities.value?.filter(identity => identity.category !== category);
    // the coin the authority rode on is released with the identity: the output, or an AuthKey that no
    // other listed identity is still opened by
    const keyCoin = removed?.authUtxo ?? removed?.keyUtxo;
    if (!keyCoin) return;
    const outpoint = outpointOf(keyCoin);
    const stillOpens = (identities.value ?? []).some(listed => listed.keyUtxo && outpointOf(listed.keyUtxo) === outpoint);
    if (stillOpens) return;
    if (mainStore.reservedUtxos[outpoint] === 'auth') await mainStore.dropReservation(outpoint);
  }

  return {
    identityCategories,
    unseenIdentities,
    announcement,
    takeAnnouncement,
    requestLearn,
    takeLearnRequest,
    requestIdentityCard,
    takeCardRequest,
    identityPublicationTxids,
    identities,
    tokenIdentities,
    publicationChecks,
    publicationChecksRunning,
    identityHistories,
    loadForWallet,
    refreshIdentities,
    followTokenIdentities,
    startFollowingTokenIdentities,
    openCheckError,
    runChecksOnOpen,
    fetchMetadataFor,
    detectWalletIdentities, // only runChecksOnOpen calls it; exposed so the tests can hand it a walk

    identitiesGuardedByKey,
    heldIdentityOf,
    heldIdentityLine,
    checkDappReservedInputs,
    identityNameAt,
    inspectCategory,
    checkPublications,
    fetchIdentityHistory,
    markIdentitiesSeen,
    addIdentity,
    listCreatedIdentity,
    removeIdentity,
  }
})
