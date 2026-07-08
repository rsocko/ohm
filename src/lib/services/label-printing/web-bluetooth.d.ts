/**
 * Web Bluetooth API type declarations.
 * These types are not included in the standard lib.dom.d.ts.
 */

interface BluetoothDevice extends EventTarget {
	readonly id: string;
	readonly name?: string;
	readonly gatt?: BluetoothRemoteGATTServer;
	addEventListener(type: 'gattserverdisconnected', listener: (ev: Event) => void): void;
}

interface BluetoothRemoteGATTServer {
	readonly connected: boolean;
	readonly device: BluetoothDevice;
	connect(): Promise<BluetoothRemoteGATTServer>;
	disconnect(): void;
	getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
	readonly device: BluetoothDevice;
	readonly uuid: string;
	getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic {
	readonly uuid: string;
	readonly value?: DataView;
	writeValue(value: BufferSource): Promise<void>;
	writeValueWithoutResponse(value: BufferSource): Promise<void>;
	readValue(): Promise<DataView>;
}

interface BluetoothRequestDeviceFilter {
	services?: (string | number)[];
	name?: string;
	namePrefix?: string;
}

interface RequestDeviceOptions {
	filters?: BluetoothRequestDeviceFilter[];
	optionalServices?: (string | number)[];
	acceptAllDevices?: boolean;
}

interface Bluetooth {
	requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
	getAvailability(): Promise<boolean>;
}

interface Navigator {
	bluetooth: Bluetooth;
}
