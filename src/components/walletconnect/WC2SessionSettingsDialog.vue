<script setup lang="ts">
  import { ref, watch, onMounted, toRefs } from 'vue';
  import Toggle from '@vueform/toggle';
  import { type DappMetadata } from 'src/interfaces/interfaces';
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useWindowSize } from '@vueuse/core'
  const settingsStore = useSettingsStore()
  const { width } = useWindowSize();
  const isMobilePhone = width.value < 480

  const props = defineProps<{
    sessionId: string,
    dappMetadata: DappMetadata
  }>();
  const { sessionId } = toRefs(props);

  const emit = defineEmits(['hide']);

  const showDialog = ref(true);
  const enableAutoApprovals = ref(false);
  const autoMode = ref("" as "forever" | "count" | "time" | "");
  const autoCount = ref(undefined as number | undefined);
  const autoCountLeft = ref(undefined as number | undefined);
  const autoDuration = ref(undefined as number | undefined);
  const autoTimeLeft = ref(undefined as number | undefined);

  const displaySessionId = `- ${!isMobilePhone ?'session ' : ''} ${sessionId.value.slice(0, 6)}`

  function toggleRadioButtons() {
    if (!enableAutoApprovals.value) {
      autoMode.value = "";
      autoCount.value = undefined;
      autoDuration.value = undefined;
      settingsStore.clearAutoApproveState(sessionId.value);
      autoTimeLeft.value = undefined;
      autoCountLeft.value = undefined;
    } else {
      autoMode.value = "forever";
    }
  }

  // Load saved settings on mount
  onMounted(() => {
    const state = settingsStore.getAutoApproveState(sessionId.value);
    if (!state) return

    enableAutoApprovals.value = true;
    if (state.mode) autoMode.value = state.mode;
  
    if (state.mode == 'count' && state.requests) {
      autoCount.value = state.requests;
      autoCountLeft.value = state.requests;
    }
  
    if (state.mode == 'time' && state.timestamp) {
      const delta = state.timestamp - Date.now();
      const minutesLeft = Math.max(0, Math.floor(delta / 60000));
      if(minutesLeft > 0) {
        autoTimeLeft.value = minutesLeft;
        autoDuration.value = Math.ceil(delta / 60000);
      } else {
        autoTimeLeft.value = 0;
      }
    }
  });

  // Update localStorage whenever the mode or values change
  watch([enableAutoApprovals, autoMode, autoCount, autoDuration], () => {
    if (!enableAutoApprovals.value) return;

    if (autoMode.value === "forever") {
      settingsStore.setAutoApproveState(sessionId.value, { mode: "forever" });
    } else if (autoMode.value === "count") {
      const remainingRequests = autoCount.value ? autoCount.value : null;
      settingsStore.setAutoApproveState(sessionId.value, { mode: "count", requests: remainingRequests });
      autoCountLeft.value = autoCount.value;
    } else if (autoMode.value === "time") {
      const expiresAt = autoDuration.value ? Date.now() + autoDuration.value * 60000 : null;
      settingsStore.setAutoApproveState(sessionId.value, { mode: "time", timestamp: expiresAt });
      autoTimeLeft.value = autoDuration.value;
    }
  });
</script> 

<template>
  <q-dialog v-model="showDialog" transition-show="scale" transition-hide="scale" @hide="emit('hide')">
    <q-card>
      <fieldset class="dialogFieldset"> 
        <legend style="font-size: large;">Manage Session</legend>

        <div style="display: flex; flex-direction: column; gap: 1rem">
          <div style="display: flex; align-items: center;">
            <img :src="dappMetadata.icons[0] ?? ''" style="display: flex; height: 55px; width: 55px;">
            <div style="margin-left: 10px;">
              <div>{{ dappMetadata.name + displaySessionId }}</div>
              <a :href="dappMetadata.url">{{ dappMetadata.url }}</a>
            </div>
          </div>

          <div>
            Enable Auto-Approvals
            <Toggle v-model="enableAutoApprovals" @change="toggleRadioButtons" style="vertical-align: middle;display: inline-block;"/>
          </div>

          <label class="radio-option">
            <input type="radio" value="forever" v-model="autoMode" :disabled="!enableAutoApprovals"/>
            Forever
          </label>
          
          <label class="radio-option">
            <input type="radio" value="count" v-model="autoMode" :disabled="!enableAutoApprovals" />
            For
            <input type="number" min="1" v-model.number="autoCount" :disabled="autoMode !== 'count'" />
            requests
            <span v-if="autoMode === 'count' && autoCountLeft != undefined">({{ autoCountLeft }} left)</span>
          </label>
          <label class="radio-option">
            <input type="radio" value="time" v-model="autoMode" :disabled="!enableAutoApprovals" />
            For
            <input type="number" min="1" v-model.number="autoDuration" :disabled="autoMode !== 'time'" />
            minutes
            <span v-if="autoMode === 'time' && autoTimeLeft != undefined">({{ autoTimeLeft }} left)</span>
          </label>

        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset{
    padding: 2rem 3rem 3rem 3rem;
    width: 500px;
    max-width: 100%;
    background-color: white
  }
  body.dark .dialogFieldset {
    background-color: #050a14;
  }
  .q-card{
    box-shadow: none;
    background: none;
  }
  .radio-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }
  .radio-option input[type="number"] {
    width: 60px;
  }
</style>