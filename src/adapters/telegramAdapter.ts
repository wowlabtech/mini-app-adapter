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
  popup,
  qrScanner,
  retrieveLaunchParams,
  setDebug,
  themeParams,
  viewport,
  type ThemeParams,
} from '@tma.js/sdk-react';

import { BaseMiniAppAdapter } from '@/adapters/baseAdapter';
import type {
  MiniAppCapability,
  MiniAppEnvironmentInfo,
  MiniAppInitOptions,
  MiniAppPopupOptions,
  MiniAppQrScanOptions,
} from '@/types/miniApp';

type TelegramWebApp = NonNullable<typeof window.Telegram>['WebApp'];

export class TelegramMiniAppAdapter extends BaseMiniAppAdapter {
  private readonly backHandlers = new Map<() => void, () => void>();

  constructor() {
    super('telegram');
  }

  override async init(options?: MiniAppInitOptions): Promise<void> {
    if (this.ready) {
      return;
    }

    const webApp = this.telegram;
    if (!webApp) {
      throw new Error('Telegram WebApp SDK is not available in current environment.');
    }

    const debug = Boolean(options?.debug);
    const eruda = Boolean(options?.eruda);
    const mockForMacOS = Boolean(options?.mockForMacOS);

    setDebug(debug);
    initSDK();

    if (eruda) {
      void import('eruda').then(({ default: erudaInstance }) => {
        erudaInstance.init();
        erudaInstance.position({ x: window.innerWidth - 50, y: 0 });
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

    webApp.ready();

    const appearance = (webApp as unknown as { colorScheme?: string }).colorScheme;

    const environment: MiniAppEnvironmentInfo = {
      platform: 'telegram',
      sdkVersion: webApp.version,
      languageCode: webApp.initDataUnsafe?.user?.language_code,
      appearance,
      isWebView: true,
    };
    this.environment = environment;

    backButton.mount.ifAvailable();
    initData.restore();

    if (miniApp.mount.isAvailable()) {
      themeParams.mount();
      miniApp.mount();
      this.bindCssVariables();
    }

    if (viewport.mount.isAvailable()) {
      await viewport.mount();
      viewport.bindCssVars();
    }

    this.ready = true;
  }

  override async setColors(colors: { header?: string; background?: string }): Promise<void> {
    const webApp = this.telegram;
    if (!webApp) {
      return super.setColors(colors);
    }

    if (colors.header) {
      if (miniApp.setHeaderColor.isAvailable()) {
        const headerColor = miniApp.setHeaderColor.supports?.('rgb') ? colors.header : 'bg_color';
        miniApp.setHeaderColor(headerColor);
      } else {
        webApp.setHeaderColor(colors.header);
      }
    }
    if (colors.background) {
      if (miniApp.setBgColor.isAvailable()) {
        miniApp.setBgColor(colors.background);
      } else {
        webApp.setBackgroundColor(colors.background);
      }
    }
  }

  override onBackButton(callback: () => void): () => void {
    const webApp = this.telegram;
    if (!webApp) {
      return super.onBackButton(callback);
    }

    const executor = () => callback();
    webApp.BackButton.onClick?.(executor);
    webApp.BackButton.show?.();
    this.backHandlers.set(callback, executor);

    return () => {
      const handler = this.backHandlers.get(callback);
      if (handler) {
        webApp.BackButton.offClick?.(handler);
        this.backHandlers.delete(callback);
      }
      if (!this.backHandlers.size) {
        webApp.BackButton.hide?.();
      }
    };
  }

  override async openLink(url: string): Promise<void> {
    const webApp = this.telegram;
    if (webApp) {
      webApp.openLink(url, { try_instant_view: true });
      return;
    }
    await super.openLink(url);
  }

  enableDebug(state: boolean): void {
    const webApp = this.telegram;
    if (!webApp) {
      return;
    }
    state ? webApp.enableClosingConfirmation?.() : webApp.disableClosingConfirmation?.();
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
      case 'backButtonVisibility':
        return this.isFeatureAvailable(backButton.show) && this.isFeatureAvailable(backButton.hide);
      case 'bindCssVariables':
        return true;
      default:
        return false;
    }
  }

  override bindCssVariables(mapper?: (key: string) => string): void {
    themeParams.bindCssVars(mapper);
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

  override setBackButtonVisibility(visible: boolean): void {
    if (!this.supports('backButtonVisibility')) {
      return;
    }
    const webApp = this.telegram;
    if (visible) {
      backButton.show();
      webApp?.BackButton.show?.();
    } else {
      backButton.hide();
      webApp?.BackButton.hide?.();
    }
  }

  private isFeatureAvailable(fn: unknown): boolean {
    if (typeof fn !== 'function') {
      return false;
    }
    const candidate = fn as { isAvailable?: () => boolean };
    return typeof candidate.isAvailable === 'function' ? candidate.isAvailable() : true;
  }

  private get telegram(): TelegramWebApp | undefined {
    return window.Telegram?.WebApp;
  }
}
