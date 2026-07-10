import type {
  ImpactHapticFeedbackStyle,
  NotificationHapticFeedbackType,
} from '@tma.js/bridge';

import {
  backButton,
  emitEvent,
  hapticFeedback,
  init as initSDK,
  initData,
  mockTelegramEnv,
  miniApp,
  openLink,
  popup,
  qrScanner,
  postEvent,
  retrieveLaunchParams,
  retrieveRawLaunchParams,
  setDebug,
  themeParams,
  viewport,
} from '@tma.js/sdk-react';
import {
  decodeStartParam,
  closingBehavior,
  requestContact,
  swipeBehavior,
  viewport as rawViewport,
  shareURL as shareURLSdk,
  copyTextToClipboard as copyTextToClipboardSdk,
  downloadFile as downloadFileSdk,
  shareStory as shareStorySdk,
  addToHomeScreen as addToHomeScreenSdk,
  checkHomeScreenStatus as checkHomeScreenStatusSdk,
  on,
  off,
} from '@tma.js/sdk';

import { BaseMiniAppAdapter } from '@/adapters/baseAdapter';
import type {
  MiniAppCapability,
  MiniAppEnvironmentInfo,
  MiniAppInitOptions,
  MiniAppLaunchParams,
  MiniAppPopupOptions,
  MiniAppQrScanOptions,
  MiniAppShareStoryOptions,
  MiniAppViewportInsets,
} from '@/types/miniApp';
import { ensureFeature, isFeatureAvailable } from '@/lib/features';
import { ensureViewportMounted } from '@/lib/viewport';
export class TelegramMiniAppAdapter extends BaseMiniAppAdapter {
  private readonly backHandlers = new Map<() => void, () => void>();
  private readonly appearanceListeners = new Set<
    (appearance: 'dark' | 'light' | undefined) => void
  >();
  private appearanceWatcherDispose?: () => void;
  private readonly viewHideListeners = new Set<() => void>();
  private readonly viewRestoreListeners = new Set<() => void>();
  private activeWatcherDispose?: () => void;

  constructor() {
    super('telegram');
  }

  override async init(options?: MiniAppInitOptions): Promise<void> {
    if (this.ready) {
      return;
    }

    const debug = Boolean(options?.debug);
    const eruda = Boolean(options?.eruda);

    setDebug(debug);
    initSDK();

    if (!miniApp.isSupported()) {
      console.warn('[tvm-app-adapter] miniApp feature is not supported; falling back to limited mode.');
    }

    if (eruda && typeof window !== 'undefined' && window.eruda) {
      window.eruda.init();
      window.eruda.position({ x: window.innerWidth - 150, y: window.innerHeight - 150 });
    }

    // Read the real launch parameters in their raw form BEFORE mocking. Two reasons:
    //  1. We need them to decide whether this is the macOS client (catch-22: the host
    //     app can't reliably tell us via `mockForMacOS` because its own
    //     `getLaunchParams()` may have already failed on macOS).
    //  2. `mockTelegramEnv` persists the passed `launchParams` to storage so the SDK
    //     can retrieve them afterwards. If we mock WITHOUT seeding, the subsequent
    //     `retrieveLaunchParams()` reads from the now-empty mock storage and throws
    //     `LaunchParamsRetrieveError` — this is exactly what broke auth on the native
    //     Telegram for macOS client while Windows/mobile kept working.
    let rawLaunchParams: string | undefined;
    try {
      rawLaunchParams = retrieveRawLaunchParams();
    } catch {
      rawLaunchParams = undefined;
    }

    // Only mock when we actually have params to seed the mock with; an unseeded mock
    // is strictly worse than no mock (see reason #2 above).
    const shouldMockMacOS =
      (options?.mockForMacOS ?? this.isMacOsClient(rawLaunchParams)) && Boolean(rawLaunchParams);

    if (shouldMockMacOS) {
      let firstThemeSent = false;
      mockTelegramEnv({
        // Raw format keeps `tgWebAppData` intact, which the SDK requires to retrieve
        // init data later (see mockTelegramEnv docs).
        launchParams: rawLaunchParams,
        onEvent(event, next) {
          if (event.name === 'web_app_request_theme') {
            let tp: Record<string, string | undefined> = {};
            if (firstThemeSent) {
              tp = themeParams.state();
            } else {
              firstThemeSent = true;
              tp ||= retrieveLaunchParams().tgWebAppThemeParams;
            }
            return emitEvent('theme_changed', { theme_params: tp as Record<string, `#${string}` | undefined> });
          }

          if (event.name === 'web_app_request_safe_area') {
            return emitEvent('safe_area_changed', { left: 0, top: 0, right: 0, bottom: 0 });
          }

          // Newer clients also request the content safe area; the macOS client never
          // answers it, leaving viewport mount hanging. Reply with zero insets too.
          if (event.name === 'web_app_request_content_safe_area') {
            return emitEvent('content_safe_area_changed', { left: 0, top: 0, right: 0, bottom: 0 });
          }

          next();
        },
      });
    }

    initData.restore();

    miniApp.ready();

    const launchParams = retrieveLaunchParams();

    backButton.mount.ifAvailable();

    // Mounted before the environment is composed: theme params are empty
    // until mount restores them from `tgWebAppThemeParams`, and the initial
    // appearance below reads them.
    if (miniApp.mount.isAvailable()) {
      themeParams.mount();
      miniApp.mount();
    }

    const environment: MiniAppEnvironmentInfo = {
      platform: 'telegram',
      sdkVersion: launchParams.tgWebAppVersion,
      languageCode: initData.user()?.language_code,
      appearance: this.readThemeParamsAppearance(),
      isWebView: true,
    };
    this.environment = environment;
    this.notifyAppearance(environment.appearance as 'dark' | 'light' | undefined);

    await this.prepareViewport();

    this.setupAppearanceWatcher();
    this.setupActiveWatcher();

    // Push safe-area / viewport changes (fullscreen, orientation, keyboard) to
    // environment subscribers so useSafeArea recomputes beyond plain window resizes.
    this.registerDisposable(this.onViewportChange(() => this.notifyEnvironmentChanged()));

    this.ready = true;
  }

  override async setColors(colors: { header?: string; background?: string; footer?: string }): Promise<void> {
    const fallback: { header?: string; background?: string; footer?: string } = {};

    if (colors.header) {
      const headerColor = miniApp.setHeaderColor.supports?.('rgb') ? colors.header : 'bg_color';
      if (!this.applyNativeColor(miniApp.setHeaderColor, headerColor, 'web_app_set_header_color', colors.header)) {
        fallback.header = colors.header;
      }
    }

    if (colors.background) {
      if (!this.applyNativeColor(miniApp.setBgColor, colors.background, 'web_app_set_background_color', colors.background)) {
        fallback.background = colors.background;
      }
    }

    if (colors.footer) {
      if (!this.applyNativeColor(miniApp.setBottomBarColor, colors.footer, 'web_app_set_bottom_bar_color', colors.footer)) {
        fallback.footer = colors.footer;
      }
    }

    if (fallback.header || fallback.background || fallback.footer) {
      await super.setColors(fallback);
    }
  }

  // The SDK feature wrappers gate calls on their own mount/version detection,
  // which is stricter than some clients actually are. When the wrapper refuses,
  // post the raw Mini Apps event: clients that don't support the method ignore it.
  private applyNativeColor(
    feature: Parameters<typeof ensureFeature>[0],
    value: string,
    method: 'web_app_set_header_color' | 'web_app_set_background_color' | 'web_app_set_bottom_bar_color',
    rawColor: string,
  ): boolean {
    if (isFeatureAvailable(feature)) {
      const { ok } = ensureFeature(feature, value);
      if (ok) {
        return true;
      }
    }

    try {
      postEvent(method, { color: rawColor as `#${string}` });
      return true;
    } catch (error) {
      console.warn(`[tvm-app-adapter] ${method} failed:`, error);
      return false;
    }
  }

  override copyTextToClipboard(text: string): Promise<void> {
    return copyTextToClipboardSdk(text);
  }

  override onBackButton(callback: () => void): () => void {
    if (!backButton.isSupported()) {
      return super.onBackButton(callback);
    }

    const dispose = backButton.onClick(() => callback());

    const removeFromBag = this.registerDisposable(() => {
      if (typeof dispose === 'function') {
        dispose();
      }
      this.backHandlers.delete(callback);
    });

    this.backHandlers.set(callback, removeFromBag);
    return removeFromBag;
  }

  override async openExternalLink(url: string): Promise<void> {
    try {
      // No `tryInstantView`: Instant View would intercept pages that must open
      // as-is (payments, auth flows); callers wanting IV can post the event themselves.
      openLink(url);
      return;
    } catch {
      // Fall back to default behaviour if Telegram specific API is not available.
    }
    await super.openExternalLink(url);
  }

  override async openInternalLink(url: string): Promise<void> {
    // `web_app_open_tg_link` expects `path_full` — the part of the link after
    // `https://t.me` (e.g. `/username?start=x`), not a full URL.
    const pathFull = this.toTelegramPathFull(url);

    if (pathFull) {
      try {
        postEvent('web_app_open_tg_link', { path_full: pathFull });
        return;
      } catch (error) {
        console.warn('[tvm-app-adapter] Telegram openInternalLink failed:', error);
      }
    }

    await super.openInternalLink(url);
  }

  enableDebug(state: boolean): void {
    setDebug(state);
  }

  override setClosingConfirmation(enabled: boolean): void {
    try {
      const behavior = closingBehavior as typeof closingBehavior & {
        isMounted?: () => boolean;
        mount?: { isAvailable?: () => boolean } & (() => void);
      };

      if (typeof behavior.isMounted === 'function' && !behavior.isMounted()
        && behavior.mount?.isAvailable?.()) {
        behavior.mount();
      }

      if (enabled) {
        closingBehavior.enableConfirmation();
      } else {
        closingBehavior.disableConfirmation();
      }
    } catch (error) {
      console.warn('[tvm-app-adapter] setClosingConfirmation failed:', error);
    }
  }

  private hapticsAvailable(): boolean {
    return isFeatureAvailable(hapticFeedback.selectionChanged);
  }

  override async supports(capability: MiniAppCapability): Promise<boolean> {
    switch (capability) {
      case 'haptics':
        return this.hapticsAvailable();
      case 'popup':
        return isFeatureAvailable(popup.show);
      case 'qrScanner':
        return isFeatureAvailable(qrScanner.open);
      case 'closeApp':
        return isFeatureAvailable(miniApp.close);
      case 'backButton':
        return backButton.isSupported();
      case 'backButtonVisibility':
        return backButton.hide.isSupported();
      case 'openExternalLink':
        return isFeatureAvailable(openLink);
      case 'openInternalLink':
        return true;
      case 'requestFullscreen':
        return Boolean(
          (typeof rawViewport.requestFullscreen === 'function')
          || viewport.requestFullscreen?.isAvailable?.(),
        );
      case 'verticalSwipes':
        return Boolean(
          swipeBehavior.enableVertical.isAvailable()
          || swipeBehavior.disableVertical.isAvailable(),
        );
      case 'viewVisibility':
        return true;
      case 'shareUrl':
        return typeof shareURLSdk === 'function';
      case 'shareStory':
        return typeof shareStorySdk === 'function';
      case 'copyTextToClipboard':
        return typeof copyTextToClipboardSdk === 'function';
      case 'downloadFile':
        return typeof downloadFileSdk === 'function';
      case 'addToHomeScreen':
        return typeof addToHomeScreenSdk?.isAvailable === 'function'
          ? addToHomeScreenSdk.isAvailable()
          : typeof addToHomeScreenSdk === 'function';
      case 'checkHomeScreenStatus':
        return typeof checkHomeScreenStatusSdk === 'function';
      case 'requestPhone':
        return isFeatureAvailable(requestContact);
      default:
        return false;
    }
  }

  override vibrateImpact(style: ImpactHapticFeedbackStyle): void {
    if (this.hapticsAvailable()) {
      hapticFeedback.impactOccurred(style);
    }
  }

  override vibrateNotification(type: NotificationHapticFeedbackType): void {
    if (this.hapticsAvailable()) {
      hapticFeedback.notificationOccurred(type);
    }
  }

  override vibrateSelection(): void {
    if (this.hapticsAvailable()) {
      hapticFeedback.selectionChanged();
    }
  }

  override async showPopup(options: MiniAppPopupOptions): Promise<string | null> {
    const popupResult = ensureFeature(popup.show, {
      title: options.title,
      message: options.message,
      buttons: options.buttons?.map((button) => ({
        id: button.id,
        text: button.text ?? button.id,
        type: button.type ?? 'default',
      })),
    });

    if (!popupResult.ok) {
      return super.showPopup(options);
    }

    const response = await popupResult.value;
    return response ?? null;
  }

  override async scanQRCode(options?: MiniAppQrScanOptions): Promise<string | null> {
    let result: string | null = null;
    const closeOnCapture = options?.closeOnCapture ?? true;

    const qrScannerResult = ensureFeature(qrScanner.open, {
      onCaptured: (qr) => {
        result = qr;
        if (closeOnCapture) {
          void ensureFeature(qrScanner.close);
        }
      },
    });

    if (!qrScannerResult.ok) {
      return super.scanQRCode(options);
    }

    await qrScannerResult.value;

    return result;
  }

  override async closeApp(): Promise<void> {
    const closeResult = ensureFeature(miniApp.close);
    if (closeResult.ok) {
      return;
    }

    await super.closeApp();
  }

  override getInitData(): string | undefined {
    try {
      return initData.raw();
    } catch {
      return undefined;
    }
  }

  override getLaunchParams(): MiniAppLaunchParams | undefined {
    const customFromUrl = this.readCustomUrlParams((key) => key.toLowerCase().startsWith('tgwebapp'));
    let customFromStartParam: Record<string, unknown> = {};

    try {
      const launchParams = retrieveLaunchParams() as { tgWebAppStartParam?: unknown };
      const startParam = launchParams.tgWebAppStartParam;
      if (typeof startParam === 'string' && startParam) {
        customFromStartParam = this.normalizeDecodedStartParam(startParam);
      }

      return {
        launchParams,
        customLaunchParams: {
          ...customFromUrl,
          ...customFromStartParam,
        },
      };
    } catch {
      return {
        customLaunchParams: {
          ...customFromUrl,
          ...customFromStartParam,
        },
      };
    }
  }

  override decodeStartParam(param: string): unknown {
    try {
      return decodeStartParam(param);
    } catch {
      return undefined;
    }
  }

  override requestFullscreen(): void {
    void this.requestFullscreenInternal();
  }

  override getViewportInsets(): MiniAppViewportInsets | undefined {
    try {
      const safeArea = viewport.safeAreaInsets();
      const contentSafeArea = viewport.contentSafeAreaInsets();
      return {
        safeArea,
        contentSafeArea,
      };
    } catch {
      return undefined;
    }
  }

  override onViewportChange(callback: (state: { height: number; stableHeight: number }) => void): () => void {
    const disposers: Array<() => void> = [];
    const fallbackHeight = () => (typeof window !== 'undefined'
      ? (window.visualViewport?.height ?? window.innerHeight)
      : 0);

    const notify = (state?: { height?: number; stableHeight?: number }) => {
      const heightCandidate = state?.height ?? this.safeHeightFromSdk();
      const stableCandidate = state?.stableHeight ?? this.stableHeightFromSdk();

      const height = Number.isFinite(heightCandidate) ? (heightCandidate as number) : fallbackHeight();
      const stableHeight = Number.isFinite(stableCandidate) && (stableCandidate as number) > 0
        ? (stableCandidate as number)
        : height;

      callback({ height, stableHeight });
    };

    const ensureMounted = async () => {
      try {
        await ensureViewportMounted(this.getViewportMountOptions());
      } catch (error) {
        console.warn('[tvm-app-adapter] ensureViewportMounted failed:', error);
      }
    };

    void ensureMounted().finally(() => notify());

    const { sdkViewport } = this.getViewportMountOptions();

    if (typeof sdkViewport.on === 'function') {
      try {
        const off = sdkViewport.on('change', (next) => notify(next as { height?: number; stableHeight?: number }));
        if (typeof off === 'function') {
          disposers.push(off);
        }
      } catch (error) {
        console.warn('[tvm-app-adapter] viewport.on(change) subscription failed:', error);
      }
    }

    try {
      if (typeof sdkViewport.height?.sub === 'function') {
        disposers.push(sdkViewport.height.sub(() => notify()));
      }
      if (typeof sdkViewport.stableHeight?.sub === 'function') {
        disposers.push(sdkViewport.stableHeight.sub(() => notify()));
      }
    } catch (error) {
      console.warn('[tvm-app-adapter] viewport signal subscriptions failed:', error);
    }

    if (typeof window !== 'undefined') {
      const onResize = () => notify();
      window.visualViewport?.addEventListener('resize', onResize);
      window.addEventListener('resize', onResize);
      disposers.push(() => {
        window.visualViewport?.removeEventListener('resize', onResize);
        window.removeEventListener('resize', onResize);
      });
    }

    return () => {
      disposers.forEach((dispose) => {
        try {
          dispose();
        } catch {
          /* ignore */
        }
      });
    };
  }

  override onAppearanceChange(
    callback: (appearance: 'dark' | 'light' | undefined) => void,
  ): () => void {
    this.appearanceListeners.add(callback);
    callback(this.environment.appearance as 'dark' | 'light' | undefined);
    return () => {
      this.appearanceListeners.delete(callback);
    };
  }

  override setBackButtonVisibility(visible: boolean): void {
    if (!backButton.isSupported()) {
      return;
    }

    if (visible) {
      backButton.show();
    } else {
      backButton.hide();
    }
  }

  override enableVerticalSwipes(): void {
    try {
      const sdkSwipe = swipeBehavior as typeof swipeBehavior & {
        isSupported?: () => boolean;
        isMounted?: () => boolean;
        mount?: () => void;
        enableVertical?: () => void;
      };

      if (typeof sdkSwipe.isSupported === 'function' && sdkSwipe.isSupported()) {
        if (typeof sdkSwipe.isMounted === 'function' && !sdkSwipe.isMounted()) {
          sdkSwipe.mount?.();
        }
        sdkSwipe.enableVertical?.();
      } else if (swipeBehavior.enableVertical.isAvailable()) {
        swipeBehavior.enableVertical();
      }
    } catch (error) {
      console.warn('[tvm-app-adapter] enableVerticalSwipes failed:', error);
    }
  }

  override disableVerticalSwipes(): void {
    try {
      const sdkSwipe = swipeBehavior as typeof swipeBehavior & {
        isSupported?: () => boolean;
        isMounted?: () => boolean;
        mount?: () => void;
        disableVertical?: () => void;
      };

      if (typeof sdkSwipe.isSupported === 'function' && sdkSwipe.isSupported()) {
        if (typeof sdkSwipe.isMounted === 'function' && !sdkSwipe.isMounted()) {
          sdkSwipe.mount?.();
        }
        sdkSwipe.disableVertical?.();
      } else if (swipeBehavior.disableVertical.isAvailable()) {
        swipeBehavior.disableVertical();
      }
    } catch (error) {
      console.warn('[tvm-app-adapter] disableVerticalSwipes failed:', error);
    }
  }

  override onViewHide(callback: () => void): () => void {
    this.viewHideListeners.add(callback);
    return () => {
      this.viewHideListeners.delete(callback);
    };
  }

  override onViewRestore(callback: () => void): () => void {
    this.viewRestoreListeners.add(callback);
    return () => {
      this.viewRestoreListeners.delete(callback);
    };
  }

  override shareUrl(url: string, text?: string): void {
    return shareURLSdk(url, text);
  }

  override async downloadFile(url: string, filename: string): Promise<void> {
    const result = ensureFeature(downloadFileSdk, url, filename);
    if (result.ok) {
      try {
        await result.value;
        return;
      } catch (error) {
        console.warn('[tvm-app-adapter] Telegram downloadFile failed:', error);
      }
    }

    await super.downloadFile(url, filename);
  }

  override async shareStory(mediaUrl: string, options?: MiniAppShareStoryOptions): Promise<void> {
    const text = options?.telegram?.text ?? options?.text;
    const widgetLink = options?.telegram?.widgetLink
      ?? (options?.link
        ? {
          url: options.link.url,
          ...(options.link.name ? { name: options.link.name } : {}),
        }
        : undefined);

    shareStorySdk(mediaUrl, {
      ...(text ? { text } : {}),
      ...(widgetLink ? { widgetLink } : {}),
    });
  }

  override async addToHomeScreen(): Promise<boolean> {
    const isAvailable = typeof addToHomeScreenSdk?.isAvailable === 'function'
      ? addToHomeScreenSdk.isAvailable()
      : true;

    if (!isAvailable) {
      return super.addToHomeScreen();
    }

    return new Promise<boolean>((resolve) => {
      const cleanup = () => {
        clearTimeout(timeout);
        off('home_screen_added', handleSuccess);
        off('home_screen_failed', handleFail);
      };

      const handleSuccess = () => {
        cleanup();
        resolve(true);
      };

      const handleFail = () => {
        cleanup();
        resolve(false);
      };

      on('home_screen_added', handleSuccess);
      on('home_screen_failed', handleFail);

      // The client is not obliged to emit anything when the user dismisses the
      // system prompt, so an unanswered request must not hang the promise.
      const timeout = setTimeout(handleFail, 30_000);

      try {
        addToHomeScreenSdk();
      } catch (error) {
        cleanup();
        console.warn('[tvm-app-adapter] Telegram addToHomeScreen failed:', error);
        resolve(false);
      }
    });
  }

  override async checkHomeScreenStatus(): Promise<'added' | 'not_added' | 'unknown' | string> {
    try {
      const status = await checkHomeScreenStatusSdk();
      if (typeof status === 'string') {
        return status;
      }
      if (typeof status === 'boolean') {
        return status ? 'added' : 'not_added';
      }
      return 'unknown';
    } catch (error) {
      console.warn('[tvm-app-adapter] Telegram checkHomeScreenStatus failed:', error);
      return 'unknown';
    }
  }

  override async requestPhone(): Promise<string | null> {
    // `isFeatureAvailable` only probes availability; unlike `ensureFeature` it does NOT
    // invoke the feature, so the native prompt is shown exactly once below.
    if (!isFeatureAvailable(requestContact)) {
      return super.requestPhone();
    }

    try {
      // `requestContact` already drives the phone-access consent flow in tma.js v3.
      // Calling `requestPhoneAccess` in addition would pop a second native dialog.
      const result = await requestContact();
      if (!result || typeof result !== 'object') {
        return null;
      }

      const contact = (result as {
        contact?: {
          phoneNumber?: unknown;
          phone_number?: unknown;
          phone?: unknown;
        };
        phoneNumber?: unknown;
        phone_number?: unknown;
        phone?: unknown;
      }).contact;

      const phone = (contact?.phoneNumber ?? contact?.phone_number ?? contact?.phone
        ?? (result as { phoneNumber?: unknown }).phoneNumber
        ?? (result as { phone_number?: unknown }).phone_number
        ?? (result as { phone?: unknown }).phone);

      return typeof phone === 'string' && phone ? phone : null;
    } catch (error) {
      console.warn('[tvm-app-adapter] Telegram requestPhone failed:', error);
      return null;
    }
  }

  // The client theme lives in theme params (`tgWebAppThemeParams` at launch,
  // `theme_changed` events afterwards) — the signal the official
  // `colorScheme` field derives from. Reading it raw is unsafe on both sides:
  // `themeParams.isDark` falsely defaults to dark while `bg_color` is unset
  // (empty pre-mount state, partial diffs), and `miniApp.isDark` tracks the
  // mini app's OWN background color, which `setColors` overrides with
  // explicit RGB values — it echoes whatever theme the host app applied
  // last, not the client theme. So: theme params only, and only when
  // `bg_color` is actually present.
  private readThemeParamsAppearance(): 'dark' | 'light' | undefined {
    try {
      if (!themeParams.bgColor()) {
        return undefined;
      }
      return themeParams.isDark() ? 'dark' : 'light';
    } catch {
      return undefined;
    }
  }

  private setupAppearanceWatcher(): void {
    this.appearanceWatcherDispose?.();

    const onThemeParamsChange = () => {
      const appearance = this.readThemeParamsAppearance();
      if (!appearance || appearance === this.environment.appearance) {
        return;
      }
      this.environment.appearance = appearance;
      this.notifyAppearance(appearance);
    };

    // Prefer subscribing to bg_color over the isDark computed: while
    // bg_color is unset isDark spuriously reads dark, and if the next real
    // theme is also dark the computed value never changes and the update is
    // swallowed; bg_color itself always changes when real data arrives.
    let disposer: (() => void) | undefined;
    if (typeof themeParams.bgColor?.sub === 'function') {
      disposer = themeParams.bgColor.sub(onThemeParamsChange);
    } else if (typeof themeParams.isDark?.sub === 'function') {
      disposer = themeParams.isDark.sub(onThemeParamsChange);
    }

    if (disposer) {
      this.appearanceWatcherDispose = this.registerDisposable(disposer);
    }
  }

  private notifyAppearance(appearance: 'dark' | 'light' | undefined): void {
    for (const listener of this.appearanceListeners) {
      listener(appearance);
    }
  }

  private setupActiveWatcher(): void {
    this.activeWatcherDispose?.();

    const activeSignal = miniApp.isActive as typeof miniApp.isActive & {
      sub?: (callback: () => void) => () => void;
    };

    const invoke = () => {
      try {
        const isActive = miniApp.isActive();
        if (isActive) {
          this.notifyViewRestore();
        } else {
          this.notifyViewHide();
        }
      } catch (error) {
        console.warn('[tvm-app-adapter] miniApp.isActive() failed:', error);
      }
    };

    if (typeof activeSignal?.sub === 'function') {
      const disposer = activeSignal.sub(() => invoke());
      this.activeWatcherDispose = this.registerDisposable(disposer);
      invoke();
      return;
    }

    try {
      invoke();
    } catch {
      // Ignore unsupported environments.
    }
  }

  private async prepareViewport(): Promise<void> {
    try {
      await ensureViewportMounted(this.getViewportMountOptions());
    } catch (error) {
      console.warn('[tvm-app-adapter] prepareViewport failed:', error);
    }
  }

  private async requestFullscreenInternal(): Promise<void> {
    try {
      const viewportOptions = this.getViewportMountOptions();
      await ensureViewportMounted(viewportOptions);

      const { sdkViewport } = viewportOptions;

      const canUseRaw = typeof sdkViewport.isSupported === 'function' ? sdkViewport.isSupported() : false;

      if (canUseRaw && typeof sdkViewport.requestFullscreen === 'function') {
        await sdkViewport.requestFullscreen();
      } else if (viewport.requestFullscreen && viewport.requestFullscreen.isAvailable?.()) {
        await viewport.requestFullscreen();
      } else {
        postEvent('web_app_request_fullscreen');
      }

      this.disableVerticalSwipes();
    } catch (error) {
      console.warn('[tvm-app-adapter] Telegram requestFullscreen failed:', error);
    }
  }

  private getViewportMountOptions(): {
    sdkViewport: typeof rawViewport & {
      isSupported?: () => boolean;
      isMounted?: () => boolean;
      mount?: () => void | Promise<void>;
      requestFullscreen?: () => Promise<void> | void;
      on?: (event: 'change', cb: (state: { height?: number; stableHeight?: number }) => void) => (() => void) | void;
      height?: (() => number) & { sub?: (cb: () => void) => () => void };
      stableHeight?: (() => number) & { sub?: (cb: () => void) => () => void };
    };
    fallbackMount: () => Promise<void>;
  } {
    const sdkViewport = rawViewport as typeof rawViewport & {
      isSupported?: () => boolean;
      isMounted?: () => boolean;
      mount?: () => void | Promise<void>;
      requestFullscreen?: () => Promise<void> | void;
      on?: (event: 'change', cb: (state: { height?: number; stableHeight?: number }) => void) => (() => void) | void;
      height?: (() => number) & { sub?: (cb: () => void) => () => void };
      stableHeight?: (() => number) & { sub?: (cb: () => void) => () => void };
    };

    return {
      sdkViewport,
      fallbackMount: async () => {
        if (viewport.mount?.isAvailable?.()) {
          await viewport.mount();
        }
      },
    };
  }

  private safeHeightFromSdk(): number | undefined {
    try {
      if (typeof rawViewport.height === 'function') {
        return rawViewport.height();
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private stableHeightFromSdk(): number | undefined {
    try {
      if (typeof rawViewport.stableHeight === 'function') {
        return rawViewport.stableHeight();
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private notifyViewHide(): void {
    for (const listener of this.viewHideListeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[tvm-app-adapter] onViewHide listener failed:', error);
      }
    }
  }

  // Reduces a Telegram link to the `path_full` form `web_app_open_tg_link`
  // expects. Returns undefined for links outside t.me so the caller can fall
  // back to a regular navigation.
  private toTelegramPathFull(url: string): string | undefined {
    try {
      const parsed = new URL(url, 'https://t.me');
      const host = parsed.hostname.toLowerCase();
      if (!['t.me', 'telegram.me', 'telegram.dog'].includes(host)) {
        return undefined;
      }
      const pathFull = `${parsed.pathname}${parsed.search}`;
      return pathFull === '/' ? undefined : pathFull;
    } catch {
      return undefined;
    }
  }

  // Detects the native Telegram for macOS client, which mishandles Mini Apps method
  // calls. Prefers `tgWebAppPlatform` from the raw launch params and falls back to the
  // user agent for the case where launch params couldn't be retrieved at all.
  private isMacOsClient(rawLaunchParams?: string): boolean {
    if (rawLaunchParams) {
      try {
        const platform = new URLSearchParams(rawLaunchParams).get('tgWebAppPlatform');
        if (platform) {
          return platform === 'macos';
        }
      } catch {
        // Fall through to the user-agent heuristic.
      }
    }

    if (typeof navigator === 'undefined') {
      return false;
    }

    const userAgent = navigator.userAgent;
    return /Mac OS X|Macintosh/.test(userAgent) && !/(iPhone|iPad|iPod)/.test(userAgent);
  }

  private normalizeDecodedStartParam(startParam: string): Record<string, unknown> {
    let decoded: unknown;

    try {
      decoded = decodeStartParam(startParam);
    } catch {
      decoded = startParam;
    }

    if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
      return { ...(decoded as Record<string, unknown>) };
    }

    if (typeof decoded === 'string' && decoded) {
      const parsed = this.parseQueryString(decoded);
      if (Object.keys(parsed).length) {
        return parsed;
      }
      return { startParam: decoded };
    }

    return {};
  }

  private parseQueryString(value: string): Record<string, unknown> {
    const normalized = value.startsWith('?') ? value.slice(1) : value;
    const params = new URLSearchParams(normalized);
    const result: Record<string, unknown> = {};

    const keys = new Set<string>();
    for (const [key] of params.entries()) {
      keys.add(key);
    }

    for (const key of keys) {
      const values = params.getAll(key);
      if (!values.length) {
        continue;
      }
      result[key] = values.length === 1 ? values[0] : values;
    }

    return result;
  }

  private notifyViewRestore(): void {
    for (const listener of this.viewRestoreListeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[tvm-app-adapter] onViewRestore listener failed:', error);
      }
    }
  }

  protected override onDestroy(): void {
    this.appearanceWatcherDispose?.();
    this.appearanceWatcherDispose = undefined;
    this.activeWatcherDispose?.();
    this.activeWatcherDispose = undefined;
    this.appearanceListeners.clear();
    this.viewHideListeners.clear();
    this.viewRestoreListeners.clear();
    this.backHandlers.clear();
    super.onDestroy();
  }
}
