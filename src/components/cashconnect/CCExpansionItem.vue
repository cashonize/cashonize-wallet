<script setup lang="ts">
// NOTE: I wanted to use Quasar's Built-In Expansion Item here, but there's some hard-to-resolve CSS conflicts.
//       The main one is to do with the "text-caption" class - which I didn't want to risk over-writing, lest it subtly destroys CSS stylign elsewhere.
//       (It looks like it'd been silenced for a reason - and the Quasar Framework CSS is dated/hard-to-work with compared to more modern standards).
import { ref, useSlots } from 'vue'

// Props definition
const props = defineProps<{
  title: string;
  caption: string;
}>()

const slots = useSlots();

// State to track expansion state
const isExpanded = ref(false)
const activeTab = ref('resolved');

// Toggle expansion state
const toggle = () => {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <div class="expansion-item">
    <div
      class="expansion-header cursor-pointer"
      @click="toggle"
      :aria-expanded="isExpanded"
    >
      <div class="row items-center">
        <div class="col-grow">
          <div class="green">{{ props.title }}</div>
          <div class="caption">{{ props.caption }}</div>
        </div>
        <div class="col-shrink">
          <q-icon :name="isExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'" />
        </div>
      </div>
    </div>
    <div v-if="isExpanded" class="q-pb-lg">
      <slot></slot>

      <template v-if="slots.resolved || slots.instruction">
        <q-tabs v-model="activeTab" active-class="green" dense>
          <q-tab name="resolved" label="Resolved" />
          <q-tab name="instruction" label="Instruction" />
        </q-tabs>
        <slot v-if="activeTab === 'instruction'" name="instruction"></slot>
        <slot v-if="activeTab === 'resolved'" name="resolved"></slot>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.caption {
  font-size: small;
  font-style: italic;
}
</style>
