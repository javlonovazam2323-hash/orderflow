# OrderFlow — Restaurant POS Architecture

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     PWA Client (React + Vite)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │  Waiter  │ │ Kitchen  │ │ Cashier  │ │  Admin   │           │
│  │  Mobile  │ │  Display │ │  Desk    │ │ Dashboard│           │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘           │
│       │            │            │            │                   │
│       └────────────┴────────────┴────────────┘                   │
│                         │                                        │
│              TanStack Query + Zustand (cart/UI)                  │
│                         │                                        │
│              Supabase JS Client (anon key only)                  │
└─────────────────────────┼────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
   Supabase Auth    PostgreSQL + RLS    Realtime
   (email/PIN)      (business data)     (live updates)
```

### Principles
- **Mobile-first**: Waiter UI optimized for one-hand use
- **Realtime-first**: No page refresh for status changes
- **Idempotent writes**: Prevent duplicate kitchen sends on flaky network
- **RLS everywhere**: Role-based data access at database level
- **Single active bill per table**: Enforced by DB constraint + RPC

### Tech Stack
| Layer | Technology |
|-------|------------|
| UI | React 19, TypeScript, Tailwind CSS v4 |
| Build | Vite 6, vite-plugin-pwa |
| Routing | React Router 7 |
| Server state | TanStack Query 5 |
| Local state | Zustand (cart, theme) |
| Backend | Supabase (Auth, Postgres, Realtime, Storage) |

---

## 2. Database Schema

See `supabase/migrations/20260816100000_initial_schema.sql` for full DDL.

### Core Entities

```
profiles ──┬── orders (waiter_id)
           ├── kitchen_tickets (waiter_id)
           ├── payments (cashier_id)
           └── audit_logs (actor_id)

restaurant_tables ── orders (1 active per table)
                  └── kitchen_tickets

orders ──┬── order_items
         ├── kitchen_tickets
         └── payments

menu_categories ── menu_items

kitchen_tickets ── order_items (kitchen_ticket_id)
```

### Key Constraints
- One `open` order per table (partial unique index)
- `order_items.idempotency_key` unique per send action
- `payments` sum must equal order total before close (RPC validation)
- Closed orders (`paid`) immutable except admin audit RPC

---

## 3. User Roles & Permissions

| Capability | Admin | Cashier | Waiter | Kitchen |
|------------|:-----:|:-------:|:------:|:-------:|
| Dashboard | ✓ | — | — | — |
| Manage menu/staff/settings | ✓ | — | — | — |
| View all tables | ✓ | ✓ | own | — |
| Create order | ✓ | — | ✓ | — |
| Send to kitchen | ✓ | — | ✓ | — |
| Kitchen queue | ✓ | — | — | ✓ |
| Update kitchen status | ✓ | — | — | ✓ |
| Receive ready notifications | ✓ | — | ✓ | — |
| Process payment | ✓ | ✓ | — | — |
| Split payment | ✓ | ✓ | — | — |
| Close bill | ✓ | ✓ | — | — |
| Daily revenue | ✓ | ✓ | — | — |
| Cancel after kitchen accept | ✓ | ✓ | — | — |
| Audit log view | ✓ | — | — | — |

Auth: Supabase Auth (email/password). Waiters may use PIN via `sign_in_with_pin` RPC (validates hashed PIN → issues session).

---

## 4. Order Lifecycle

```
                    ┌─────────┐
                    │  DRAFT  │  (cart, not sent)
                    └────┬────┘
                         │ send_to_kitchen (idempotent)
                         ▼
                    ┌─────────┐
                    │  OPEN   │  (active bill on table)
                    └────┬────┘
                         │ kitchen ticket created
                         ▼
              ┌──────────────────────┐
              │  KITCHEN: NEW        │
              └──────────┬───────────┘
                         │ accept
                         ▼
              ┌──────────────────────┐
              │  KITCHEN: ACCEPTED   │
              └──────────┬───────────┘
                         │ start cooking
                         ▼
              ┌──────────────────────┐
              │  KITCHEN: IN_PROGRESS│
              └──────────┬───────────┘
                         │ mark ready
                         ▼
              ┌──────────────────────┐
              │  KITCHEN: READY      │──► notification → waiter
              └──────────┬───────────┘
                         │ all items ready / request bill
                         ▼
              ┌──────────────────────┐
              │ AWAITING_PAYMENT     │
              └──────────┬───────────┘
                         │ full payment received
                         ▼
              ┌──────────────────────┐
              │       PAID           │──► table → EMPTY
              └──────────────────────┘

Additional order (same table): new kitchen_ticket, same order (OPEN)
```

### Table Status Mapping
| Table Status | Trigger |
|--------------|---------|
| `empty` | No active order |
| `occupied` | Waiter assigned, no items sent |
| `has_order` | Items sent to kitchen |
| `preparing` | Kitchen accepted/in progress |
| `ready` | All tickets ready |
| `awaiting_payment` | Bill requested / ready to pay |

---

## 5. Payment Lifecycle

```
Order OPEN / AWAITING_PAYMENT
         │
         ▼
┌─────────────────┐
│ Add payment(s)  │  cash | card | click | payme | other
│ (split allowed) │
└────────┬────────┘
         │
         ▼
  sum(payments) < total ──► stay open, show remaining
         │
  sum(payments) = total
         │
         ▼
┌─────────────────┐
│  close_order()  │  RPC: atomic
│  - order → PAID │
│  - table → EMPTY│
│  - audit log    │
└────────┬────────┘
         ▼
    Receipt generated (print-ready JSON)
```

Service charge: `subtotal × service_charge_percent / 100` applied at bill calculation.

---

## 6. Folder Structure

```
orderflow/
├── docs/
│   └── ARCHITECTURE.md
├── public/
│   └── icons/
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   └── 20260816100000_initial_schema.sql
│   └── seed.sql
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── router.tsx
│   │   └── providers.tsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   ├── BottomNav.tsx
│   │   │   └── RoleGuard.tsx
│   │   └── ui/
│   │       ├── Badge.tsx
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Input.tsx
│   │       └── Modal.tsx
│   ├── features/
│   │   ├── auth/
│   │   │   ├── LoginPage.tsx
│   │   │   └── PinLoginPage.tsx
│   │   ├── waiter/
│   │   │   ├── TablesPage.tsx
│   │   │   ├── MenuPage.tsx
│   │   │   ├── CartDrawer.tsx
│   │   │   └── OrdersPage.tsx
│   │   ├── kitchen/
│   │   │   └── KitchenPage.tsx
│   │   ├── cashier/
│   │   │   ├── CashierPage.tsx
│   │   │   ├── PaymentPage.tsx
│   │   │   └── ReceiptView.tsx
│   │   └── admin/
│   │       └── DashboardPage.tsx
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useNotifications.ts
│   │   ├── useRealtimeTables.ts
│   │   └── useTheme.ts
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── format.ts
│   │   ├── constants.ts
│   │   └── api/
│   │       ├── orders.ts
│   │       ├── kitchen.ts
│   │       ├── payments.ts
│   │       └── menu.ts
│   ├── stores/
│   │   ├── cartStore.ts
│   │   └── themeStore.ts
│   ├── types/
│   │   └── database.ts
│   ├── styles/
│   │   └── index.css
│   └── main.tsx
├── .env.example
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tsconfig.app.json
```

---

## 7. Realtime Channels

| Channel | Events | Subscribers |
|---------|--------|-------------|
| `tables` | table status changes | waiter, cashier, admin |
| `kitchen_tickets` | new/updated tickets | kitchen, admin |
| `notifications:{user_id}` | ready alerts | waiter |
| `orders:{order_id}` | payment updates | cashier |

---

## 8. MVP Flow (Phase 1)

```
LOGIN → TABLE SELECT → MENU → CART → SEND TO KITCHEN
  → KITCHEN ACCEPT → IN PROGRESS → READY
  → WAITER NOTIFICATION → CASHIER → SPLIT PAYMENT
  → CLOSE BILL → TABLE EMPTY
```

All steps implemented with Supabase RPC + Realtime + RLS.
