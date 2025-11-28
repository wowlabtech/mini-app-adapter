import type {
  ImpactHapticFeedbackStyle,
  NotificationHapticFeedbackType,
} from '@tma.js/bridge';

import type { ShellAPI } from '@/lib/shell';

export type MiniAppPlatform =
  | 'telegram'
  | 'vk'
  | 'max'
  | 'web'
  | 'shell_ios'
  | 'shell_android';

export interface MiniAppEnvironmentInfo {
  platform: MiniAppPlatform;
  sdkVersion?: string;
  appVersion?: string;
  languageCode?: string;
  appearance?: string;
  isWebView?: boolean;
  hasNativeQR?: boolean;
  hasPush?: boolean;
  hasWidgets?: boolean;
  safeArea?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export interface MiniAppSafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MiniAppViewportInsets {
  safeArea: MiniAppSafeAreaInsets;
  contentSafeArea: MiniAppSafeAreaInsets;
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

export interface MiniAppShareStoryOptions {
  text?: string;
  widgetLink?: {
    url: string;
    name?: string;
  };
}

export type MiniAppCapability =
  | 'haptics'
  | 'popup'
  | 'qrScanner'
  | 'closeApp'
  | 'backButton'
  | 'backButtonVisibility'
  | 'bindCssVariables'
  | 'requestPhone'
  | 'notifications';

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
  readonly shell: ShellAPI;

  /**
   * Quick capability check before calling platform specific APIs.
   */
  supports(capability: MiniAppCapability): boolean | Promise<boolean>;

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
   * Tears down adapter listeners/resources when it is no longer used.
   */
  destroy?(): void;

  /**
   * Applies navigation / background colors if supported by the host platform.
   */
  setColors(colors: { header?: string; background?: string; footer?: string }): Promise<void>;

  /**
   * Registers a callback for platform back button.
   * Returns disposer that removes the listener.
   */
  onBackButton(callback: () => void): () => void;

  /**
   * Opens external link using platform capabilities.
   */
  openExternalLink(url: string): Promise<void>;

  /**
   * Opens internal link using platform capabilities.
   */
  openInternalLink(url: string): Promise<void>;

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
   * Subscribes to appearance changes if supported by the platform.
   */
  onAppearanceChange?(callback: (appearance: 'dark' | 'light' | undefined) => void): () => void;

  /**
   * Provides raw init data string, if available.
   */
  getInitData?(): string | undefined;

  /**
   * Reads platform launch parameters, if available.
   */
  getLaunchParams?(): unknown;

  /**
   * Decodes platform specific start parameter.
   */
  decodeStartParam?(param: string): unknown;

  /**
   * Requests fullscreen mode if supported by the platform.
   */
  requestFullscreen?(): void;

  /**
   * Returns viewport safe area insets if supported by the platform.
   */
  getViewportInsets?(): MiniAppViewportInsets | undefined;

  /**
   * Aggregates all known safe area insets into a single value.
   */
  computeSafeArea(): MiniAppEnvironmentInfo['safeArea'];

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
   * Notifies when the host view goes to background/foreground (VK only).
   */
  onViewHide?(callback: () => void): () => void;
  onViewRestore?(callback: () => void): () => void;

  /**
   * Enables or disables vertical swipe gestures if supported by the platform.
   */
  enableVerticalSwipes?(): void;
  disableVerticalSwipes?(): void;

  /**
   * Displays native popup if available.
   * Resolves with button id or null if popup was dismissed.
   */
  showPopup(options: MiniAppPopupOptions): Promise<string | null>;

  /**
   * Opens QR scanner and resolves with scanned value (if any).
   */
  scanQRCode(options?: MiniAppQrScanOptions): Promise<string | null>;

  /**
   * Requests phone number from the host platform if supported.
   */
  requestPhone(): Promise<string | null>;

  /**
   * Requests permission to send push notifications (platform-specific).
   * Resolves with true if permission was granted.
   */
  requestNotificationsPermission?(): Promise<boolean>;

  /**
   * Subscribes to push token updates delivered by native shells.
   */
  onPushToken(listener: (token: string) => void): () => void;

  /**
   * Subscribes to native deep link events exposed by shell containers.
   */
  onDeepLink(listener: (path: string) => void): void;

  /**
   * Subscribes to adapter environment updates (safe area, appearance etc.).
   */
  subscribe?(listener: () => void): () => void;

  /**
   * Shares a message using platform-specific capabilities.
   */
  shareMessage?(message: string): Promise<void>;

  /**
   * Shares a URL using platform-specific capabilities.
   */
  shareUrl?(url: string, text: string): void;

  /**
   * Copies text to the clipboard if supported by the platform.
   */
  copyTextToClipboard?(text: string): Promise<void>;

  /**
   * Downloads a file using platform-specific capabilities.
   */
  downloadFile?(url: string, filename: string): Promise<void>;

  /**
   * Shares a story using platform-specific capabilities.
   */
  shareStory?(mediaUrl: string, options?: MiniAppShareStoryOptions): Promise<void>;

  /**
   * Sends analytics event to the host platform if supported.
   */
  trackConversionEvent(event: string, payload?: Record<string, unknown>): void;

  /**
   * Sends retargeting pixel event if supported.
   */
  trackPixelEvent(event: string, payload?: Record<string, unknown>): void;
}
