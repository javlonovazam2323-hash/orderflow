import { toEscPosLines, type ReceiptData } from './thermal'

/** Web Bluetooth ESC/POS — Chrome/Android + HTTPS kerak */
const PRINTER_SERVICE = '000018f0-0000-1000-8000-00805f9b34fb'
const SERIAL_SERVICE = '00001101-0000-1000-8000-00805f9b34fb'

export function isBluetoothPrintSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

async function writeInChunks(
  characteristic: BluetoothRemoteGATTCharacteristic,
  data: Uint8Array,
  chunkSize = 512,
) {
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize)
    await characteristic.writeValue(chunk)
    await new Promise((r) => setTimeout(r, 50))
  }
}

export async function printViaBluetooth(data: ReceiptData): Promise<void> {
  if (!isBluetoothPrintSupported()) {
    throw new Error('Bu brauzer Bluetooth qo\'llab-quvvatlamaydi. Chrome + Android ishlating.')
  }

  const lines = toEscPosLines(data)
  const payload = textToBytes(lines.join('\n'))

  const device = await navigator.bluetooth!.requestDevice({
    acceptAllDevices: true,
    optionalServices: [PRINTER_SERVICE, SERIAL_SERVICE],
  })

  const server = await device.gatt!.connect()

  let characteristic: BluetoothRemoteGATTCharacteristic | null = null

  for (const serviceUuid of [PRINTER_SERVICE, SERIAL_SERVICE]) {
    try {
      const service = await server.getPrimaryService(serviceUuid)
      const chars = await service.getCharacteristics()
      characteristic = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse) ?? chars[0]
      if (characteristic) break
    } catch {
      // keyingi service
    }
  }

  if (!characteristic) {
    // Barcha servislarni skanerlash
    const services = await server.getPrimaryServices()
    for (const service of services) {
      try {
        const chars = await service.getCharacteristics()
        const writable = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse)
        if (writable) {
          characteristic = writable
          break
        }
      } catch { /* skip */ }
    }
  }

  if (!characteristic) {
    server.disconnect()
    throw new Error('Printer characteristic topilmadi')
  }

  try {
    if (characteristic.properties.writeWithoutResponse) {
      const chunkSize = 512
      for (let i = 0; i < payload.length; i += chunkSize) {
        await characteristic.writeValueWithoutResponse(payload.slice(i, i + chunkSize))
        await new Promise((r) => setTimeout(r, 50))
      }
    } else {
      await writeInChunks(characteristic, payload)
    }
  } finally {
    server.disconnect()
  }
}
