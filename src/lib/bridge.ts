export type BridgeSupportsAsync<Method extends string = string> = (method: Method) => Promise<boolean>;

export async function isBridgeMethodSupported<Method extends string = string>(
  method: Method,
  supportsAsync?: BridgeSupportsAsync<Method>,
): Promise<boolean> {
  if (typeof supportsAsync !== 'function') {
    return false;
  }

  try {
    return await supportsAsync(method);
  } catch (error) {
    console.warn('[tvm-app-adapter] bridge.supportsAsync failed:', error);
    return false;
  }
}
