import bridge, {
  AnyRequestMethodName,
  parseURLSearchParamsForGetLaunchParams,
  
  TapticNotificationType,
  
  TapticVibrationPowerType,
  
  type AppearanceType,
  type GetLaunchParamsResponse,
  type ParentConfigData,
  type VKBridgeSubscribeHandler,
} from '@vkontakte/vk-bridge';

import { BaseMiniAppAdapter } from '@/adapters/baseAdapter';
import type {
  MiniAppCapability,
  MiniAppEnvironmentInfo,
  MiniAppInitOptions,
  MiniAppQrScanOptions,
} from '@/types/miniApp';

export class VKMiniAppAdapter extends BaseMiniAppAdapter {
  private configSafeArea?: MiniAppEnvironmentInfo['safeArea'];
  private stopViewportTracking?: () => void;

  private readonly handleViewportSafeArea = () => {
    if (typeof window === 'undefined') {
      return;
    }

    const combinedSafeArea = this.computeSafeArea();
    if (!combinedSafeArea) {
      return;
    }
    const prevSafeArea = this.environment.safeArea;

    if (!prevSafeArea ||
      prevSafeArea.top !== combinedSafeArea.top ||
      prevSafeArea.right !== combinedSafeArea.right ||
      prevSafeArea.bottom !== combinedSafeArea.bottom ||
      prevSafeArea.left !== combinedSafeArea.left) {
      this.environment.safeArea = combinedSafeArea;
      this.notifyEnvironmentChanged();
    }
  };

  override computeSafeArea(): MiniAppEnvironmentInfo['safeArea'] {
    const baseSafeArea = this.computeBaseSafeArea() ?? {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    };

    const safeArea = { ...baseSafeArea };
    const overlayInsets = this.resolveOverlayInsets();

    if (overlayInsets) {
      safeArea.top = Math.max(safeArea.top, overlayInsets.top);
      safeArea.right = Math.max(safeArea.right, overlayInsets.right);
    }

    return safeArea;
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
    this.unsubscribe = () => bridge.unsubscribe(handler);

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
    if (await this.isBridgeMethodSupported('VKWebAppTapticImpactOccurred')) {
      bridge.send('VKWebAppTapticImpactOccurred', { style });
    }
  }

  override async vibrateNotification(type: TapticNotificationType): Promise<void> {
    if (await this.isBridgeMethodSupported('VKWebAppTapticNotificationOccurred')) {
      bridge.send('VKWebAppTapticNotificationOccurred', { type });
    }
  }

  override async vibrateSelection(): Promise<void> {
    if (await this.isBridgeMethodSupported('VKWebAppTapticSelectionChanged')) {
      bridge.send('VKWebAppTapticSelectionChanged');
    }
  }

  override async setColors(colors: { header?: string; background?: string }): Promise<void> {
    const { header, background } = colors;

    if (header || background) {
      const canApplyViewSettings = await this.isBridgeMethodSupported('VKWebAppSetViewSettings');

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

  override getLaunchParams(): unknown {
    if (!this.launchParams) {
      return undefined;
    }

    return {
      launchParams: this.launchParams,
      queryParams: this.queryParams,
    };
  }

  override async supports(capability: MiniAppCapability): Promise<boolean> {
    if (capability === 'requestPhone') {
      const [supportsPhoneNumber, supportsPersonalCard] = await Promise.all([
        this.isBridgeMethodSupported('VKWebAppGetPhoneNumber'),
        this.isBridgeMethodSupported('VKWebAppGetPersonalCard'),
      ]);
      return supportsPhoneNumber || supportsPersonalCard;
    }

    if (capability === 'notifications') {
      return this.isBridgeMethodSupported('VKWebAppAllowNotifications');
    }

    return await super.supports(capability);
  }

  override async requestPhone(): Promise<string | null> {
    const [supportsPhoneNumber, supportsPersonalCard] = await Promise.all([
      this.isBridgeMethodSupported('VKWebAppGetPhoneNumber'),
      this.isBridgeMethodSupported('VKWebAppGetPersonalCard'),
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
    const supported = await this.isBridgeMethodSupported('VKWebAppAllowNotifications');
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

  override async scanQRCode(options?: MiniAppQrScanOptions): Promise<string | null> {
    const supportsQrScanner = await this.isBridgeMethodSupported('VKWebAppOpenCodeReader');
    
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

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.viewHideListeners.clear();
    this.viewRestoreListeners.clear();
    this.stopViewportTracking?.();
    this.stopViewportTracking = undefined;
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

  private async isBridgeMethodSupported(method: AnyRequestMethodName): Promise<boolean> {
    if (typeof bridge.supportsAsync === 'function') {
      try {
        return await bridge.supportsAsync(method);
      } catch (error) {
        console.warn('[tvm-app-adapter] VK bridge.supportsAsync failed:', error);
        return false;
      }
    }

    return false;
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
    const previousSafeArea = this.environment.safeArea;
    this.environment.safeArea = this.configSafeArea;

    const result = super.computeSafeArea() ?? {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    };

    this.environment.safeArea = previousSafeArea;
    return result;
  }

  private startViewportTracking(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const handler = this.handleViewportSafeArea;
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);

    this.stopViewportTracking = () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
    };
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
}
