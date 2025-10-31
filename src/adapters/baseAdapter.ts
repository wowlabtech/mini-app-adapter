import type {
  ImpactHapticFeedbackStyle,
  NotificationHapticFeedbackType,
} from '@tma.js/bridge';

import {
  type MiniAppAdapter,
  type MiniAppCapability,
  type MiniAppEnvironmentInfo,
  type MiniAppInitOptions,
  type MiniAppPlatform,
  type MiniAppPopupOptions,
  type MiniAppQrScanOptions,
} from '@/types/miniApp';

export abstract class BaseMiniAppAdapter implements MiniAppAdapter {
  protected ready = false;

  protected environment: MiniAppEnvironmentInfo;

  protected constructor(platform: MiniAppPlatform, environment?: Partial<MiniAppEnvironmentInfo>) {
    this.environment = {
      platform,
      ...environment,
    };
  }

  supports(_capability: MiniAppCapability): boolean {
    return false;
  }

  get platform(): MiniAppPlatform {
    return this.environment.platform;
  }

  async init(_options?: MiniAppInitOptions): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  getEnvironment(): MiniAppEnvironmentInfo {
    return { ...this.environment };
  }

  async setColors(colors: { header?: string; background?: string }): Promise<void> {
    if (colors.background) {
      document.body.style.backgroundColor = colors.background;
    }
    if (colors.header) {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        meta.setAttribute('content', colors.header);
      }
    }
  }

  onBackButton(callback: () => void): () => void {
    const handler = () => callback();
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }

  async openLink(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async closeApp(): Promise<void> {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.close();
    }
  }

  setBackButtonVisibility(_visible: boolean): void {
    // No-op by default.
  }

  bindCssVariables(_mapper?: (key: string) => string): void {
    // No-op by default.
  }

  vibrateImpact(_style: ImpactHapticFeedbackStyle): void {
    navigator.vibrate?.(10);
  }

  vibrateNotification(_type: NotificationHapticFeedbackType): void {
    navigator.vibrate?.([10, 30, 10]);
  }

  vibrateSelection(): void {
    navigator.vibrate?.(5);
  }

  async showPopup(options: MiniAppPopupOptions): Promise<string | null> {
    const message = [options.title, options.message].filter(Boolean).join('\n\n');
    window.alert(message);
    const firstButton = options.buttons?.[0];
    return firstButton?.id ?? 'ok';
  }

  async scanQRCode(_options?: MiniAppQrScanOptions): Promise<string | null> {
    return null;
  }
}
