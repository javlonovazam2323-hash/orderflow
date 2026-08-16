# OrderFlow

Restoran, choyxona va kafelar uchun mobil-first buyurtma boshqaruv tizimi (PWA).

## Stack

- React 19 + TypeScript + Vite
- Tailwind CSS v4
- Supabase (Auth, PostgreSQL, Realtime, RLS)
- PWA (offline-ready architecture)

## Tez boshlash (Demo rejim)

Node.js o'rnatilgan bo'lishi kerak.

```bash
cd orderflow
npm install
npm run dev
```

`.env` fayli bo'lmasa yoki Supabase sozlanmagan bo'lsa, **avtomatik demo rejim** ishlaydi (localStorage mock data).

### Demo hisoblar

| Rol | Email | Parol |
|-----|-------|-------|
| Admin | admin@orderflow.uz | demo1234 |
| Kassir | kassir@orderflow.uz | demo1234 |
| Ofitsiant | ofitsiant@orderflow.uz | demo1234 |
| Oshxona | oshxona@orderflow.uz | demo1234 |

### MVP oqimini sinash

1. **Ofitsiant** → Stol tanlash → Menyudan taom qo'shish → Savat → Oshxonaga yuborish
2. **Oshxona** → Qabul qilish → Jarayonda → TAYYOR
3. **Ofitsiant** → Notification (🔔 Stol X tayyor!)
4. **Kassir** → Ochiq hisob → Split payment → Hisob yopiladi → Stol bo'sh

## Production (Supabase)

1. [Supabase](https://supabase.com) da yangi loyiha yarating
2. `.env.example` dan `.env` nusxalang:

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_USE_MOCK=false
```

3. Migratsiyani ishga tushiring:

```bash
npx supabase init
npx supabase db push
# yoki SQL Editor da supabase/migrations/20260816100000_initial_schema.sql
# va supabase/seed.sql ni bajaring
```

4. Auth foydalanuvchilarni yarating va `profiles` jadvaliga ulang:

```sql
INSERT INTO profiles (id, full_name, role)
VALUES ('auth-user-uuid', 'Sardor', 'waiter');
```

## Arxitektura

Batafsil: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Struktura

```
src/
├── app/          # Router, providers
├── components/   # UI va layout
├── features/     # Rol bo'yicha sahifalar
├── hooks/        # Auth, notifications, realtime
├── lib/          # API, Supabase, mock store
├── stores/       # Cart, theme
└── types/        # TypeScript types
```

## Keyingi bosqichlar

- [x] Admin menyu boshqaruvi
- [x] Kunlik hisobot va grafiklar
- [x] Ofitsiant KPI statistikasi
- [x] Admin sozlamalar paneli
- [x] PIN login
- [x] Termoprinter integratsiyasi (ESC/POS + 80mm)
- [x] Offline queue (navbat + idempotency)
