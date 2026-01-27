<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore } from 'src/stores/settingsStore'

  const { locale } = useI18n()
  const settingsStore = useSettingsStore()

  const availableLocales = [
    { code: 'en', name: 'English', flag: '/emoji-icons/countrygb.svg' },
    { code: 'es', name: 'Español', flag: '/emoji-icons/countryes.svg' }
    // Add more languages here as they become available
  ]

  const selectedLocale = computed({
    get: () => availableLocales.find(l => l.code === locale.value) || availableLocales[0],
    set: (value: typeof availableLocales[0]) => {
      locale.value = value.code
      settingsStore.locale = value.code
      localStorage.setItem('locale', value.code)
    }
  })
</script>

<template>
  <q-select
    v-model="selectedLocale"
    :options="availableLocales"
    option-value="code"
    option-label="name"
    dense
    options-dense
    borderless
    class="language-selector"
    popup-content-class="language-selector-dropdown"
  >
    <template #selected-item="{ opt }">
      <div class="locale-item">
        <img :src="opt.flag" :alt="opt.name" class="flag" />
        <span>{{ opt.name }}</span>
      </div>
    </template>
    <template #option="{ opt, itemProps }">
      <q-item v-bind="itemProps">
        <q-item-section>
          <div class="locale-item">
            <img :src="opt.flag" :alt="opt.name" class="flag" />
            <span>{{ opt.name }}</span>
          </div>
        </q-item-section>
      </q-item>
    </template>
  </q-select>
</template>

<style scoped>
.language-selector {
  margin: 0px;
  padding: 0px 6px;
  border: 1px solid var(--color-lightGrey);
  background: #f3f3f6 no-repeat 100%;
}
.locale-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.flag {
  width: 20px;
  height: 20px;
}
</style>

<style>
/* Override global .row margin that centers the component */
.language-selector .row,
.language-selector .row.no-wrap {
  margin: 0;
}
/* Style the dropdown to match the select */
.language-selector-dropdown .q-item {
  background: #f3f3f6 no-repeat 100%;
  font-size: 14px;
}
.language-selector-dropdown .locale-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.language-selector-dropdown .flag {
  width: 20px;
  height: 20px;
}
</style>
