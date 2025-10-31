# twm-adapter

Cross-platform adapter toolkit for **Telegram**, **VK**, and **MAX** mini apps.  
Install the package to access unified platform detection, capability checks, and ready-made adapters.

## Features

- Core adapters: `MaxMiniAppAdapter`, `TelegramMiniAppAdapter`, `VKMiniAppAdapter`, `WebMiniAppAdapter`
- React helpers: `AdapterProvider`, `useMiniAppAdapter`
- Capability-aware API (haptics, back button visibility, QR scanning, popups, closing behaviour)
- TypeScript definitions exported from `src/index.ts`

## Install

```bash
npm install twm-adapter
```

## Usage

```ts
import { createAdapter } from 'twm-adapter';

const adapter = createAdapter(); // auto-detects platform
await adapter.init();

if (adapter.supports('haptics')) {
  adapter.vibrateSelection();
}
```

React integration:

```tsx
import { AdapterProvider, createAdapter } from 'twm-adapter';

const adapter = createAdapter();

function Root() {
  return (
    <AdapterProvider adapter={adapter}>
      <App />
    </AdapterProvider>
  );
}
```

## Build & publish (private)

1. Update `version` in `package.json`.
2. Build the distributables:
   ```bash
   npm run build
   ```
   Produces `dist/index.{js,cjs,d.ts}` via `tsup`.
3. Publish as a restricted package:
   ```bash
   npm publish --access restricted
   ```

`react` and `react-dom` are peer dependencies to keep consumer bundles lean, while the `exports` map exposes both ESM and CJS entry points.
