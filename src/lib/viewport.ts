type ViewportController = {
  isSupported?: () => boolean;
  isMounted?: () => boolean;
  mount?: () => void | Promise<void>;
};

export interface ViewportMountOptions {
  sdkViewport?: ViewportController;
  fallbackMount?: () => void | Promise<void>;
}

export async function ensureViewportMounted(options: ViewportMountOptions): Promise<void> {
  const { sdkViewport, fallbackMount } = options;

  if (sdkViewport?.isSupported?.()) {
    if (typeof sdkViewport.isMounted === 'function' && sdkViewport.isMounted()) {
      return;
    }

    if (typeof sdkViewport.mount === 'function') {
      await sdkViewport.mount();
    }
    return;
  }

  if (typeof fallbackMount === 'function') {
    await fallbackMount();
  }
}
