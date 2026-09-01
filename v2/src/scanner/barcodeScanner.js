export function normalizeScannedCode(value) {
  return String(value ?? '').trim();
}

export function findProductByBarcode(products, code) {
  const target = normalizeScannedCode(code);
  if (!target) return null;

  return (Array.isArray(products) ? products : []).find(product =>
    normalizeScannedCode(product.barcode) === target
  ) || null;
}

export function supportsCameraBarcodeScanner() {
  return typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    'BarcodeDetector' in window &&
    navigator?.mediaDevices?.getUserMedia instanceof Function;
}

export async function startCameraBarcodeScanner({
  videoElement,
  onCode,
  onError = null,
  formats = [
    'ean_13',
    'ean_8',
    'upc_a',
    'upc_e',
    'code_128',
    'qr_code'
  ]
} = {}) {
  if (!videoElement) {
    throw new Error('Elemento de video requerido');
  }

  if (!supportsCameraBarcodeScanner()) {
    throw new Error(
      'La cámara para códigos requiere HTTPS y un navegador compatible'
    );
  }

  const supportedFormats =
    typeof window.BarcodeDetector.getSupportedFormats === 'function'
      ? await window.BarcodeDetector.getSupportedFormats()
      : formats;

  const usableFormats = formats.filter(format =>
    supportedFormats.includes(format)
  );

  const detector = new window.BarcodeDetector({
    formats: usableFormats.length ? usableFormats : undefined
  });

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' }
    }
  });

  videoElement.srcObject = stream;
  videoElement.setAttribute('playsinline', '');
  await videoElement.play();

  let stopped = false;
  let frameId = null;
  let lastCode = '';
  let lastCodeAt = 0;

  const scanFrame = async () => {
    if (stopped) return;

    try {
      const results = await detector.detect(videoElement);
      const first = results
        .map(result => normalizeScannedCode(result.rawValue))
        .find(Boolean);

      if (first) {
        const now = Date.now();
        const isDuplicate =
          first === lastCode &&
          (now - lastCodeAt) < 1200;

        if (!isDuplicate) {
          lastCode = first;
          lastCodeAt = now;
          await onCode?.(first);
        }
      }
    } catch (error) {
      onError?.(error);
    }

    if (!stopped) {
      frameId = requestAnimationFrame(scanFrame);
    }
  };

  frameId = requestAnimationFrame(scanFrame);

  return {
    stop() {
      if (stopped) return;
      stopped = true;

      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }

      for (const track of stream.getTracks()) {
        track.stop();
      }

      videoElement.srcObject = null;
    }
  };
}
