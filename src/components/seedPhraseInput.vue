<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { bip39WordListEnglish } from '@bitauth/libauth'

  const emit = defineEmits<{
    'update:modelValue': [value: string]
    'update:isValid': [value: boolean]
  }>()

  defineProps<{
    modelValue?: string
    isValid?: boolean
  }>()

  const seedWords = ref<string[]>(Array(12).fill(''))
  const seedWordCount = ref<12 | 24>(12)
  const touchedWords = ref<Set<number>>(new Set())
  // Template refs for input elements, used to programmatically focus the next field after paste
  const inputRefs = ref<(HTMLInputElement | null)[]>([])

  // Constructed full seed phrase from individual word inputs
  const constructedSeedPhrase = computed(() => {
    return seedWords.value.map(w => w.trim().toLowerCase()).filter(w => w).join(' ')
  })

  // Check if all seed words are valid BIP39 words
  const allSeedWordsValid = computed(() => {
    const filledWords = seedWords.value.map(w => w.trim().toLowerCase()).filter(w => w)
    if (filledWords.length !== seedWordCount.value) return false
    return filledWords.every(word => bip39WordListEnglish.includes(word))
  })

  // Emit changes to parent
  watch(constructedSeedPhrase, (value) => {
    emit('update:modelValue', value)
  })

  watch(allSeedWordsValid, (value) => {
    emit('update:isValid', value)
  }, { immediate: true })

  function isValidBip39Word(word: string): boolean {
    return bip39WordListEnglish.includes(word.trim().toLowerCase())
  }

  function getWordValidationClass(index: number): string {
    if (!touchedWords.value.has(index)) return ''
    const word = seedWords.value[index]?.trim()
    if (!word) return ''
    return isValidBip39Word(word) ? 'valid-word' : 'invalid-word'
  }

  function onWordBlur(index: number) {
    touchedWords.value.add(index)
  }

  function onWordInput(index: number) {
    const value = seedWords.value[index]
    if (!value) return
    // Check if input contains spaces (pasted multiple words)
    if (value.includes(' ')) {
      const words = value.trim().split(/\s+/)
      // Distribute words starting from current index
      for (let i = 0; i < words.length && (index + i) < seedWords.value.length; i++) {
        const word = words[i]
        if (word) seedWords.value[index + i] = word
        // Mark distributed words as touched for validation
        if (i > 0) touchedWords.value.add(index + i)
      }
      // Focus the next empty field or the field after last distributed word
      const nextIndex = Math.min(index + words.length, seedWords.value.length - 1)
      const nextInput = inputRefs.value[nextIndex]
      if (nextInput) nextInput.focus()
    }
  }

  function changeSeedWordCount(count: 12 | 24) {
    seedWordCount.value = count
    // Preserve existing words, expand or truncate array
    const newWords = Array(count).fill('')
    for (let i = 0; i < Math.min(seedWords.value.length, count); i++) {
      newWords[i] = seedWords.value[i]
    }
    seedWords.value = newWords
    // Reset touched state for removed words
    touchedWords.value = new Set([...touchedWords.value].filter(i => i < count))
  }
</script>

<template>
  <div>
    <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 15px;">
      <span>Seed phrase:</span>
      <label class="word-count-option">
        <input type="radio" :value="12" v-model="seedWordCount" @change="changeSeedWordCount(12)"> 12 words
      </label>
      <label class="word-count-option">
        <input type="radio" :value="24" v-model="seedWordCount" @change="changeSeedWordCount(24)"> 24 words
      </label>
    </div>
    <div class="seed-words-grid">
      <div v-for="(_, index) in seedWords" :key="index" class="seed-word-input">
        <span class="seed-word-number">{{ index + 1 }}</span>
        <input
          :ref="(el) => inputRefs[index] = el as HTMLInputElement"
          v-model="seedWords[index]"
          :class="getWordValidationClass(index)"
          @blur="onWordBlur(index)"
          @input="onWordInput(index)"
          type="text"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
.word-count-option {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.seed-words-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  max-width: 550px;
}
@media (max-width: 600px) {
  .seed-words-grid {
    grid-template-columns: repeat(3, 1fr);
    max-width: 450px;
  }
}
@media (max-width: 450px) {
  .seed-words-grid {
    grid-template-columns: repeat(2, 1fr);
    max-width: 300px;
  }
}
.seed-word-input {
  display: flex;
  align-items: center;
  gap: 6px;
}
.seed-word-number {
  font-size: 12px;
  color: grey;
  min-width: 20px;
  text-align: right;
}
.seed-word-input input {
  flex: 1;
  padding: 6px 8px;
  font-size: 14px;
  min-width: 0;
}
.seed-word-input input.valid-word {
  border-color: #4caf50;
  outline-color: #4caf50;
  background-color: #e8f5e9;
}
.seed-word-input input.invalid-word {
  border-color: #f44336;
  outline-color: #f44336;
  background-color: #ffebee;
}
body.dark .seed-word-input input.valid-word {
  background-color: #1b3d1f;
  color: #a5d6a7;
}
body.dark .seed-word-input input.invalid-word {
  background-color: #3d1b1b;
  color: #ef9a9a;
}
</style>
