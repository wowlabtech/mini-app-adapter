export type FeatureCallable<T extends (...args: any[]) => unknown> = T & {
  isAvailable?: () => boolean;
};

export type FeatureCallResult<T extends (...args: any[]) => unknown> =
  | { ok: true; value: ReturnType<T> }
  | { ok: false };

export function isFeatureAvailable<T extends (...args: any[]) => unknown>(
  feature: FeatureCallable<T> | T | null | undefined,
): feature is FeatureCallable<T> {
  if (typeof feature !== 'function') {
    return false;
  }

  const candidate = feature as FeatureCallable<T>;
  if (typeof candidate.isAvailable === 'function') {
    try {
      return candidate.isAvailable();
    } catch (error) {
      console.warn('[tvm-app-adapter] feature availability check failed:', error);
      return false;
    }
  }

  return true;
}

export function ensureFeature<T extends (...args: any[]) => unknown>(
  feature: FeatureCallable<T> | T | null | undefined,
  ...args: Parameters<T>
): FeatureCallResult<T> {
  if (!isFeatureAvailable(feature as FeatureCallable<T>)) {
    return { ok: false };
  }

  try {
    const value = (feature as T)(...args);
    return { ok: true, value };
  } catch (error) {
    console.warn('[tvm-app-adapter] feature call failed:', error);
    return { ok: false };
  }
}
