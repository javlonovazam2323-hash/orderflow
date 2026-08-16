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

Dashboard → **Authentication** → **Users** → har biri uchun:

| Email | Parol | Rol |
|-------|-------|-----|
| admin@orderflow.uz | (kuchli parol) | admin |
| kassir@orderflow.uz | ... | cashier |
| ofitsiant@orderflow.uz | ... | waiter |
| oshxona@orderflow.uz | ... | kitchen |

UUID ni nusxalang va `supabase/seed-auth.sql` ni tahrirlab ishga tushiring.

## 4. Realtime yoqish

Dashboard → **Database** → **Publications** — `supabase_realtime` publication da quyidagi jadvallar bo'lishi kerak:

- `restaurant_tables`
- `kitchen_tickets`
- `notifications`
- `orders`

(Migratsiyada qo'shilgan)

## 5. Frontend env

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
VITE_USE_MOCK=false
```

**Muhim:** `service_role` keyni frontendga qo'ymang!

## 6. Build va deploy

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

## 7. PWA (HTTPS shart)

Production HTTPS da PWA avtomatik ishlaydi:

- Offline cache (app shell + menyu rasmlari)
- "Ilovani o'rnatish" taklifi
- Avtomatik yangilanish

## 8. PIN sozlash (production)

```sql
UPDATE profiles
SET pin_hash = crypt('1234', gen_salt('bf'))
WHERE role = 'waiter' AND full_name = 'Sardor';
```

PIN auth uchun Edge Function tavsiya etiladi — `sign_in_with_pin` RPC faqat profil lookup.

## 9. Tekshirish ro'yxati

- [ ] Login (har rol)
- [ ] PIN login (ofitsiant)
- [ ] Stol → menyu → oshxonaga yuborish
- [ ] Realtime (oshxona + ofitsiant notification)
- [ ] Split payment + chek
- [ ] Admin menyu CRUD
- [ ] RLS: ofitsiant boshqa rol ma'lumotlarini ko'ra olmasin

## 10. Monitoring

Supabase Dashboard:

- **Logs** → API xatolari
- **Database** → Advisors (security)
- **Auth** → Sessions
