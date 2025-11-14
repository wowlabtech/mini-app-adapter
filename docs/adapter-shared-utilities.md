# Adapter Shared Utilities (Step 2)

Цель Step 2 — собрать повторяющуюся логику платформенных адаптеров в переиспользуемые блоки, чтобы следующие этапы (capability parity, telemetry, hooks) опирались на единые API.

## Safe Area & Viewport helpers

| Helper | Назначение | Где используется |
| --- | --- | --- |
| `computeCombinedSafeArea({ environment, viewport, css, minimum })` | Складывает платформенные safe area, viewport insets и CSS env vars без двойного счета | `BaseMiniAppAdapter.computeSafeArea`, `VKMiniAppAdapter` overlay-insets |
| `readCssSafeArea()` | Считывает `env(safe-area-inset-*)` из `document.documentElement` | Вызывается из базового адаптера и VK safe-area merge |
| `createSafeAreaWatcher({ getSafeArea, onChange })` | Следит за `resize`/`orientationchange`, пересчитывает safe area и уведомляет адаптер | `VKMiniAppAdapter.startViewportTracking`, готово к переиспользованию в Web |
| `ensureViewportMounted({ sdkViewport, fallbackMount })` | Унифицирует подключение Telegram viewport API перед fullscreen/binding | `TelegramMiniAppAdapter.requestFullscreen` |
| `bindViewportCssVars({ sdkViewport, fallbackMount, bindCssVars })` | Монтирует и биндинит Telegram viewport CSS vars с защитой от повторов | `TelegramMiniAppAdapter.prepareViewport` |

## Bridge / capability helpers

| Helper | Назначение | Кому нужен |
| --- | --- | --- |
| `ensureFeature(fn, ...args)` | Безопасный вызов feature API с проверкой `isAvailable`/try-catch, возвращает `{ ok, value }` | Telegram haptics/popup/swipe, Web fallback |
| `isBridgeMethodSupported(methodName)` | Объединить проверку `bridge.supportsAsync` (VK) и аналогичные проверки у MAX/Telegram | VK (`VKWebApp*`), потенциально MAX | 
| `createCapabilityGuard(adapter, capability, predicate)` | Позволяет централизованно описать capability map и переиспользовать в Step 3 | Все адаптеры |

## Misc utilities

| Helper | Назначение |
| --- | --- |
| `withCssEnvFallback(element, vars)` | Подстановка CSS env-safe-area в inline стили (для web overlay’ев) |
| `createMediaQueryListener(query, handler)` | Единая регистрация matchMedia слушателей (повторяется в `useAdapterTheme`, `VKMiniAppAdapter`) |
| `triggerFileDownload(url, fileName, { preferBlob })` | Общий blob/anchor download helper для браузера | `BaseMiniAppAdapter.downloadFile`, `WebMiniAppAdapter.downloadFile` |

## План внедрения

1. ✅ `src/lib/safeArea.ts`: `readCssSafeArea`, `computeCombinedSafeArea`, `createSafeAreaWatcher` + интеграция в Base/VK.
2. ✅ `src/lib/viewport.ts`: `ensureViewportMounted`, `bindViewportCssVars` и переход Telegram на общий код.
3. ✅ `src/lib/bridge.ts`: `ensureFeature`, `isBridgeMethodSupported` (гварды подключены к Telegram/VK).
4. ◻️ Вынести оставшиеся misc-хелперы (`withCssEnvFallback`, `createMediaQueryListener`) и подключить Web/hooks.
5. ◻️ Обновить `useSafeArea`/`useAdapterTheme` и подготовить capability guard перед Step 3.

Результат Step 2 — платформа-агностичные утилиты и подготовленный contract для Step 3/4/5.
