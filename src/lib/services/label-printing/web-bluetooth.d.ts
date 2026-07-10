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
	getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothCharacteristicProperties {
	readonly broadcast: boolean;
	readonly read: boolean;
	readonly writeWithoutResponse: boolean;
	readonly write: boolean;
	readonly notify: boolean;
	readonly indicate: boolean;
	readonly authenticatedSignedWrites: boolean;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
	readonly uuid: string;
	readonly value?: DataView;
	readonly properties: BluetoothCharacteristicProperties;
	writeValue(value: ArrayBuffer | ArrayBufferView): Promise<void>;
	writeValueWithResponse(value: ArrayBuffer | ArrayBufferView): Promise<void>;
	writeValueWithoutResponse(value: ArrayBuffer | ArrayBufferView): Promise<void>;
	readValue(): Promise<DataView>;
	startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
	stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
	addEventListener(type: 'characteristicvaluechanged', listener: (ev: Event & { target: BluetoothRemoteGATTCharacteristic }) => void): void;
	removeEventListener(type: 'characteristicvaluechanged', listener: (ev: Event & { target: BluetoothRemoteGATTCharacteristic }) => void): void;
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
