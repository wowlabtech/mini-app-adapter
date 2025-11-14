# Adapter lifecycle audit

Промежуточные заметки по Step 1 (lifecycle cleanup). Фиксируем все места, где адаптеры вешают слушателей/таймеры/ресурсы, и отмечаем текущее состояние очистки.

## BaseMiniAppAdapter

| Ресурс | Где добавляется | Очистка сейчас | Комментарий |
| --- | --- | --- | --- |
| `window.resize` | конструктор (`cssResizeHandler`) | `BaseMiniAppAdapter.dispose()` снимает, но метод нигде не вызывается | Нужен единый `destroy()` и регистрация обработчиков через менеджер.
| Scroll guards (`overscrollBehavior`, `touchAction`) | `applyScrollGuards()` в конструкторе | `scrollLockCleanup` вызывается в `dispose()` | Аналогично, cleanup не вызывается без общего `destroy()`.
| Подписчики environment | `subscribe()` кладёт лиснер в `Set` | Нет глобового сброса | При `destroy()` надо чистить `listeners`, иначе колбэки висят на адаптере в памяти.

## TelegramMiniAppAdapter

| Ресурс | Где вешается | Есть ли dispose | Проблема |
| --- | --- | --- | --- |
| `backButton.onClick` | `onBackButton` сохраняет disposer в `backHandlers` | Снимается только при ручном dispose callback | При смене адаптера нужны массовые `cleanup()` + `backButton.hide()`.
| Appearance watcher (`themeParams.isDark.sub`) | `setupAppearanceWatcher()` | `disposeAppearanceWatcher` вызывается только при повторном setup | Нужен вызов при уничтожении.
| Active watcher (`miniApp.isActive.sub`) | `setupActiveWatcher()` | `disposeActiveWatcher` только при пересоздании | Нужно снимать в `destroy()`.
| View listeners (`viewHideListeners`, `viewRestoreListeners`) | `onViewHide/onViewRestore` | Нет | Коллекции растут, слушатели не снимаются автоматически.
| Viewport mounts (`window` state) | `prepareViewport` / `ensureViewportMounted` | Нет | При уничтожении стоит отзывать CSS биндинги/viewport, либо хотя бы сбрасывать ссылки.

## VKMiniAppAdapter

| Ресурс | Где вешается | Очистка | Примечание |
| --- | --- | --- | --- |
| `bridge.subscribe` | `init` | `dispose()` снимает | Хорошо, но `dispose()` публичен, не вызывается автоматически и не зовёт `super.dispose()`.
| `window.resize`/`orientationchange` | `startViewportTracking()` | `stopViewportTracking()` внутри `dispose()` | Аналогично, нужен общий `destroy()`.
| View listeners | Sets `viewHideListeners`, `viewRestoreListeners` | `dispose()` просто `clear()`, колбэки не уведомляются | Нормально, но надо также чистить в базовом `destroy()` и вызывать `super.dispose()`.
| Safe area state | вычисляется через `computeSafeArea` | --- | После destroy стоит сбрасывать `environment.safeArea`.

## MaxMiniAppAdapter

| Ресурс | Где вешается | Очистка | Комментарий |
| --- | --- | --- | --- |
| Back button handlers (`BackButton.onClick`) | `onBackButton` | Снимается только когда пользователь вызывает disposer | Нет глобового cleanup; при отписке стоит прятать кнопку и очищать все хендлеры.
| Кастомное событие `WebAppRequestPhone` | `requestPhoneViaEvent` | Н/Д | Одноразово, но `styleTag` не снимается (см. Web адаптер).

## WebMiniAppAdapter

| Ресурс | Где вешается | Очистка | Комментарий |
| --- | --- | --- | --- |
| DOM overlay для QR | `scanQRCode` | overlay удаляется | OK.
| Style tag с анимацией | `scanQRCode` | **Не** удаляется | Надо удалять перед resolve, иначе стиль остаётся навсегда.
| `closeBtn.onclick` | `scanQRCode` | очищается через удаление overlay | OK.

## Глобальные пробелы

1. Нет унифицированного `destroy()`/`dispose()` контракта в интерфейсе `MiniAppAdapter`, поэтому адаптеры не умеют гарантированно очищать ресурсы при размонтировании.
2. Подписки и слушатели регистрируются вручную (maps/sets), из-за чего легко пропустить очистку.
3. Веб-сканер оставляет `style` в `<head>`, что вызывает утечку.
4. Telegram/VK не вызывают `super.dispose()`, потому что базовый метод защищён и недоступен снаружи.

## Что делать на Step 1

- Добавить в интерфейс `MiniAppAdapter` методы `destroy()` и/или `dispose()`; реализовать в `BaseMiniAppAdapter` публичный `destroy` с менеджером ресурсов.
- Ввести helper `createDisposableBag()` (или встроить в базовый класс) c методами `add(fn)` / `runAll()`.
- Перенести все подписки (`window`, `bridge`, `sub`, `backButton`, `view listeners`, `qrScanner`, стили и т.д.) на регистрацию через этот менеджер.
- После внедрения – вызывать `super.destroy()` в адаптерах и чистить их локальное состояние.
- Для Web адаптера явно удалять временный `<style>`.

Эти записи закрывают Step 1.1 (аудит) и служат чек-листом для последующих подшагов.
