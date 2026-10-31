import { defineBoot } from '#q-app';
import { createI18n } from 'vue-i18n';
import { defaultLocale, defaultMessages, isSupportedLocale, loadLocaleMessages, type MessageSchema } from 'src/i18n';

function getInitialLocale(): string {
  const stored = localStorage.getItem('locale');
  if (stored && isSupportedLocale(stored)) return stored;
  // Only use browser language if it's a supported locale
  const browserLang = navigator.language?.split('-')[0] ?? '';
  return isSupportedLocale(browserLang) ? browserLang : defaultLocale;
}

// Starts in English; the boot below switches to the chosen language once its messages are loaded
export const i18n = createI18n<[MessageSchema], string, false>({
  legacy: false,  // Composition API mode
  locale: defaultLocale,
  fallbackLocale: defaultLocale,
  messages: { [defaultLocale]: defaultMessages }
});

// the last language asked for, so a slow load cannot override a later pick
let requestedLocale = defaultLocale;

// Loads the language's messages if this session has not yet, then switches to it.
// Throws when the load fails (a web tab left open across a deploy can ask for a chunk the host no longer serves),
// leaving the current language in place. Returns false when a later pick took over while this one loaded.
export async function switchLocale(locale: string): Promise<boolean> {
  requestedLocale = locale;
  if (!i18n.global.availableLocales.includes(locale)) {
    const messages = await loadLocaleMessages(locale);
    i18n.global.setLocaleMessage(locale, messages);
  }
  if (requestedLocale !== locale) return false;
  i18n.global.locale.value = locale;
  return true;
}

export default defineBoot(async ({ app }) => {
  app.use(i18n);
  // Quasar waits for this before mounting, so the app never shows English first,
  // and the i18n.global.t calls in stores and utils already see the chosen language
  const initialLocale = getInitialLocale();
  if (initialLocale === defaultLocale) return;
  try {
    await switchLocale(initialLocale);
  } catch (error) {
    // the stored choice is kept, so the next start tries again
    console.error(`Failed to load the ${initialLocale} translations, starting in English`, error);
  }
});
