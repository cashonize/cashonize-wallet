<script setup lang="ts">
  // The PIN field of the app lock, with its wrong-PIN message and the wait after too many tries.
  // `check` says whether the typed PIN is right; the lock screen unlocks with it, a dialog only verifies.
  import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useAppLockStore } from 'src/stores/appLockStore'
  import { pinMaxLength, pinMinLength } from 'src/utils/appLock'
  const appLock = useAppLockStore()
  const { t } = useI18n()

  const props = defineProps<{
    check: (pin: string) => Promise<boolean>,
    submitLabel: string,
    cancellable?: boolean,
  }>()
  const emit = defineEmits<{ verified: [], cancel: [] }>()

  const pin = ref('')
  const wrong = ref(false)
  const checking = ref(false)
  const input = ref<HTMLInputElement>()
  watch(pin, (typed) => {
    pin.value = typed.replace(/\D/g, '')
    // not on the clearing after a wrong PIN, which is when the message shows
    if (typed) wrong.value = false
  })

  // the seconds left of the wait, counted down while it lasts
  const now = ref(Date.now())
  const timer = setInterval(() => { now.value = Date.now() }, 1000)
  onUnmounted(() => clearInterval(timer))
  const waitSeconds = computed(() => Math.max(0, Math.ceil((appLock.retryAt - now.value) / 1000)))

  onMounted(() => input.value?.focus())
  defineExpose({ focus: () => input.value?.focus() })

  async function submit() {
    if (checking.value || waitSeconds.value > 0 || pin.value.length < pinMinLength) return
    checking.value = true
    try {
      const matches = await props.check(pin.value)
      now.value = Date.now()
      if (matches) {
        emit('verified')
        return
      }
      wrong.value = true
      pin.value = ''
    } finally {
      checking.value = false
    }
  }
</script>

<template>
  <form class="pin-entry" @submit.prevent="submit">
    <!-- a masked text field rather than a password one, which browsers would offer to save -->
    <input
      ref="input" v-model="pin" class="pin-input" type="text" inputmode="numeric" autocomplete="off"
      :maxlength="pinMaxLength" :placeholder="t('appLock.pinPlaceholder')" :aria-label="t('appLock.pinPlaceholder')"
      :disabled="waitSeconds > 0"
    >
    <div v-if="waitSeconds > 0" class="pin-message">{{ t('appLock.tooManyAttempts', { seconds: waitSeconds }) }}</div>
    <div v-else-if="wrong" class="pin-message">{{ t('appLock.wrongPin') }}</div>
    <div class="pin-buttons">
      <input v-if="cancellable" type="button" :value="t('appLock.cancel')" @click="emit('cancel')">
      <input type="submit" class="primaryButton" :value="submitLabel" :disabled="checking || waitSeconds > 0 || pin.length < pinMinLength">
    </div>
  </form>
</template>

<style scoped>
.pin-entry {
  width: 100%;
  max-width: 260px;
}
.pin-input {
  text-align: center;
  font-size: 1.4em;
  letter-spacing: 0.3em;
  -webkit-text-security: disc;
}
.pin-input::placeholder {
  font-size: 0.7em;
  letter-spacing: normal;
}
.pin-message {
  margin-top: 8px;
  color: red;
  font-size: smaller;
  text-align: center;
}
.pin-buttons {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 14px;
}
.pin-buttons input {
  margin: 0;
}
</style>
