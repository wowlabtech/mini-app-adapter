import jsQR from "jsqr";

import { BaseMiniAppAdapter } from './baseAdapter';
import type { MiniAppCapability, MiniAppQrScanOptions, MiniAppScanResult } from '@/types/miniApp';
import { triggerFileDownload } from '@/lib/download';
import { shareNative } from '@/lib/nativeShare';
import { classifyGetUserMediaError } from '@/lib/scanErrors';

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

  override async supports(capability: MiniAppCapability): Promise<boolean> {
    switch (capability) {
      case 'copyTextToClipboard':
        return typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText);
      case 'downloadFile':
        return typeof document !== 'undefined';
      case 'shareUrl':
        return typeof navigator !== 'undefined' && (Boolean(navigator.share) || Boolean(navigator.clipboard?.writeText));
      case 'addToHomeScreen':
        return /android/i.test(navigator.userAgent) && Boolean(this.deferredPrompt);
      case 'checkHomeScreenStatus':
        return true;
      default:
        return super.supports(capability);
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

  override scanQRCode(_options?: MiniAppQrScanOptions): Promise<MiniAppScanResult> {
    return new Promise<MiniAppScanResult>(async (resolve) => {
      if (typeof document === 'undefined') {
        resolve({ status: 'error', code: 'unsupported' });
        return;
      }

      // getUserMedia is gated behind a secure context. On plain http (e.g. a LAN
      // IP during testing) navigator.mediaDevices is undefined — bail before
      // building the scanner UI instead of throwing mid-stream.
      if (!navigator.mediaDevices?.getUserMedia) {
        resolve({
          status: 'error',
          code: window.isSecureContext === false ? 'insecure_context' : 'unsupported',
        });
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
      overlay.style.gap = "20px";
      overlay.style.padding = "24px";
      overlay.style.boxSizing = "border-box";
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
      hint.style.fontSize = "17px";
      hint.style.opacity = "0.9";
      overlay.appendChild(hint);

      const bottomCloseBtn = document.createElement("button");
      bottomCloseBtn.innerText = "Закрыть";
      bottomCloseBtn.style.minWidth = `${Math.min(scanSize, 220)}px`;
      bottomCloseBtn.style.height = "48px";
      bottomCloseBtn.style.padding = "0 20px";
      bottomCloseBtn.style.border = "1px solid rgba(255,255,255,0.24)";
      bottomCloseBtn.style.borderRadius = "14px";
      bottomCloseBtn.style.background = "rgba(255,255,255,0.12)";
      bottomCloseBtn.style.color = "white";
      bottomCloseBtn.style.fontSize = "16px";
      bottomCloseBtn.style.fontWeight = "600";
      bottomCloseBtn.style.cursor = "pointer";
      bottomCloseBtn.style.backdropFilter = "blur(8px)";
      overlay.appendChild(bottomCloseBtn);

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      let stream: MediaStream | null = null;
      let rafId: number | null = null;
      let lastScanAt = 0;

      let closed = false;
      const finalize = async (result: MiniAppScanResult) => {
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
        // View torn down under us — treat as a user-initiated close.
        void finalize({ status: 'cancelled' });
      });

      const closeScanner = (result: MiniAppScanResult) => {
        void finalize(result);
        removeFromBag();
      };

      closeBtn.onclick = () => closeScanner({ status: 'cancelled' });
      bottomCloseBtn.onclick = () => closeScanner({ status: 'cancelled' });

      // ===============================================
      //  START CAM
      // ===============================================
      try {
        const constraints: MediaStreamConstraints[] = [
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              aspectRatio: { ideal: 1.7777777778 },
            },
            audio: false,
          },
          {
            video: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          },
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

        // The user may have closed the overlay (or the view was destroyed) while
        // getUserMedia was still pending — the permission prompt can take a couple
        // of seconds. In that case finalize() already ran with stream === null, so
        // the tracks would otherwise leak and keep the camera (and the device) hot.
        if (closed) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
          return;
        }

        const [videoTrack] = stream.getVideoTracks();
        if (videoTrack) {
          try {
            const advancedConstraints = [
              { focusMode: "continuous" },
              { exposureMode: "continuous" },
              { whiteBalanceMode: "continuous" },
            ] as unknown as MediaTrackConstraintSet[];
            await videoTrack.applyConstraints({
              advanced: advancedConstraints,
            });
          } catch {
            // Ignore unsupported advanced camera constraints.
          }
        }

        video.srcObject = stream;
        await video.play();

        // Closed while video.play() was awaiting — stop the camera and bail.
        if (closed) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
          video.srcObject = null;
          return;
        }

        // Cap the resolution we actually feed to jsQR. The camera streams up to
        // 1920x1080 (~2MP), but decoding a full-res frame ~12x/sec pegs the CPU
        // and overheats the phone. Downscaling the longest side to SCAN_MAX_DIM
        // cuts the per-frame pixel work by roughly an order of magnitude while
        // staying well above the resolution a QR needs to be readable.
        const SCAN_MAX_DIM = 720;
        // ~7 decodes/sec is plenty responsive for QR and far cooler than ~12.
        const SCAN_INTERVAL_MS = 140;

        const scanFrame = (now: number) => {
          if (closed) {
            return;
          }
          if (now - lastScanAt >= SCAN_INTERVAL_MS && context && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
            if (videoWidth > 0 && videoHeight > 0) {
              const scale = Math.min(1, SCAN_MAX_DIM / Math.max(videoWidth, videoHeight));
              const width = Math.round(videoWidth * scale);
              const height = Math.round(videoHeight * scale);
              canvas.width = width;
              canvas.height = height;
              context.drawImage(video, 0, 0, width, height);
              const imageData = context.getImageData(0, 0, width, height);
              // Loyalty QR codes are dark-on-light, so skip the inverted pass
              // ("attemptBoth" runs jsQR twice and doubles the cost for nothing).
              const result = jsQR(imageData.data, width, height, {
                inversionAttempts: "dontInvert",
              });
              if (result?.data) {
                closeScanner({ status: 'success', data: result.data });
                return;
              }
              lastScanAt = now;
            }
          }
          rafId = requestAnimationFrame(scanFrame);
        };

        rafId = requestAnimationFrame(scanFrame);
      } catch (error) {
        // The camera failure surfaces here via the `!stream` throw above, so the
        // original DOMException.name is intact for classification.
        console.error("QR Start error", error);
        closeScanner({ status: 'error', code: classifyGetUserMediaError(error), cause: error });
      }
    });
  }
  shareUrl(url: string, text?: string): void {
    void shareNative(url, text).then((result) => {
      if (result !== 'unsupported') return;

      const payload = text ? `${text}\n${url}` : url;
      this.copyTextToClipboard(payload).catch((err) => {
        console.warn('Share fallback (clipboard) failed:', err);
      });
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
