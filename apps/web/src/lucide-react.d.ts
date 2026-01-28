// Type declarations for lucide-react direct ESM imports
// These are used for better tree-shaking instead of barrel imports
// See: https://lucide.dev/guide/packages/lucide-react#tree-shaking

declare module 'lucide-react/dist/esm/icons/*' {
  import { LucideIcon } from 'lucide-react';
  const icon: LucideIcon;
  export default icon;
}
