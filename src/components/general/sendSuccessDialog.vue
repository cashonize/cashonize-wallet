<script setup lang="ts">
  // The screen after a send: full screen on a phone, a card on wider screens. The check plays
  // once and nothing waits on it; under prefers-reduced-motion it is drawn static.
  import { computed } from 'vue'
  import { useDialogPluginComponent } from 'quasar'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useWindowSize } from 'src/utils/composables'
  import { copyToClipboard } from 'src/utils/utils'
  import type { SendSuccessInfo } from 'src/interfaces/interfaces'
  import TxNoteField from './TxNoteField.vue'
  import SendAmount from './SendAmount.vue'
  import { useI18n } from 'vue-i18n'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const props = defineProps<{
    sendInfo: SendSuccessInfo,
  }>()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])

  const { dialogRef, onDialogHide, onDialogOK } = useDialogPluginComponent()

  const { width } = useWindowSize();
  const isMobilePhone = computed(() => width.value < 480)

  const shortRecipient = computed(() => {
    const [prefix, payload] = props.sendInfo.recipient.split(':')
    if (!payload) return `${props.sendInfo.recipient.slice(0, 8)}…${props.sendInfo.recipient.slice(-6)}`
    return `${prefix}:${payload.slice(0, 4)}…${payload.slice(-4)}`
  })
  const shortTxid = computed(() => `${props.sendInfo.txid.slice(0, 8)}…${props.sendInfo.txid.slice(-6)}`)
  const explorerLink = computed(() => `${store.explorerUrl}/${props.sendInfo.txid}`)
  const copyIconSrc = computed(() => settingsStore.darkMode ? 'images/copyGrey.svg' : 'images/copy.svg')

  // Enter closes the screen like Done, except while typing a note, where Enter saves the note
  function onEnter(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement) return
    onDialogOK()
  }
</script>

<template>
  <q-dialog ref="dialogRef" :maximized="isMobilePhone" @hide="onDialogHide">
    <q-card class="sendSuccess" :class="{ fullScreen: isMobilePhone }" @keydown.enter="onEnter">
      <div class="closeRow">
        <q-btn icon="close" :color="settingsStore.darkMode ? 'white' : 'black'" flat round dense v-close-popup />
      </div>

      <div class="hero">
        <svg class="check" viewBox="0 0 120 120" aria-hidden="true">
          <g class="rays">
            <line v-for="angle in [0, 60, 120, 180, 240, 300]" :key="'l' + angle" x1="60" y1="17" x2="60" y2="9" :transform="`rotate(${angle} 60 60)`" />
            <circle v-for="angle in [30, 90, 150, 210, 270, 330]" :key="'c' + angle" cx="60" cy="12" r="2.4" :transform="`rotate(${angle} 60 60)`" />
          </g>
          <circle class="halo" cx="60" cy="60" r="34" />
          <circle class="disc" cx="60" cy="60" r="34" />
          <path class="tick" d="M45 61l10 10 20-21" pathLength="1" />
        </svg>
        <div class="title">{{ t('alertDialog.transactionSent') }}</div>
        <SendAmount :summary="sendInfo" class="amountBlock" />
        <div class="recipient" @click="copyToClipboard(sendInfo.recipient)">
          <span class="label">{{ t('sendSuccess.to') }}</span>
          <span>{{ shortRecipient }}</span>
          <img class="copyIcon icon" :src="copyIconSrc">
        </div>
      </div>

      <div class="details">
        <div class="detailRow">
          <span class="label">{{ t('alertDialog.txId') }}</span>
          <span class="value" @click="copyToClipboard(sendInfo.txid)">
            {{ shortTxid }}
            <img class="copyIcon icon" :src="copyIconSrc">
          </span>
        </div>
        <div class="detailRow">
          <a :href="explorerLink" target="_blank">{{ t('alertDialog.linkExplorer') }}</a>
        </div>
      </div>

      <TxNoteField :txid="sendInfo.txid" />

      <div class="actions">
        <input type="button" class="primaryButton" :value="t('common.actions.done')" @click="onDialogOK">
      </div>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .sendSuccess {
    width: 480px;
    max-width: 100%;
    padding: 12px 28px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
  }
  .sendSuccess.fullScreen {
    width: 100%;
    padding: calc(12px + var(--safe-area-inset-top, 0px)) 20px calc(16px + var(--safe-area-inset-bottom, 0px));
  }
  body.dark .sendSuccess {
    background-color: var(--bg-color);
  }
  .closeRow {
    display: flex;
    justify-content: flex-end;
    margin-bottom: -16px;
  }
  .hero {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  /* a soft glow of the brand color behind the check */
  .hero::before {
    content: "";
    position: absolute;
    z-index: -1;
    top: -60px;
    left: 50%;
    width: 480px;
    height: 360px;
    margin-left: -240px;
    background: radial-gradient(closest-side, rgba(10, 193, 143, 0.16), transparent);
    pointer-events: none;
  }
  .check {
    width: 104px;
    height: 104px;
    overflow: visible;
  }
  .check .disc {
    fill: var(--color-primary);
    transform-box: fill-box;
    transform-origin: center;
  }
  .check .tick {
    fill: none;
    stroke: #fff;
    stroke-width: 6;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 1;
    stroke-dashoffset: 0;
  }
  .check .halo {
    fill: none;
    stroke: var(--color-primary);
    stroke-width: 2;
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
  }
  .check .rays {
    opacity: 0;
    transform-origin: 60px 60px;
  }
  .check .rays line {
    stroke: var(--color-primary);
    stroke-width: 3;
    stroke-linecap: round;
  }
  .check .rays circle {
    fill: #7fe3c6;
  }
  .title {
    font-weight: 600;
    font-size: 17px;
  }
  .amountBlock {
    margin-top: 6px;
  }
  .recipient {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 14px;
    padding: 6px 12px 6px 14px;
    border-radius: 999px;
    background: var(--surface-subtle);
    font-size: 14px;
    cursor: pointer;
  }
  .label {
    color: var(--color-grey);
  }
  .details {
    border-top: 1px solid var(--surface-line);
    border-bottom: 1px solid var(--surface-line);
  }
  .details .detailRow {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 2px;
    margin: 0;
  }
  .details .detailRow + .detailRow {
    border-top: 1px solid var(--surface-line);
  }
  .details .value {
    cursor: pointer;
  }
  .actions {
    display: flex;
  }
  .actions .primaryButton {
    width: 100%;
  }
  .fullScreen .actions {
    margin-top: auto;
  }

  @keyframes draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
  @keyframes pop { 0% { transform: scale(0.3); opacity: 0; } 60% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); } }
  @keyframes burst { 0% { opacity: 0; transform: scale(0.72) rotate(-6deg); } 25% { opacity: 1; } 100% { opacity: 0; transform: scale(1.14) rotate(0); } }
  @keyframes halo { 0% { opacity: 0.55; transform: scale(1); } 100% { opacity: 0; transform: scale(1.75); } }

  /* same gate as the QR animation in qrCode.vue: without it the check is simply drawn */
  @media (prefers-reduced-motion: no-preference) {
    .check .disc { animation: pop 0.42s cubic-bezier(0.3, 1.3, 0.5, 1) backwards; }
    .check .tick { animation: draw 0.26s ease-out 0.22s backwards; }
    .check .halo { animation: halo 0.7s ease-out 0.2s; }
    .check .rays { animation: burst 0.65s cubic-bezier(0.2, 0.7, 0.3, 1) 0.24s; }
  }
</style>
