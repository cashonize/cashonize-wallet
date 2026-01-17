<script setup lang="ts">
  import { computed, ref, onMounted } from 'vue'
  import { useQuasar } from 'quasar'
  import { useStore } from '../stores/store'
  import { useSettingsStore } from '../stores/settingsStore'
  import { copyToClipboard } from 'src/utils/utils'
  import { DERIVATION_PATHS } from 'src/utils/walletUtils'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()

    // Persistent storage (only relevant for browser/PWA, not Electron or Capacitor)
  const isBrowser = process.env.MODE === 'spa'
  const persistentStorageSupported = typeof navigator !== 'undefined' && !!navigator.storage?.persist
  const persistentStorageStatus = ref<'unknown' | 'granted' | 'denied'>('unknown')

  onMounted(async () => {
    if (isBrowser && persistentStorageSupported) {
      const persisted = await navigator.storage.persisted()
      persistentStorageStatus.value = persisted ? 'granted' : 'denied'
    }
  })

  async function requestPersistentStorage() {
    if (!persistentStorageSupported) return
    const granted = await navigator.storage.persist()
    persistentStorageStatus.value = granted ? 'granted' : 'denied'
    if (granted) {
      $q.notify({
        message: "Persistent storage granted - your wallet data is protected",
        icon: 'check_circle',
        color: "green"
      })
    } else {
      $q.notify({
        message: "Persistent storage denied - make sure you have a backup of your seed phrase",
        icon: 'warning',
        color: "grey-7"
      })
    }
  }

  const derivationPathNote = computed(() => {
    const path = store.wallet.derivationPath;
    if (path === DERIVATION_PATHS.standard.full) return "BCH standard";
    if (path === DERIVATION_PATHS.bitcoindotcom.full) return "legacy, Bitcoin.com wallet compatible";
    return "custom";
  })

  // Computed property to check if current wallet's seed has been backed up
  const backupStatus = computed(() => settingsStore.getBackupStatus(store.activeWalletName));
  const hasSeedBackedUp = computed(() => backupStatus.value === 'verified' || backupStatus.value === 'imported');

  // Seedphrase display state
  const displaySeedphrase = ref(false);
  const showBackupVerification = ref(false);
  const verificationIndices = ref<number[]>([]);
  const verificationWords = ref<string[]>([]);

  function resetVerificationState() {
    showBackupVerification.value = false;
    verificationWords.value = [];
  }

  function toggleShowSeedphrase() {
    // Close verification if open
    if (showBackupVerification.value) resetVerificationState();
    displaySeedphrase.value = !displaySeedphrase.value;
  }

  function toggleBackupVerification() {
    // Close seedphrase if open
    displaySeedphrase.value = false;

    // Toggle verification
    if (showBackupVerification.value) {
      resetVerificationState();
    } else {
      const words = store.wallet.mnemonic.split(' ');
      // Pick 4 random indices
      const indices: number[] = [];
      while (indices.length < 4) {
        const randomIndex = Math.floor(Math.random() * words.length);
        if (!indices.includes(randomIndex)) {
          indices.push(randomIndex);
        }
      }
      indices.sort((a, b) => a - b);
      verificationIndices.value = indices;
      verificationWords.value = Array(4).fill('');
      showBackupVerification.value = true;
    }
  }

  function getVerificationWordClass(position: number): string {
    const enteredWord = verificationWords.value[position]?.trim().toLowerCase();
    if (!enteredWord) return '';
    const correctIndex = verificationIndices.value[position];
    if (correctIndex === undefined) return '';
    const words = store.wallet.mnemonic.split(' ');
    const correctWord = words[correctIndex]?.toLowerCase();
    return enteredWord === correctWord ? 'valid-word' : 'invalid-word';
  }

  function verifyBackup() {
    const words = store.wallet.mnemonic.split(' ');
    const allCorrect = verificationIndices.value.every((wordIndex, position) => {
      const enteredWord = verificationWords.value[position]?.trim().toLowerCase();
      const correctWord = words[wordIndex]?.toLowerCase();
      return enteredWord === correctWord;
    });

    if (allCorrect) {
      settingsStore.setBackupStatus(store.activeWalletName, 'verified');
      showBackupVerification.value = false;
      $q.notify({
        message: "Backup verified successfully!",
        icon: 'check_circle',
        color: "green"
      });
    } else {
      $q.notify({
        message: "Some words don't match. Please check and try again.",
        icon: 'warning',
        color: "grey-7"
      });
    }
  }

  async function copySeedphrase() {
    const confirmed = await new Promise<boolean>((resolve) => {
      $q.dialog({
        title: 'Copy Seed Phrase',
        message: 'Copying your seed phrase to the clipboard is not recommended for security reasons, but allowed for convenience.<br>You can clear your clipboard afterwards by copying something else.',
        html: true,
        cancel: { flat: true, color: 'dark' },
        ok: { label: 'Copy', color: 'primary', textColor: 'white' },
        persistent: true
      }).onOk(() => resolve(true))
        .onCancel(() => resolve(false))
    })
    if (!confirmed) return
    void navigator.clipboard.writeText(store.wallet.mnemonic);
    $q.notify({
      message: "Seed phrase copied to clipboard",
      icon: 'info',
      timeout: 2000,
      color: "grey-6"
    })
  }
</script>

<template>
  <div>
    <div style="margin-bottom: 15px;">
      Current wallet: <span class="wallet-name-styled">{{ store.activeWalletName }}</span>
    </div>

    <!-- Show/Hide Seed Phrase -->
    <div style="margin-top: 15px;">
      <div style="margin-bottom: 8px;">Wallet seed phrase</div>
      <div class="seedphrase-actions">
        <input @click="toggleShowSeedphrase()" class="button primary" type="button"
          :value="displaySeedphrase ? 'Hide seed phrase' : 'Show seed phrase'"
        >
        <input v-if="!hasSeedBackedUp" @click="toggleBackupVerification()" class="button" type="button" value="Verify your backup">
      </div>
    </div>
    <div v-if="displaySeedphrase" class="seedphrase-container">
      <span v-for="(word, index) in store.wallet.mnemonic.split(' ')" :key="index" class="seedphrase-word">
        <span class="seedphrase-number">{{ index + 1 }}</span>{{ word }}
      </span>
    </div>
    <button v-if="displaySeedphrase" @click="copySeedphrase" class="seedphrase-copy-btn">
      Copy Seed Phrase
    </button>

    <!-- Backup Status -->
    <div v-if="!showBackupVerification" class="backup-status-section">
      <div v-if="backupStatus === 'verified'" class="backup-status verified">
        <span class="status-icon">✓</span>
        <span>Backup verified</span>
      </div>
      <div v-else-if="backupStatus === 'imported'" class="backup-status verified">
        <span class="status-icon">✓</span>
        <span>Imported wallet</span>
        <span class="inline-hint">— no extra backup verification needed</span>
      </div>
      <div v-else class="backup-status not-verified">
        <span class="status-icon">!</span>
        <span>Not backed up yet</span>
        <span class="inline-hint">— click "Verify your backup" to confirm</span>
      </div>
    </div>

    <!-- Backup Verification UI -->
    <div v-if="showBackupVerification" class="verification-container">
      <div class="verification-title">Backup verification test</div>
      <div class="verification-subtitle">Enter the following words from your written backup to confirm you've saved it correctly.</div>
      <div class="verification-grid">
        <div v-for="(wordIndex, position) in verificationIndices" :key="position" class="verification-input-group">
          <label class="verification-label">Word {{ wordIndex + 1 }}</label>
          <input
            v-model="verificationWords[position]"
            :class="getVerificationWordClass(position)"
            type="text"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            class="verification-input"
          >
        </div>
      </div>
      <button @click="verifyBackup" class="button primary" style="margin-top: 15px;">Verify</button>
    </div>

    <div class="derivation-section">
      <div class="derivation-label">
        Derivation path
        <span class="derivation-note">({{ derivationPathNote }})</span>
      </div>
      <div class="derivation-container" @click="copyToClipboard(store.wallet.derivationPath)">
        <span class="derivation-path">{{ store.wallet.derivationPath }}</span>
        <img class="copyIcon" src="images/copyGrey.svg">
      </div>
    </div>

    <!-- Persistent Storage (browser only) -->
    <div v-if="isBrowser && persistentStorageSupported" class="persistent-storage-section">
      <div class="persistent-storage-info">
        <span v-if="persistentStorageStatus === 'granted'" class="storage-status granted">
          <span class="status-icon">✓</span> Data persistence granted by browser
          <span class="inline-hint">— this protects wallet data from being cleared</span>
        </span>
        <span v-else-if="persistentStorageStatus === 'denied'" class="storage-status denied">
          <span class="status-icon">!</span>
          <span>Wallet data not protected</span>
          <span class="inline-hint">— request data persistence from the browser</span>
        </span>
        <span v-else class="storage-status unknown">
          Checking...
        </span>
      </div>
      <div v-if="persistentStorageStatus !== 'granted'" class="persistent-storage-hint">
        In rare cases, browsers may clear site data automatically. To protect against this, we are requesting data persistence.
      </div>
      <input
        v-if="persistentStorageStatus !== 'granted'"
        @click="requestPersistentStorage()"
        class="button"
        type="button"
        value="Request data persistence"
        style="margin-top: 10px; margin-bottom: 15px;"
      >
    </div>
  </div>
</template>

<style scoped>
.wallet-name-styled {
  font-family: monospace;
  background-color: #f0f0f0;
  padding: 2px 8px;
  border-radius: 4px;
}
body.dark .wallet-name-styled {
  background-color: #2a2a3e;
}
.seedphrase-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.backup-status-section {
  margin-top: 20px;
}
.backup-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.backup-status.verified {
  color: #2e7d32;
}
body.dark .backup-status.verified {
  color: #a5d6a7;
}
.backup-status.not-verified {
  color: #e65100;
}
body.dark .backup-status.not-verified {
  color: #ffcc80;
}
.status-icon {
  font-weight: bold;
}
.inline-hint {
  color: #888;
}
.seedphrase-container {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 16px;
  margin-top: 12px;
  background-color: #f5f5f5;
  border-radius: 8px;
}
@media (min-width: 600px) {
  .seedphrase-container {
    grid-template-columns: repeat(6, 1fr);
    max-width: 600px;
  }
}
body.dark .seedphrase-container {
  background-color: #1a1a2e;
}
.seedphrase-word {
  font-family: monospace;
  font-size: 14px;
  padding: 6px 8px;
  background-color: white;
  border-radius: 4px;
  text-align: center;
}
body.dark .seedphrase-word {
  background-color: #0f0f1a;
}
.seedphrase-number {
  color: #888;
  font-size: 11px;
  margin-right: 4px;
}
.seedphrase-copy-btn {
  margin-top: 12px;
  padding: 8px 16px;
  background-color: #e0e0e0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
body.dark .seedphrase-copy-btn {
  background-color: #2a2a3e;
  color: #f5f5f5;
}
.derivation-section {
  margin-top: 24px;
  margin-bottom: 15px;
}
.derivation-label {
  font-size: 14px;
  margin-bottom: 8px;
}
.derivation-note {
  font-size: 12px;
  color: #888;
  font-weight: normal;
}
.derivation-container {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background-color: #f5f5f5;
  border-radius: 8px;
  max-width: fit-content;
  cursor: pointer;
}
body.dark .derivation-container {
  background-color: #1a1a2e;
}
.derivation-path {
  font-family: monospace;
  font-size: 14px;
}
.verification-container {
  margin-top: 20px;
  padding: 16px;
  background-color: #f5f5f5;
  border-radius: 8px;
}
body.dark .verification-container {
  background-color: #1a1a2e;
}
.verification-title {
  font-weight: 500;
  margin-bottom: 4px;
}
.verification-subtitle {
  font-size: 13px;
  color: #666;
  margin-bottom: 15px;
}
body.dark .verification-subtitle {
  color: #aaa;
}
.verification-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  max-width: 350px;
}
@media (min-width: 500px) {
  .verification-grid {
    grid-template-columns: repeat(4, 1fr);
    max-width: 500px;
  }
}
.verification-input-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.verification-label {
  font-size: 12px;
  color: #888;
}
.verification-input {
  padding: 8px;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 4px;
  width: 100%;
  box-sizing: border-box;
}
body.dark .verification-input {
  background-color: #0f0f1a;
  border-color: #444;
  color: #f5f5f5;
}
.verification-input.valid-word {
  border-color: #4caf50;
  background-color: #e8f5e9;
}
.verification-input.invalid-word {
  border-color: #f44336;
  background-color: #ffebee;
}
body.dark .verification-input.valid-word {
  background-color: #1b3d1f;
  color: #a5d6a7;
}
body.dark .verification-input.invalid-word {
  background-color: #3d1b1b;
  color: #ef9a9a;
}
.persistent-storage-section {
  margin-top: 24px;
  margin-bottom: 15px;
  padding-top: 20px;
  border-top: 1px solid #e0e0e0;
}
body.dark .persistent-storage-section {
  border-top-color: #333;
}
.persistent-storage-info {
  margin-bottom: 8px;
}
.storage-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}
.storage-status.granted {
  color: #2e7d32;
}
body.dark .storage-status.granted {
  color: #a5d6a7;
}
.storage-status.denied {
  color: #e65100;
}
body.dark .storage-status.denied {
  color: #ffcc80;
}
.storage-status.unknown {
  color: #888;
}
.persistent-storage-hint {
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}
body.dark .persistent-storage-hint {
  color: #aaa;
}
</style>
