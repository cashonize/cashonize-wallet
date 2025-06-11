import { boot } from 'quasar/wrappers';
import { defineCustomElements } from '@bitjson/qr-code';

export default boot(() => {
  // Call defineCustomElements once globally to register the <qr-code> web component.
  // This ensures it's available to all Vue components from app startup.
  defineCustomElements(window);
});