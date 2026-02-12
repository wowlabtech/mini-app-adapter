import jsQR from "jsqr";

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
      const scanSize = Math.min(Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.72), 320);
      const scanBox = document.createElement("div");
      scanBox.style.width = `${scanSize}px`;
      scanBox.style.height = `${scanSize}px`;
      scanBox.style.position = "relative";
      scanBox.style.flex = "0 0 auto";
      scanBox.style.borderRadius = "18px";
      scanBox.style.overflow = "hidden";
      overlay.appendChild(scanBox);

      const scanArea = document.createElement("div");
      scanArea.style.position = "absolute";
      scanArea.style.inset = "0";
      scanArea.style.zIndex = "1";
      scanArea.style.background = "#000";
      scanBox.appendChild(scanArea);

      const video = document.createElement("video");
      video.setAttribute("playsinline", "true");
      video.autoplay = true;
      video.muted = true;
      video.style.width = "100%";
      video.style.height = "100%";
      video.style.objectFit = "cover";
      video.style.position = "absolute";
      video.style.inset = "0";
      scanArea.appendChild(video);

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
      frame.style.zIndex = "3";
      scanBox.appendChild(frame);

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
      line.style.zIndex = "4";
      scanBox.appendChild(line);

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

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      let stream: MediaStream | null = null;
      let rafId: number | null = null;
      let lastScanAt = 0;

      let closed = false;
      const finalize = async (result: string | null) => {
        if (closed) {
          return;
        }
        closed = true;
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
        }
        video.srcObject = null;
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
        const constraints: MediaStreamConstraints[] = [
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          { video: { facingMode: "environment" }, audio: false },
          { video: true, audio: false },
        ];

        let lastError: unknown = null;
        for (const constraint of constraints) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(constraint);
            break;
          } catch (error) {
            lastError = error;
          }
        }

        if (!stream) {
          throw lastError instanceof Error ? lastError : new Error("Unable to access camera");
        }

        video.srcObject = stream;
        await video.play();

        const scanFrame = (now: number) => {
          if (closed) {
            return;
          }
          if (now - lastScanAt >= 100 && context && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const width = video.videoWidth;
            const height = video.videoHeight;
            if (width > 0 && height > 0) {
              canvas.width = width;
              canvas.height = height;
              context.drawImage(video, 0, 0, width, height);
              const imageData = context.getImageData(0, 0, width, height);
              const result = jsQR(imageData.data, width, height, {
                inversionAttempts: "attemptBoth",
              });
              if (result?.data) {
                closeScanner(result.data);
                return;
              }
              lastScanAt = now;
            }
          }
          rafId = requestAnimationFrame(scanFrame);
        };

        rafId = requestAnimationFrame(scanFrame);
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
