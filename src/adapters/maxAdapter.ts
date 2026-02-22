import type {
  ImpactHapticFeedbackStyle,
  NotificationHapticFeedbackType,
} from '@tma.js/bridge';

import { BaseMiniAppAdapter } from '@/adapters/baseAdapter';
import type {
  MiniAppCapability,
  MiniAppEnvironmentInfo,
  MiniAppInitOptions,
  MiniAppLaunchParams,
  MiniAppPopupOptions,
  MiniAppQrScanOptions,
} from '@/types/miniApp';

type MaxBackButtonPayload = {
  needConfirmation?: boolean;
};

interface MaxBackButton {
  isVisible?: boolean;
  show?: () => void;
  hide?: () => void;
  onClick?: (handler: (payload: MaxBackButtonPayload) => void) => (() => void) | void;
  offClick?: (handler: (payload: MaxBackButtonPayload) => void) => void;
}

interface MaxHapticFeedback {
  impactOccurred?: (style: ImpactHapticFeedbackStyle, disableVibrationFallback?: boolean) => Promise<unknown>;
  notificationOccurred?: (
    type: NotificationHapticFeedbackType,
    disableVibrationFallback?: boolean,
  ) => Promise<unknown>;
  selectionChanged?: (disableVibrationFallback?: boolean) => Promise<unknown>;
}

interface MaxWebApp {
  version?: string;
  platform?: string;
  initData?: string;
  initDataUnsafe?: {
    query_id?: string;
    start_param?: string;
    user?: {
      language_code?: string;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
  };
  ready?: () => void;
  close?: () => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  openExternalLink?: (url: string) => void;
  openMaxLink?: (url: string) => void;
  downloadFile?: (url: string, fileName: string) => Promise<unknown>;
  shareContent?: (payload: { text: string; link?: string; requestId: string }) => Promise<unknown>;
  shareMaxContent?: (payload: { text: string; link?: string; requestId: string }) => Promise<unknown>;
  openCodeReader?: (allowFileSelect?: boolean) => Promise<{ requestId: string; value?: string }>;
  requestPhoneNumber?: () => Promise<unknown>;
  BackButton?: MaxBackButton;
  HapticFeedback?: MaxHapticFeedback;
}

type MaxPhoneRequestEventDetail = {
  providePromise: (promise: Promise<unknown>) => void;
};

function getMaxBridge(): MaxWebApp | undefined {
  return (window as typeof window & { WebApp?: MaxWebApp }).WebApp;
}

export class MaxMiniAppAdapter extends BaseMiniAppAdapter {
  private readonly backHandlers = new Map<() => void, () => void>();
  private initData?: string;
  private initDataUnsafe?: MaxWebApp['initDataUnsafe'];

  constructor() {
    super('max');
  }

  override async init(_options?: MiniAppInitOptions): Promise<void> {
    if (this.ready) {
      return;
    }

    const bridge = getMaxBridge();
    bridge?.ready?.();

    this.initData = bridge?.initData;
    this.initDataUnsafe = bridge?.initDataUnsafe;

    const environment: MiniAppEnvironmentInfo = {
      platform: 'max',
      sdkVersion: bridge?.version,
      appVersion: bridge?.version,
      languageCode: bridge?.initDataUnsafe?.user?.language_code,
      isWebView: true,
    };

    this.environment = environment;
    this.ready = true;
  }

  override supports(capability: MiniAppCapability): boolean {
    const bridge = getMaxBridge();

    switch (capability) {
      case 'haptics':
        return Boolean(bridge?.HapticFeedback?.impactOccurred);
      case 'qrScanner':
        return typeof bridge?.openCodeReader === 'function';
      case 'closeApp':
        return typeof bridge?.close === 'function';
      case 'backButton':
        return Boolean(bridge?.BackButton?.onClick);
      case 'backButtonVisibility':
        return Boolean(bridge?.BackButton?.show && bridge.BackButton.hide);
      case 'openInternalLink':
        return typeof bridge?.openMaxLink === 'function';
      case 'downloadFile':
        return typeof bridge?.downloadFile === 'function';
      case 'requestPhone':
        if (!bridge) {
          return false;
        }
        return typeof bridge.requestPhoneNumber === 'function' || typeof window !== 'undefined';
      case 'popup':
        return false;
      default:
        return false;
    }
  }

  override getInitData(): string | undefined {
    return this.initData;
  }

  override getLaunchParams(): MiniAppLaunchParams | undefined {
    return {
      launchParams: this.initDataUnsafe,
      customLaunchParams: this.readCustomUrlParams(),
    };
  }

  override onBackButton(callback: () => void): () => void {
    const bridge = getMaxBridge();
    if (!bridge?.BackButton?.onClick) {
      return super.onBackButton(callback);
    }

    const wrapped = () => callback();
    const disposer = bridge.BackButton.onClick(wrapped);
    bridge.BackButton.show?.();

    const removeFromBag = this.registerDisposable(() => {
      if (typeof disposer === 'function') {
        disposer();
      } else {
        bridge.BackButton?.offClick?.(wrapped);
      }
      this.backHandlers.delete(callback);
      if (!this.backHandlers.size) {
        bridge.BackButton?.hide?.();
      }
    });

    this.backHandlers.set(callback, removeFromBag);
    return removeFromBag;
  }

  override setBackButtonVisibility(visible: boolean): void {
    const bridge = getMaxBridge();
    if (!bridge?.BackButton) {
      return;
    }
    visible ? bridge.BackButton.show?.() : bridge.BackButton.hide?.();
  }

  override async openExternalLink(url: string): Promise<void> {
    const bridge = getMaxBridge();
    if (bridge?.openExternalLink) {
      bridge.openExternalLink(url);
      return;
    }
    await super.openExternalLink(url);
  }

  override async openInternalLink(url: string): Promise<void> {
    const bridge = getMaxBridge();
    if (bridge?.openMaxLink) {
      bridge.openMaxLink(url);
      return;
    }
    await super.openInternalLink(url);
  }

  override async closeApp(): Promise<void> {
    const bridge = getMaxBridge();
    if (bridge?.close) {
      bridge.close();
      return;
    }
    await super.closeApp();
  }

  override vibrateImpact(style: ImpactHapticFeedbackStyle): void {
    const bridge = getMaxBridge();
    if (!bridge?.HapticFeedback?.impactOccurred) {
      super.vibrateImpact(style);
      return;
    }
    void bridge.HapticFeedback.impactOccurred(style).catch((error) => {
      console.warn('[mini-app-template] MAX impact haptic failed:', error);
    });
  }

  override vibrateNotification(type: NotificationHapticFeedbackType): void {
    const bridge = getMaxBridge();
    if (!bridge?.HapticFeedback?.notificationOccurred) {
      super.vibrateNotification(type);
      return;
    }
    void bridge.HapticFeedback.notificationOccurred(type).catch((error) => {
      console.warn('[mini-app-template] MAX notification haptic failed:', error);
    });
  }

  override vibrateSelection(): void {
    const bridge = getMaxBridge();
    if (!bridge?.HapticFeedback?.selectionChanged) {
      super.vibrateSelection();
      return;
    }
    void bridge.HapticFeedback.selectionChanged().catch((error) => {
      console.warn('[mini-app-template] MAX selection haptic failed:', error);
    });
  }

  override async scanQRCode(options?: MiniAppQrScanOptions): Promise<string | null> {
    const bridge = getMaxBridge();
    if (!bridge?.openCodeReader) {
      return super.scanQRCode(options);
    }

    try {
      const result = await bridge.openCodeReader(options?.closeOnCapture !== false);
      return result?.value ?? null;
    } catch (error) {
      console.warn('[mini-app-template] MAX QR scanner failed:', error);
      return null;
    }
  }

  override async requestPhone(): Promise<string | null> {
    const bridge = getMaxBridge();
    if (bridge?.requestPhoneNumber) {
      try {
        const response = await bridge.requestPhoneNumber();
        return this.extractPhone(response);
      } catch (error) {
        console.warn('[mini-app-template] MAX requestPhone failed:', error);
        return null;
      }
    }

    return this.requestPhoneViaEvent();
  }

  override async showPopup(options: MiniAppPopupOptions): Promise<string | null> {
    // MAX bridge does not expose a native popup API yet.
    return super.showPopup(options);
  }

  override async downloadFile(url: string, filename: string): Promise<void> {
    const bridge = getMaxBridge();
    if (bridge?.downloadFile) {
      try {
        await bridge.downloadFile(url, filename);
        return;
      } catch (error) {
        console.warn('[mini-app-template] MAX downloadFile failed:', error);
      }
    }

    await super.downloadFile(url, filename);
  }

  private async requestPhoneViaEvent(): Promise<string | null> {
    if (typeof window === 'undefined') {
      return null;
    }

    let providedPromise: Promise<unknown> | undefined;
    const detail: MaxPhoneRequestEventDetail = {
      providePromise: (promise) => {
        providedPromise = promise;
      },
    };

    window.dispatchEvent(new CustomEvent<MaxPhoneRequestEventDetail>('WebAppRequestPhone', { detail }));

    if (!providedPromise) {
      console.warn('[mini-app-template] MAX requestPhone not handled: native promise missing');
      return null;
    }

    try {
      const result = await providedPromise;
      return this.extractPhone(result);
    } catch (error) {
      console.warn('[mini-app-template] MAX requestPhone promise rejected:', error);
      return null;
    }
  }

  private extractPhone(data: unknown): string | null {
    if (typeof data === 'string') {
      return data || null;
    }

    if (!data || typeof data !== 'object') {
      return null;
    }

    const directPhone = (data as { phone?: unknown; phone_number?: unknown; phoneNumber?: unknown }).phone
      ?? (data as { phone_number?: unknown }).phone_number
      ?? (data as { phoneNumber?: unknown }).phoneNumber;

    if (typeof directPhone === 'string' && directPhone) {
      return directPhone;
    }

    const contact = (data as { contact?: unknown }).contact;
    if (contact && typeof contact === 'object') {
      const nested = (contact as {
        phone?: unknown;
        phone_number?: unknown;
        phoneNumber?: unknown;
      }).phone
        ?? (contact as { phone_number?: unknown }).phone_number
        ?? (contact as { phoneNumber?: unknown }).phoneNumber;

      if (typeof nested === 'string' && nested) {
        return nested;
      }
    }

    return null;
  }

  protected override onDestroy(): void {
    this.backHandlers.clear();
    super.onDestroy();
  }
}
