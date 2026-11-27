<script setup lang="ts">
  import BackRow from 'src/components/general/BackRow.vue'
  import { useI18n } from 'vue-i18n'
  import { useStore } from 'src/stores/store'
  import EmojiItem from './general/emojiItem.vue'
  const store = useStore()
  const { t } = useI18n()

  const isBrowser = import.meta.env.QUASAR_SPA_MODE;
  const isCapacitor = import.meta.env.QUASAR_CAPACITOR_MODE;
  const isDesktop = import.meta.env.QUASAR_ELECTRON_MODE;
  const applicationVersion = import.meta.env.version

  const releasesUrl = 'https://github.com/cashonize/cashonize-wallet/releases/latest'
  const links = [
    { icon: 'language', label: 'aboutCashonize.learnMore', href: 'https://about.cashonize.com' },
    // the web wallet is where someone still has an app to get
    ...(isBrowser ? [{ icon: 'download', label: 'aboutCashonize.downloadPage', href: releasesUrl }] : []),
    { icon: 'code', label: 'aboutCashonize.viewSource', href: 'https://github.com/cashonize/cashonize-wallet' },
    { icon: 'fab_x', label: 'aboutCashonize.followOnX', href: 'https://x.com/cashonize' },
    { icon: 'fab_telegram', label: 'aboutCashonize.joinTelegram', href: 'https://t.me/cashonize' },
  ]
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('aboutCashonize.title') }}</legend>
    <BackRow @click="store.goBack()" />

    <div class="about">
      <div class="about-head">
        <img src="images/cashonize-icon.png" width="56" height="56" alt="">
        <div>
          <div class="about-name">Cashonize</div>
          <div class="description" style="font-size: smaller;">
            {{ t('settings.version', { version: applicationVersion }) }}
            <span v-if="isDesktop && store.latestGithubRelease && store.latestGithubRelease == 'v'+applicationVersion">{{ t('settings.latest') }}</span>
            <span v-if="isDesktop && store.latestGithubRelease && store.latestGithubRelease !== 'v'+applicationVersion">
              <i18n-t keypath="settings.latestRelease" tag="span">
                <template #version>
                  <a :href="releasesUrl" target="_blank">{{ store.latestGithubRelease }}</a>
                </template>
              </i18n-t>
            </span>
          </div>
        </div>
      </div>

      <p style="margin-bottom: 4px;">{{ t('aboutCashonize.description') }}</p>
      <p class="description">{{ t('aboutCashonize.tagline') }}</p>

      <div class="about-links">
        <a v-for="link in links" :key="link.href" :href="link.href" target="_blank">
          <q-icon :name="link.icon" size="20px" class="about-link-icon" />
          <span style="flex: 1;">{{ t(link.label) }}</span>
          <q-icon name="open_in_new" size="16px" class="about-link-icon" />
        </a>
      </div>

      <div class="description" style="font-size: smaller;">
        <div v-if="isCapacitor || isDesktop" style="font-style: italic; margin-bottom: 6px;">
          {{ isCapacitor ? t('aboutCashonize.logoHintTaps') : t('aboutCashonize.logoHintClicks') }}
        </div>
        <a style="color: inherit;" href="https://x.com/GeukensMathieu" target="_blank">
          <i18n-t keypath="settings.madeWith" tag="span">
            <template #heart>
              <EmojiItem emoji="💚" :sizePx="16" style="vertical-align: sub;" />
            </template>
          </i18n-t>
        </a>
      </div>
    </div>
  </fieldset>
</template>

<style scoped>
/* the same narrow column as the menu page it is opened from */
.about {
  max-width: 560px;
}
.about-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 4px 0 18px;
}
.about-head img {
  border-radius: 12px;
}
.about-name {
  font-size: 1.4em;
  font-weight: 600;
  line-height: 1.2;
}
.about-links {
  margin: 18px 0 14px;
  border: 1px solid var(--surface-line);
  border-radius: 8px;
  overflow: hidden;
}
/* rows like the menu page's, as links out of the app */
.about-links a {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 8px 12px 8px 10px;
  color: var(--font-color);
}
.about-links a + a {
  border-top: 1px solid var(--surface-line);
}
.about-links a:hover {
  opacity: 1;
  background: var(--surface-strong);
}
.about-link-icon {
  flex: none;
  opacity: 0.6;
}
</style>
