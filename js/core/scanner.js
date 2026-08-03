// Camera scanning.
//
// Two engines behind one interface:
//   BarcodeDetector — Chrome, Edge, Samsung. Handles QR and every 1D format.
//   ean.js          — our own, for Safari, which has no BarcodeDetector. 1D only.
//
// On the fallback path a location QR cannot be read in-app, but the phone's own
// camera app opens the label's URL directly, so nothing is actually lost — the
// UI says so rather than leaving the user wondering.

import { decodeImage } from '../vendor/ean.js';

const FORMATS = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];
const FRAME_MS = 140;          // ~7 looks per second: responsive, not a battery fire
const REPEAT_MS = 2500;        // ignore the same code for this long

export function capabilities() {
  return {
    camera: Boolean(navigator.mediaDevices?.getUserMedia),
    native: typeof window.BarcodeDetector !== 'undefined',
    // Without the native detector we cannot read QR, only product barcodes.
    qr: typeof window.BarcodeDetector !== 'undefined',
    secure: window.isSecureContext,
  };
}

export class Scanner {
  constructor({ video, onResult, onError }) {
    this.video = video;
    this.onResult = onResult;
    this.onError = onError;
    this.stream = null;
    this.timer = null;
    this.detector = null;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.lastCode = null;
    this.lastAt = 0;
    this.running = false;
  }

  async start() {
    if (this.running) return;

    if (!window.isSecureContext) {
      throw new Error('The camera only works over HTTPS. Open the app from its https:// address.');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser will not give the app a camera.');
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch (err) {
      throw new Error(friendlyCameraError(err));
    }

    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');       // iOS refuses fullscreen takeover
    this.video.muted = true;
    await this.video.play().catch(() => {});

    if (typeof window.BarcodeDetector !== 'undefined') {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        this.detector = new window.BarcodeDetector({
          formats: FORMATS.filter(f => supported.includes(f)),
        });
      } catch {
        this.detector = null;                          // fall through to ean.js
      }
    }

    this.running = true;
    this.timer = setInterval(() => this.tick(), FRAME_MS);
  }

  async tick() {
    if (!this.running) return;
    const { video } = this;
    if (video.readyState < 2 || !video.videoWidth) return;

    try {
      let code = null;
      let format = null;

      if (this.detector) {
        const hits = await this.detector.detect(video);
        if (hits.length) {
          code = hits[0].rawValue;
          format = hits[0].format;
        }
      } else {
        // Downscale: a 1D decode does not need 1280 pixels, and smaller frames
        // keep the loop comfortably inside its interval on an old phone.
        const width = 640;
        const height = Math.round(video.videoHeight * (width / video.videoWidth));
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx.drawImage(video, 0, 0, width, height);
        code = decodeImage(this.ctx.getImageData(0, 0, width, height));
        format = code ? 'ean' : null;
      }

      if (!code) return;

      const now = Date.now();
      if (code === this.lastCode && now - this.lastAt < REPEAT_MS) return;
      this.lastCode = code;
      this.lastAt = now;

      if (navigator.vibrate) navigator.vibrate(30);
      this.onResult?.({ code, format });
    } catch (err) {
      this.onError?.(err);
    }
  }

  /** Let the next scan of the same code through immediately. */
  forget() {
    this.lastCode = null;
    this.lastAt = 0;
  }

  async torch(on) {
    const track = this.stream?.getVideoTracks?.()[0];
    if (!track?.getCapabilities) return false;
    if (!track.getCapabilities().torch) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      return true;
    } catch {
      return false;
    }
  }

  hasTorch() {
    const track = this.stream?.getVideoTracks?.()[0];
    return Boolean(track?.getCapabilities?.().torch);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    for (const track of this.stream?.getTracks?.() ?? []) track.stop();
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }
}

function friendlyCameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
      return 'Camera permission was refused. Allow it in your browser settings for this site, then try again.';
    case 'NotFoundError':
      return 'No camera found on this device.';
    case 'NotReadableError':
      return 'Another app is using the camera. Close it and try again.';
    case 'OverconstrainedError':
      return 'No suitable camera on this device.';
    default:
      return err?.message || 'Could not start the camera.';
  }
}

/**
 * A scanned location label is a full URL. Pull the slug out of it, tolerating
 * whichever host the label was printed with.
 */
export function locationSlugFrom(text) {
  if (!text) return null;
  const match = String(text).match(/#\/l\/([A-Za-z0-9._-]+)/);
  return match ? match[1] : null;
}

/** Barcodes we are prepared to treat as a product code. */
export function isProductCode(text) {
  return /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(String(text).trim());
}
