# Mini App Adapter

Набор адаптеров и React-хуков, который выравнивает API популярных mini-app платформ (Telegram, VK, MAX, Web и фирменные Shell-контейнеры) и позволяет переиспользовать бизнес-логику без платформенных `if/else`.

## Возможности
- Автоопределение платформы (`detectPlatform`) и универсальный фабричный метод `createAdapter()`.
- Единый `MiniAppAdapter` контракт: цвета интерфейса, back button, popup, QR-сканер, шэринг, haptics, clipboard, push-токен и deep-link события.
- React-провайдер `AdapterProvider` с хуками `useMiniAppAdapter`, `useAdapterTheme`, `useSafeArea`.
- VK-пиксель и конверсионная аналитика (`configureVkPixel`, `trackConversionEvent`, `trackPixelEvent`).
- Встроенный shell-bridge (push токены, deep links, нативный QR, запрос токена / пуш-разрешений).

## Поддерживаемые платформы
| Платформа | Адаптер | Особенности |
| --- | --- | --- |
| Telegram Mini Apps | `TelegramMiniAppAdapter` | Поддержка `tg-back-button`, viewport CSS vars, haptics. |
| VK Mini Apps | `VKMiniAppAdapter` | VK Bridge, safe-area watcher, pixel конверсии. |
| MAX Mini Apps | `MaxMiniAppAdapter` | Встроенные popup/share/requestPhone вызовы. |
| Shell (iOS / Android) | `ShellMiniAppAdapter` | Вызовы через NativeBridge: QR, push токены, deep links. |
| Web fallback | `WebMiniAppAdapter` | Degraded функциональность в браузере без vendor SDK. |

## Установка
```bash
npm install @wowlabtech/mini-app-adapter
# или
yarn add @wowlabtech/mini-app-adapter
```
> Пакет ожидает `react` и `react-dom` версии 19+ как `peerDependencies`.

## Быстрый старт
```tsx
import { createAdapter, AdapterProvider } from '@wowlabtech/mini-app-adapter';
import { createRoot } from 'react-dom/client';
import App from './App';

async function bootstrap() {
  const adapter = createAdapter({ vk: { pixelCode: 'VK-XXXX' } });
  await adapter.init({ debug: import.meta.env.DEV });

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <AdapterProvider adapter={adapter}>
      <App />
    </AdapterProvider>,
  );
}

bootstrap();
```

## Использование адаптера
```ts
import { createAdapter } from '@wowlabtech/mini-app-adapter';

const adapter = createAdapter('telegram');
await adapter.init({ eruda: true });

adapter.setColors({ header: '#0a0a0a', background: '#ffffff' });
adapter.onBackButton(() => adapter.closeApp());
adapter.showPopup({ title: 'Готово', message: 'Данные сохранены' });
const qr = await adapter.scanQRCode();
```

### React-хуки
- `useMiniAppAdapter()` — быстрый доступ к активному адаптеру внутри компонентов.
- `useAdapterTheme()` — хранит пользовательское предпочтение (`system` / `light` / `dark`) и синхронизирует `adapter.setColors`.
- `useSafeArea()` — объединяет CSS/env/viewport-инсеты и возвращает `{ top, right, bottom, left }`.

### Shell API
```ts
import { shell, requestShellPushPermission, storeShellToken } from '@wowlabtech/mini-app-adapter';

shell.onPushToken((token) => console.log('native push token', token));
shell.onDeepLink((path) => console.log('deep link', path));
const value = await shell.openNativeQR();
requestShellPushPermission();
storeShellToken({ token: 'abc', source: 'vk' });
```

### Аналитика VK
```ts
import { configureVkPixel, trackPixelEvent, trackConversionEvent } from '@wowlabtech/mini-app-adapter';

configureVkPixel('VK-123456');
trackConversionEvent('purchase', { amount: 990, currency: 'RUB' });
trackPixelEvent('ViewContent', { sku: 'SKU-1' });
```

## Дополнительные материалы
- `docs/adapter-lifecycle-audit.md` — заметки по очистке ресурсов и lifecycle.
- `docs/adapter-shared-utilities.md` — обзор общих утилит (safe area, viewport, bridge-хелперы).

## Скрипты разработки
- `npm run build` — компиляция через `tsup` (`dist/`).
- `npm run build:watch` — сборка в watch-режиме.
- `npm run lint` / `npm run lint:fix` — ESLint с правилами React + TypeScript.

## Лицензия
MIT (см. `package.json`).
