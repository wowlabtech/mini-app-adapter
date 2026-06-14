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
  onClick?(callback: () => void): (() => void) | void;
  offClick?(callback: () => void): void;
}

interface MaxHapticFeedback {
  impactOccurred?(
    impactStyle: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft',
    disableVibrationFallback?: boolean,
  ): Promise<unknown>;
  notificationOccurred?(
    notificationType: 'error' | 'success' | 'warning',
    disableVibrationFallback?: boolean,
  ): Promise<unknown>;
  selectionChanged?(disableVibrationFallback?: boolean): Promise<unknown>;
}

interface MaxWebApp {
  version?: string;
  platform?: 'ios' | 'android' | 'desktop' | 'web';
  initData?: string;
  initDataUnsafe?: {
    auth_date?: number;
    hash?: string;
    query_id?: string;
    ip?: string;
    start_param?: string;
    chat?: {
      id?: number;
      type?: 'DIALOG' | 'CHAT' | 'CHANNEL';
    };
    user?: {
      id?: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
      language_code?: string;
    };
  };
  ready?(): void;
  close?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  requestContact?(): Promise<{ phone?: string }>;
  openLink?(url: string): void;
  openMaxLink?(url: string): void;
  downloadFile?(url: string, fileName: string): Promise<unknown>;
  shareContent?(params: { text?: string; link?: string }): Promise<unknown>;
  shareMaxContent?(
    params: { text?: string; link?: string } | { mid: string; chatType: 'DIALOG' | 'CHAT' },
  ): Promise<unknown>;
  openCodeReader?(fileSelect?: boolean): Promise<{ requestId?: string; value?: string }>;
  BackButton?: MaxBackButton;
  HapticFeedback?: MaxHapticFeedback;
}

interface Window {
  Telegram?: TelegramSDK;
  WebApp?: MaxWebApp;
  eruda?: {
    init(): void;
    position(coords: { x: number; y: number }): void;
  };
  NativeBridge?: {
    postMessage(message: {
      type: 'storeToken' | 'requestPushPermission' | 'openNativeQR';
      payload?: Record<string, unknown>;
    }): void;
  };
  nativePlatform?: 'shell_ios' | 'shell_android';
  nativePushToken?: (token: string) => void;
  nativeDeepLink?: (path: string) => void;
  nativeQRResult?: (value: string) => void;
  nativeAppActive?: () => void;
  nativeAppBackground?: () => void;
}
