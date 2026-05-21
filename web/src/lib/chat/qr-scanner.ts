export type BarcodeDetectorResult = {
    rawValue: string;
};

export type BarcodeDetectorInstance = {
    detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
};

export type BarcodeDetectorConstructor = {
    new (options?: { formats?: string[] }): BarcodeDetectorInstance;
    getSupportedFormats?: () => Promise<string[]>;
};

export function createQrScannerController(callbacks: {
    onScan: (value: string) => void;
    onError: (message: string) => void;
}) {
    let stream: MediaStream | null = null;
    let frame = 0;

    async function start(videoElement: HTMLVideoElement): Promise<void> {
        const Detector = readBarcodeDetector();
        if (!Detector) {
            callbacks.onError("QR scanning is not supported in this browser.");
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            callbacks.onError("Camera access is not available in this browser.");
            return;
        }

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" },
                audio: false,
            });
            videoElement.srcObject = stream;
            await videoElement.play();

            const detector = new Detector({ formats: ["qr_code"] });
            scanFrame(videoElement, detector);
        } catch (error) {
            stop(videoElement);
            callbacks.onError(toErrorMessage(error));
        }
    }

    function stop(videoElement: HTMLVideoElement | null): void {
        if (frame) {
            cancelAnimationFrame(frame);
            frame = 0;
        }
        stream?.getTracks().forEach((track) => track.stop());
        stream = null;
        if (videoElement) {
            videoElement.srcObject = null;
        }
    }

    function scanFrame(
        videoElement: HTMLVideoElement,
        detector: BarcodeDetectorInstance,
    ): void {
        frame = requestAnimationFrame(async () => {
            try {
                const results = await detector.detect(videoElement);
                const value = results[0]?.rawValue;
                if (value) {
                    callbacks.onScan(value);
                    return;
                }
            } catch (error) {
                callbacks.onError(toErrorMessage(error));
            }

            scanFrame(videoElement, detector);
        });
    }

    return { start, stop };
}

export function applyScannedConnectValue(
    value: string,
    current: { serverUrl: string; sessionId: string },
): { serverUrl: string; sessionId: string } {
    const trimmed = value.trim();
    if (!trimmed) {
        return current;
    }

    try {
        const url = new URL(trimmed);
        const scannedServer = url.searchParams.get("server");
        const scannedSession = url.searchParams.get("session");
        if (scannedServer) {
            return {
                serverUrl: scannedServer,
                sessionId: scannedSession ?? current.sessionId,
            };
        }
    } catch {
        // Not a URL with connection params; treat it as a raw server URL.
    }

    return { serverUrl: trimmed, sessionId: current.sessionId };
}

function readBarcodeDetector(): BarcodeDetectorConstructor | null {
    if (typeof window === "undefined" || !("BarcodeDetector" in window)) {
        return null;
    }

    return (
        (
            window as Window & {
                BarcodeDetector?: BarcodeDetectorConstructor;
            }
        ).BarcodeDetector ?? null
    );
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
