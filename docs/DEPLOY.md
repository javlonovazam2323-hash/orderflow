# OrderFlow — Production Deploy

## 1. Supabase loyiha yaratish

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Region: yaqin (masalan Frankfurt yoki Singapore)
3. Database parolini saqlang

## 2. Migratsiyalar

Supabase Dashboard → **SQL Editor** → ketma-ket bajaring:

```
supabase/migrations/20260816100000_initial_schema.sql
supabase/migrations/20260816110000_pin_login.sql
supabase/migrations/20260816120000_staff_management.sql
supabase/seed.sql
```

Yoki CLI:

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

## 3. Auth foydalanuvchilar

**Usul A — Saytdan (tavsiya):**

1. `.env` ni to'ldiring va Edge Functions deploy qiling (4-bo'lim)
2. Saytni oching → avtomatik `/setup` sahifasi
3. **Xodimlarni yaratish** tugmasini bosing

**Usul B — CLI:**

```bash
# .env ga SUPABASE_SERVICE_ROLE_KEY qo'shing
node scripts/setup-staff.mjs
```

**Usul C — SQL (auth users allaqachon bo'lsa):**

`supabase/seed-auth.sql` ni SQL Editor da bajaring.

| Email | Parol | Rol | PIN |
|-------|-------|-----|-----|
| admin@orderflow.uz | demo1234 | admin | — |
| kassir@orderflow.uz | demo1234 | cashier | 0000 |
| ofitsiant@orderflow.uz | demo1234 | waiter | 1234 |
| oshxona@orderflow.uz | demo1234 | kitchen | 5678 |

Keyinchalik **Admin → Xodimlar** bo'limidan o'zgartiring.

## 4. Edge Functions

```bash
supabase functions deploy bootstrap-staff
supabase functions deploy manage-staff
supabase functions deploy pin-login
```

Functions avtomatik `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` oladi.

## 5. Realtime yoqish

Dashboard → **Database** → **Publications** — `supabase_realtime` publication da quyidagi jadvallar bo'lishi kerak:

- `restaurant_tables`
- `kitchen_tickets`
- `notifications`
- `orders`

(Migratsiyada qo'shilgan)

## 6. Frontend env

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
VITE_USE_MOCK=false
```

**Muhim:** `service_role` keyni frontendga qo'ymang!

## 7. Build va deploy

### Vercel / Netlify

```bash
npm run build
# dist/ papkani deploy qiling
```

Environment variables ni platformada qo'shing.

### Docker (ixtiyoriy)

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_USE_MOCK=false
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

## 8. PWA (HTTPS shart)

Production HTTPS da PWA avtomatik ishlaydi:

- Offline cache (app shell + menyu rasmlari)
- "Ilovani o'rnatish" taklifi
- Avtomatik yangilanish

## 9. PIN login

PIN auth `pin-login` Edge Function orqali ishlaydi (session yaratadi).

Admin panel → **Xodimlar** dan PIN o'rnating.

## 10. Tekshirish ro'yxati

- [ ] Login (har rol)
- [ ] PIN login (ofitsiant)
- [ ] Stol → menyu → oshxonaga yuborish
- [ ] Realtime (oshxona + ofitsiant notification)
- [ ] Split payment + chek
- [ ] Admin menyu CRUD
- [ ] RLS: ofitsiant boshqa rol ma'lumotlarini ko'ra olmasin

## 11. Monitoring

Supabase Dashboard:

- **Logs** → API xatolari
- **Database** → Advisors (security)
- **Auth** → Sessions
