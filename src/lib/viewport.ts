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

export interface ViewportCssBindingOptions extends ViewportMountOptions {
  bindCssVars?: (mapper?: (key: string) => string) => void;
  mapper?: (key: string) => string;
}

export async function bindViewportCssVars(options: ViewportCssBindingOptions): Promise<void> {
  await ensureViewportMounted(options);

  if (typeof options.bindCssVars !== 'function') {
    return;
  }

  try {
    options.bindCssVars(options.mapper);
  } catch (error) {
    if (error instanceof Error && /css variables are already bound/i.test(error.message)) {
      return;
    }
    throw error;
  }
}
