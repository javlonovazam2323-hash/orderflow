import type { CartItem } from '@/types/database'

export type QueueActionType = 'send_to_kitchen'

export interface QueuedAction {
  id: string
  type: QueueActionType
  idempotency_key: string
  payload: {
    order_id: string
    items: CartItem[]
  }
  created_at: string
  retries: number
}

const STORAGE_KEY = 'orderflow_offline_queue'

export function getQueue(): QueuedAction[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveQueue(queue: QueuedAction[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
}

export function enqueue(action: Omit<QueuedAction, 'created_at' | 'retries'>): QueuedAction {
  const queue = getQueue()
  const existing = queue.find((a) => a.idempotency_key === action.idempotency_key)
  if (existing) return existing

  const entry: QueuedAction = {
    ...action,
    created_at: new Date().toISOString(),
    retries: 0,
  }
  queue.push(entry)
  saveQueue(queue)
  return entry
}

export function dequeue(id: string) {
  saveQueue(getQueue().filter((a) => a.id !== id))
}

export function getQueueCount(): number {
  return getQueue().length
}

export async function flushQueue(
  processor: (action: QueuedAction) => Promise<void>,
): Promise<{ success: number; failed: number }> {
  let queue = getQueue()
  let success = 0
  let failed = 0

  for (const action of queue) {
    try {
      await processor(action)
      queue = queue.filter((a) => a.id !== action.id)
      success++
    } catch {
      const item = queue.find((a) => a.id === action.id)
      if (item) {
        item.retries += 1
        if (item.retries >= 3) {
          queue = queue.filter((a) => a.id !== action.id)
        }
      }
      failed++
    }
  }

  saveQueue(queue)
  return { success, failed }
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}
