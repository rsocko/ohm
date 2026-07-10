/**
 * Bluetooth Printer Service
 * Web Bluetooth connection to Phomemo thermal printers with chunked data transfer.
 */

import type { PrinterConfig, PrinterState, BluetoothState, RenderedLabel, PrinterStatus, PrinterStatusEvent } from './types';
import { DEFAULT_PRINTER_CONFIG, KNOWN_PRINTER_PROFILES } from './types';
import { buildPrintJob, buildD30PrintJob } from './escpos';
import type { D30MediaType } from './escpos';
import { canvasToRaster, rotateCanvas90CW, prepareCanvasForD30 } from './renderer';

class BluetoothPrinterService {
	private config: PrinterConfig;
	private device: BluetoothDevice | null = null;
	private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
	private notifyCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
	private _state: BluetoothState = $state('disconnected');
	private _deviceName: string | null = $state(null);
	private _printerStatus: PrinterStatus = $state('idle');
	private _lastStatusEvent: PrinterStatusEvent | null = $state(null);
	private autoReconnectAttempted = false;
	private useWriteWithResponse = false;
	private _isLabelPrinter = false;
	private statusListeners: ((event: PrinterStatusEvent) => void)[] = [];

	constructor(config?: Partial<PrinterConfig>) {
		this.config = { ...DEFAULT_PRINTER_CONFIG, ...config };
		if (typeof navigator !== 'undefined' && !('bluetooth' in navigator)) {
			this._state = 'unavailable';
		}
	}

	get state(): BluetoothState { return this._state; }
	get deviceName(): string | null { return this._deviceName; }
	get isAvailable(): boolean { return this._state !== 'unavailable'; }
	get isConnected(): boolean { return this._state === 'connected' && this.characteristic !== null; }
	get isLabelPrinter(): boolean { return this._isLabelPrinter; }
	get printerStatus(): PrinterStatus { return this._printerStatus; }
	get lastStatusEvent(): PrinterStatusEvent | null { return this._lastStatusEvent; }
	get isPrinting(): boolean { return this._state === 'printing'; }

	/** Subscribe to printer status change events */
	onStatus(listener: (event: PrinterStatusEvent) => void): () => void {
		this.statusListeners.push(listener);
		return () => {
			this.statusListeners = this.statusListeners.filter(l => l !== listener);
		};
	}

	/** Detect D-series label printers (D30, D35, etc.) from the device name */
	private detectLabelPrinter(): void {
		const name = this.device?.name ?? '';
		this._isLabelPrinter = /^D\d/i.test(name);
	}

	/** Pick the best write method based on characteristic properties */
	private detectWriteMethod(): void {
		if (!this.characteristic) return;
		const props = this.characteristic.properties;
		this.useWriteWithResponse = props.write;
	}

	/**
	 * Decode raw BLE notification bytes from Phomemo printers into a status.
	 * The protocol varies by model but common patterns:
	 *   - Byte 0: response type (0x00 = status query response)
	 *   - Status byte patterns observed on D30/M110/T02:
	 *     0x00 = idle/ready, 0x01 = printing, 0x02 = paper out,
	 *     0x03 = cover open, 0x04 = overheated, 0x05 = low battery
	 */
	private decodeStatus(data: DataView): PrinterStatus {
		if (data.byteLength === 0) return 'idle';

		// Look for status byte — typically in byte 2 or byte 4 depending on model
		// Common response frame: [header] [type] [status] [checksum]
		const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

		// Find the status byte — different models put it at different offsets
		// Heuristic: scan for known status values after any header bytes
		for (let i = Math.min(2, bytes.length - 1); i < Math.min(6, bytes.length); i++) {
			switch (bytes[i]) {
				case 0x00: return 'idle';
				case 0x01: return 'printing';
				case 0x02: return 'paper-out';
				case 0x03: return 'cover-open';
				case 0x04: return 'overheated';
				case 0x05: return 'low-battery';
			}
		}

		// If all bytes are 0, assume idle
		if (bytes.every(b => b === 0)) return 'idle';

		return 'idle';
	}

	/** Handle incoming notification from the printer */
	private handleNotification = (event: Event): void => {
		const target = event.target as BluetoothRemoteGATTCharacteristic;
		if (!target.value) return;

		const raw = new Uint8Array(target.value.buffer, target.value.byteOffset, target.value.byteLength);
		const status = this.decodeStatus(target.value);
		const statusEvent: PrinterStatusEvent = { status, raw, timestamp: Date.now() };

		this._printerStatus = status;
		this._lastStatusEvent = statusEvent;

		// Transition BLE state based on printer feedback
		if (status === 'printing' && this._state === 'connected') {
			this._state = 'printing';
		} else if (status === 'idle' && this._state === 'printing') {
			this._state = 'connected';
		}

		for (const listener of this.statusListeners) {
			try { listener(statusEvent); } catch { /* don't crash on listener errors */ }
		}
	};

	/**
	 * Subscribe to BLE notifications from the printer's notify characteristic.
	 * This gives us real-time printer status (printing, paper out, etc.).
	 */
	private async subscribeToNotifications(service: BluetoothRemoteGATTService, notifyCharUuid: string): Promise<void> {
		try {
			const notifyChar = await service.getCharacteristic(notifyCharUuid);
			if (!notifyChar.properties.notify) return;

			await notifyChar.startNotifications();
			notifyChar.addEventListener('characteristicvaluechanged', this.handleNotification);
			this.notifyCharacteristic = notifyChar;
		} catch {
			// Non-fatal: status monitoring is best-effort
			console.debug('[printer] Could not subscribe to notifications — status monitoring unavailable');
		}
	}

	/**
	 * Try known BLE service/characteristic UUID pairs until one works.
	 * Updates config with the working pair so subsequent prints use it directly.
	 */
	private async discoverService(server: BluetoothRemoteGATTServer): Promise<{
		service: BluetoothRemoteGATTService;
		characteristic: BluetoothRemoteGATTCharacteristic;
	}> {
		// Build list: configured UUID first, then all known profiles
		const profiles = [
			{ serviceUuid: this.config.serviceUuid, writeCharUuid: this.config.writeCharUuid, notifyCharUuid: this.config.writeCharUuid },
			...KNOWN_PRINTER_PROFILES.filter(p => p.serviceUuid !== this.config.serviceUuid),
		];

		const errors: string[] = [];
		for (const profile of profiles) {
			try {
				const service = await server.getPrimaryService(profile.serviceUuid);
				const char = await service.getCharacteristic(profile.writeCharUuid);
				// Remember the working UUIDs
				this.config.serviceUuid = profile.serviceUuid;
				this.config.writeCharUuid = profile.writeCharUuid;
				// Subscribe to notifications for printer status feedback
				await this.subscribeToNotifications(service, profile.notifyCharUuid);
				return { service, characteristic: char };
			} catch {
				errors.push(profile.serviceUuid);
			}
		}

		throw new Error(
			`Could not find a compatible print service on this device. ` +
			`Tried ${errors.length} known service UUIDs. ` +
			`Make sure your printer model is supported (Phomemo M110, M120, D30, T02).`
		);
	}

	/**
	 * Try to auto-reconnect to a previously paired device.
	 * Uses navigator.bluetooth.getDevices() which returns devices
	 * the user has previously granted access to — no user gesture needed.
	 */
	async tryAutoReconnect(): Promise<boolean> {
		if (this.autoReconnectAttempted || !this.isAvailable || this.isConnected) return false;
		this.autoReconnectAttempted = true;

		try {
			// getDevices() is a newer Web Bluetooth API not yet in all TS lib definitions
			const bt = navigator.bluetooth as Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> };
			if (!bt.getDevices) return false;
			const devices = await bt.getDevices();
			if (devices.length === 0) return false;

			// Try the first previously-paired device
			const device = devices[0];
			if (!device.gatt) return false;

			this._state = 'connecting';
			this.device = device;

			device.addEventListener('gattserverdisconnected', () => {
				this._state = 'disconnected';
				this.characteristic = null;
			});

			const server = await device.gatt.connect();
			const result = await this.discoverService(server);
			this.characteristic = result.characteristic;
			this.detectWriteMethod();
			this.detectLabelPrinter();

			this._deviceName = device.name ?? null;
			this._state = 'connected';
			return true;
		} catch {
			// Silent fail — auto-reconnect is best-effort
			this._state = 'disconnected';
			return false;
		}
	}

	async connect(): Promise<void> {
		if (!this.isAvailable) throw new Error('Web Bluetooth not available in this browser');

		this._state = 'connecting';
		try {
			this.device = await navigator.bluetooth.requestDevice({
				filters: [
					{ namePrefix: 'M110' },
					{ namePrefix: 'M120' },
					{ namePrefix: 'Phomemo' },
					{ namePrefix: 'T02' },
					{ namePrefix: 'D30' },
				],
				optionalServices: KNOWN_PRINTER_PROFILES.map(p => p.serviceUuid),
			});

			this.device.addEventListener('gattserverdisconnected', () => {
				this._state = 'disconnected';
				this.characteristic = null;
			});

			const server = await this.device.gatt!.connect();
			const result = await this.discoverService(server);
			this.characteristic = result.characteristic;
			this.detectWriteMethod();
			this.detectLabelPrinter();

			this._deviceName = this.device.name ?? null;
			this._state = 'connected';
		} catch (error) {
			this._state = 'error';
			throw error;
		}
	}

	async disconnect(): Promise<void> {
		if (this.notifyCharacteristic) {
			try {
				this.notifyCharacteristic.removeEventListener('characteristicvaluechanged', this.handleNotification);
				await this.notifyCharacteristic.stopNotifications();
			} catch { /* best-effort cleanup */ }
			this.notifyCharacteristic = null;
		}
		if (this.device?.gatt?.connected) this.device.gatt.disconnect();
		this.device = null;
		this.characteristic = null;
		this._state = 'disconnected';
		this._deviceName = null;
		this._printerStatus = 'idle';
	}

	/** Send data in chunks with proper flow control */
	async sendData(data: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<void> {
		if (!this.characteristic) throw new Error('Printer not connected');

		const { chunkSize, chunkDelayMs } = this.config;
		const total = data.length;

		for (let offset = 0; offset < total; offset += chunkSize) {
			const chunk = data.slice(offset, Math.min(offset + chunkSize, total));
			if (this.useWriteWithResponse) {
				await this.characteristic.writeValueWithResponse(chunk);
			} else {
				await this.characteristic.writeValueWithoutResponse(chunk);
			}
			onProgress?.(offset + chunk.length, total);
			if (offset + chunkSize < total) {
				const delay = this.useWriteWithResponse ? Math.min(chunkDelayMs, 5) : chunkDelayMs;
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}

	/** Write a single command/packet to the characteristic */
	private async writeCommand(data: Uint8Array): Promise<void> {
		if (!this.characteristic) throw new Error('Printer not connected');
		if (this.useWriteWithResponse) {
			await this.characteristic.writeValueWithResponse(data);
		} else {
			await this.characteristic.writeValueWithoutResponse(data);
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Print a rendered label.
	 * D-series (D30/D35) uses a multi-step protocol with rotation.
	 * M-series/T-series uses standard ESC/POS in a single blob.
	 */
	async printLabel(label: RenderedLabel, onProgress?: (sent: number, total: number) => void): Promise<void> {
		if (!label.rasterData || !label.bytesPerLine) {
			throw new Error('Label has no raster data');
		}

		this._state = 'printing';
		try {
			if (this._isLabelPrinter && label.canvas) {
				await this.printLabelD30(label, onProgress);
			} else {
				const printData = buildPrintJob(label.rasterData, label.bytesPerLine, label.height, this.config.density);
				await this.sendData(printData, onProgress);
			}
			await this.waitForPrintComplete();
		} finally {
			if (this._state === 'printing') this._state = 'connected';
		}
	}

	/**
	 * D30-specific print flow matching catdogmaus/D30printerPWA (proven stable):
	 * - Concatenate: ESC @ + GS v 0 header + raw raster + ESC d 0 → single buffer
	 * - Send entire buffer in 128-byte chunks with writeValueWithResponse
	 * - 20ms delay between chunks for reliable streaming
	 *
	 * Key insights from research:
	 * - DPI is 8 px/mm in BOTH directions (203 DPI uniform)
	 * - Canvas must be 96px wide (12mm tape) × N px tall (feed direction)
	 * - ESC @ before GS v 0 resets printer state (critical)
	 * - ESC d 0 footer triggers gap sensor to stop feed
	 * - No Phomemo-specific speed/density/media header needed
	 * - No 255-line block limit — 320+ lines work as single block
	 */
	private async printLabelD30(label: RenderedLabel, onProgress?: (sent: number, total: number) => void): Promise<void> {
		// Scale and rotate for D30
		const labelLengthMm = this.config.labelLengthMm === 'continuous' ? 0 : this.config.labelLengthMm;
		const rotated = prepareCanvasForD30(label.canvas, this.config.tapeWidthMm, labelLengthMm);
		const { raster, bytesPerLine } = canvasToRaster(rotated);

		// Determine media type from tape config
		const mediaType: D30MediaType = this.config.labelLengthMm === 'continuous' ? 'continuous' : 'gaps';

		const job = buildD30PrintJob(raster, bytesPerLine, rotated.height, mediaType);

		console.log('[D30 Print]', {
			canvasSize: `${rotated.width}x${rotated.height}`,
			bytesPerLine,
			feedLines: rotated.height,
			totalRasterBytes: raster.length,
			mediaType,
			tapeWidthMm: this.config.tapeWidthMm,
			labelLengthMm,
		});

		// Concatenate entire print job into a single buffer
		// (matches catdogmaus approach: header+marker+data+footer as one stream)
		const block = job.blocks[0]; // Single block (no splitting)
		const totalSize = job.header.length + block.marker.length + block.data.length + job.footer.length;
		const printBuffer = new Uint8Array(totalSize);
		let pos = 0;
		printBuffer.set(job.header, pos); pos += job.header.length;
		printBuffer.set(block.marker, pos); pos += block.marker.length;
		printBuffer.set(block.data, pos); pos += block.data.length;
		printBuffer.set(job.footer, pos);

		// Send in 128-byte chunks with 20ms delay (proven stable by catdogmaus)
		const PACKET_SIZE = 128;
		const CHUNK_DELAY = 20; // ms — matches catdogmaus D30printerPWA
		let sentBytes = 0;

		for (let offset = 0; offset < printBuffer.length; offset += PACKET_SIZE) {
			const chunk = printBuffer.slice(offset, Math.min(offset + PACKET_SIZE, printBuffer.length));
			await this.characteristic!.writeValueWithResponse(chunk);
			sentBytes += chunk.length;
			onProgress?.(sentBytes, totalSize);

			// 20ms delay between chunks — belt-and-suspenders flow control
			if (offset + PACKET_SIZE < printBuffer.length) {
				await this.delay(CHUNK_DELAY);
			}
		}
	}

	/**
	 * Wait for the printer to signal it's done (status → idle).
	 * Times out after 10s to avoid hanging if notifications aren't supported.
	 */
	private async waitForPrintComplete(timeoutMs = 10000): Promise<void> {
		if (!this.notifyCharacteristic) return; // No notification support — skip

		// If already idle, printer processed instantly
		if (this._printerStatus === 'idle') {
			// Give printer a moment to start — it may not have sent 'printing' yet
			await new Promise(resolve => setTimeout(resolve, 200));
			if (this._printerStatus === 'idle') return;
		}

		return new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				unsubscribe();
				resolve();
			}, timeoutMs);

			const unsubscribe = this.onStatus((event) => {
				if (event.status === 'idle') {
					clearTimeout(timeout);
					unsubscribe();
					resolve();
				} else if (event.status === 'paper-out' || event.status === 'cover-open' || event.status === 'overheated') {
					clearTimeout(timeout);
					unsubscribe();
					// Don't reject — the error is already surfaced via printerStatus
					resolve();
				}
			});
		});
	}

	/** Print multiple labels sequentially */
	async printBatch(labels: RenderedLabel[], onProgress?: (current: number, total: number) => void): Promise<void> {
		for (let i = 0; i < labels.length; i++) {
			await this.printLabel(labels[i]);
			onProgress?.(i + 1, labels.length);
			if (i < labels.length - 1) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		}
	}

	updateConfig(config: Partial<PrinterConfig>): void {
		this.config = { ...this.config, ...config };
	}
}

// Singleton
let instance: BluetoothPrinterService | null = null;
export function getPrinterService(config?: Partial<PrinterConfig>): BluetoothPrinterService {
	if (!instance) instance = new BluetoothPrinterService(config);
	return instance;
}

export type { BluetoothPrinterService };
