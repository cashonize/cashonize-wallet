<script setup lang="ts">
  // Inline click-to-edit text, used for private tx notes and address labels.
  // Displays as plain text; editing happens in place with an underlined input that
  // saves on blur or enter and cancels on escape. The empty state shows a hint with
  // an edit icon; it renders invisible so the parent can reveal it on row hover via
  // :deep(.inline-edit-hint). Sizing (flex, max-width, click target) is left to the
  // parent through classes on the component root.
  import { ref, nextTick, watch, onDeactivated } from 'vue';

  const props = defineProps<{
    value: string | undefined;
    hint: string;
    maxLength: number;
  }>();

  const emit = defineEmits<{ save: [value: string] }>();

  const editing = ref(false);
  const draft = ref("");
  const editingRef = ref<HTMLElement | null>(null);
  const inputRef = ref<HTMLInputElement | null>(null);

  async function startEdit() {
    editing.value = true;
    draft.value = props.value ?? "";
    // the input is behind a v-if, wait for the DOM update before focusing it
    await nextTick();
    inputRef.value?.focus();
  }

  function saveEdit() {
    if (!editing.value) return;
    editing.value = false;
    emit('save', draft.value);
  }

  function cancelEdit() {
    editing.value = false;
  }

  // Blur alone can't close the editor: pressing Quasar controls (pagination, toggles)
  // prevents default on mousedown, so the input never blurs. Watch presses at the
  // document level while editing and close on any press outside the edit field.
  function handleGlobalMousedown(event: MouseEvent) {
    if (!editingRef.value?.contains(event.target as Node)) saveEdit();
  }

  watch(editing, (isEditing, _prev, onCleanup) => {
    if (!isEditing) return;
    document.addEventListener('mousedown', handleGlobalMousedown, true);
    onCleanup(() => document.removeEventListener('mousedown', handleGlobalMousedown, true));
  });

  // close an open editor when navigating away from the containing KeepAlive view
  onDeactivated(saveEdit);
</script>

<template>
  <div v-if="editing" ref="editingRef" class="inline-edit inline-edit-editing" @click.stop>
    <input
      ref="inputRef"
      v-model="draft"
      class="inline-edit-input"
      type="text"
      :maxlength="maxLength"
      autocomplete="off"
      spellcheck="false"
      @blur="saveEdit"
      @keyup.enter="saveEdit"
      @keyup.esc="cancelEdit"
    >
    <!-- silent maxlength truncation is confusing, show the limit when writing gets close -->
    <span
      v-if="draft.length >= maxLength - 20"
      class="inline-edit-counter"
      :class="{ 'at-limit': draft.length >= maxLength }"
    >{{ draft.length }}/{{ maxLength }}</span>
  </div>
  <div v-else-if="value" class="inline-edit" :title="value" @click.stop="startEdit()">{{ value }}</div>
  <div v-else class="inline-edit inline-edit-add" @click.stop="startEdit()">
    <span class="inline-edit-hint">{{ hint }} <q-icon name="edit" size="14px" /></span>
  </div>
</template>

<style scoped>
.inline-edit {
  min-width: 0;
  text-align: center;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
}

.inline-edit-editing {
  display: flex;
  align-items: center;
  gap: 6px;
}

.inline-edit-counter {
  font-size: 0.75em;
  opacity: 0.6;
}

.inline-edit-counter.at-limit {
  color: #e6a23c;
  opacity: 1;
}

/* invisible by default, the parent reveals it on row hover */
.inline-edit-hint {
  opacity: 0;
  transition: opacity 0.2s;
}

.inline-edit-hint .q-icon {
  vertical-align: -0.15em;
}

/* plain underlined input; the focused state needs the same overrides or the
   global chota input rules bring back the border and focus ring */
.inline-edit-input,
.inline-edit-input:focus {
  flex: 1 1 0;
  min-width: 0;
  text-align: center;
  font-size: inherit;
  color: inherit;
  background: transparent;
  border: none;
  outline: none;
  box-shadow: none;
  border-bottom: 1px solid var(--color-primary);
  border-radius: 0;
  padding: 0 4px 1px;
  margin: 0;
}
</style>
