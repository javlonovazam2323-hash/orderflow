-- OrderFlow: Auth users → profiles bog'lash
-- 1. Supabase Dashboard → Authentication → Users da foydalanuvchilarni yarating
-- 2. UUID larni quyidagi INSERT larga qo'ying
-- 3. SQL Editor da bajaring

-- UUID larni o'zgartiring:
-- SELECT id, email FROM auth.users;

INSERT INTO profiles (id, full_name, role, is_active) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Admin', 'admin', true),
  ('00000000-0000-0000-0000-000000000002', 'Kassir Ali', 'cashier', true),
  ('00000000-0000-0000-0000-000000000003', 'Ofitsiant Sardor', 'waiter', true),
  ('00000000-0000-0000-0000-000000000004', 'Oshpaz', 'kitchen', true)
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active;

-- PIN kodlar (bcrypt)
UPDATE profiles SET pin_hash = crypt('1234', gen_salt('bf'))
WHERE role = 'waiter';

UPDATE profiles SET pin_hash = crypt('5678', gen_salt('bf'))
WHERE role = 'kitchen';

UPDATE profiles SET pin_hash = crypt('0000', gen_salt('bf'))
WHERE role = 'cashier';

-- Admin uchun PIN yo'q (faqat email login)
