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
  setDebug,
  themeParams,
  viewport,
} from '@tma.js/sdk-react';
import {
  decodeStartParam,
  closingBehavior,
  requestContact,
  requestPhoneAccess,
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
  MiniAppPopupOptions,
  MiniAppQrScanOptions,
  MiniAppShareStoryOptions,
  MiniAppViewportInsets,
} from '@/types/miniApp';
import { ensureFeature, isFeatureAvailable } from '@/lib/features';
import { bindViewportCssVars, ensureViewportMounted } from '@/lib/viewport';
export class TelegramMiniAppAdapter extends BaseMiniAppAdapter {
  private readonly backHandlers = new Map<() => void, () => void>();
  private cssVariablesBound = false;
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
    const mockForMacOS = Boolean(options?.mockForMacOS);

    setDebug(debug);
    initSDK();

    if (!miniApp.isSupported()) {
      console.warn('[tvm-app-adapter] miniApp feature is not supported; falling back to limited mode.');
    }

    if (eruda) {
      void import('eruda').then(({ default: erudaInstance }) => {
        erudaInstance.init();
        erudaInstance.position({ x: window.innerWidth - 150, y: window.innerHeight - 150 });
      });
    }

    if (mockForMacOS) {
      let firstThemeSent = false;
      mockTelegramEnv({
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

          next();
        },
      });
    }

    initData.restore();

    miniApp.ready();

    const launchParams = retrieveLaunchParams();
    let appearance: string | undefined;
    try {
      appearance = miniApp.isDark() ? 'dark' : 'light';
    } catch {
      appearance = undefined;
    }

    const environment: MiniAppEnvironmentInfo = {
      platform: 'telegram',
      sdkVersion: launchParams.tgWebAppVersion,
      languageCode: initData.user()?.language_code,
      appearance,
      isWebView: true,
    };
    this.environment = environment;
    this.notifyAppearance(environment.appearance as 'dark' | 'light' | undefined);

    backButton.mount.ifAvailable();

    if (miniApp.mount.isAvailable()) {
      themeParams.mount();
      miniApp.mount();
      this.bindCssVariables();
    }

    await this.prepareViewport();

    this.setupAppearanceWatcher();
    this.setupActiveWatcher();

    this.ready = true;
  }

  override async setColors(colors: { header?: string; background?: string; footer?: string }): Promise<void> {
    const fallback: { header?: string; background?: string; footer?: string } = {};

    if (colors.header) {
      if (miniApp.setHeaderColor.isAvailable()) {
        const headerColor = miniApp.setHeaderColor.supports?.('rgb') ? colors.header : 'bg_color';
        const { ok } = ensureFeature(miniApp.setHeaderColor, headerColor);
        if (!ok) {
          fallback.header = colors.header;
        }
      } else {
        fallback.header = colors.header;
      }
    }

    if (colors.background) {
      if (miniApp.setBgColor.isAvailable()) {
        const { ok } = ensureFeature(miniApp.setBgColor, colors.background);
        if (!ok) {
          fallback.background = colors.background;
        }
      } else {
        fallback.background = colors.background;
      }
    }

    if (colors.footer) {
      if (miniApp.setBgColor.isAvailable()) {
        const { ok } = ensureFeature(miniApp.setBottomBarColorFp, colors.footer);
        if (!ok) {
          fallback.footer = colors.footer;
        }
      } else {
        fallback.footer = colors.footer;
      }
    }

    if (fallback.header || fallback.background) {
      await super.setColors(fallback);
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
      if (!this.backHandlers.size) {
        backButton.hide();
      }
    });

    this.backHandlers.set(callback, removeFromBag);
    return removeFromBag;
  }

  override async openExternalLink(url: string): Promise<void> {
    try {
      openLink(url, { tryInstantView: true });
      return;
    } catch {
      // Fall back to default behaviour if Telegram specific API is not available.
    }
    await super.openExternalLink(url);
  }

  override async openInternalLink(url: string): Promise<void> {
    postEvent('web_app_open_tg_link', { path_full: url });
  }

  enableDebug(state: boolean): void {
    try {
      state ? closingBehavior.enableConfirmation() : closingBehavior.disableConfirmation();
    } catch {
      // Ignore unsupported environments.
    }
  }

  override supports(capability: MiniAppCapability): boolean {
    switch (capability) {
      case 'haptics':
        return isFeatureAvailable(hapticFeedback.selectionChanged);
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
      case 'bindCssVariables':
        return true;
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
      case 'requestPhone': {
        return Boolean(isFeatureAvailable(requestPhoneAccess) || isFeatureAvailable(requestContact));
      }
      default:
        return false;
    }
  }

  override bindCssVariables(mapper?: (key: string) => string): void {
    if (this.cssVariablesBound) {
      return;
    }

    try {
      themeParams.bindCssVars(mapper);
      this.cssVariablesBound = true;
    } catch (error) {
      if (error instanceof Error && /css variables are already bound/i.test(error.message)) {
        this.cssVariablesBound = true;
        return;
      }
      throw error;
    }
  }

  override vibrateImpact(style: ImpactHapticFeedbackStyle): void {
    if (this.supports('haptics')) {
      hapticFeedback.impactOccurred(style);
    }
  }

  override vibrateNotification(type: NotificationHapticFeedbackType): void {
    if (this.supports('haptics')) {
      hapticFeedback.notificationOccurred(type);
    }
  }

  override vibrateSelection(): void {
    if (this.supports('haptics')) {
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

  override getLaunchParams(): unknown {
    try {
      return retrieveLaunchParams();
    } catch {
      return undefined;
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
    const contactFeature = ensureFeature(requestContact);
    if (!contactFeature.ok) {
      return super.requestPhone();
    }

    if (requestPhoneAccess) {
      const accessFeature = ensureFeature(requestPhoneAccess);
      if (accessFeature.ok) {
        try {
          await accessFeature.value;
        } catch (error) {
          console.warn('[tvm-app-adapter] Telegram requestPhone access failed:', error);
        }
      }
    }

    try {
      const result = await contactFeature.value;
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

  private setupAppearanceWatcher(): void {
    this.appearanceWatcherDispose?.();

    if (typeof themeParams.isDark?.sub === 'function') {
      const disposer = themeParams.isDark.sub(() => {
        const appearance = themeParams.isDark() ? 'dark' : 'light';
        this.environment.appearance = appearance;
        this.notifyAppearance(appearance);
      });
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
      await bindViewportCssVars({
        ...this.getViewportMountOptions(),
        bindCssVars: typeof viewport.bindCssVars === 'function' ? viewport.bindCssVars : undefined,
      });
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
