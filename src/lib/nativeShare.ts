import { UAParser, type IResult } from 'ua-parser-js';

// The Apple system share sheet (iOS, iPadOS and macOS alike — any browser, since
// they all hand off to the same native sheet) receives `text` and `url` as
// separate items, and each share target picks whichever it prefers: some send
// only the text, others only the link. `withFeatureCheck` also catches iPadOS
// reporting a desktop Macintosh user agent (flips device model to iPad via
// touch-points while `os` keeps saying macOS).
function isApplePlatform(): boolean {
  const { os, device } = UAParser(navigator.userAgent).withFeatureCheck() as IResult;
  return os.name === 'iOS' || os.name === 'macOS' || device.model === 'iPad';
}

let sharePending = false;

export type NativeShareResult = 'shared' | 'unsupported';

/**
 * Opens the browser/OS native share sheet directly, bypassing any mini-app
 * host UI — inside VK/Telegram, adapter `shareUrl` opens the host's own
 * platform share dialog instead, which isn't what "always native OS share"
 * means. Use this when a "More"/"Other" action must hand off to the actual
 * OS sheet regardless of which mini-app platform is active.
 */
export async function shareNative(url: string, text?: string): Promise<NativeShareResult> {
  if (typeof navigator === 'undefined' || !navigator.share) {
    return 'unsupported';
  }

  // A second navigator.share while the native sheet is still open rejects
  // with InvalidStateError ("An earlier share has not yet completed"), so
  // repeated taps are ignored until the current share settles.
  if (sharePending) {
    return 'shared';
  }

  // A single combined text item survives every target of the Apple share
  // sheet, which otherwise lets targets drop either the text or the link
  // (see isApplePlatform).
  const data: ShareData = isApplePlatform()
    ? { text: text ? `${text}\n${url}` : url }
    : { text, url };

  sharePending = true;
  try {
    await navigator.share(data);
  } catch (error) {
    if ((error as DOMException)?.name !== 'AbortError') {
      console.warn('[mini-app-adapter] Native share failed:', error);
    }
  } finally {
    sharePending = false;
  }

  return 'shared';
}
