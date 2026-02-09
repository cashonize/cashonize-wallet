import { boot } from 'quasar/wrappers';
import { createI18n } from 'vue-i18n';
import { translations, defaultLocale } from 'src/i18n';

function getInitialLocale(): string {
  const stored = localStorage.getItem('locale');
  if (stored) return stored;
  // Only use browser language if it's a supported locale
  const browserLang = navigator.language?.split('-')[0] ?? '';
  const supportedLocales = Object.keys(translations);
  return supportedLocales.includes(browserLang) ? browserLang : defaultLocale;
}

export const i18n = createI18n({
  legacy: false,  // Composition API mode
  locale: getInitialLocale(),
  fallbackLocale: defaultLocale,
  messages: translations
});

export default boot(({ app }) => {
  app.use(i18n);
});
