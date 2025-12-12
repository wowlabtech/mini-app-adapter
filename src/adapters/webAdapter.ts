import { Html5Qrcode } from "html5-qrcode";

import { BaseMiniAppAdapter } from './baseAdapter';
import type { MiniAppQrScanOptions } from '@/types/miniApp';
import { triggerFileDownload } from '@/lib/download';

export class WebMiniAppAdapter extends BaseMiniAppAdapter {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  constructor() {
    super("web", {
      sdkVersion: navigator.userAgent,
      languageCode: navigator.language,
      isWebView: false,
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeinstallprompt', (event: Event) => {
        event.preventDefault();
        this.deferredPrompt = event as BeforeInstallPromptEvent;
      });
    }
  }

  override async downloadFile(url: string, filename: string): Promise<void> {
    try {
      await triggerFileDownload(url, filename, { preferBlob: true });
    } catch (error) {
      console.warn('[mini-app-template] Web downloadFile fallback:', error);
      await super.downloadFile(url, filename);
    }
  }

  override scanQRCode(_options?: MiniAppQrScanOptions): Promise<string | null> {
    return new Promise(async (resolve) => {
      if (typeof document === 'undefined') {
        resolve(null);
        return;
      }

      // ===============================================
      //  SAVE BODY STATE
      // ===============================================
      const prevOverflow = document.body.style.overflow;
      const prevPos = document.body.style.position;
      const prevTouch = document.body.style.touchAction;
      const prevWidth = document.body.style.width;
      const prevHtmlOverflow = document.documentElement.style.overflow;

      // ===============================================
      //  DISABLE PAGE SCROLL
      // ===============================================
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.width = "100%";
      document.body.style.touchAction = "none";
      document.documentElement.style.overflow = "hidden";

      // ===============================================
      //  CREATE FULLSCREEN OVERLAY
      // ===============================================
      const overlay = document.createElement("div");
      overlay.id = "qr-overlay";
      overlay.style.position = "fixed";
      overlay.style.top = "0";
      overlay.style.left = "0";
      overlay.style.right = "0";
      overlay.style.bottom = "0";
      overlay.style.zIndex = "999999999";
      overlay.style.background = "rgba(0,0,0,0.92)";
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      
      overlay.style.display = "flex";
      overlay.style.flexDirection = "column";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.overflow = "hidden"; 
      overlay.style.backdropFilter = "blur(3px)";
      document.body.appendChild(overlay);

      // ===============================================
      //  CLOSE BUTTON (TOP RIGHT)
      // ===============================================
      const closeBtn = document.createElement("button");
      closeBtn.innerText = "✕";
      closeBtn.style.position = "absolute";
      closeBtn.style.top = "22px";
      closeBtn.style.right = "22px";
      closeBtn.style.fontSize = "32px";
      closeBtn.style.color = "white";
      closeBtn.style.background = "transparent";
      closeBtn.style.border = "none";
      closeBtn.style.cursor = "pointer";
      closeBtn.style.zIndex = "9999999999";
      overlay.appendChild(closeBtn);

      // ===============================================
      //  CENTER SCAN AREA
      // ===============================================
      const scanArea = document.createElement("div");
      scanArea.id = "qr-reader";
      scanArea.style.width = "300px";
      scanArea.style.height = "300px";
      scanArea.style.borderRadius = "18px";
      scanArea.style.overflow = "hidden";
      scanArea.style.position = "relative";
      overlay.appendChild(scanArea);

      // ===============================================
      //  WHITE TELEGRAM-LIKE FRAME
      // ===============================================
      const frame = document.createElement("div");
      frame.style.position = "absolute";
      frame.style.top = "0";
      frame.style.left = "0";
      frame.style.right = "0";
      frame.style.bottom = "0";
      frame.style.border = "3px solid rgba(255,255,255,0.9)";
      frame.style.borderRadius = "18px";
      frame.style.pointerEvents = "none";
      frame.style.zIndex = "10";
      scanArea.appendChild(frame);

      // ===============================================
      //  SCAN LINE ANIMATION
      // ===============================================
      const line = document.createElement("div");
      line.style.position = "absolute";
      line.style.left = "0";
      line.style.right = "0";
      line.style.height = "2px";
      line.style.background = "rgba(255,255,255,0.85)";
      line.style.borderRadius = "2px";
      line.style.animation = "qr-line 2s infinite";
      line.style.zIndex = "11";
      scanArea.appendChild(line);

      const styleTag = document.createElement("style");
      styleTag.innerHTML = `
        @keyframes qr-line {
          0% { top: 0; }
          50% { top: calc(100% - 2px); }
          100% { top: 0; }
        }
      `;
      document.head.appendChild(styleTag);

      // ===============================================
      //  "POINT CAMERA" TEXT
      // ===============================================
      const hint = document.createElement("div");
      hint.innerText = "Наведите камеру на QR-код";
      hint.style.color = "white";
      hint.style.marginTop = "30px";
      hint.style.fontSize = "17px";
      hint.style.opacity = "0.9";
      overlay.appendChild(hint);

      // ===============================================
      //  HTML5-QRCODE INSTANCE
      // ===============================================
      const scanner = new Html5Qrcode("qr-reader");

      let closed = false;
      const finalize = async (result: string | null) => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          await scanner.stop();
        } catch {}
        overlay.remove();
        styleTag.remove();

        document.body.style.overflow = prevOverflow;
        document.body.style.position = prevPos;
        document.body.style.width = prevWidth;
        document.body.style.touchAction = prevTouch;
        document.documentElement.style.overflow = prevHtmlOverflow;

        resolve(result);
      };

      const removeFromBag = this.registerDisposable(() => {
        void finalize(null);
      });

      const closeScanner = (result: string | null) => {
        void finalize(result);
        removeFromBag();
      };

      closeBtn.onclick = () => closeScanner(null);

      // ===============================================
      //  START CAM
      // ===============================================
      try {
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
          },
          (decodedText: string) => {
            closeScanner(decodedText);
          },
          () => {}
        );
      } catch (error) {
        console.error("QR Start error", error);
        closeScanner(null);
      }
    });
  }

  shareUrl(url: string, text: string): void {
    if (navigator.share) {
      try {
        navigator.share({ title: text, text, url });
        return;
      } catch (err) {
        console.warn('Share cancelled or failed:', err);
      }
    }

    const payload = text ? `${text}\n${url}` : url;
    this.copyTextToClipboard(payload).catch((err) => {
      console.warn('Share fallback (clipboard) failed:', err);
    });
  }

  override async addToHomeScreen(): Promise<boolean> {
    const isAndroid = /android/i.test(navigator.userAgent);
    if (!isAndroid || !this.deferredPrompt) {
      return super.addToHomeScreen();
    }

    try {
      this.deferredPrompt.prompt();
      const choice = await this.deferredPrompt.userChoice;
      this.deferredPrompt = null;
      return choice?.outcome === 'accepted';
    } catch (error) {
      console.warn('[tvm-app-adapter] Web addToHomeScreen failed:', error);
      this.deferredPrompt = null;
      return false;
    }
  }

  override async checkHomeScreenStatus(): Promise<'added' | 'not_added' | 'unknown' | string> {
    try {
      const isStandalone =
        (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
        // iOS Safari specific flag
        (typeof navigator !== 'undefined' && (navigator as unknown as { standalone?: boolean }).standalone === true);

      if (isStandalone) {
        return 'added';
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

// Minimal BeforeInstallPromptEvent typing to avoid lib.dom dependency mismatch.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome?: 'accepted' | 'dismissed'; platform?: string }>;
}
