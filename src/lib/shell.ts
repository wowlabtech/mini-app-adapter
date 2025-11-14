import type { MiniAppPlatform } from '@/types/miniApp';

export type ShellPlatform = 'shell_ios' | 'shell_android';

const SHELL_PLATFORMS: readonly ShellPlatform[] = ['shell_ios', 'shell_android'] as const;
const SHELL_QR_TIMEOUT_MS = 60_000;
const ADAPTER_INSTALL_FLAG = '__NATIVE_SHELL_ADAPTER_INSTALLED__';

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
  };

type PushListener = (token: string) => void;
type DeepLinkListener = (path: string) => void;
type VoidListener = () => void;

type PendingQrRequest = {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

const pushListeners = new Set<PushListener>();
const deepLinkListeners = new Set<DeepLinkListener>();
const activeListeners = new Set<VoidListener>();
const backgroundListeners = new Set<VoidListener>();

let pendingQrRequest: PendingQrRequest | null = null;

export interface ShellBridgeConfig {
  platformFlag: string;
  pushTokenCallback: string;
  qrResultCallback: string;
  deepLinkCallback: string;
  appActiveCallback: string;
  appBackgroundCallback: string;
}

const DEFAULT_BRIDGE_CONFIG: ShellBridgeConfig = {
  platformFlag: '__NATIVE_SHELL_PLATFORM__',
  pushTokenCallback: '__NATIVE_SHELL_PUSH_TOKEN__',
  qrResultCallback: '__NATIVE_SHELL_ON_QR_RESULT__',
  deepLinkCallback: '__NATIVE_SHELL_ON_DEEPLINK__',
  appActiveCallback: '__NATIVE_SHELL_ON_ACTIVE__',
  appBackgroundCallback: '__NATIVE_SHELL_ON_BACKGROUND__',
};

let bridgeConfig: ShellBridgeConfig = { ...DEFAULT_BRIDGE_CONFIG };

export interface ShellAPI {
  openNativeQR(): Promise<string>;
  onPushToken(callback: PushListener): void;
  onDeepLink(callback: DeepLinkListener): void;
  onAppActive(callback: VoidListener): void;
  onAppBackground(callback: VoidListener): void;
}

export function configureShellBridge(config: Partial<ShellBridgeConfig>): void {
  bridgeConfig = { ...bridgeConfig, ...config };
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
  const platform = shellWindow[bridgeConfig.platformFlag];
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
      return startHtml5Qrcode();
    },
    onPushToken(callback: PushListener): void {
      pushListeners.add(callback);
    },
    onDeepLink(callback: DeepLinkListener): void {
      deepLinkListeners.add(callback);
    },
    onAppActive(callback: VoidListener): void {
      activeListeners.add(callback);
    },
    onAppBackground(callback: VoidListener): void {
      backgroundListeners.add(callback);
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
  if (!shellWindow || shellWindow[ADAPTER_INSTALL_FLAG]) {
    return;
  }

  shellWindow[ADAPTER_INSTALL_FLAG] = true;
  const target = shellWindow as Record<string, unknown>;

  target[bridgeConfig.pushTokenCallback] = (token: string) => {
    for (const listener of pushListeners) {
      try {
        listener(token);
      } catch (error) {
        console.warn('[tvm-app-adapter] push token listener failed:', error);
      }
    }
  };

  target[bridgeConfig.deepLinkCallback] = (path: string) => {
    for (const listener of deepLinkListeners) {
      try {
        listener(path);
      } catch (error) {
        console.warn('[tvm-app-adapter] deep link listener failed:', error);
      }
    }
  };

  target[bridgeConfig.appActiveCallback] = () => {
    for (const listener of activeListeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[tvm-app-adapter] app active listener failed:', error);
      }
    }
  };

  target[bridgeConfig.appBackgroundCallback] = () => {
    for (const listener of backgroundListeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[tvm-app-adapter] app background listener failed:', error);
      }
    }
  };

  target[bridgeConfig.qrResultCallback] = (value: string) => {
    if (!pendingQrRequest) {
      return;
    }
    clearTimeout(pendingQrRequest.timeoutId);
    pendingQrRequest.resolve(value);
    pendingQrRequest = null;
  };
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

async function startHtml5Qrcode(): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('QR scanning requires a browser environment.');
  }

  const [{ Html5Qrcode }] = await Promise.all([import('html5-qrcode')]);

  return new Promise<string>((resolve, reject) => {
    const elementId = `native-shell-qr-${Date.now()}`;
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0, 0, 0, 0.9)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '2147483647';
    overlay.style.backdropFilter = 'blur(2px)';

    const reader = document.createElement('div');
    reader.id = elementId;
    reader.style.width = '280px';
    reader.style.height = '280px';
    reader.style.borderRadius = '16px';
    reader.style.overflow = 'hidden';
    reader.style.position = 'relative';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '✕';
    closeButton.style.position = 'absolute';
    closeButton.style.top = '16px';
    closeButton.style.right = '16px';
    closeButton.style.background = 'transparent';
    closeButton.style.border = 'none';
    closeButton.style.color = '#fff';
    closeButton.style.fontSize = '28px';
    closeButton.style.cursor = 'pointer';

    overlay.appendChild(closeButton);
    overlay.appendChild(reader);
    document.body.appendChild(overlay);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let disposed = false;
    const scanner = new Html5Qrcode(elementId);

    const cleanup = async (result?: string, error?: Error) => {
      if (disposed) {
        return;
      }
      disposed = true;

      try {
        await scanner.stop();
        const maybeClear = (scanner as unknown as { clear?: () => Promise<void> | void }).clear;
        if (typeof maybeClear === 'function') {
          await Promise.resolve(maybeClear.call(scanner));
        }
      } catch {
        // Ignore stop errors.
      }

      overlay.remove();
      document.body.style.overflow = previousOverflow;

      if (typeof result === 'string') {
        resolve(result);
      } else if (error) {
        reject(error);
      } else {
        reject(new Error('QR scanning was cancelled.'));
      }
    };

    closeButton.addEventListener('click', () => {
      void cleanup(undefined, new Error('QR scanning was cancelled by the user.'));
    });

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText: string) => {
          void cleanup(decodedText);
        },
        () => {}
      )
      .catch((error: unknown) => {
        const cause = error instanceof Error ? error : new Error('Unable to start HTML5 QR scanner.');
        void cleanup(undefined, cause);
      });
  });
}
