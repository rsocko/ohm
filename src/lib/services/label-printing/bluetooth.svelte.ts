/**
 * Bluetooth Printer Service
 * Web Bluetooth connection to Phomemo thermal printers with chunked data transfer.
 */

import type { PrinterConfig, PrinterState, BluetoothState, RenderedLabel } from './types';
import { DEFAULT_PRINTER_CONFIG } from './types';
import { buildPrintJob } from './escpos';

class BluetoothPrinterService {
	private config: PrinterConfig;
	private device: BluetoothDevice | null = null;
	private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
	private _state: BluetoothState = $state('disconnected');
	private _deviceName: string | null = $state(null);
	private autoReconnectAttempted = false;

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
			const service = await server.getPrimaryService(this.config.serviceUuid);
			this.characteristic = await service.getCharacteristic(this.config.writeCharUuid);

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
				optionalServices: [this.config.serviceUuid],
			});

			this.device.addEventListener('gattserverdisconnected', () => {
				this._state = 'disconnected';
				this.characteristic = null;
			});

			const server = await this.device.gatt!.connect();
			const service = await server.getPrimaryService(this.config.serviceUuid);
			this.characteristic = await service.getCharacteristic(this.config.writeCharUuid);

			this._deviceName = this.device.name ?? null;
			this._state = 'connected';
		} catch (error) {
			this._state = 'error';
			throw error;
		}
	}

	async disconnect(): Promise<void> {
		if (this.device?.gatt?.connected) this.device.gatt.disconnect();
		this.device = null;
		this.characteristic = null;
		this._state = 'disconnected';
		this._deviceName = null;
	}

	/** Send data in chunks to avoid BLE MTU overflow */
	async sendData(data: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<void> {
		if (!this.characteristic) throw new Error('Printer not connected');

		const { chunkSize, chunkDelayMs } = this.config;
		const total = data.length;

		for (let offset = 0; offset < total; offset += chunkSize) {
			const chunk = data.slice(offset, Math.min(offset + chunkSize, total));
			await this.characteristic.writeValueWithoutResponse(chunk);
			onProgress?.(offset + chunk.length, total);
			if (offset + chunkSize < total) {
				await new Promise(resolve => setTimeout(resolve, chunkDelayMs));
			}
		}
	}

	/** Print a rendered label */
	async printLabel(label: RenderedLabel, onProgress?: (sent: number, total: number) => void): Promise<void> {
		if (!label.rasterData || !label.bytesPerLine) {
			throw new Error('Label has no raster data');
		}
		const printData = buildPrintJob(label.rasterData, label.bytesPerLine, label.height, this.config.density);
		await this.sendData(printData, onProgress);
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
