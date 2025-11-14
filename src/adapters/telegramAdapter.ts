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
  
  type ThemeParams,
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
            let tp: ThemeParams = {};
            if (firstThemeSent) {
              tp = themeParams.state();
            } else {
              firstThemeSent = true;
              tp ||= retrieveLaunchParams().tgWebAppThemeParams;
            }
            return emitEvent('theme_changed', { theme_params: tp });
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
    return shareURLSdk(url ,text);
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
    shareStorySdk(mediaUrl, options);
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
    };
    fallbackMount: () => Promise<void>;
  } {
    const sdkViewport = rawViewport as typeof rawViewport & {
      isSupported?: () => boolean;
      isMounted?: () => boolean;
      mount?: () => void | Promise<void>;
      requestFullscreen?: () => Promise<void> | void;
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
