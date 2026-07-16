import type { MiniAppPlatform } from '@/types/miniApp';

export type ShellPlatform = 'shell_ios' | 'shell_android';

const SHELL_PLATFORMS: readonly ShellPlatform[] = ['shell_ios', 'shell_android'] as const;
const SHELL_QR_TIMEOUT_MS = 60_000;

type ShellBridgeCommand =
  | {
      type: 'storeToken';
      payload?: ShellStoreTokenPayload;
    }
  | {
      type: 'requestPushPermission';
    }
  | {
      type: 'openNativeQR';
    };

export interface ShellStoreTokenPayload {
  token?: string;
  [key: string]: unknown;
}

interface NativeShellBridge {
  postMessage(message: ShellBridgeCommand): void;
}

type ShellWindow = Window &
  Record<string, unknown> & {
    NativeBridge?: NativeShellBridge;
    nativePlatform?: ShellPlatform;
    nativePushToken?: (token: string) => void;
    nativeDeepLink?: (path: string) => void;
    nativeQRResult?: (value: string) => void;
    nativeQRError?: (reason: string) => void;
    nativeAppActive?: () => void;
    nativeAppBackground?: () => void;
  };

type PushListener = (token: string) => void;
type DeepLinkListener = (path: string) => void;
type VoidListener = () => void;

type PendingQrRequest = {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

/**
 * Reasons the native shell can report over the `nativeQRError` callback. These
 * mirror the camera-level scan codes so the shell adapter can pass them straight
 * through. Native iOS/Android must send one of these strings; anything else is
 * normalized to `unknown`.
 */
export type ShellQrErrorReason =
  | 'permission_denied'
  | 'no_camera'
  | 'camera_busy'
  | 'cancelled'
  | 'unknown';

const SHELL_QR_ERROR_REASONS: readonly ShellQrErrorReason[] = [
  'permission_denied',
  'no_camera',
  'camera_busy',
  'cancelled',
  'unknown',
] as const;

/** Carries the native reason so the shell adapter can map it to a scan code. */
export class ShellQrError extends Error {
  readonly reason: ShellQrErrorReason;

  constructor(reason: ShellQrErrorReason) {
    super(`Native QR failed: ${reason}`);
    this.name = 'ShellQrError';
    this.reason = reason;
  }
}

function normalizeShellQrReason(reason: unknown): ShellQrErrorReason {
  return SHELL_QR_ERROR_REASONS.includes(reason as ShellQrErrorReason)
    ? (reason as ShellQrErrorReason)
    : 'unknown';
}

const pushListeners = new Set<PushListener>();
const deepLinkListeners = new Set<DeepLinkListener>();
const activeListeners = new Set<VoidListener>();
const backgroundListeners = new Set<VoidListener>();

let lastPushToken: string | null = null;

let pendingQrRequest: PendingQrRequest | null = null;

export interface ShellBridgeConfig {
  platformFlag: string;
  pushTokenCallback: string;
  qrResultCallback: string;
  qrErrorCallback: string;
  deepLinkCallback: string;
  appActiveCallback: string;
  appBackgroundCallback: string;
}

const DEFAULT_BRIDGE_CONFIG: ShellBridgeConfig = {
  platformFlag: 'nativePlatform',
  pushTokenCallback: 'nativePushToken',
  qrResultCallback: 'nativeQRResult',
  qrErrorCallback: 'nativeQRError',
  deepLinkCallback: 'nativeDeepLink',
  appActiveCallback: 'nativeAppActive',
  appBackgroundCallback: 'nativeAppBackground',
};

let bridgeConfig: ShellBridgeConfig = { ...DEFAULT_BRIDGE_CONFIG };

type BridgeCallbackKey =
  | 'pushTokenCallback'
  | 'deepLinkCallback'
  | 'appActiveCallback'
  | 'appBackgroundCallback'
  | 'qrResultCallback'
  | 'qrErrorCallback';

let installedCallbackNames: Partial<Record<BridgeCallbackKey, string>> = {};

function notifyPushListeners(token: string): void {
  lastPushToken = token;
  for (const listener of pushListeners) {
    try {
      listener(token);
    } catch (error) {
      console.warn('[tvm-app-adapter] push token listener failed:', error);
    }
  }
}

export interface ShellAPI {
  openNativeQR(): Promise<string>;
  onPushToken(callback: PushListener): () => void;
  onDeepLink(callback: DeepLinkListener): () => void;
  onAppActive(callback: VoidListener): () => void;
  onAppBackground(callback: VoidListener): () => void;
}

export function configureShellBridge(config: Partial<ShellBridgeConfig>): void {
  bridgeConfig = { ...bridgeConfig, ...config };
  installGlobalCallbacks();
}

export function isShell(platform: MiniAppPlatform): platform is ShellPlatform {
  return SHELL_PLATFORMS.includes(platform as ShellPlatform);
}

export function isShellIOS(platform: MiniAppPlatform): platform is 'shell_ios' {
  return platform === 'shell_ios';
}

export function isShellAndroid(platform: MiniAppPlatform): platform is 'shell_android' {
  return platform === 'shell_android';
}

export function readShellPlatform(): ShellPlatform | undefined {
  const shellWindow = getShellWindow();
  if (!shellWindow) {
    return undefined;
  }
  const platform = (shellWindow as Record<string, unknown>)[bridgeConfig.platformFlag];
  if (platform === 'shell_ios' || platform === 'shell_android') {
    return platform;
  }
  return undefined;
}

type PlatformResolver = MiniAppPlatform | (() => MiniAppPlatform);

export function createShellAPI(platform: PlatformResolver): ShellAPI {
  installGlobalCallbacks();

  const resolvePlatform = typeof platform === 'function' ? platform : () => platform;

  return {
    async openNativeQR(): Promise<string> {
      const currentPlatform = resolvePlatform();
      if (isShell(currentPlatform)) {
        return openNativeQrViaBridge();
      }
      // Native QR is a shell-only bridge call. Web/Telegram/VK platforms scan
      // through their own adapter's scanQRCode override, so reaching here means
      // openNativeQR was called outside a shell container.
      throw new Error('Native QR scanning is only available inside a shell container.');
    },
    onPushToken(callback: PushListener): () => void {
      pushListeners.add(callback);
      if (lastPushToken) {
        queueMicrotask(() => {
          try {
            callback(lastPushToken as string);
          } catch (error) {
            console.warn('[tvm-app-adapter] push token listener failed:', error);
          }
        });
      }
      return () => pushListeners.delete(callback);
    },
    onDeepLink(callback: DeepLinkListener): () => void {
      deepLinkListeners.add(callback);
      return () => deepLinkListeners.delete(callback);
    },
    onAppActive(callback: VoidListener): () => void {
      activeListeners.add(callback);
      return () => activeListeners.delete(callback);
    },
    onAppBackground(callback: VoidListener): () => void {
      backgroundListeners.add(callback);
      return () => backgroundListeners.delete(callback);
    },
  };
}

export const shell = createShellAPI(() => readShellPlatform() ?? 'web');

export function storeShellToken(payload?: ShellStoreTokenPayload): boolean {
  return sendBridgeCommand({ type: 'storeToken', payload });
}

export function requestShellPushPermission(): boolean {
  return sendBridgeCommand({ type: 'requestPushPermission' });
}

function getShellWindow(): ShellWindow | null {
  return typeof window === 'undefined' ? null : (window as unknown as ShellWindow);
}

function getNativeBridge(): NativeShellBridge | null {
  const shellWindow = getShellWindow();
  if (!shellWindow) {
    return null;
  }
  const bridge = shellWindow.NativeBridge;
  if (!bridge || typeof bridge.postMessage !== 'function') {
    return null;
  }
  return bridge;
}

function sendBridgeCommand(command: ShellBridgeCommand): boolean {
  const bridge = getNativeBridge();
  if (!bridge) {
    return false;
  }
  try {
    bridge.postMessage(command);
    return true;
  } catch (error) {
    console.warn('[tvm-app-adapter] NativeBridge.postMessage failed:', error);
    return false;
  }
}

function installGlobalCallbacks(): void {
  const shellWindow = getShellWindow();
  if (!shellWindow) {
    installedCallbackNames = {};
    return;
  }

  const target = shellWindow as ShellWindow & Record<string, unknown>;

  const assignCallback = (
    key: BridgeCallbackKey,
    handler: (...args: unknown[]) => void,
  ) => {
    const nextName = bridgeConfig[key];
    const previousName = installedCallbackNames[key];
    if (previousName && previousName !== nextName) {
      delete target[previousName];
    }
    installedCallbackNames[key] = nextName;
    target[nextName] = handler;
  };

  assignCallback('pushTokenCallback', (token: unknown) => {
    if (typeof token !== 'string') {
      return;
    }
    console.log('[tvm-app-adapter] nativePushToken', token);
    notifyPushListeners(token);
  });

  assignCallback('deepLinkCallback', (path: unknown) => {
    if (typeof path !== 'string') {
      return;
    }
    for (const listener of deepLinkListeners) {
      try {
        listener(path);
      } catch (error) {
        console.warn('[tvm-app-adapter] deep link listener failed:', error);
      }
    }
  });

  assignCallback('appActiveCallback', () => {
    for (const listener of activeListeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[tvm-app-adapter] app active listener failed:', error);
      }
    }
  });

  assignCallback('appBackgroundCallback', () => {
    for (const listener of backgroundListeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[tvm-app-adapter] app background listener failed:', error);
      }
    }
  });

  assignCallback('qrResultCallback', (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }
    if (!pendingQrRequest) {
      return;
    }
    clearTimeout(pendingQrRequest.timeoutId);
    pendingQrRequest.resolve(value);
    pendingQrRequest = null;
  });

  // Error channel for the native scanner. Without this the native side can only
  // report success, so a denied/cancelled scan silently hangs until the 60s
  // timeout. Native must call it with a ShellQrErrorReason.
  assignCallback('qrErrorCallback', (reason: unknown) => {
    if (!pendingQrRequest) {
      return;
    }
    clearTimeout(pendingQrRequest.timeoutId);
    pendingQrRequest.reject(new ShellQrError(normalizeShellQrReason(reason)));
    pendingQrRequest = null;
  });
}

function openNativeQrViaBridge(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (pendingQrRequest) {
      pendingQrRequest.reject(new Error('QR request superseded by a new call.'));
      clearTimeout(pendingQrRequest.timeoutId);
      pendingQrRequest = null;
    }

    if (!sendBridgeCommand({ type: 'openNativeQR' })) {
      reject(new Error('Native bridge is unavailable.'));
      return;
    }

    const timeoutId = setTimeout(() => {
      if (pendingQrRequest) {
        pendingQrRequest.reject(new Error('Native QR request timed out.'));
        pendingQrRequest = null;
      }
    }, SHELL_QR_TIMEOUT_MS);

    pendingQrRequest = { resolve, reject, timeoutId };
  });
}
