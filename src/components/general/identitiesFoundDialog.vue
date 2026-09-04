<script setup lang="ts">
  import { computed } from 'vue'
  import { useDialogPluginComponent } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import TokenIcon from 'src/components/general/TokenIcon.vue'
  import { useStore } from 'src/stores/store'
  import { useIdentitiesStore } from 'src/stores/identitiesStore'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { formatBch, formatTokenAmountFromBigInt, truncateHash } from 'src/utils/utils'

  // Shown whenever the wallet held back identities the user never listed: that is the moment the
  // spendable balance and the token list change, so it is told directly, with names, every time.
  const props = defineProps<{
    ids: string[], // categories, or the authhead txid of one the wallet could not name yet
  }>()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])

  const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()
  const { t } = useI18n()
  const store = useStore()
  const identitiesStore = useIdentitiesStore()
  const settingsStore = useSettingsStore()


  // Registries may not have been fetched yet when the walk returns, so a name can be missing and
  // the id stands in for it rather than waiting
  const entries = computed(() => props.ids.map(id => {
    const identity = identitiesStore.identities?.find(identity => identity.category === id)
    const output = identity?.authUtxo ?? identity?.identityOutput
    const metadata = store.bcmrRegistries?.[id]
    const reserve = output?.token?.amount
      ? `${formatTokenAmountFromBigInt(output.token.amount, metadata?.token?.decimals ?? 0)} ${metadata?.token?.symbol ?? ''}`.trim()
      : undefined
    return {
      id,
      name: metadata?.name,
      iconUrl: settingsStore.disableTokenIcons ? undefined : store.tokenIconUrl(id),
      reserve,
      bch: output ? formatBch(output.satoshis, store.network) : undefined,
    }
  }))
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" transition-show="scale" transition-hide="scale">
    <q-card class="dialogCard">
      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">{{ t('identities.found.title') }}</legend>
        <div>{{ t('identities.found.intro') }}</div>
        <div class="found-list">
          <div v-for="entry in entries" :key="entry.id" class="found-entry">
            <TokenIcon :token-id="entry.id" :icon-url="entry.iconUrl" :size="32" />
            <div>
              <div>{{ entry.name ?? truncateHash(entry.id) }}</div>
              <div class="found-facts">
                <span v-if="entry.reserve">{{ t('identities.found.reserve', { amount: entry.reserve }) }}</span>
                <span v-if="entry.bch">{{ entry.bch }}</span>
              </div>
            </div>
          </div>
        </div>
        <div>{{ t('identities.found.heldBack') }}</div>
        <div style="margin-top: 8px;">{{ t('identities.found.remove') }}</div>
        <div class="found-actions">
          <input type="button" class="primaryButton" :value="t('identities.found.view')" @click="onDialogOK()">
          <input type="button" :value="t('identities.found.close')" @click="onDialogCancel()">
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset {
    padding: 2rem;
    width: 550px;
    max-width: 100%;
  }
  .found-list {
    margin: 12px 0;
  }
  .found-entry {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }
  .found-facts {
    color: grey;
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .found-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 16px;
  }
</style>
