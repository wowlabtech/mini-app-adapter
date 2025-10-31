import { BaseMiniAppAdapter } from '@/adapters/baseAdapter';

export class WebMiniAppAdapter extends BaseMiniAppAdapter {
  constructor() {
    super('web', {
      sdkVersion: navigator.userAgent,
      languageCode: navigator.language,
      isWebView: false,
    });
  }
}
