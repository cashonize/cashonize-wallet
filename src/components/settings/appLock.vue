<script setup lang="ts">
  // Turning the app lock on and off and changing its PIN
  import BackRow from 'src/components/general/BackRow.vue'
  import MenuRow from 'src/components/general/MenuRow.vue'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import { computed, ref } from 'vue'
  import { Notify } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import { useStore } from 'src/stores/store'
  import { useAppLockStore } from 'src/stores/appLockStore'
  import { isValidPin, pinMaxLength, pinMinLength } from 'src/utils/appLock'
  import { displayAndLogError } from 'src/utils/errorHandling'
  const store = useStore()
  const appLock = useAppLockStore()
  const { t } = useI18n()

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
        <div>
          <div class="lock-state">
            {{ appLock.enabled ? t('appLock.isOn') : t('appLock.description') }}
            <InfoPopup><div style="max-width: 300px;">{{ t('appLock.notEncryption') }}</div></InfoPopup>
          </div>
          <div class="description" style="font-size: smaller;">{{ t('appLock.askedWhen') }}:</div>
        </div>
      </div>

      <ul class="lock-asks">
        <li v-for="ask in ['askOpen', 'askSpend', 'askSeed']" :key="ask">
          <q-icon name="check" size="18px" class="lock-check" />
          <span>{{ t(`appLock.${ask}`) }}</span>
        </li>
      </ul>

      <div v-if="appLock.enabled && !changing" class="lock-rows">
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

      <div class="lock-notes">
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
