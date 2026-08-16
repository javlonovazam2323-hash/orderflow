import { formatCurrency, formatDateTime } from '@/lib/format'
import { buildReceiptData, downloadEscPos, printThermalReceipt } from '@/lib/receipt/thermal'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { PAYMENT_METHOD_LABELS, type Order, type OrderItem, type Payment, type RestaurantSettings } from '@/types/database'

interface ReceiptViewProps {
  order: Order
  items: OrderItem[]
  payments: Payment[]
  settings: RestaurantSettings | null
  tableNumber: number | null
  waiterName?: string
  onClose: () => void
}

export function ReceiptView({
  order, items, payments, settings, tableNumber, waiterName, onClose,
}: ReceiptViewProps) {
  const receiptData = buildReceiptData(order, items, payments, settings, tableNumber, waiterName)

  return (
    <div className="min-h-full p-4 max-w-sm mx-auto">
      <Card className="print:shadow-none print:border-0 receipt-thermal" id="receipt">
        <CardContent className="pt-6 space-y-4 font-mono text-sm">
          <div className="text-center space-y-1">
            <p className="text-lg font-bold font-sans">{receiptData.restaurant.name}</p>
            {settings?.phone && <p className="text-xs text-muted">{settings.phone}</p>}
            <p className="text-xs text-muted">CHEK</p>
          </div>

          <div className="border-t border-dashed border-border pt-3 space-y-1 text-xs">
            <p>Stol: {tableNumber}</p>
            <p>Hisob №: {order.order_number}</p>
            <p>Sana: {formatDateTime(order.closed_at ?? order.opened_at)}</p>
            {waiterName && <p>Ofitsiant: {waiterName}</p>}
          </div>

          <div className="border-t border-dashed border-border pt-3 space-y-2">
            {items.filter((i) => i.status !== 'cancelled').map((item) => (
              <div key={item.id} className="flex justify-between gap-2">
                <span className="flex-1">{item.menu_item?.name} ×{item.quantity}</span>
                <span className="shrink-0">{formatCurrency(item.total_price)}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-border pt-3 space-y-1">
            {order.service_charge > 0 && (
              <div className="flex justify-between text-xs text-muted">
                <span>Xizmat haqi</span>
                <span>{formatCurrency(order.service_charge)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold">
              <span>Jami</span>
              <span>{formatCurrency(order.total)}</span>
            </div>
            {payments.map((p) => (
              <div key={p.id} className="flex justify-between text-xs text-muted">
                <span>{PAYMENT_METHOD_LABELS[p.method]}</span>
                <span>{formatCurrency(p.amount)}</span>
              </div>
            ))}
          </div>

          <p className="text-center text-xs pt-2">{receiptData.footer}</p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 mt-4 print:hidden">
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => printThermalReceipt(receiptData)}>
            🖨 Termo chek
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => window.print()}>
            📄 Oddiy
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => downloadEscPos(receiptData)}
        >
          ⬇ ESC/POS fayl (printer bridge)
        </Button>
        <Button className="w-full" onClick={onClose}>Yopish</Button>
      </div>
    </div>
  )
}
