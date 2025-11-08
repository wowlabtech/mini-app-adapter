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
} from '@tma.js/sdk';

import { BaseMiniAppAdapter } from '@/adapters/baseAdapter';
import type {
  MiniAppCapability,
  MiniAppEnvironmentInfo,
  MiniAppInitOptions,
  MiniAppPopupOptions,
  MiniAppQrScanOptions,
  MiniAppViewportInsets,
} from '@/types/miniApp';
export class TelegramMiniAppAdapter extends BaseMiniAppAdapter {
  private readonly backHandlers = new Map<() => void, () => void>();
  private cssVariablesBound = false;
  private readonly appearanceListeners = new Set<
    (appearance: 'dark' | 'light' | undefined) => void
  >();
  private disposeAppearanceWatcher?: () => void;
  private readonly viewHideListeners = new Set<() => void>();
  private readonly viewRestoreListeners = new Set<() => void>();
  private disposeActiveWatcher?: () => void;

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
        miniApp.setHeaderColor(headerColor);
      } else {
        fallback.header = colors.header;
      }
    }

    if (colors.background) {
      if (miniApp.setBgColor.isAvailable()) {
        miniApp.setBgColor(colors.background);
      } else {
        fallback.background = colors.background;
      }
    }

    if (colors.footer) {
      if (miniApp.setBgColor.isAvailable()) {
        miniApp.setBottomBarColorFp(colors.footer);
      } else {
        fallback.footer = colors.footer;
      }
    }

    if (fallback.header || fallback.background) {
      await super.setColors(fallback);
    }
  }

  override onBackButton(callback: () => void): () => void {
    if (!backButton.isSupported()) {
      return super.onBackButton(callback);
    }

    const dispose = backButton.onClick(() => callback());
    this.backHandlers.set(callback, dispose);

    return () => {
      const handler = this.backHandlers.get(callback);
      if (handler) {
        handler();
        this.backHandlers.delete(callback);
      }
      if (!this.backHandlers.size) {
        backButton.hide();
      }
    };
  }

  override async openLink(url: string): Promise<void> {
    try {
      openLink(url, { tryInstantView: true });
      return;
    } catch {
      // Fall back to default behaviour if Telegram specific API is not available.
    }
    await super.openLink(url);
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
        return this.isFeatureAvailable(hapticFeedback.selectionChanged);
      case 'popup':
        return this.isFeatureAvailable(popup.show);
      case 'qrScanner':
        return this.isFeatureAvailable(qrScanner.open);
      case 'closeApp':
        return this.isFeatureAvailable(miniApp.close);
      case 'backButton':
        return backButton.isSupported();
      case 'backButtonVisibility':
        return backButton.hide.isSupported();
      case 'bindCssVariables':
        return true;
      case 'requestPhone': {
        return Boolean(this.isFeatureAvailable(requestPhoneAccess) || this.isFeatureAvailable(requestContact));
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
    if (!this.supports('popup')) {
      return super.showPopup(options);
    }

    const response = await popup.show({
      title: options.title,
      message: options.message,
      buttons: options.buttons?.map((button) => ({
        id: button.id,
        text: button.text ?? button.id,
        type: button.type ?? 'default',
      })),
    });

    return response ?? null;
  }

  override async scanQRCode(options?: MiniAppQrScanOptions): Promise<string | null> {
    if (!this.supports('qrScanner')) {
      return super.scanQRCode(options);
    }

    let result: string | null = null;
    const closeOnCapture = options?.closeOnCapture ?? true;

    await qrScanner.open({
      onCaptured: (qr) => {
        result = qr;
        if (closeOnCapture && this.isFeatureAvailable(qrScanner.close)) {
          qrScanner.close();
        }
      },
    });

    return result;
  }

  override async closeApp(): Promise<void> {
    if (this.supports('closeApp')) {
      miniApp.close();
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

  override async requestPhone(): Promise<string | null> {
    if (!this.isFeatureAvailable(requestContact)) {
      return super.requestPhone();
    }

    if (requestPhoneAccess && this.isFeatureAvailable(requestPhoneAccess)) {
      try {
        await requestPhoneAccess();
      } catch (error) {
        console.warn('[tvm-app-adapter] Telegram requestPhone access failed:', error);
      }
    }

    try {
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

  private isFeatureAvailable(fn: unknown): boolean {
    if (typeof fn !== 'function') {
      return false;
    }
    const candidate = fn as { isAvailable?: () => boolean };
    return typeof candidate.isAvailable === 'function' ? candidate.isAvailable() : true;
  }

  private setupAppearanceWatcher(): void {
    this.disposeAppearanceWatcher?.();

    if (typeof themeParams.isDark?.sub === 'function') {
      this.disposeAppearanceWatcher = themeParams.isDark.sub(() => {
        const appearance = themeParams.isDark() ? 'dark' : 'light';
        this.environment.appearance = appearance;
        this.notifyAppearance(appearance);
      });
    }
  }

  private notifyAppearance(appearance: 'dark' | 'light' | undefined): void {
    for (const listener of this.appearanceListeners) {
      listener(appearance);
    }
  }

  private setupActiveWatcher(): void {
    this.disposeActiveWatcher?.();

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
      this.disposeActiveWatcher = activeSignal.sub(() => invoke());
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
      await this.ensureViewportMounted();
      if (viewport.bindCssVars && typeof viewport.bindCssVars === 'function') {
        viewport.bindCssVars();
      }
    } catch (error) {
      console.warn('[tvm-app-adapter] prepareViewport failed:', error);
    }
  }

  private async ensureViewportMounted(): Promise<void> {
    try {
      const sdkViewport = rawViewport as typeof rawViewport & {
        isSupported?: () => boolean;
        isMounted?: () => boolean;
        mount?: () => void;
      };

      if (typeof sdkViewport.isSupported === 'function' && sdkViewport.isSupported()) {
        if (typeof sdkViewport.isMounted === 'function' && !sdkViewport.isMounted()) {
          sdkViewport.mount?.();
        }
        return;
      }

      if (viewport.mount.isAvailable()) {
        await viewport.mount();
      }
    } catch (error) {
      console.warn('[tvm-app-adapter] ensureViewportMounted failed:', error);
      throw error;
    }
  }

  private async requestFullscreenInternal(): Promise<void> {
    try {
      await this.ensureViewportMounted();

      const sdkViewport = rawViewport as typeof rawViewport & {
        requestFullscreen?: () => Promise<void> | void;
      };

      const canUseRaw = typeof (sdkViewport as { isSupported?: () => boolean }).isSupported === 'function'
        ? (sdkViewport as { isSupported?: () => boolean }).isSupported?.()
        : false;

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

}
