/**
 * Camera service for AR mode.
 * Handles getUserMedia lifecycle, stream management, and device enumeration.
 */

export interface CameraConfig {
	facingMode?: 'environment' | 'user';
	width?: number;
	height?: number;
}

export interface CameraState {
	stream: MediaStream | null;
	ready: boolean;
	error: string | null;
}

const defaultConfig: CameraConfig = {
	facingMode: 'environment',
	width: 1920,
	height: 1080
};

/**
 * Start the camera and attach to a video element.
 */
export async function startCamera(
	videoEl: HTMLVideoElement,
	config: CameraConfig = {}
): Promise<CameraState> {
	const cfg = { ...defaultConfig, ...config };

	try {
		const stream = await navigator.mediaDevices.getUserMedia({
			video: {
				facingMode: { ideal: cfg.facingMode! },
				width: { ideal: cfg.width! },
				height: { ideal: cfg.height! }
			},
			audio: false
		});

		videoEl.srcObject = stream;
		await videoEl.play();

		return { stream, ready: true, error: null };
	} catch (err) {
		const error = err as Error;
		let message: string;

		if (error.name === 'NotAllowedError') {
			message = 'Camera access denied. Please allow camera permissions in your browser settings.';
		} else if (error.name === 'NotFoundError') {
			message = 'No camera found on this device.';
		} else if (error.name === 'NotReadableError') {
			message = 'Camera is in use by another application.';
		} else if (error.name === 'OverconstrainedError') {
			message = 'Camera does not support the requested resolution.';
		} else {
			message = `Camera error: ${error.message}`;
		}

		return { stream: null, ready: false, error: message };
	}
}

/**
 * Stop all tracks on a media stream.
 */
export function stopCamera(stream: MediaStream | null): void {
	if (stream) {
		stream.getTracks().forEach((track) => track.stop());
	}
}

/**
 * Check if the device has camera access (without actually starting it).
 */
export async function hasCameraAccess(): Promise<boolean> {
	try {
		const devices = await navigator.mediaDevices.enumerateDevices();
		return devices.some((d) => d.kind === 'videoinput');
	} catch {
		return false;
	}
}

/**
 * Toggle the device torch/flashlight (useful in dark panels).
 * Only works if the track supports the torch constraint.
 */
export async function toggleTorch(stream: MediaStream | null, enabled: boolean): Promise<boolean> {
	if (!stream) return false;
	const track = stream.getVideoTracks()[0];
	if (!track) return false;

	try {
		const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
		if (!capabilities.torch) return false;
		await track.applyConstraints({ advanced: [{ torch: enabled } as MediaTrackConstraintSet] });
		return true;
	} catch {
		return false;
	}
}
