// Everything the wallet knows about the identities it follows: which ones are listed, where each
// one's authhead sits now, what its published metadata serves, and the keys and guards around it.
// Split out of the main store the way the dapp-connection stores are, reaching back to it for the
// wallet, its coins and the reservations - because holding a coin back is the main store's job,
// and deciding which coin that is, is this one's.

import { defineStore } from "pinia"
import { ref, computed } from 'vue'
import type { Utxo } from "mainnet-js"
import { useStore } from "./store"
import { useSettingsStore } from "./settingsStore"
import {
  loadIdentityList,
  addToIdentityList,
  removeFromIdentityList,
  clearIdentityList,
  resolveIdentities,
  describeChainLinks,
  checkPublicationUri,
  type IdentityState,
  type IdentityStatus,
  type DescribedLink,
  type PublicationUriStatus,
  nameChainFromRegistry,
  loadFollowed,
  saveFollowed,
  type FollowedIdentities,
} from "src/utils/tools/authchainIdentity"
import { detectIdentities, type DetectedIdentity } from "src/utils/tools/identityDetection"
import { queryAuthchainLinks, type ChaingraphSpentOutput } from "src/queryChainGraph"
import { outpointOf } from "src/utils/wallet/reservedUtxos"
import { formatTokenAmountFromBigInt } from "src/utils/utils"
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global


export const useIdentitiesStore = defineStore('identities', () => {
  const mainStore = useStore()
  const settingsStore = useSettingsStore()

  // Token categories whose authhead this wallet keeps custody of, and where those authheads sit
  // now. Only the categories persist, the resolved state is rebuilt from Chaingraph every time
  // (see utils/tools/authchainIdentity.ts).
  const identityCategories = ref([] as string[]);
  // Categories the user took off the list, which the automatic detection must not put back
  const dismissedIdentities = ref([] as string[]);
  // Listed by the wallet itself and not yet seen: what the marker on the wallet tools entry is
  // for, and what marks the cards as found automatically on the visit that clears it
  const unseenIdentities = ref([] as string[]);
  // Authheads held here that the detection could not name, by txid. Protected either way: naming
  // is a convenience, an unspendable coin is the point. Each is asked its registry once per session, on the page's visit.
  const unnamedAuthheads = ref([] as string[]);
  let triedThisSession: string[] = [];
  // The wallet's own transactions that carried a metadata publication, read off the same walk, so
  // the history can tell a metadata update from the wallet's other identity operations
  const identityPublicationTxids = ref([] as string[]);
  const identities = ref(undefined as (IdentityState[] | undefined));
  // The identity of every token this wallet holds, followed passively: not listed, not reserved,
  // never news. What it is for is noticing an authhead arriving here, which promotes the identity
  // to the list, and the memory the later change notices read.
  const tokenIdentities = ref(undefined as (IdentityState[] | undefined));
  let followed: FollowedIdentities = {};
  // a first open on a wallet holding hundreds of categories does a bounded amount of work
  const followedPerOpenCap = 100;
  // What each listed identity's published registry locations actually serve, keyed by category.
  // Kept beside the identities rather than on them: resolution reads the chain, this reads the
  // hosting, and one can be present without the other.
  const publicationChecks = ref({} as Record<string, PublicationUriStatus[]>);
  const publicationChecksRunning = ref(false);
  // One resolve at a time: a pass writes the identities list and the 'auth' reservations derived
  // from it whole, so two overlapping passes would undo each other's result
  const identitiesResolving = ref(false);
  async function withResolveLock<T>(pass: () => Promise<T>): Promise<T | undefined> {
    if (identitiesResolving.value) return undefined;
    identitiesResolving.value = true;
    try {
      return await pass();
    } finally {
      identitiesResolving.value = false;
    }
  }

  // The persisted lists are per wallet per network, so every write names the pair
  const walletKey = () => [mainStore.network, mainStore.wallet.name] as const;
  // authority over the identity, directly or through its key
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
    unnamedAuthheads.value = loadIdentityList('unnamed', network, walletName);
    followed = loadFollowed(network, walletName);
    triedThisSession = [];
    identities.value = undefined;
    tokenIdentities.value = undefined;
    identityPublicationTxids.value = [];
    announcement.value = undefined;
    openCheckError.value = undefined;
    publicationChecks.value = {};
    identityHistories.value = {};
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
      // a chain the markers cannot name is protected all the same, by outpoint: naming it comes
      // after, and is never a condition of protecting it
      if (!identity.category) {
        if (dismissedIdentities.value.includes(identity.authheadTxid)) continue;
        if (unnamedAuthheads.value.includes(identity.authheadTxid)) continue;
        // already named by the list, which resolved before this ran: not unnamed, not news
        if ((identities.value ?? []).some(listed => listed.authheadTxid === identity.authheadTxid)) continue;
        unnamedAuthheads.value = addToIdentityList('unnamed', ...walletKey(), identity.authheadTxid);
        listed.push(identity.authheadTxid);
        continue;
      }
      if (dismissedIdentities.value.includes(identity.category)) continue;
      if (identityCategories.value.includes(identity.category)) continue;
      listCategory(identity.category);
      listed.push(identity.category);
    }
    // news either way, an unnamed authhead like a category, cleared by the next visit
    if (listed.length) unseenIdentities.value = addToIdentityList('unseen', ...walletKey(), listed);
    return listed;
  }

  // The wallet held something back the user never asked it to, so it says so every time, with
  // names, at the moment the balance changes: a coin found in the wallet's own history, a key, a
  // followed identity whose authhead arrived. Set after the resolve so the dialog can say what
  // each one carries; announcements made close together accumulate, and the wallet page opens one
  // dialog for them and clears this.
  const announcement = ref<string[] | undefined>(undefined);
  function announceFound(ids: string[]) {
    if (!ids.length) return;
    const pending = announcement.value ?? [];
    announcement.value = [...pending, ...ids.filter(id => !pending.includes(id))];
  }
  // what the dialog says, taken and cleared in one step
  function takeAnnouncement() {
    const pending = announcement.value;
    announcement.value = undefined;
    return pending;
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

  // Protection first, so it never waits on naming; the announcement last, so it has names to say
  async function detectWalletIdentities(spentOutputs: ChaingraphSpentOutput[]) {
    const started = mainStore.currentInitializationToken();
    const detected = detectIdentities(spentOutputs);
    identityPublicationTxids.value = detected.publicationTxids;
    const unseenBefore = unseenIdentities.value;
    if (!listDetectedIdentities(detected.identities).length) return;
    await refreshIdentities();
    // what this pass added to the unseen list; an unnamed authhead is announced by its txid and
    // named on the page's visit, since naming reaches hosting
    const toAnnounce = unseenIdentities.value.filter(id => !unseenBefore.includes(id));
    await fetchMetadataFor(toAnnounce);
    if (mainStore.walletSwitchedSince(started)) return;
    announceFound(toAnnounce);
  }

  // Naming coins from the registry their own chain published, forward at every step and never
  // at open, since it reaches hosting. Returns what it listed, or nothing once the wallet switched
  // underneath it: the caller writes lists under the current wallet.
  async function nameFromRegistries(coins: Utxo[]) {
    const named: { coin: Utxo; category: string }[] = [];
    const started = mainStore.currentInitializationToken();
    for (const coin of coins) {
      const category = await nameChainFromRegistry(coin.txid, settingsStore.chaingraph, settingsStore.ipfsGateway);
      if (mainStore.walletSwitchedSince(started)) return [];
      if (!category) continue;
      if (identityCategories.value.includes(category)) continue;
      if (dismissedIdentities.value.includes(category)) continue;
      listCategory(category);
      named.push({ coin, category });
    }
    return named;
  }

  // Naming what is already protected, once per session: a chain that could not be named now is
  // not asked again until the next open. A name found here is news, like any other find.
  async function nameUnnamedAuthheads() {
    const coins = unnamedAuthheadCoins.value.filter(coin => !triedThisSession.includes(coin.txid));
    if (!coins.length) return 0;
    triedThisSession.push(...coins.map(coin => coin.txid));
    const named = await nameFromRegistries(coins);
    for (const { coin, category } of named) {
      unnamedAuthheads.value = removeFromIdentityList('unnamed', ...walletKey(), coin.txid);
      // the news moves to the category with the name
      unseenIdentities.value = removeFromIdentityList('unseen', ...walletKey(), coin.txid);
      unseenIdentities.value = addToIdentityList('unseen', ...walletKey(), category);
    }
    return named.length;
  }

  // An identity's own history, which is the chain itself: what each link did, and the reserve
  // read down the list, which is the issuance schedule. One query, and only when a card asks for
  // it: this is the one identity query that grows with a chain's length. Keyed by the authhead
  // the chain was fetched at, so once the authhead moves the entry is simply not the one asked for.
  const identityHistories = ref({} as Record<string, DescribedLink[]>);

  async function fetchIdentityHistory(identity: IdentityState) {
    const authhead = identity.authheadTxid;
    if (!authhead || identityHistories.value[authhead]) return;
    const links = await queryAuthchainLinks(identity.category, settingsStore.chaingraph);
    identityHistories.value = {
      ...identityHistories.value,
      [authhead]: describeChainLinks(links),
    };
  }

  // What the notification trail counts: identities listed without being asked for, answered by
  // opening the page. A key candidate is a shape guess about an NFT and gets no wallet-level
  // marker; the token item carries that nudge.
  const unseenCount = computed(() => unseenIdentities.value.length);

  // The page has been opened, so what it found on its own is no longer news
  function markIdentitiesSeen() {
    const unseen = unseenIdentities.value;
    clearIdentityList('unseen', ...walletKey());
    unseenIdentities.value = [];
    return unseen;
  }

  // Which key opens an identity's covenant, beyond its own category: an identity that adopted a
  // guard after its genesis names its key in the registry, and the indexer's copy carries that
  function extraKeyCategories(category: string): string[] {
    const authNft = mainStore.bcmrRegistries?.[category]?.extensions?.authNft;
    if (typeof authNft !== 'string' || !/^[0-9a-f]{64}$/i.test(authNft)) return [];
    return [authNft.toLowerCase()];
  }

  // Re-resolved rather than restored: an authhead moves to a new outpoint whenever the metadata is
  // updated elsewhere. One owner for both the list and the 'auth' reservations rewritten from it.
  // Returns what it held back that the user did not ask for: a watched identity whose authhead,
  // or whose key, has arrived; the caller announces them.
  async function resolveListedIdentities(): Promise<string[]> {
    const news: string[] = [];
    const currentUtxos = mainStore.walletUtxos;
    if (!currentUtxos) return news;
    if (!identityCategories.value.length) {
      identities.value = [];
      // still runs: it reserves the unnamed authheads, and clears an 'auth' reservation left
      // behind by an identity that is no longer listed
      await syncAuthReservations([]);
      return news;
    }
    const started = mainStore.currentInitializationToken();
    const resolved = await resolveIdentities(
      identityCategories.value, settingsStore.chaingraph, currentUtxos, extraKeyCategories
    );
    if (mainStore.walletSwitchedSince(started)) return news;
    // a watched identity whose authhead arrived is held from here on, which the user is told
    for (const identity of resolved) {
      const before = identities.value?.find(listed => listed.category === identity.category);
      if (before?.status === 'notHeld' && heldStatuses.includes(identity.status)) news.push(identity.category);
    }
    // the checks answer for one publication, by position in its locations: once the publication
    // changed, they would land on the new locations, so they go until the next check runs
    const checks = { ...publicationChecks.value };
    for (const identity of resolved) {
      const before = identities.value?.find(listed => listed.category === identity.category);
      if (before?.publication?.hash !== identity.publication?.hash) delete checks[identity.category];
    }
    publicationChecks.value = checks;
    identities.value = resolved;
    await syncAuthReservations(resolved);
    return news;
  }

  // The news a resolve found is announced here, so every path that resolves tells the user the
  // same way; a caller inside a locked pass calls resolveListedIdentities itself
  async function refreshIdentities() {
    const news = await withResolveLock(resolveListedIdentities);
    if (news?.length) {
      await fetchMetadataFor(news);
      announceFound(news);
    }
  }

  // Held authheads that carry no identity of their own on the list: same protection, no name.
  // Derived, never stored: a UTXO the resolved list accounts for is not unnamed, whichever list
  // found it first.
  const unnamedAuthheadCoins = computed(() => {
    const named = (identities.value ?? []).map(identity => identity.authheadTxid);
    return (mainStore.walletUtxos ?? []).filter(
      utxo => utxo.vout === 0 && unnamedAuthheads.value.includes(utxo.txid) && !named.includes(utxo.txid)
    );
  });

  // Holds back every authhead this wallet has. A resolve adds protection and never releases a
  // coin the wallet still holds: a held authhead stays the authhead until spent, and Chaingraph
  // can be behind the wallet's own transaction. Nothing is released while an identity is
  // unresolved either. Every write checks for a wallet switch first.
  async function syncAuthReservations(resolved: IdentityState[]) {
    const started = mainStore.currentInitializationToken();
    const authOutpoints: string[] = [];
    for (const coin of unnamedAuthheadCoins.value) {
      const outpoint = outpointOf(coin);
      authOutpoints.push(outpoint);
      if (mainStore.walletSwitchedSince(started)) return;
      if (!mainStore.reservedUtxos[outpoint]) await mainStore.reserveUtxo(coin, 'auth');
    }
    for (const identity of resolved) {
      // the identity output when this wallet holds it, the AuthKey when a covenant does: either
      // way it is the coin the authority rides on, and one key can carry several identities
      const keyCoin = identity.authUtxo ?? identity.keyUtxo;
      if (!keyCoin) continue;
      const outpoint = outpointOf(keyCoin);
      authOutpoints.push(outpoint);
      // A reservation already made for another reason is left alone: the coin is held back either
      // way, and rewriting the reason would take it away from whatever made it
      if (mainStore.walletSwitchedSince(started)) return;
      if (!mainStore.reservedUtxos[outpoint]) await mainStore.reserveUtxo(keyCoin, 'auth');
    }
    if (resolved.some(identity => identity.status === 'unresolved')) return;
    const heldOutpoints = (mainStore.walletUtxos ?? []).map(outpointOf);
    for (const [outpoint, reason] of Object.entries(mainStore.reservedUtxos)) {
      if (reason !== 'auth') continue;
      if (authOutpoints.includes(outpoint)) continue;
      if (heldOutpoints.includes(outpoint)) continue;
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

  // The identities of the tokens this wallet holds, followed: every held category at open, up to
  // the cap, and all of them on the page's visit. Resolving only what was never looked up would
  // leave the group half filled until the visit, since the states themselves are not persisted.
  // Nothing is listed or reserved here except an identity whose authhead, or whose key, turns
  // out to be in this wallet, which is promoted and announced.
  async function followTokenIdentities(scope: 'open' | 'all') {
    await withResolveLock(async () => {
      const currentUtxos = mainStore.walletUtxos;
      if (!currentUtxos) return;
      const held = (mainStore.tokenList ?? [])
        .map(token => token.category)
        .filter(category => !identityCategories.value.includes(category) && !dismissedIdentities.value.includes(category));
      const categories = scope === 'open' ? held.slice(0, followedPerOpenCap) : held;
      const started = mainStore.currentInitializationToken();
      const resolved = categories.length
        ? await resolveIdentities(categories, settingsStore.chaingraph, currentUtxos, extraKeyCategories)
        : [];
      if (mainStore.walletSwitchedSince(started)) return;
      const outage = outageReason(resolved);
      if (outage && scope === 'open') openCheckError.value = outage;
      // what was not asked this time keeps its last answer, as long as the token is still held
      const next = (tokenIdentities.value ?? []).filter(
        identity => held.includes(identity.category) && !categories.includes(identity.category)
      );
      const promoted: string[] = [];
      let remembered = false;
      for (const identity of resolved) {
        if (identity.status === 'unresolved' || !identity.authheadTxid) {
          const previous = tokenIdentities.value?.find(known => known.category === identity.category);
          if (previous) next.push(previous);
          continue;
        }
        remembered = true;
        followed[identity.category] = {
          authheadTxid: identity.authheadTxid,
          ...(identity.publication ? { publicationHash: identity.publication.hash } : {}),
        };
        // an identity whose output, or whose key, is here is this wallet's to look after
        if (heldStatuses.includes(identity.status)) {
          listCategory(identity.category);
          promoted.push(identity.category);
          continue;
        }
        next.push(identity);
      }
      if (mainStore.walletSwitchedSince(started)) return;
      if (remembered) saveFollowed(...walletKey(), followed);
      tokenIdentities.value = next;
      if (!promoted.length) return;
      unseenIdentities.value = addToIdentityList('unseen', ...walletKey(), promoted);
      await resolveListedIdentities();
      await fetchMetadataFor(promoted);
      if (mainStore.walletSwitchedSince(started)) return;
      announceFound(promoted);
    });
  }

  // What went wrong in a pass the wallet ran on its own at open, shown on the page where the
  // result would be rather than toasted on every open; cleared by the next pass that runs
  const openCheckError = ref<string | undefined>(undefined);

  // The passes the wallet runs on its own once a wallet is up: the walk of its history for the
  // identities these keys made, mainnet only like the walk itself, and the followed token
  // identities, on both networks since those lookups are keyed by category.
  // Outside the wallet's own failure path: a lookup failing here, an electrum server refusing a
  // guard address say, must not flag a wallet that did load, so it is reported where the
  // identities are. The resolve of what the wallet follows comes first, since the walk lists
  // against it.
  async function runChecksOnOpen() {
    const started = mainStore.currentInitializationToken();
    openCheckError.value = undefined;
    try {
      await refreshIdentities();
      if (mainStore.network === 'mainnet') {
        const spentOutputs = await mainStore.walkSpentOutputs();
        if (mainStore.walletSwitchedSince(started)) return;
        await detectWalletIdentities(spentOutputs);
      }
      if (mainStore.walletSwitchedSince(started)) return;
      if (settingsStore.followTokenIdentities) await followTokenIdentities('open');
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
  // it is rather than as an NFT with no metadata. Empty for anything that is not a confirmed key.
  function identitiesGuardedByKey(keyCategory: string) {
    return identities.value?.filter(
      identity => identity.keyUtxo?.token?.category === keyCategory
    ) ?? [];
  }

  // The identity of a token this wallet holds the authority over, directly or through a key, so
  // the token list can say so beside the token and point here. Nothing for a watched identity.
  function heldIdentityOf(category: string) {
    const identity = identities.value?.find(identity => identity.category === category);
    if (!identity) return undefined;
    return heldStatuses.includes(identity.status) ? identity : undefined;
  }

  // What the token list says beside such a token: the balance shown leaves the reserve out, and
  // the identities page is where the identity is managed
  function heldIdentityLine(category: string): string | undefined {
    const identity = heldIdentityOf(category);
    if (!identity) return undefined;
    const reserve = (identity.authUtxo?.token ?? identity.identityOutput?.token)?.amount;
    if (!reserve) return t('tokenItem.identity.held');
    const metadata = mainStore.bcmrRegistries?.[category];
    const amount = `${formatTokenAmountFromBigInt(reserve, metadata?.token?.decimals ?? 0)} ${metadata?.token?.symbol ?? ''}`.trim();
    return t('tokenItem.identity.heldWithReserve', { amount });
  }

  // Where an identity the user is about to add sits, before it is listed: the page says whether
  // it is held here, guarded, or somebody else's, and lists it on the user's word
  async function inspectCategory(category: string): Promise<IdentityState> {
    const [found] = await resolveIdentities(
      [category], settingsStore.chaingraph, mainStore.walletUtxos ?? [], extraKeyCategories
    );
    return found ?? { category, status: 'unresolved' };
  }

  async function addIdentity(category: string) {
    // adding by hand undoes a dismissal: the user changed their mind, which is the whole point
    dismissedIdentities.value = removeFromIdentityList('dismissed', ...walletKey(), category);
    listCategory(category);
    await refreshIdentities();
  }

  // An identity this wallet just created, token or not: its authhead is output 0 of the
  // transaction, so the coin is held back straight away rather than when Chaingraph or this
  // wallet's own view catches up. The resolve after it is a lookup that can fail, and the
  // identity is listed and held back whether or not it does: a failure is not the caller's.
  async function listCreatedIdentity(category: string, authheadTxId: string) {
    dismissedIdentities.value = removeFromIdentityList('dismissed', ...walletKey(), category);
    listCategory(category);
    const outpoint = `${authheadTxId}:0`;
    if (!mainStore.reservedUtxos[outpoint]) await mainStore.reserveOutpoint(outpoint, 'auth');
    try {
      await refreshIdentities();
    } catch (error) {
      console.error("Failed to resolve the created identity:", error);
    }
  }

  // The wallet's only way to stop holding an authhead back, for when the user wants to spend that
  // coin outside the identities page. Adding the identity again, by category or through the
  // ownership check, reserves its authhead again.
  async function removeUnnamedAuthhead(txid: string) {
    dismissedIdentities.value = addToIdentityList('dismissed', ...walletKey(), txid);
    unnamedAuthheads.value = removeFromIdentityList('unnamed', ...walletKey(), txid);
    const coin = (mainStore.walletUtxos ?? []).find(utxo => utxo.vout === 0 && utxo.txid === txid);
    if (coin && mainStore.reservedUtxos[outpointOf(coin)] === 'auth') {
      await mainStore.dropReservation(outpointOf(coin));
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
    // the coin the authority rode on is released with the identity: the output, or a key that no
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
    dismissedIdentities,
    unseenIdentities,
    unseenCount,
    announcement,
    takeAnnouncement,
    unnamedAuthheads,
    identityPublicationTxids,
    identities,
    tokenIdentities,
    identitiesResolving,
    publicationChecks,
    publicationChecksRunning,
    identityHistories,
    loadForWallet,
    refreshIdentities,
    resolveListedIdentities,
    followTokenIdentities,
    openCheckError,
    runChecksOnOpen,
    fetchMetadataFor,
    detectWalletIdentities,
    nameUnnamedAuthheads,
    unnamedAuthheadCoins,
    identitiesGuardedByKey,
    heldIdentityOf,
    heldIdentityLine,
    inspectCategory,
    checkPublications,
    fetchIdentityHistory,
    markIdentitiesSeen,
    addIdentity,
    listCreatedIdentity,
    removeIdentity,
    removeUnnamedAuthhead,
  }
})
