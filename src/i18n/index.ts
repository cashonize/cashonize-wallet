import en from './locales/en.json';

export const defaultLocale = 'en';
export const defaultMessages = en;

export type MessageSchema = typeof en;

// English is bundled because it is the fallback for missing keys; every other language
// is its own chunk, fetched on the web and read from disk in the Electron and Android apps
const localeLoaders: Record<string, () => Promise<{ default: MessageSchema }>> = {
  es: () => import('./locales/es.json'),
  fr: () => import('./locales/fr.json'),
  de: () => import('./locales/de.json'),
  pt: () => import('./locales/pt.json'),
};

export const supportedLocales = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' }
];

export function isSupportedLocale(locale: string): boolean {
  return supportedLocales.some(supported => supported.code === locale);
}

export async function loadLocaleMessages(locale: string): Promise<MessageSchema> {
  const loader = localeLoaders[locale];
  if (!loader) throw new Error(`Unsupported locale: ${locale}`);
  return (await loader()).default;
}
