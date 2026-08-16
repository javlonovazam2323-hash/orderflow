import { formatCurrency, formatDateTime } from '@/lib/format'
import { PAYMENT_METHOD_LABELS, type Order, type OrderItem, type Payment, type RestaurantSettings } from '@/types/database'

export interface ReceiptData {
  restaurant: {
    name: string
    phone?: string | null
    address?: string | null
  }
  order: {
    number: string
    table: number | null
    waiter?: string
    opened_at: string
    closed_at: string | null
  }
  items: { name: string; quantity: number; unit_price: number; total: number; notes?: string | null }[]
  totals: {
    subtotal: number
    service_charge: number
    tax: number
    total: number
  }
  payments: { method: string; amount: number }[]
  footer: string
  currency: string
}

export function buildReceiptData(
  order: Order,
  items: OrderItem[],
  payments: Payment[],
  settings: RestaurantSettings | null,
  tableNumber: number | null,
  waiterName?: string,
): ReceiptData {
  return {
    restaurant: {
      name: settings?.name ?? 'OrderFlow',
      phone: settings?.phone,
      address: settings?.address,
    },
    order: {
      number: order.order_number,
      table: tableNumber,
      waiter: waiterName,
      opened_at: order.opened_at,
      closed_at: order.closed_at,
    },
    items: items
      .filter((i) => i.status !== 'cancelled')
      .map((i) => ({
        name: i.menu_item?.name ?? '—',
        quantity: i.quantity,
        unit_price: i.unit_price,
        total: i.total_price,
        notes: i.notes,
      })),
    totals: {
      subtotal: order.subtotal,
      service_charge: order.service_charge,
      tax: order.tax_amount,
      total: order.total,
    },
    payments: payments.map((p) => ({
      method: PAYMENT_METHOD_LABELS[p.method],
      amount: p.amount,
    })),
    footer: settings?.receipt_footer ?? 'Rahmat!',
    currency: settings?.currency ?? 'UZS',
  }
}

/** ESC/POS-compatible text lines for future Bluetooth/USB printer bridge */
export function toEscPosLines(data: ReceiptData): string[] {
  const lines: string[] = [
    '\x1B\x40', // init
    '\x1B\x61\x01', // center
    data.restaurant.name,
    '------------------------',
    '\x1B\x61\x00', // left
    `Stol: ${data.order.table ?? '—'}`,
    `Hisob: ${data.order.number}`,
    `Sana: ${formatDateTime(data.order.closed_at ?? data.order.opened_at)}`,
  ]
  if (data.order.waiter) lines.push(`Ofitsiant: ${data.order.waiter}`)
  lines.push('------------------------')

  for (const item of data.items) {
    lines.push(`${item.name}`)
    lines.push(`  ${item.quantity} x ${formatCurrency(item.unit_price)} = ${formatCurrency(item.total)}`)
    if (item.notes) lines.push(`  > ${item.notes}`)
  }

  lines.push('------------------------')
  lines.push(`Jami: ${formatCurrency(data.totals.total)}`)
  for (const p of data.payments) {
    lines.push(`${p.method}: ${formatCurrency(p.amount)}`)
  }
  lines.push('\x1B\x61\x01', data.footer, '\x1B\x61\x00')
  lines.push('\n\n\n', '\x1D\x56\x00') // cut
  return lines
}

export function downloadEscPos(data: ReceiptData, filename?: string) {
  const content = toEscPosLines(data).join('\n')
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? `chek-${data.order.number}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

export function printThermalReceipt(data: ReceiptData) {
  const printWindow = window.open('', '_blank', 'width=320,height=600')
  if (!printWindow) return

  const itemsHtml = data.items.map((item) => `
    <tr>
      <td>${item.name}${item.notes ? `<br><small>* ${item.notes}</small>` : ''}</td>
      <td style="text-align:right">${item.quantity}</td>
      <td style="text-align:right">${formatCurrency(item.total, data.currency)}</td>
    </tr>
  `).join('')

  const paymentsHtml = data.payments.map((p) =>
    `<div class="row"><span>${p.method}</span><span>${formatCurrency(p.amount, data.currency)}</span></div>`
  ).join('')

  printWindow.document.write(`<!DOCTYPE html>
<html><head><title>Chek ${data.order.number}</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 0 auto; color: #000; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  .row { display: flex; justify-content: space-between; }
  .total { font-size: 14px; font-weight: bold; }
</style></head><body>
  <div class="center bold" style="font-size:14px">${data.restaurant.name}</div>
  ${data.restaurant.phone ? `<div class="center">${data.restaurant.phone}</div>` : ''}
  <div class="center">--- CHEK ---</div>
  <div class="divider"></div>
  <div>Stol: ${data.order.table ?? '—'}</div>
  <div>Hisob №: ${data.order.number}</div>
  <div>${formatDateTime(data.order.closed_at ?? data.order.opened_at)}</div>
  ${data.order.waiter ? `<div>Ofitsiant: ${data.order.waiter}</div>` : ''}
  <div class="divider"></div>
  <table>${itemsHtml}</table>
  <div class="divider"></div>
  <div class="row"><span>Taomlar</span><span>${formatCurrency(data.totals.subtotal, data.currency)}</span></div>
  ${data.totals.service_charge > 0 ? `<div class="row"><span>Xizmat haqi</span><span>${formatCurrency(data.totals.service_charge, data.currency)}</span></div>` : ''}
  <div class="row total"><span>JAMI</span><span>${formatCurrency(data.totals.total, data.currency)}</span></div>
  ${paymentsHtml}
  <div class="divider"></div>
  <div class="center">${data.footer}</div>
</body></html>`)
  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => {
    printWindow.print()
    printWindow.close()
  }, 300)
}
