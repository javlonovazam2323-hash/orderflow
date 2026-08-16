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

Batafsil qo'llanma: **[docs/DEPLOY.md](docs/DEPLOY.md)**

Qisqa:

1. Supabase da yangi loyiha yarating
2. Migratsiyalar + seed ishga tushiring
3. `seed-auth.sql` bilan foydalanuvchilarni ulang
4. `.env` sozlang va `npm run build`

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
- [x] PWA offline cache + install prompt
- [x] Bluetooth ESC/POS printer
- [x] Production deploy qo'llanmasi
