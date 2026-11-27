<script setup lang="ts">
  // Short answers to what is particular to Bitcoin Cash and to this wallet, each pointing at the
  // tool that solves it. Not a manual: general crypto questions are left to the wider web.
  import BackRow from 'src/components/general/BackRow.vue'
  import { useStore } from 'src/stores/store'
  import { menuSectionViewBase } from 'src/stores/constants'
  import { useI18n } from 'vue-i18n'

  const store = useStore()
  const { t } = useI18n()

  // where the wallet lives, and so how it is lost, differs per platform
  let losingDeviceVariant: 'losingDevice.browser' | 'losingDevice.mobile' | 'losingDevice.desktop' = 'losingDevice.browser'
  if (import.meta.env.QUASAR_CAPACITOR_MODE) losingDeviceVariant = 'losingDevice.mobile'
  if (import.meta.env.QUASAR_ELECTRON_MODE) losingDeviceVariant = 'losingDevice.desktop'

  // `tool` is the view an answer sends the reader to, named by its menu page label
  const questions = [
    { id: losingDeviceVariant },
    { id: 'twoAddresses' },
    { id: 'addressChanged' },
    { id: 'bchForTokens' },
    { id: 'tokenSupport', tool: { view: 20, label: 'settings.menu.addressConverter' } },
    { id: 'imposterToken' },
    { id: 'tokenValue', tool: { view: menuSectionViewBase + 7, label: 'settings.menu.tokenSettings' } },
    { id: 'utxos', tool: { view: 7, label: 'settings.menu.utxoManagement' } },
  ]
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('faq.title') }}</legend>
    <BackRow @click="store.goBack()" />

    <div class="description" style="margin-bottom: 10px;">{{ t('faq.description') }}</div>

    <details v-for="question in questions" :key="question.id" class="faq-item">
      <summary>{{ t(`faq.questions.${question.id}.question`) }}</summary>
      <div class="faq-answer">
        {{ t(`faq.questions.${question.id}.answer`) }}
        <div v-if="'tool' in question" class="faq-tool">
          <span class="action-link" @click="store.changeView(question.tool.view)">{{ t(question.tool.label) }} →</span>
        </div>
      </div>
    </details>
  </fieldset>
</template>

<style scoped>
.faq-item {
  border-bottom: 1px solid var(--surface-line);
}
.faq-item summary {
  display: list-item;
  padding: 12px 4px;
  font-weight: 500;
  cursor: pointer;
}
.faq-answer {
  max-width: 70ch;
  padding: 0 4px 14px 21px;
  line-height: 1.5;
}
.faq-tool {
  margin-top: 8px;
}
</style>
