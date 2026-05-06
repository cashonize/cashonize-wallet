## Security Considerations

Cashonize is available as a webwallet, an installable web app, and as downloadable desktop (Windows, Linux) and Android (.apk) applications. All variants share the same codebase, but they have different security properties worth understanding.

### Code delivery

**Webwallets fetch a live application each time you visit.** The code is served fresh from the web on every visit, which means it is not vetted beforehand and could in principle change between sessions. This is an inherent property of any web wallet, not specific to Cashonize.

**Downloadable apps pin the code at install time.** When you install the desktop or Android version, you download a specific version of the code once, and it does not change until you update. Note that current Cashonize releases are not code-signed, so you should verify you are downloading from the official GitHub releases page: https://github.com/cashonize/cashonize-wallet/releases

**Installable web apps share the security model of webwallets.** Adding Cashonize to your home screen makes it feel like a native app, but the code is still loaded from the web. It is a convenience feature, not a security upgrade.

### Wallet persistence

Cashonize is non-custodial. There is no recovery if you lose your seed phrase, so always write it down and store it somewhere safe before holding meaningful amounts in the wallet.

Browser-based wallets (the webwallet and the installable web app) are particularly exposed, because browsers can clear site data on their own. Brave in particular may evict storage when it considers a site dormant, and clearing browsing data also wipes IndexedDB. To reduce this risk, Cashonize asks the browser to mark its storage as persistent, and you can also trigger the request manually from the settings menu. Bookmarking cashonize.com first helps the request succeed on Brave. Even with persistent storage granted, a written seed phrase backup is the only thing that survives losing your device or your browser profile.

### Phishing

The only correct URL for the webwallet is cashonize.com. Bookmark it and use the bookmark instead of typing the URL or clicking through search results, since lookalike crypto domains are a recurring phishing vector. For the desktop and Android apps, only download from the official GitHub releases page: https://github.com/cashonize/cashonize-wallet/releases. Treat anything else (third-party app stores, mirror sites, links from social media DMs) as untrusted.

### Seed storage

Cashonize currently stores your seed phrase unencrypted in IndexedDB. The actual on-disk location depends on the platform (Capacitor and Electron handle their respective platform storage), but in all cases the seed is stored in plaintext at rest:

- **On the webwallet and installable web app**, your seed lives in the browser's IndexedDB storage for cashonize.com. Any browser extension with access to that origin, or anything else with access to your browser profile, can read it.
- **On the desktop app (Electron)**, your seed lives in Electron's IndexedDB store on disk. Anything running on your computer with access to your user account can read it.
- **On the Android .apk (Capacitor)**, your seed lives in the app's private IndexedDB storage. Android's per-app sandboxing means other apps cannot read it by default, which is a meaningful default protection that the desktop and web variants do not have.

### Summary

**Risk by platform:**
- The webwallet and installable web app carry ongoing exposure on every visit: code is delivered fresh from the web, phishing applies each time you navigate to the URL, and any browser extension with access to the origin can read the seed in IndexedDB.
- The desktop app pins the code at install time, but stores the seed in plaintext on your filesystem. Its main advantage over the webwallet is code pinning, not storage isolation.
- The Android .apk pins code at install and adds per-app sandboxing on top.

**Recommendations:**
- Write down your seed phrase before holding meaningful amounts. Without it, no recovery is possible.
- For most users the desktop app strikes the best balance of code pinning and accessibility. Encrypted seed storage is on the roadmap.
- On the webwallet, only run it on a browser profile where you trust every installed extension, and request persistent storage.
- Only download desktop and Android apps from the official GitHub releases page.