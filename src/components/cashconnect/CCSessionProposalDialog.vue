<script setup lang="ts">
import { ref } from 'vue';
import { useQuasar, useDialogPluginComponent } from 'quasar'
import type { BchSessionProposal } from 'cashconnect';

import { useStore } from 'src/stores/store';
import { useSettingsStore } from 'src/stores/settingsStore';

import CCViewTemplateDialog from './CCViewTemplateDialog.vue';

const $q = useQuasar();
const store = useStore();
const settingsStore = useSettingsStore();

const props = defineProps<{
  session: BchSessionProposal
}>()

defineEmits([
  ...useDialogPluginComponent.emits
])

const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

function viewTemplate() {
  $q.dialog({
    component: CCViewTemplateDialog,
    componentProps: {
      template: props.session.params.requiredNamespaces?.bch?.template,
    },
  });
}

//-----------------------------------------------------------------------------
// Tokens
//-----------------------------------------------------------------------------

// State to store fetched token info from BCMR.
const tokens = ref<{ [categoryId: string]: any }>({});

function getTokenName(categoryId: string) {
  // NOTE: This is a remote payload, so we wrap in a try/catch for graceful failure.
  try {
    const tokenInfo = tokens.value[categoryId];

    if(!tokenInfo) {
      return categoryId;
    }

    return tokenInfo.name;
  } catch(error) {
    console.warn(`${error}`);

    return categoryId;
  }
}

function getTokenIcon(categoryId: string) {
  // NOTE: This is a remote payload, so we wrap in a try/catch for graceful failure.
  try {
    const tokenInfo = tokens.value[categoryId];

    if(!tokenInfo?.uris?.icon) {
      return categoryId;
    }

    const tokenIconUri = tokenInfo.uris.icon;

    if(tokenIconUri?.startsWith('ipfs://')){
      return settingsStore.ipfsGateway + tokenIconUri.slice(7);
    }

    return tokenIconUri;
  } catch(error) {
    console.warn(`${error}`);

    return categoryId;
  }
}

props.session.params.requiredNamespaces?.bch?.allowedTokens.forEach(async (tokenId) => {
  try {
    const tokenInfo = await store.fetchTokenInfo(tokenId);
    tokens.value[tokenId] = await tokenInfo.json();
  } catch(error) {
    console.warn(`${error}`);
  }
});

</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" persistent transition-show="scale">
    <q-card>
      <fieldset class="cc-modal-fieldset">
        <legend style="font-size: larger;">Approve Session?</legend>
        <div  style="display: flex; flex-direction: column; gap: 1rem;">
          <!-- App Info -->
          <div style="display: flex; align-items: center; flex-direction: row; gap: 10px; padding: 7px;">
            <!-- App Icon -->
            <div style="display: flex; align-items: center; height: 64px; width: 64px;">
              <q-img :src="session.params.proposer.metadata.icons[0]" />
            </div>

            <!-- Metadata -->
            <div style="display: flex; flex-direction: column; width: 100%;">
              <div>{{ session.params.proposer.metadata.name }}</div>
              <div><a :href="session.params.proposer.metadata.url" target="_blank">{{ session.params.proposer.metadata.url }}</a></div>
              <div>{{ session.params.proposer.metadata.description }}</div>
            </div>
          </div>

          <!-- Namespaces -->
          <div class="cc-modal-details">
            <!-- Template -->
            <div class="cc-modal-section">
              <div class="cc-modal-heading">Template:</div>
              <a @click="viewTemplate()" class="cursor-pointer">{{ session.params.requiredNamespaces?.bch?.template.name }}</a> (Untrusted)
            </div>

            <!-- Allowed Tokens -->
            <div class="cc-modal-section">
              <div class="cc-modal-heading">Will be able to see Tokens:</div>
              <ul>
                <li v-for="(allowedToken, i) of session.params.requiredNamespaces?.bch?.allowedTokens" :key="i" class="q-mb-xs">
                  <q-avatar size="18px" class="q-mr-xs">
                    <q-img :src="getTokenIcon(allowedToken)" />
                  </q-avatar>
                  <span>
                    {{ getTokenName(allowedToken) }}
                    <q-tooltip>{{ allowedToken }}</q-tooltip>
                  </span>
                </li>
              </ul>
            </div>

            <!-- Methods -->
            <div class="cc-modal-section">
              <div class="cc-modal-heading">Will be able to invoke Methods/Events:</div>
              <ul>
                <li v-for="(method, i) of session.params.requiredNamespaces?.bch?.methods" :key="i">{{ method }}</li>
                <li v-for="(event, i) of session.params.requiredNamespaces?.bch?.events" :key="i">{{ event }}</li>
              </ul>
            </div>
          </div>
        </div>
        <!-- Approve/Reject Buttons -->
        <div style="margin: 2rem 0; display: flex; gap: 1rem;" class="justify-center">
          <input type="button" class="primaryButton" value="Approve" @click="onDialogOK" v-close-popup>
          <input type="button" value="Reject" @click="onDialogCancel">
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset{
    padding: 3rem;
    width: 500px;
    max-width: 100%;
    height: 220px;
    background-color: white
  }
  body.dark .dialogFieldset {
    background-color: #050a14;
  }
  .q-card{
    box-shadow: none;
    background: none;
  }
</style>
