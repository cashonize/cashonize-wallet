<script setup lang="ts">
  import { ref, watch, onUnmounted } from 'vue'
  import { useStore } from 'src/stores/store'
  import CharCounter from './CharCounter.vue'
  import { maxTxNoteLength } from 'src/utils/history/txNotes'
  import { useI18n } from 'vue-i18n'
  const store = useStore()
  const { t } = useI18n()

  const props = defineProps<{
    txid: string,
  }>()

  // The note field autosaves: debounced while typing, immediately on blur, Enter and unmount
  const noteDraft = ref(store.txNotes[props.txid] ?? "");
  let noteSaveTimeout: ReturnType<typeof setTimeout> | undefined;

  function saveNote() {
    clearTimeout(noteSaveTimeout);
    store.setTxNote(props.txid, noteDraft.value);
  }

  watch(noteDraft, () => {
    clearTimeout(noteSaveTimeout);
    noteSaveTimeout = setTimeout(saveNote, 500);
  });
  onUnmounted(saveNote);
</script>

<template>
  <label class="noteField">
    <input
      v-model="noteDraft"
      class="noteInput"
      type="text"
      :placeholder="t('transactionDialog.notePlaceholder')"
      :maxlength="maxTxNoteLength"
      autocomplete="off"
      spellcheck="false"
      @blur="saveNote"
      @keyup.enter="saveNote"
    >
    <CharCounter :length="noteDraft.length" :max-length="maxTxNoteLength" />
    <q-icon name="edit" size="16px" class="noteIcon" />
  </label>
</template>

<style scoped>
  .noteField {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--surface-line-strong);
    border-radius: 8px;
    background-color: var(--surface-faint);
    transition: border-color 0.2s;
    cursor: text;
  }
  .noteField:focus-within {
    border-color: var(--color-primary);
  }
  .noteIcon {
    flex: none;
    opacity: 0.55;
  }
  /* a class, not the element: app.css styles dark-mode inputs with a more specific selector */
  .noteField .noteInput {
    flex: 1;
    min-width: 0;
    width: auto;
    border: none;
    outline: none;
    box-shadow: none;
    background: transparent;
    padding: 0;
    margin: 0;
    font-size: inherit;
    color: inherit;
  }
</style>
