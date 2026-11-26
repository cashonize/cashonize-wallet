<script setup lang="ts">
  // Turning the app lock on and off and changing its PIN
  import BackRow from 'src/components/general/BackRow.vue'
  import MenuRow from 'src/components/general/MenuRow.vue'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import { computed, onActivated, onDeactivated, ref, watch } from 'vue'
  import { Notify } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import { useStore } from 'src/stores/store'
  import { menuSectionViewBase } from 'src/stores/constants'
  import { useAppLockStore } from 'src/stores/appLockStore'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { isValidPin, pinMaxLength, pinMinLength } from 'src/utils/appLock'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { biometricsAvailable, verifyBiometrics } from 'src/utils/biometrics'
  const store = useStore()
  const appLock = useAppLockStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  // a forgotten PIN is recovered from only by restoring, which a wallet without a backup cannot do
  const notBackedUp = computed(() => store.availableWallets
    .map(wallet => wallet.name)
    .filter(name => settingsStore.getBackupStatus(name) === 'none'))
  function openBackup() {
    // the backup page is section 1 of the menu page
    store.changeView(menuSectionViewBase + 1)
  }

  const newPin = ref('')
  const repeatPin = ref('')
  const changing = ref(false)
  const saving = ref(false)

  const pinError = computed(() => {
    if (newPin.value && !isValidPin(newPin.value)) return t('appLock.pinRule', { min: pinMinLength, max: pinMaxLength })
    if (repeatPin.value && repeatPin.value !== newPin.value) return t('appLock.pinMismatch')
    return undefined
  })
  const canSave = computed(() => isValidPin(newPin.value) && repeatPin.value === newPin.value && !saving.value)

  function resetForm() {
    newPin.value = ''
    repeatPin.value = ''
    changing.value = false
  }

  // the page is kept alive: a form opened behind the PIN closes when the page is left or the app locks
  onDeactivated(resetForm)
  watch(() => appLock.locked, resetForm)

  async function savePin() {
    if (!canSave.value) return
    saving.value = true
    try {
      const wasEnabled = appLock.enabled
      await appLock.setPin(newPin.value)
      resetForm()
      Notify.create({ type: 'positive', message: wasEnabled ? t('appLock.pinChanged') : t('appLock.turnedOn') })
    } catch (error) {
      displayAndLogError(error)
    } finally {
      saving.value = false
    }
  }

  // Asked again on each visit, as a fingerprint may have been enrolled in the device's settings since
  const canUseBiometrics = ref(false)
  onActivated(async () => { canUseBiometrics.value = await biometricsAvailable() })

  // Turning it on adds a way in, so the PIN is asked first, then the prompt shows that it works
  async function toggleBiometrics(on: boolean) {
    if (!on) {
      appLock.setBiometrics(false)
      return
    }
    if (!await appLock.confirmPin()) return
    if (!await verifyBiometrics(t('appLock.biometricsSetupTitle'), t('appLock.cancel'))) return
    appLock.setBiometrics(true)
    Notify.create({ type: 'positive', message: t('appLock.biometricsTurnedOn') })
  }

  async function startChange() {
    if (await appLock.confirmPin()) changing.value = true
  }

  async function turnOff() {
    if (!await appLock.confirmPin()) return
    appLock.removePin()
    resetForm()
    Notify.create({ type: 'positive', message: t('appLock.turnedOff') })
  }
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('appLock.title') }}</legend>
    <BackRow @click="store.goBack()" />

    <div class="app-lock">
      <div class="lock-head">
        <span class="lock-badge" :class="{ on: appLock.enabled }">
          <q-icon :name="appLock.enabled ? 'lock' : 'lock_open'" size="26px" />
        </span>
        <div class="lock-state">{{ appLock.enabled ? t('appLock.isOn') : t('appLock.description') }}</div>
        <InfoPopup><div style="max-width: 300px;">{{ t('appLock.notEncryption') }}</div></InfoPopup>
      </div>

      <div style="margin-bottom: 8px;">{{ t('appLock.askedWhen') }}:</div>
      <ul class="lock-asks">
        <li v-for="ask in ['askOpen', 'askSpend', 'askSeed']" :key="ask">
          <q-icon name="check" size="18px" class="lock-check" />
          <span>{{ t(`appLock.${ask}`) }}</span>
        </li>
      </ul>

      <div v-if="appLock.enabled && !changing" class="lock-rows">
        <div v-if="canUseBiometrics || appLock.biometrics" class="lock-toggle">
          <q-icon name="fingerprint" size="20px" />
          <span class="lock-toggle-label">{{ t('appLock.biometricsToggle') }}</span>
          <q-toggle :model-value="appLock.biometrics" dense @update:model-value="toggleBiometrics" />
        </div>
        <MenuRow icon="lock" :label="t('appLock.lockNow')" @click="appLock.lock()" />
        <MenuRow icon="edit" :label="t('appLock.changePin')" @click="startChange()" />
        <MenuRow icon="lock_open" :label="t('appLock.turnOff')" @click="turnOff()" />
      </div>

      <form v-else class="lock-form" @submit.prevent="savePin">
        <div class="pin-fields">
          <div>
            <label for="newPin">{{ changing ? t('appLock.newPin') : t('appLock.choosePin') }}</label>
            <input id="newPin" v-model="newPin" class="pin-field" type="text" inputmode="numeric" autocomplete="off" :maxlength="pinMaxLength">
          </div>
          <div>
            <label for="repeatPin">{{ t('appLock.repeatPin') }}</label>
            <input id="repeatPin" v-model="repeatPin" class="pin-field" type="text" inputmode="numeric" autocomplete="off" :maxlength="pinMaxLength">
          </div>
        </div>
        <div class="pin-hint" :class="{ error: pinError }">{{ pinError ?? t('appLock.pinRule', { min: pinMinLength, max: pinMaxLength }) }}</div>
        <div class="lock-buttons">
          <input type="submit" class="primaryButton" :value="changing ? t('appLock.changePin') : t('appLock.turnOn')" :disabled="!canSave">
          <input v-if="changing" type="button" class="button" :value="t('appLock.cancel')" @click="resetForm()">
        </div>
      </form>

      <template v-if="notBackedUp.length">
        <div class="warning-box lock-warning" style="margin-top: 16px;">
          <q-icon name="warning" size="20px" class="warning-box-icon" />
          <div>{{ t('appLock.notBackedUp', { wallets: notBackedUp.join(', ') }) }}</div>
        </div>
        <div v-if="notBackedUp.includes(store.activeWalletName)" class="lock-rows" style="margin-top: 8px;">
          <MenuRow icon="key" :label="t('appLock.backUpNow')" @click="openBackup()" />
        </div>
      </template>

      <!-- the warning above says the same, in a wallet's own terms -->
      <div v-else class="lock-notes">
        <div><q-icon name="info_outline" size="16px" /> <span>{{ t('appLock.backupFirst') }}</span></div>
      </div>
    </div>
  </fieldset>
</template>

<style scoped>
.app-lock {
  max-width: 560px;
}
.lock-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 4px 0 14px;
}
.lock-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--surface-strong);
}
.lock-badge.on {
  background: var(--color-primary);
  color: #fff;
}
.lock-state {
  flex: 1;
  font-size: 1.15em;
  font-weight: 600;
}
.lock-asks {
  margin: 0 0 20px;
  padding: 0;
  list-style: none;
}
.lock-asks li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 6px;
}
.lock-check {
  flex: none;
  margin-top: 3px;
  color: var(--color-primary);
}
.lock-rows, .lock-form {
  border: 1px solid var(--surface-line);
  border-radius: 8px;
}
.lock-rows {
  overflow: hidden;
}
.lock-form {
  padding: 14px;
}
/* laid out as a menu row, with a toggle where the row's chevron would be */
.lock-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  margin: 0;
  padding: 8px 10px;
  border-bottom: 1px solid var(--surface-line);
}
.lock-toggle-label {
  flex: 1;
}
.pin-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}
.pin-fields label {
  display: block;
  font-size: smaller;
}
.pin-field {
  letter-spacing: 0.3em;
  -webkit-text-security: disc;
}
.pin-hint {
  margin-top: 6px;
  color: grey;
  font-size: smaller;
}
.pin-hint.error {
  color: red;
}
.lock-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}
.lock-buttons input {
  margin: 0;
}
/* the page's most important sentence, in the text colour rather than orange on an orange tint */
.lock-warning {
  color: var(--font-color);
}
.lock-warning .q-icon {
  color: orange;
}
.lock-notes {
  margin-top: 16px;
  color: grey;
  font-size: smaller;
}
.lock-notes div {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 6px;
}
.lock-notes .q-icon {
  flex: none;
  margin-top: 2px;
}
</style>
