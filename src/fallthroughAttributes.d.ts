// Quasar's components render one root element and pass undeclared attributes and listeners on to
// it, but their types list only their own props, so a strict template check rejects a title or
// @click on them.
// TODO: remove once Vue's template check accepts native attributes and listeners on components
// typed from .d.ts, or Quasar's types declare them: delete this file and run vue-tsc.
import type { HTMLAttributes } from 'vue';

declare module 'vue' {
  // Only the native ones we use, typed as on a native element; the rest stay errors.
  // The widening is global: a component that doesn't pass attributes to a single root (several
  // roots, inheritAttrs: false) accepts them too, where Vue does not apply them.
  interface ComponentCustomProps {
    title?: HTMLAttributes['title'];
    'aria-label'?: HTMLAttributes['aria-label'];
    onClick?: HTMLAttributes['onClick'];
    onKeydown?: HTMLAttributes['onKeydown'];
  }
}
