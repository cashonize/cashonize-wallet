<script setup lang="ts">
  // The PIN field of the app lock, with its wrong-PIN message and the wait after too many tries.
  // `check` says whether the typed PIN is right; the lock screen unlocks with it, a dialog only verifies.
  import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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

  // minutes and seconds, as the wait grows to a quarter of an hour
  const waitTime = computed(() => `${Math.floor(waitSeconds.value / 60)}:${String(waitSeconds.value % 60).padStart(2, '0')}`)

  onMounted(() => input.value?.focus())
  // the field was disabled for the wait and lost its focus
  watch(waitSeconds, (seconds) => { if (seconds === 0) void nextTick(() => input.value?.focus()) })
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
    <!-- The digits are typed into a field that is not shown, which keeps the device's own number
         keyboard, and drawn as one dot each, so the row says nothing of how long a PIN is. A text field rather than a password one, which browsers
         would offer to save. -->
    <div class="pin-dots" :class="{ waiting: waitSeconds > 0, wrong }">
      <span v-if="!pin" class="pin-placeholder">{{ t('appLock.pinPlaceholder') }}</span>
      <span v-for="index in pin.length" :key="index" class="pin-dot"></span>
      <input
        ref="input" v-model="pin" class="pin-input" type="text" inputmode="numeric" enterkeyhint="go" autocomplete="off"
        :maxlength="pinMaxLength" :aria-label="t('appLock.pinPlaceholder')" :disabled="waitSeconds > 0"
      >
    </div>
    <div v-if="waitSeconds > 0" class="pin-message">{{ t('appLock.tooManyAttempts', { time: waitTime }) }}</div>
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
.pin-dots {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 48px;
  border: 1px solid var(--surface-line-strong);
  border-radius: 8px;
}
.pin-dots:focus-within {
  border-color: var(--color-primary);
}
.pin-dots.waiting {
  opacity: 0.4;
}
.pin-dots.wrong {
  border-color: red;
}
.pin-placeholder {
  color: grey;
}
.pin-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--font-color);
}
.pin-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: text;
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
  flex: 1;
}
.pin-buttons input {
  margin: 0;
}
</style>
