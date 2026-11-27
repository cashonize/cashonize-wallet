<script setup lang="ts">
  // What a token card's "info" opens: the creator's description, then the facts as a labelled
  // list, then the way out to an explorer. Rendered only while open, so a long token list pays
  // nothing for it.
  import { computed, onMounted, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { sanitizeUrl } from 'src/utils/utils'
  import type { ParsedField } from 'src/parsing/nftParsing'
  const { t } = useI18n()

  // a note follows the value in the secondary text style, as a currency value does an amount
  interface Fact { label: string, value: string, mono?: boolean, note?: string }

  const props = defineProps<{
    description?: string | undefined,
    facts?: Fact[],
    // an NFT's parsed data and its attributes, each a list under a caption of its own
    parsedFields?: ParsedField[] | undefined,
    parsedTitle?: string | undefined,
    // the registry's attributes extension, which only a flat record of is shown
    attributes?: string | Record<string, string | Record<string, string>> | undefined,
    webUrl?: string | undefined,
    // lists under captions of their own that are not the token's metadata, such as market data
    moreSections?: { title: string, facts: Fact[] }[],
    // with a category the panel ends in the explorer link
    category?: string,
  }>()

  // A creator can write a page of description, so it opens cut to a few lines; whether there is
  // more to show is read off the rendered text, which depends on the card's width
  const lead = ref<HTMLElement>()
  const showFull = ref(false)
  const overflowing = ref(false)
  onMounted(() => {
    if (lead.value) overflowing.value = lead.value.scrollHeight > lead.value.clientHeight + 1
  })

  const sections = computed(() => {
    const parsed = (props.parsedFields ?? []).map((field, index) => ({
      label: field.name ?? field.fieldId ?? t('tokenItem.info.field', { index }),
      value: field.parsedValue?.formatted ?? field.value,
    }))
    const attributeRecord = typeof props.attributes === 'object' ? props.attributes : {}
    const attributes = Object.entries(attributeRecord).map(([label, value]) => ({
      label,
      value: (typeof value === 'string' ? value : JSON.stringify(value)) || t('tokenItem.empty'),
    }))
    return [
      { title: props.parsedTitle ?? t('tokenItem.info.parsedFields'), facts: parsed },
      { title: t('tokenItem.info.nftAttributes'), facts: attributes },
      ...(props.moreSections ?? []),
    ].filter(section => section.facts.length)
  })

  const safeWebUrl = computed(() => props.webUrl ? sanitizeUrl(props.webUrl) : undefined)
  // the link is shown as the address it leads to, in full but for the scheme: on x.com the path is the profile
  const webAddress = computed(() => safeWebUrl.value?.replace(/^https:\/\//, '').replace(/\/$/, ''))
  // A plain http address is an old website rather than an abuse of the link, so it is shown to
  // read and copy, but not linked: the apps open only https, and the page can be altered on its way
  const httpWebUrl = computed(() => {
    if (!props.webUrl || safeWebUrl.value) return undefined
    try {
      const parsed = new URL(props.webUrl)
      return parsed.protocol === 'http:' ? parsed.href : undefined
    } catch {
      return undefined
    }
  })
</script>

<template>
  <div class="tokenAction infoPanel">
    <div v-if="description" class="infoLead">
      <p ref="lead" :class="{ clamped: !showFull }">{{ description }}</p>
      <span v-if="overflowing" class="action-link" @click="showFull = !showFull">
        {{ showFull ? t('tokenItem.info.showLess') : t('tokenItem.info.showFull') }}
      </span>
    </div>

    <dl v-if="facts?.length || webUrl" class="infoFacts">
      <div v-for="fact in facts" :key="fact.label">
        <dt>{{ fact.label }}</dt>
        <dd :class="{ mono: fact.mono }">{{ fact.value }}</dd>
      </div>
      <div v-if="webUrl">
        <dt>{{ t('tokenItem.info.website') }}</dt>
        <dd>
          <a v-if="safeWebUrl" :href="safeWebUrl" target="_blank">{{ webAddress }}</a>
          <template v-else-if="httpWebUrl">
            {{ httpWebUrl }} <span class="infoNote">{{ t('tokenItem.info.notHttps') }}</span>
          </template>
          <span v-else style="color: var(--color-error);">{{ t('common.unsafeUrl') }}</span>
        </dd>
      </div>
    </dl>

    <template v-for="section in sections" :key="section.title">
      <div class="infoCaption">{{ section.title }}</div>
      <dl class="infoFacts">
        <div v-for="(fact, index) in section.facts" :key="index">
          <dt>{{ fact.label }}</dt>
          <dd>{{ fact.value }} <span v-if="'note' in fact && fact.note" class="infoNote">{{ fact.note }}</span></dd>
        </div>
      </dl>
    </template>

    <a v-if="category" class="infoLink" :href="'https://tokenexplorer.cash/?tokenId=' + category" target="_blank">
      <span>{{ t('tokenItem.info.seeDetailsOnExplorer') }}</span>
      <q-icon name="open_in_new" size="16px" />
    </a>
  </div>
</template>

<style scoped>
.infoPanel {
  border: 1px solid var(--surface-line);
  border-radius: 8px;
  background: var(--surface-faint);
  overflow: hidden;
}
.infoPanel > * + * {
  border-top: 1px solid var(--surface-line);
}
.infoLead {
  padding: 12px;
}
.infoLead p {
  max-width: 70ch;
  margin: 0;
  line-height: 1.45;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.infoLead p.clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 10;
  line-clamp: 10;
  overflow: hidden;
}
.infoLead .action-link {
  display: inline-block;
  margin-top: 6px;
  font-size: smaller;
}
/* a column of grey labels beside their values, stacked where the card is narrow */
.infoFacts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 18px;
  margin: 0;
  padding: 10px 12px;
}
.infoFacts > div {
  display: contents;
}
.infoFacts dt {
  color: grey;
  font-size: smaller;
  font-weight: normal;
  align-self: baseline;
}
.infoFacts dd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.infoFacts dd.mono {
  font-size: smaller;
}
.infoNote {
  color: grey;
  font-size: smaller;
  white-space: nowrap;
}
.infoCaption {
  padding: 8px 12px 0;
  color: grey;
  font-size: smaller;
}
.infoCaption + .infoFacts {
  border-top: none;
}
.infoLink {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 8px 12px;
  color: var(--font-color);
}
.infoLink span {
  flex: 1;
}
.infoLink .q-icon {
  opacity: 0.6;
}
.infoLink:hover {
  opacity: 1;
  background: var(--surface-strong);
}
@media only screen and (max-width: 570px) {
  .infoFacts {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
  .infoFacts dd {
    margin-bottom: 8px;
  }
  .infoFacts > div:last-child dd {
    margin-bottom: 0;
  }
}
</style>
