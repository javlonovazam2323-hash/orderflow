interface BluetoothRemoteGATTCharacteristic {
  properties: { write?: boolean; writeWithoutResponse?: boolean }
  writeValue(value: BufferSource): Promise<void>
  writeValueWithoutResponse(value: BufferSource): Promise<void>
}

interface BluetoothDevice {
  gatt?: BluetoothRemoteGATTServer
}

interface BluetoothRemoteGATTServer {
  connect(): Promise<BluetoothRemoteGATTServer>
  disconnect(): void
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>
  getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>
}

interface BluetoothRemoteGATTService {
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>
}

interface Bluetooth {
  requestDevice(options: {
    acceptAllDevices?: boolean
    optionalServices?: string[]
  }): Promise<BluetoothDevice>
}

interface Navigator {
  bluetooth?: Bluetooth
}
