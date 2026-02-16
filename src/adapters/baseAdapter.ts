import type {
  ImpactHapticFeedbackStyle,
  NotificationHapticFeedbackType,
} from '@tma.js/bridge';

import {
  type MiniAppShareStoryOptions,
  type MiniAppAdapter,
  type MiniAppCapability,
  type MiniAppEnvironmentInfo,
  type MiniAppInitOptions,
  type MiniAppPlatform,
  type MiniAppPopupOptions,
  type MiniAppQrScanOptions,
  type MiniAppViewportInsets,
} from '@/types/miniApp';
import { DisposableBag, type Disposable } from '@/lib/disposables';
import { triggerFileDownload } from '@/lib/download';
import { computeCombinedSafeArea, readCssSafeArea } from '@/lib/safeArea';
import { createShellAPI, type ShellAPI } from '@/lib/shell';

export abstract class BaseMiniAppAdapter implements MiniAppAdapter {
  protected ready = false;

  protected environment: MiniAppEnvironmentInfo;

  private listeners = new Set<() => void>();

  private readonly disposables = new DisposableBag();

  readonly shell: ShellAPI;

  protected constructor(platform: MiniAppPlatform, environment?: Partial<MiniAppEnvironmentInfo>) {
    this.shell = createShellAPI(platform);
    this.environment = {
      platform,
      ...environment,
    };

    if (typeof window !== 'undefined') {
      const resizeHandler = () => this.notifyEnvironmentChanged();
      window.addEventListener('resize', resizeHandler);
      this.registerDisposable(() => window.removeEventListener('resize', resizeHandler));

      if (platform !== 'web') {
        const cleanup = this.applyScrollGuards();
        if (cleanup) {
          this.registerDisposable(cleanup);
        }
      }
    }
  }

  supports(capability: MiniAppCapability): boolean | Promise<boolean> {
    switch (capability) {
      case 'openExternalLink':
        return true;
      default:
        return false;
    }
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

  destroy(): void {
    try {
      this.onDestroy();
    } finally {
      this.disposables.disposeAll();
      this.listeners.clear();
      this.ready = false;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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

  onPushToken(callback: (token: string) => void): () => void {
    return this.shell.onPushToken(callback);
  }

  onDeepLink(callback: (path: string) => void): () => void {
    return this.shell.onDeepLink(callback);
  }

  async openExternalLink(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  
  async openInternalLink(url: string): Promise<void> {
    window.open(url, '_self', 'noopener,noreferrer');
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

  onAppearanceChange(callback: (appearance: 'dark' | 'light' | undefined) => void): () => void {
    callback(this.environment.appearance as 'dark' | 'light' | undefined);
    return () => {};
  }

  getInitData(): string | undefined {
    return undefined;
  }

  getLaunchParams(): unknown {
    return undefined;
  }

  decodeStartParam(_param: string): unknown {
    return undefined;
  }

  requestFullscreen(): void {
    // No-op by default.
  }

  onViewportChange(callback: (state: { height: number; stableHeight: number }) => void): () => void {
    if (typeof window === 'undefined') {
      return () => {};
    }

    const fallbackHeight = () => window.visualViewport?.height ?? window.innerHeight;

    const notify = () => {
      const height = fallbackHeight();
      callback({ height, stableHeight: height });
    };

    notify();

    const onResize = () => notify();
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', onResize);
    window.addEventListener('resize', onResize);

    return () => {
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
      window.removeEventListener('resize', onResize);
    };
  }

  getViewportInsets(): MiniAppViewportInsets | undefined {
    return undefined;
  }

  shareMessage(_message: string): Promise<void> {
    return Promise.resolve();
  }

  shareUrl(_url: string, _text: string): void {
    // No-op by default.
  }


  async downloadFile(url: string, filename: string): Promise<void> {
    await triggerFileDownload(url, filename);
  }

  shareStory(_mediaUrl: string, _options?: MiniAppShareStoryOptions): Promise<void> {
    return Promise.resolve();
  }

  trackConversionEvent(_event: string, _payload?: Record<string, unknown>): void {
    // No-op by default; platform-specific adapters can override.
  }

  trackPixelEvent(_event: string, _payload?: Record<string, unknown>): void {
    // No-op by default; platform-specific adapters can override.
  }

  copyTextToClipboard(text: string): Promise<void> {
    return navigator.clipboard.writeText(text).catch(() => {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';  // Prevent scrolling to bottom of page in MS Edge.
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand('copy');
      } catch {
        // Ignore errors
      }
      document.body.removeChild(textarea);
    });
  }

  computeSafeArea(): MiniAppEnvironmentInfo['safeArea'] {
    const viewportInsets = this.getViewportInsets?.();
    const cssSafeArea = readCssSafeArea();

    return computeCombinedSafeArea({
      environment: this.environment.safeArea,
      viewport: viewportInsets,
      css: cssSafeArea,
    });
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

  onViewHide(_callback: () => void): () => void {
    return () => {};
  }

  onViewRestore(_callback: () => void): () => void {
    return () => {};
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

  async requestPhone(): Promise<string | null> {
    return null;
  }

  async requestNotificationsPermission(): Promise<boolean> {
    if (typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') {
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (error) {
      console.warn('[tvm-app-adapter] requestNotificationsPermission fallback failed:', error);
      return false;
    }
  }

  async addToHomeScreen(): Promise<boolean> {
    // Браузерный универсальный промпт отсутствует
    return false;
  }

  async checkHomeScreenStatus(): Promise<'added' | 'not_added' | 'unknown' | string> {
    return 'unknown';
  }

  async denyNotifications(): Promise<boolean> {
    // Браузер не предоставляет API для принудительного отключения ранее выданного разрешения
    // уведомлений, поэтому по умолчанию возвращаем false.
    console.warn('[tvm-app-adapter] denyNotifications fallback is not supported in this environment.');
    return false;
  }

  enableVerticalSwipes(): void {
    // No-op by default.
  }

  disableVerticalSwipes(): void {
    // No-op by default.
  }

  protected notifyEnvironmentChanged(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[tvm-app-adapter] environment listener failed:', error);
      }
    }
  }

  protected onDestroy(): void {
    // Subclasses can override to run synchronous teardown before shared disposables flush.
  }

  protected registerDisposable(disposable: Disposable): () => void {
    return this.disposables.add(disposable);
  }

  private applyScrollGuards(): (() => void) | undefined {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) {
      return undefined;
    }

    const prevHtmlOverscroll = html.style.overscrollBehaviorY;
    const prevBodyOverscroll = body.style.overscrollBehaviorY;
    const prevBodyTouchAction = body.style.touchAction;

    html.style.overscrollBehaviorY = 'none';
    body.style.overscrollBehaviorY = 'none';
    body.style.touchAction = 'manipulation';

    return () => {
      html.style.overscrollBehaviorY = prevHtmlOverscroll;
      body.style.overscrollBehaviorY = prevBodyOverscroll;
      body.style.touchAction = prevBodyTouchAction;
    };
  }
}
