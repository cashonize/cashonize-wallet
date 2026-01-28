// Mock browser globals for tests that import modules using localStorage/navigator
// (e.g., src/boot/i18n.ts is imported by src/utils/utils.ts)
// We use a minimal mock rather than jsdom to keep tests lightweight.
// Properties are configurable so individual tests can override with vi.stubGlobal().

const localStorageMock = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true });
