<script setup lang="ts">
  // Turning the app lock on and off and changing its PIN
  import BackRow from 'src/components/general/BackRow.vue'
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
      <p>{{ t('appLock.description') }}</p>
      <p class="description">{{ t('appLock.notEncryption') }}</p>

      <template v-if="appLock.enabled && !changing">
        <p style="font-weight: 600;">{{ t('appLock.isOn') }}</p>
        <div class="app-lock-buttons">
          <input type="button" class="button" :value="t('appLock.lockNow')" @click="appLock.lock()">
          <input type="button" class="button" :value="t('appLock.changePin')" @click="startChange()">
          <input type="button" class="button" :value="t('appLock.turnOff')" @click="turnOff()">
        </div>
      </template>

      <form v-else @submit.prevent="savePin">
        <div class="warning-box" style="margin-bottom: 15px;">{{ t('appLock.backupFirst') }}</div>
        <label for="newPin">{{ changing ? t('appLock.newPin') : t('appLock.choosePin') }}</label>
        <input id="newPin" v-model="newPin" class="pin-field" type="text" inputmode="numeric" autocomplete="off" :maxlength="pinMaxLength">
        <label for="repeatPin" style="margin-top: 10px;">{{ t('appLock.repeatPin') }}</label>
        <input id="repeatPin" v-model="repeatPin" class="pin-field" type="text" inputmode="numeric" autocomplete="off" :maxlength="pinMaxLength">
        <div v-if="pinError" style="color: red; font-size: smaller; margin-top: 6px;">{{ pinError }}</div>
        <div class="app-lock-buttons" style="margin-top: 15px;">
          <input type="submit" class="primaryButton" :value="changing ? t('appLock.changePin') : t('appLock.turnOn')" :disabled="!canSave">
          <input v-if="changing" type="button" class="button" :value="t('appLock.cancel')" @click="resetForm()">
        </div>
      </form>
    </div>
  </fieldset>
</template>

<style scoped>
.app-lock {
  max-width: 560px;
}
.app-lock label {
  display: block;
}
.pin-field {
  max-width: 220px;
  letter-spacing: 0.3em;
  -webkit-text-security: disc;
}
.app-lock-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.app-lock-buttons input {
  margin: 0;
}
</style>
