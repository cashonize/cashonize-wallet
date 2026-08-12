<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import EmojiItem from '../general/emojiItem.vue'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const isBrowser = import.meta.env.QUASAR_SPA_MODE;
</script>

<template>
  <fieldset class="item">
    <legend>{{ t('aboutCashonize.title') }}</legend>

    <div style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(5)">
      ← {{ t('common.backToSettings') }}
    </div>

    <p style="margin-bottom: 8px;">{{ t('aboutCashonize.description') }}</p>
    <p style="color: grey; margin: 0 0 15px;">{{ t('aboutCashonize.tagline') }}</p>

    <div style="margin-bottom: 15px;">
      <a style="color: var(--font-color); cursor: pointer;" href="https://about.cashonize.com" target="_blank">
        {{ t('aboutCashonize.learnMore') }}
        <img :src="settingsStore.darkMode? 'images/external-link-grey.svg' : 'images/external-link.svg'" style="vertical-align: sub;"/>
      </a>
    </div>

    <div v-if="isBrowser" style="margin-bottom: 15px;">
      <a style="color: var(--font-color); cursor: pointer;" href="https://github.com/cashonize/cashonize-wallet/releases/latest" target="_blank">
        {{ t('aboutCashonize.downloadPage') }}
        <img :src="settingsStore.darkMode? 'images/external-link-grey.svg' : 'images/external-link.svg'" style="vertical-align: sub;"/>
      </a>
    </div>

    <div style="margin-bottom: 15px;">
      <a style="color: var(--font-color); cursor: pointer;" href="https://github.com/cashonize/cashonize-wallet" target="_blank">
        {{ t('aboutCashonize.viewSource') }}
        <img :src="settingsStore.darkMode? 'images/external-link-grey.svg' : 'images/external-link.svg'" style="vertical-align: sub;"/>
      </a>
    </div>

    <div style="margin-bottom: 15px;">
      <a style="color: var(--font-color); cursor: pointer;" href="https://x.com/cashonize" target="_blank">
        {{ t('aboutCashonize.followOnX') }}
        <img :src="settingsStore.darkMode? 'images/external-link-grey.svg' : 'images/external-link.svg'" style="vertical-align: sub;"/>
      </a>
    </div>

    <div style="margin-bottom: 15px;">
      <a style="color: var(--font-color); cursor: pointer;" href="https://x.com/GeukensMathieu" target="_blank">
        <i18n-t keypath="settings.madeWith" tag="span">
          <template #heart>
            <EmojiItem emoji="💚" :sizePx="18" style="vertical-align: sub;" />
          </template>
        </i18n-t>
      </a>
    </div>
  </fieldset>
</template>
