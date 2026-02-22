import bridge, {
  AnyRequestMethodName,
  parseURLSearchParamsForGetLaunchParams,
  
  ShowStoryBoxOptions,
  
  TapticNotificationType,
  
  TapticVibrationPowerType,
  
  type AppearanceType,
  type GetLaunchParamsResponse,
  type ParentConfigData,
  type VKBridgeSubscribeHandler,
} from '@vkontakte/vk-bridge';

import { getVkPixelCode } from '@/config/vkAnalytics';
import { BaseMiniAppAdapter } from '@/adapters/baseAdapter';
import type {
  MiniAppCapability,
  MiniAppEnvironmentInfo,
  MiniAppInitOptions,
  MiniAppLaunchParams,
  MiniAppQrScanOptions,
  MiniAppShareStoryOptions,
} from '@/types/miniApp';
import { isBridgeMethodSupported, type BridgeSupportsAsync } from '@/lib/bridge';
import { computeCombinedSafeArea, createSafeAreaWatcher, readCssSafeArea } from '@/lib/safeArea';

const ANALYTICS_EVENT_NAME_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;
const ANALYTICS_FALLBACK_EVENT = 'VK_ANALYTICS_EVENT';

type VkAnalyticsMethod = 'VKWebAppConversionHit' | 'VKWebAppRetargetingPixel';
type VkAnalyticsEnvelope = {
  method: VkAnalyticsMethod;
  params: Record<string, unknown>;
};

export class VKMiniAppAdapter extends BaseMiniAppAdapter {
  private configSafeArea?: MiniAppEnvironmentInfo['safeArea'];
  private stopViewportTracking?: () => void;
  private readonly supportsAsync?: BridgeSupportsAsync<AnyRequestMethodName> = typeof bridge.supportsAsync === 'function'
    ? bridge.supportsAsync.bind(bridge)
    : undefined;
  private pixelCodeWarningShown = false;

  override computeSafeArea(): MiniAppEnvironmentInfo['safeArea'] {
    const baseSafeArea = this.computeBaseSafeArea();
    const overlayInsets = this.resolveOverlayInsets();

    if (overlayInsets) {
      return computeCombinedSafeArea({
        environment: baseSafeArea,
        minimum: overlayInsets,
      });
    }

    return baseSafeArea;
  }
  private unsubscribe?: () => void;
  private launchParams?: GetLaunchParamsResponse;
  private queryParams?: Record<string, unknown>;
  private readonly viewHideListeners = new Set<() => void>();
  private readonly viewRestoreListeners = new Set<() => void>();

  constructor() {
    super('vk');
  }

  override async init(_options?: MiniAppInitOptions): Promise<void> {
    if (this.ready) {
      return;
    }

    const handler: VKBridgeSubscribeHandler = (event) => this.handleBridgeEvent(event);
    bridge.subscribe(handler);
    this.unsubscribe = this.registerDisposable(() => bridge.unsubscribe(handler));

    let initialConfig: ParentConfigData | undefined;
    try {
      initialConfig = (await bridge.send('VKWebAppGetConfig')) as ParentConfigData;
    } catch (error) {
      console.warn('[tvm-app-adapter] VKWebAppGetConfig failed:', error);
    }

    try {
      const initResult = (await bridge.send('VKWebAppInit')) as { result?: boolean } | undefined;
      if (initResult && 'result' in initResult && initResult.result === false) {
        console.warn('[tvm-app-adapter] VKWebAppInit returned result=false.');
      }
    } catch (error) {
      console.error('[tvm-app-adapter] VKWebAppInit failed:', error);
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      throw error;
    }

    let launchParams: GetLaunchParamsResponse;
    try {
      launchParams = await bridge.send('VKWebAppGetLaunchParams');
    } catch (error) {
      console.error('[tvm-app-adapter] VKWebAppGetLaunchParams failed:', error);
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      throw error;
    }

    const search = typeof window !== 'undefined' ? window.location.search : '';
    const queryParams = parseURLSearchParamsForGetLaunchParams(search);

    this.launchParams = launchParams;
    this.queryParams = queryParams as Record<string, unknown>;
    this.environment = this.composeEnvironment(launchParams, queryParams, initialConfig);
    this.configSafeArea = this.environment.safeArea;
    const combinedSafeArea = this.computeSafeArea();
    this.environment.safeArea = combinedSafeArea;
    this.applyAppearance(this.environment.appearance, initialConfig?.scheme);
    this.notifyEnvironmentChanged();

    this.ready = true;
    this.startViewportTracking();
  }

  override async vibrateImpact(style: TapticVibrationPowerType): Promise<void> {
    if (await this.supportsBridgeMethod('VKWebAppTapticImpactOccurred')) {
      bridge.send('VKWebAppTapticImpactOccurred', { style });
    }
  }

  override async vibrateNotification(type: TapticNotificationType): Promise<void> {
    if (await this.supportsBridgeMethod('VKWebAppTapticNotificationOccurred')) {
      bridge.send('VKWebAppTapticNotificationOccurred', { type });
    }
  }

  override async vibrateSelection(): Promise<void> {
    if (await this.supportsBridgeMethod('VKWebAppTapticSelectionChanged')) {
      bridge.send('VKWebAppTapticSelectionChanged');
    }
  }

  override async setColors(colors: { header?: string; background?: string }): Promise<void> {
    const { header, background } = colors;

    if (header || background) {
      const canApplyViewSettings = await this.supportsBridgeMethod('VKWebAppSetViewSettings');

      if (canApplyViewSettings) {
        const statusBarStyle: AppearanceType = header
          ? this.resolveStatusBarStyle(header)
          : this.environment.appearance?.includes('dark') ? 'light' : 'dark';

        await bridge.send('VKWebAppSetViewSettings', {
          status_bar_style: statusBarStyle,
          ...(header ? { action_bar_color: header } : {}),
          ...(background ? { navigation_bar_color: background } : {}),
        });
      }
    }

    await super.setColors(colors);
  }

  override getEnvironment(): MiniAppEnvironmentInfo {
    return {
      ...this.environment,
      isWebView: bridge.isWebView(),
    };
  }

  override getLaunchParams(): MiniAppLaunchParams | undefined {
    if (!this.launchParams) {
      return {
        customLaunchParams: this.readCustomUrlParams((key) => {
          const normalized = key.toLowerCase();
          return normalized.startsWith('vk_') || normalized === 'sign';
        }),
      };
    }

    return {
      launchParams: {
        bridge: this.launchParams,
        query: this.queryParams,
      },
      customLaunchParams: this.readCustomUrlParams((key) => {
        const normalized = key.toLowerCase();
        return normalized.startsWith('vk_') || normalized === 'sign';
      }),
    };
  }

  override async openExternalLink(url: string): Promise<void> {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  override async supports(capability: MiniAppCapability): Promise<boolean> {
    switch (capability) {
      case 'haptics': {
        const [impact, notification, selection] = await Promise.all([
          this.supportsBridgeMethod('VKWebAppTapticImpactOccurred'),
          this.supportsBridgeMethod('VKWebAppTapticNotificationOccurred'),
          this.supportsBridgeMethod('VKWebAppTapticSelectionChanged'),
        ]);
        return impact || notification || selection;
      }
      case 'qrScanner':
        return this.supportsBridgeMethod('VKWebAppOpenCodeReader');
      case 'requestPhone': {
        const [supportsPhoneNumber, supportsPersonalCard] = await Promise.all([
          this.supportsBridgeMethod('VKWebAppGetPhoneNumber'),
          this.supportsBridgeMethod('VKWebAppGetPersonalCard'),
        ]);
        return supportsPhoneNumber || supportsPersonalCard;
      }
      case 'notifications':
        return this.supportsBridgeMethod('VKWebAppAllowNotifications');
      case 'shareUrl':
        return this.supportsBridgeMethod('VKWebAppShare');
      case 'shareStory':
        return this.supportsBridgeMethod('VKWebAppShowStoryBox');
      case 'downloadFile':
        return this.supportsBridgeMethod('VKWebAppDownloadFile');
      case 'addToHomeScreen':
        return this.supportsBridgeMethod('VKWebAppAddToHomeScreen');
      case 'denyNotifications':
        return this.supportsBridgeMethod('VKWebAppDenyNotifications');
      case 'openExternalLink':
        return true;
      case 'viewVisibility':
        return true;
      default:
        return await super.supports(capability);
    }
  }

  override async requestPhone(): Promise<string | null> {
    const [supportsPhoneNumber, supportsPersonalCard] = await Promise.all([
      this.supportsBridgeMethod('VKWebAppGetPhoneNumber'),
      this.supportsBridgeMethod('VKWebAppGetPersonalCard'),
    ]);
    if (!supportsPhoneNumber && !supportsPersonalCard) {
      return super.requestPhone();
    }

    try {
      if (supportsPhoneNumber) {
        const result = await bridge.send('VKWebAppGetPhoneNumber');
        const phoneNumber = (result as { phone_number?: unknown }).phone_number;
        return typeof phoneNumber === 'string' && phoneNumber ? phoneNumber : null;
      }

      const card = await bridge.send('VKWebAppGetPersonalCard', { type: ['phone'] });
      const phone = (card as { phone?: unknown }).phone;
      return typeof phone === 'string' && phone ? phone : null;
    } catch (error) {
      console.warn('[tvm-app-adapter] VK requestPhone failed:', error);
      return null;
    }
  }

  override async requestNotificationsPermission(): Promise<boolean> {
    const supported = await this.supportsBridgeMethod('VKWebAppAllowNotifications');
    if (!supported) {
      return super.requestNotificationsPermission();
    }

    try {
      const response = await bridge.send('VKWebAppAllowNotifications');
      if (response && typeof response === 'object' && 'result' in response) {
        return Boolean((response as { result?: unknown }).result);
      }
      return true;
    } catch (error) {
      console.warn('[tvm-app-adapter] VK allow notifications failed:', error);
      return false;
    }
  }

  override async addToHomeScreen(): Promise<boolean> {
    const supported = await this.supportsBridgeMethod('VKWebAppAddToHomeScreen');
    if (!supported) {
      console.warn('[tvm-app-adapter] VK addToHomeScreen not supported');
      return super.addToHomeScreen();
    }

    try {
      const response = await bridge.send('VKWebAppAddToHomeScreen');
      if (response && typeof response === 'object' && 'result' in response) {
        return Boolean((response as { result?: unknown }).result);
      }
      return true;
    } catch (error) {
      console.warn('[tvm-app-adapter] VK addToHomeScreen failed:', error);
      return false;
    }
  }

  override async denyNotifications(): Promise<boolean> {
    const supported = await this.supportsBridgeMethod('VKWebAppDenyNotifications');
    if (!supported) {
      return super.denyNotifications();
    }

    try {
      const response = await bridge.send('VKWebAppDenyNotifications');
      if (response && typeof response === 'object' && 'result' in response) {
        return Boolean((response as { result?: unknown }).result);
      }
      return true;
    } catch (error) {
      console.warn('[tvm-app-adapter] VK deny notifications failed:', error);
      return false;
    }
  }

  override async scanQRCode(options?: MiniAppQrScanOptions): Promise<string | null> {
    const supportsQrScanner = await this.supportsBridgeMethod('VKWebAppOpenCodeReader');
    
    if (!supportsQrScanner) {
      return super.scanQRCode(options);
    }

    let result: string | null = null;

    try {
      const data = await bridge.send('VKWebAppOpenCodeReader')
      if (data.code_data) {
        result = data.code_data;
      }
    } catch (error) {
      console.log(error);
    }

    return result;
  }

  override onViewHide(callback: () => void): () => void {
    this.viewHideListeners.add(callback);
    return () => {
      this.viewHideListeners.delete(callback);
    };
  }

  override onViewRestore(callback: () => void): () => void {
    this.viewRestoreListeners.add(callback);
    return () => {
      this.viewRestoreListeners.delete(callback);
    };
  }

  override async shareStory(mediaUrl: string, _options?: MiniAppShareStoryOptions): Promise<void> {
    const options = _options;
    const vkOptions = options?.vk;

    const fallbackAttachment = options?.link
      ? {
        type: 'url',
        text: 'open',
        url: options.link.url,
      }
      : undefined;

    const fallbackStickers = options?.text
      ? [{
        sticker_type: 'native',
        sticker: {
          action_type: 'text',
          action: {
            text: options.text,
            style: 'classic',
            background_style: 'none',
          },
          transform: {
            gravity: 'center_bottom',
            translation_y: -0.2,
          },
        },
      }]
      : undefined;

    const bridgeOptions: ShowStoryBoxOptions = {
      background_type: vkOptions?.backgroundType ?? 'image',
      url: mediaUrl,
      locked: vkOptions?.locked ?? true,
      ...((vkOptions?.attachment ?? fallbackAttachment)
        ? { attachment: (vkOptions?.attachment ?? fallbackAttachment) as ShowStoryBoxOptions['attachment'] }
        : {}),
      ...((vkOptions?.stickers ?? fallbackStickers)
        ? { stickers: (vkOptions?.stickers ?? fallbackStickers) as ShowStoryBoxOptions['stickers'] }
        : {}),
    };

    await bridge.send('VKWebAppShowStoryBox', bridgeOptions);
  }

  override shareUrl(url: string, text?: string): void {
    void this.shareUrlInternal(url, text);
  }

  private async shareUrlInternal(url: string, text?: string): Promise<void> {
    const supported = await this.supportsBridgeMethod('VKWebAppShare');
    if (!supported) {
      super.shareUrl(url, text ?? '');
      return;
    }

    try {
      await bridge.send('VKWebAppShare', {
        link: url,
        ...(text ? { text } : {}),
      });
    } catch (error) {
      console.warn('[tvm-app-adapter] VK shareUrl failed:', error);
      super.shareUrl(url, text ?? '');
    }
  }

  override async downloadFile(url: string, filename: string): Promise<void> {
    const supported = await this.supportsBridgeMethod('VKWebAppDownloadFile');
    if (!supported) {
      await super.downloadFile(url, filename);
      return;
    }

    try {
      const response = await bridge.send('VKWebAppDownloadFile', { url, filename });
      const result = (response as { result?: boolean } | undefined)?.result;
      if (result === false) {
        throw new Error('VKWebAppDownloadFile returned result=false');
      }
    } catch (error) {
      console.warn('[tvm-app-adapter] VK downloadFile failed:', error);
      await super.downloadFile(url, filename);
    }
  }

  override trackConversionEvent(event: string, payload?: Record<string, unknown>): void {
    const normalizedEvent = this.normalizeAnalyticsEventName(event);
    if (!normalizedEvent) {
      return;
    }

    const envelope: VkAnalyticsEnvelope = {
      method: 'VKWebAppConversionHit',
      params: {
        event: normalizedEvent,
        params: this.normalizeAnalyticsPayload(payload),
      },
    };

    this.dispatchAnalytics(envelope);
  }

  override trackPixelEvent(event: string, payload?: Record<string, unknown>): void {
    const pixelCode = getVkPixelCode();
    if (!pixelCode) {
      if (!this.pixelCodeWarningShown) {
        console.warn('[VKAnalytics] VK pixel code is not configured. Call configureVkPixel() before tracking.');
        this.pixelCodeWarningShown = true;
      }
      return;
    }

    const normalizedEvent = this.normalizeAnalyticsEventName(event);
    if (!normalizedEvent) {
      return;
    }

    const envelope: VkAnalyticsEnvelope = {
      method: 'VKWebAppRetargetingPixel',
      params: {
        pixel_code: pixelCode,
        type: normalizedEvent,
        data: this.normalizeAnalyticsPayload(payload),
      },
    };

    this.pixelCodeWarningShown = false;
    this.dispatchAnalytics(envelope);
  }

  private dispatchAnalytics(envelope: VkAnalyticsEnvelope): void {
    if (typeof bridge.isWebView === 'function') {
      try {
        if (!bridge.isWebView()) {
          this.emitAnalyticsFallback(envelope);
          return;
        }
      } catch (error) {
        console.warn('[VKAnalytics] bridge.isWebView check failed:', error);
        this.emitAnalyticsFallback(envelope);
        return;
      }
    }

    void this.safeBridgeSend(envelope.method, envelope.params);
  }

  private emitAnalyticsFallback(envelope: VkAnalyticsEnvelope): void {
    if (typeof window === 'undefined') {
      return;
    }

    const detail = {
      ...envelope,
      timestamp: Date.now(),
    };

    if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent(ANALYTICS_FALLBACK_EVENT, { detail }));
      return;
    }

    try {
      window.postMessage({ type: ANALYTICS_FALLBACK_EVENT, detail }, '*');
    } catch (error) {
      console.warn('[VKAnalytics] fallback dispatch failed', error);
    }
  }

  private normalizeAnalyticsEventName(event: string): string | null {
    if (typeof event !== 'string') {
      return null;
    }

    const trimmed = event.trim();
    if (!trimmed || !ANALYTICS_EVENT_NAME_PATTERN.test(trimmed)) {
      console.warn(`[VKAnalytics] Invalid event name: "${event}"`);
      return null;
    }

    return trimmed;
  }

  private normalizeAnalyticsPayload(payload?: Record<string, unknown>): Record<string, unknown> {
    if (!this.isPlainObject(payload)) {
      return {};
    }

    return { ...payload };
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') {
      return false;
    }

    if (Array.isArray(value)) {
      return false;
    }

    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  private async safeBridgeSend(method: VkAnalyticsMethod, params: Record<string, unknown>): Promise<void> {
    try {
      const supported = await this.supportsBridgeMethod(method as AnyRequestMethodName);
      if (!supported) {
        return;
      }

      await bridge.send(method as AnyRequestMethodName, params as never);
    } catch (error) {
      console.warn(`[VKAnalytics] ${method} failed`, error);
    }
  }

  private composeEnvironment(
    launchParams: GetLaunchParamsResponse,
    queryParams: ReturnType<typeof parseURLSearchParamsForGetLaunchParams>,
    config?: ParentConfigData,
  ): MiniAppEnvironmentInfo {
    const language = queryParams.vk_language ?? launchParams.vk_language;
    const platform = queryParams.vk_platform ?? launchParams.vk_platform;
    const appId = queryParams.vk_app_id ?? launchParams.vk_app_id;
    const prefersDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
    const appearance = this.normalizeAppearance(config?.appearance, config?.scheme) ?? (prefersDark ? 'dark' : 'light');
    const configSafeArea = this.extractSafeAreaFromConfig(config);
    return {
      platform: 'vk',
      sdkVersion: platform ? String(platform) : undefined,
      appVersion: typeof appId === 'number' ? `vk-app-${appId}` : undefined,
      languageCode: language ? String(language) : undefined,
      appearance,
      isWebView: bridge.isWebView(),
      safeArea: configSafeArea,
    };
  }

  private handleBridgeEvent(event: Parameters<VKBridgeSubscribeHandler>[0]): void {
    const { type, data } = event.detail ?? {};

    if (type === 'VKWebAppViewHide') {
      this.notifyVisibilityListeners(this.viewHideListeners);
      return;
    }

    if (type === 'VKWebAppViewRestore') {
      this.notifyVisibilityListeners(this.viewRestoreListeners);
      return;
    }

    if (type === 'VKWebAppUpdateConfig' && data) {
      const config = data as ParentConfigData;
      this.updateEnvironmentFromConfig(config);
    }
  }

  private updateEnvironmentFromConfig(config: ParentConfigData): void {
    if (!this.environment) {
      return;
    }

    const nextAppearance = this.normalizeAppearance(config.appearance, config.scheme);
    let changed = false;

    if (nextAppearance && nextAppearance !== this.environment.appearance) {
      this.environment.appearance = nextAppearance;
      changed = true;
    }

    const prevSafeArea = this.environment.safeArea;
    const nextSafeArea = this.extractSafeAreaFromConfig(config);
    if (nextSafeArea) {
      this.configSafeArea = nextSafeArea;
      this.environment.safeArea = nextSafeArea;
    } else {
      this.configSafeArea = undefined;
      this.environment.safeArea = undefined;
    }

    const combinedSafeArea = this.computeSafeArea() ?? {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    };
    const prevForComparison = prevSafeArea;
    const safeAreaChanged =
      !prevForComparison ||
      prevForComparison.top !== combinedSafeArea.top ||
      prevForComparison.right !== combinedSafeArea.right ||
      prevForComparison.bottom !== combinedSafeArea.bottom ||
      prevForComparison.left !== combinedSafeArea.left;

    if (safeAreaChanged) {
      this.environment.safeArea = combinedSafeArea;
      changed = true;
    } else {
      this.environment.safeArea = prevSafeArea;
    }

    this.applyAppearance(this.environment.appearance, config.scheme);

    if (changed) {
      this.notifyEnvironmentChanged();
    }
  }

  private applyAppearance(appearance?: string, scheme?: string): void {
    if (typeof document === 'undefined') {
      return;
    }

    if (appearance) {
      document.documentElement.dataset.vkAppearance = appearance;
      document.documentElement.classList.toggle('dark', appearance === 'dark');
    }

    if (scheme) {
      document.documentElement.dataset.vkScheme = scheme;
      if (!appearance) {
        const normalized = this.normalizeAppearance(undefined, scheme);
        document.documentElement.classList.toggle('dark', normalized === 'dark');
      }
    }
  }

  private resolveStatusBarStyle(color: string): AppearanceType {
    const hex = color.replace('#', '');
    const normalized = hex.length === 3
      ? hex.split('').map((symbol) => symbol + symbol).join('')
      : hex.slice(0, 6);

    const r = parseInt(normalized.slice(0, 2), 16) / 255;
    const g = parseInt(normalized.slice(2, 4), 16) / 255;
    const b = parseInt(normalized.slice(4, 6), 16) / 255;

    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.6 ? 'dark' : 'light';
  }

  private normalizeAppearance(
    rawAppearance?: string | null,
    scheme?: string | null,
  ): 'dark' | 'light' | undefined {
    const normalized = rawAppearance?.toLowerCase();
    if (normalized === 'dark' || normalized === 'light') {
      return normalized;
    }

    const normalizedScheme = scheme?.toLowerCase();
    if (normalizedScheme) {
      if (normalizedScheme.includes('dark') || normalizedScheme.includes('space_gray')) {
        return 'dark';
      }
      return 'light';
    }

    return undefined;
  }

  private extractSafeAreaFromConfig(config?: ParentConfigData): MiniAppEnvironmentInfo['safeArea'] | undefined {
    const rawInsets = config && 'insets' in config
      ? (config as { insets?: { top?: number; right?: number; bottom?: number; left?: number } }).insets
      : undefined;

    if (!rawInsets) {
      return undefined;
    }

    const { top = 0, right = 0, bottom = 0, left = 0 } = rawInsets;
    const values = [top, right, bottom, left].map((value) => (typeof value === 'number' ? value : Number(value) || 0));
    const hasInsets = values.some((value) => value !== 0);

    if (!hasInsets) {
      return undefined;
    }

    const [nTop, nRight, nBottom, nLeft] = values;
    return { top: nTop, right: nRight, bottom: nBottom, left: nLeft };
  }

  private notifyVisibilityListeners(listeners: Set<() => void>): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[tvm-app-adapter] VK visibility listener failed:', error);
      }
    }
  }

  private computeBaseSafeArea(): MiniAppEnvironmentInfo['safeArea'] {
    return computeCombinedSafeArea({
      environment: this.configSafeArea,
      viewport: this.getViewportInsets?.(),
      css: readCssSafeArea(),
    });
  }

  private startViewportTracking(): void {
    this.stopViewportTracking?.();

    const dispose = createSafeAreaWatcher({
      getSafeArea: () => this.computeSafeArea(),
      onChange: (next) => {
        this.environment.safeArea = next;
        this.notifyEnvironmentChanged();
      },
    });

    if (dispose) {
      this.stopViewportTracking = this.registerDisposable(dispose);
    }
  }

  private resolveOverlayInsets(): { top: number; right: number } | undefined {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (!bridge.isWebView()) {
      return undefined;
    }

    if (!this.isLikelyMobilePlatform()) {
      return undefined;
    }

    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
    if (!viewportWidth) {
      return undefined;
    }

    const overlayBreakpoint = 880;
    if (viewportWidth > overlayBreakpoint) {
      return undefined;
    }

    const orientationQuery = window.matchMedia?.('(orientation: landscape)');
    const isLandscape = Boolean(orientationQuery?.matches);

    const top = isLandscape ? 48 : 56;
    const right = isLandscape ? 72 : 88;

    return { top, right };
  }

  private isLikelyMobilePlatform(): boolean {
    const platform = (this.resolveLaunchParam('vk_platform') ?? '').toLowerCase();
    const device = (this.resolveLaunchParam('vk_viewer_device') ?? '').toLowerCase();
    const isLayer = this.resolveLaunchParam('vk_is_layer') === '1';

    if (isLayer) {
      return false;
    }

    const mobilePattern = /(iphone|ipad|ios|android|mobile)/i;
    const desktopPattern = /(desktop|web|tablet)/i;

    const matchesMobilePlatform = mobilePattern.test(platform) || mobilePattern.test(device);
    const matchesDesktopPlatform = desktopPattern.test(platform) || desktopPattern.test(device);

    if (!matchesMobilePlatform) {
      return false;
    }

    return !matchesDesktopPlatform;
  }

  private resolveLaunchParam(key: string): string | undefined {
    const queryValue = this.queryParams?.[key];
    if (typeof queryValue === 'string' && queryValue) {
      return queryValue;
    }

    const launchValue = this.launchParams ? (this.launchParams as Record<string, unknown>)[key] : undefined;
    if (typeof launchValue === 'string' && launchValue) {
      return launchValue;
    }

    if (typeof launchValue === 'number') {
      return String(launchValue);
    }

    if (typeof launchValue === 'boolean') {
      return launchValue ? '1' : '0';
    }

    return undefined;
  }

  private supportsBridgeMethod(method: AnyRequestMethodName): Promise<boolean> {
    return isBridgeMethodSupported(method, this.supportsAsync);
  }

  protected override onDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.stopViewportTracking?.();
    this.stopViewportTracking = undefined;
    this.viewHideListeners.clear();
    this.viewRestoreListeners.clear();
    super.onDestroy();
  }
}
