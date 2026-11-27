<script setup lang="ts">
  // The locations of a metadata publication as the user types them, one row each, with the room
  // left in the output they share with the hash. Used by the create page and the identities page.
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { filledLocations, locationBudgetLeft } from 'src/utils/tools/authchainIdentity'
  import { isSupportedLocation, publishedFormOf, registryUrlOf } from 'src/utils/tools/registryFile'

  const rows = defineModel<string[]>({ required: true })
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  // A full URL is welcome, and the row says what of it goes on chain and where the file is read
  // from, the well-known path a bare domain stands for above all; the input itself is left alone
  function rowNote(row: string): string | undefined {
    const typed = row.trim()
    if (!typed) return undefined
    const published = publishedFormOf(typed)
    if (!isSupportedLocation(published)) return t('identities.publish.errors.unsupportedLocation', { uri: published })
    const url = registryUrlOf(published, settingsStore.ipfsGateway)
    if (published !== typed) return t('identities.publish.publishedAs', { published, url })
    return t('identities.publish.fetchedFrom', { url })
  }

  const filled = computed(() => filledLocations(rows.value))
  const budgetLeft = computed(() => locationBudgetLeft(filled.value))

  function setRow(index: number, value: string) {
    rows.value = rows.value.map((row, rowIndex) => rowIndex === index ? value : row)
  }
  function addRow() {
    rows.value = [...rows.value, ""]
  }
  function removeRow(index: number) {
    const remaining = rows.value.filter((_, rowIndex) => rowIndex !== index)
    rows.value = remaining.length ? remaining : [""]
  }
</script>

<template>
  <div v-for="(row, index) in rows" :key="index">
    <div class="publish-uri-row">
      <input
        :value="row"
        :placeholder="t('identities.publish.uriPlaceholder')"
        @input="setRow(index, ($event.target as HTMLInputElement).value)"
      >
      <span v-if="rows.length > 1" class="remove-uri" @click="removeRow(index)">
        {{ t('identities.publish.removeLocation') }}
      </span>
    </div>
    <div v-if="rowNote(row)" class="description publish-uri-note">{{ rowNote(row) }}</div>
  </div>
  <div class="publish-uri-actions">
    <button @click="addRow()">{{ t('identities.publish.addLocation') }}</button>
    <slot />
    <span v-if="filled.length" class="description" :class="{ 'over-budget': budgetLeft < 0 }">
      {{ t('identities.publish.bytesLeft', { bytes: budgetLeft }) }}
    </span>
  </div>
</template>

<style scoped>
.publish-uri-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}
.publish-uri-row input {
  flex: 1 1 260px;
  margin: 0;
}
.publish-uri-note {
  margin-top: 4px;
  word-break: break-all;
}
.publish-uri-actions {
  display: flex;
  align-items: baseline;
  gap: 15px;
  flex-wrap: wrap;
  margin-top: 6px;
}
/* adding a row to a form is a small action, not one the full button size fits */
.publish-uri-actions button {
  padding: 8px 16px;
  font-size: 0.9em;
}
.remove-uri {
  cursor: pointer;
  color: grey;
}
/* what will not relay reads as an error rather than as one more grey number */
.over-budget {
  color: var(--color-error);
}
</style>
