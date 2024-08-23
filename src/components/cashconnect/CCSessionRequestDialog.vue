<script setup lang="ts">
import { useQuasar, useDialogPluginComponent } from 'quasar'
import type { BchSession } from 'cashconnect';
import type { Web3WalletTypes } from '@walletconnect/web3wallet';

import CCViewTemplateDialog from './CCViewTemplateDialog.vue';

const $q = useQuasar();

const props = defineProps<{
  session: Web3WalletTypes.SessionProposal
}>()

defineEmits([
  // REQUIRED; need to specify some events that your
  // component will emit through useDialogPluginComponent()
  ...useDialogPluginComponent.emits
])

const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

// this is part of our example (so not required)
function onOKClick () {
  // on OK, it is REQUIRED to
  // call onDialogOK (with optional payload)
  onDialogOK()
  // or with payload: onDialogOK({ ... })
  // ...and it will also hide the dialog automatically
}

function viewTemplate() {
  $q.dialog({
    component: CCViewTemplateDialog,
    componentProps: {
      template: props.session.params.requiredNamespaces?.bch?.template,
    },
  });
}
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card>
      <fieldset class="cc-modal-fieldset">
        <legend style="font-size: larger;">Approve Session?</legend>
        <div  style="display: flex; flex-direction: column; gap: 1rem;">
          <!-- App Info -->
          <div style="display: flex; align-items: center; flex-direction: row; gap: 10px; padding: 7px;">
            <!-- App Icon -->
            <div style="display: flex; align-items: center; height: 64px; width: 64px;">
              <img :src="session.params.proposer.metadata.icons[0]">
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
              <div class="cc-modal-heading">Template</div>
              <a @click="viewTemplate()">{{ session.params.requiredNamespaces?.bch?.template.name }}</a> (Untrusted)
            </div>

            <!-- Methods -->
            <div class="cc-modal-section">
              <div class="cc-modal-heading">Methods/Events</div>
              <ul>
                <li v-for="(method, i) of session.params.requiredNamespaces?.bch?.methods" :key="i">{{ method }}</li>
                <li v-for="(event, i) of session.params.requiredNamespaces?.bch?.events" :key="i">{{ event }}</li>
              </ul>
            </div>

            <!-- Allowed Tokens -->
            <div class="cc-modal-section">
              <div class="cc-modal-heading">Allowed Tokens</div>
              <ul>
                <li v-for="(allowedToken, i) of session.params.requiredNamespaces?.bch?.allowedTokens" :key="i">{{ allowedToken }}</li>
              </ul>
            </div>
          </div>
        </div>
        <!-- Approve/Reject Buttons -->
        <q-card-actions align="right">
          <q-btn color="primary" label="OK" @click="onOKClick" />
          <q-btn color="negative" label="Cancel" @click="onDialogCancel" />
        </q-card-actions>
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
