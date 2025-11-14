interface TelegramBackButton {
  show?(): void;
  hide?(): void;
  onClick?(callback: () => void): void;
  offClick?(callback: () => void): void;
}

interface TelegramWebApp {
  version?: string;
  initDataUnsafe?: {
    user?: {
      language_code?: string;
    };
  };
  ready(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  openExternalLink(url: string, options?: { try_instant_view?: boolean }): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  BackButton: TelegramBackButton;
}

interface TelegramSDK {
  WebApp?: TelegramWebApp;
}

interface MaxBackButton {
  isVisible?: boolean;
  show?(): void;
  hide?(): void;
  onClick?(callback: (payload: { needConfirmation?: boolean }) => void): (() => void) | void;
  offClick?(callback: (payload: { needConfirmation?: boolean }) => void): void;
}

interface MaxHapticFeedback {
  impactOccurred?(impactStyle: string, disableVibrationFallback?: boolean): Promise<unknown>;
  notificationOccurred?(notificationType: string, disableVibrationFallback?: boolean): Promise<unknown>;
  selectionChanged?(disableVibrationFallback?: boolean): Promise<unknown>;
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
    };
  };
  ready?(): void;
  close?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  openExternalLink?(url: string): void;
  openMaxLink?(url: string): void;
  downloadFile?(url: string, fileName: string): Promise<unknown>;
  shareContent?(params: { text: string; link?: string; requestId: string }): Promise<unknown>;
  shareMaxContent?(params: { text: string; link?: string; requestId: string }): Promise<unknown>;
  openCodeReader?(allowFileSelect?: boolean): Promise<{ requestId: string; value?: string }>;
  BackButton?: MaxBackButton;
  HapticFeedback?: MaxHapticFeedback;
}

interface Window {
  Telegram?: TelegramSDK;
  WebApp?: MaxWebApp;
  NativeBridge?: {
    postMessage(message: {
      type: 'storeToken' | 'requestPushPermission' | 'openNativeQR';
      payload?: Record<string, unknown>;
    }): void;
  };
}

declare module 'eruda' {
  const eruda: {
    init(): void;
    position(coords: { x: number; y: number }): void;
  };
  export default eruda;
}
