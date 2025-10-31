import type {
  ImpactHapticFeedbackStyle,
  NotificationHapticFeedbackType,
} from '@tma.js/bridge';

export type MiniAppPlatform = 'telegram' | 'vk' | 'max' | 'web';

export interface MiniAppEnvironmentInfo {
  platform: MiniAppPlatform;
  sdkVersion?: string;
  appVersion?: string;
  languageCode?: string;
  appearance?: string;
  isWebView?: boolean;
  safeArea?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export interface MiniAppInitOptions {
  /**
   * Enables verbose logs for platforms that support it.
   */
  debug?: boolean;
  /**
   * Dynamically loads Eruda devtools if supported.
   */
  eruda?: boolean;
  /**
   * Allows adapters to mock vendor-specific quirks (e.g. Telegram macOS client).
   */
  mockForMacOS?: boolean;
}

export type MiniAppCapability =
  | 'haptics'
  | 'popup'
  | 'qrScanner'
  | 'closeApp'
  | 'backButtonVisibility'
  | 'bindCssVariables';

export interface MiniAppPopupButton {
  id: string;
  text?: string;
  type?: 'default' | 'ok' | 'destructive';
}

export interface MiniAppPopupOptions {
  title: string;
  message: string;
  buttons?: MiniAppPopupButton[];
}

export interface MiniAppQrScanOptions {
  /**
   * Closes scanner right after the QR code was captured. Defaults to true.
   */
  closeOnCapture?: boolean;
}

export interface MiniAppAdapter {
  readonly platform: MiniAppPlatform;

  /**
   * Quick capability check before calling platform specific APIs.
   */
  supports(capability: MiniAppCapability): boolean;

  /**
   * Initializes platform SDK. Safe to call multiple times.
   */
  init(options?: MiniAppInitOptions): Promise<void>;

  /**
   * Indicates whether init step finished successfully.
   */
  isReady(): boolean;

  /**
   * Reads environment specific data exposed by the host Mini App platform.
   */
  getEnvironment(): MiniAppEnvironmentInfo;

  /**
   * Applies navigation / background colors if supported by the host platform.
   */
  setColors(colors: { header?: string; background?: string }): Promise<void>;

  /**
   * Registers a callback for platform back button.
   * Returns disposer that removes the listener.
   */
  onBackButton(callback: () => void): () => void;

  /**
   * Opens external link using platform capabilities.
   */
  openLink(url: string): Promise<void>;

  /**
   * Closes the host mini app if supported.
   */
  closeApp(): Promise<void>;

  /**
   * Updates visibility of the native back button if supported.
   */
  setBackButtonVisibility(visible: boolean): void;

  /**
   * Optional hook allowing adapters to expose debug helpers.
   */
  enableDebug?(state: boolean): void;

  /**
   * Binds platform theme variables to CSS custom properties.
   */
  bindCssVariables(mapper?: (key: string) => string): void;

  /**
   * Strong/weak haptic feedback helpers.
   */
  vibrateImpact(style: ImpactHapticFeedbackStyle): void;
  vibrateNotification(type: NotificationHapticFeedbackType): void;
  vibrateSelection(): void;

  /**
   * Displays native popup if available.
   * Resolves with button id or null if popup was dismissed.
   */
  showPopup(options: MiniAppPopupOptions): Promise<string | null>;

  /**
   * Opens QR scanner and resolves with scanned value (if any).
   */
  scanQRCode(options?: MiniAppQrScanOptions): Promise<string | null>;

}
