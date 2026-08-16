-- OrderFlow: Auth users → profiles bog'lash (email bo'yicha)
-- Avval Dashboard → Authentication → Users da foydalanuvchilarni yarating
-- YOKI saytda /setup sahifasidan bir bosishda yarating

INSERT INTO profiles (id, full_name, role, is_active)
SELECT
  u.id,
  CASE u.email
    WHEN 'admin@orderflow.uz' THEN 'Admin'
    WHEN 'kassir@orderflow.uz' THEN 'Kassir Ali'
    WHEN 'ofitsiant@orderflow.uz' THEN 'Ofitsiant Sardor'
    WHEN 'oshxona@orderflow.uz' THEN 'Oshpaz'
    ELSE split_part(u.email, '@', 1)
  END,
  CASE u.email
    WHEN 'admin@orderflow.uz' THEN 'admin'::user_role
    WHEN 'kassir@orderflow.uz' THEN 'cashier'::user_role
    WHEN 'ofitsiant@orderflow.uz' THEN 'waiter'::user_role
    WHEN 'oshxona@orderflow.uz' THEN 'kitchen'::user_role
    ELSE 'waiter'::user_role
  END,
  true
FROM auth.users u
WHERE u.email IN (
  'admin@orderflow.uz',
  'kassir@orderflow.uz',
  'ofitsiant@orderflow.uz',
  'oshxona@orderflow.uz'
)
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active;

-- PIN kodlar
UPDATE profiles SET pin_hash = extensions.crypt('1234', extensions.gen_salt('bf')) WHERE role = 'waiter';
UPDATE profiles SET pin_hash = extensions.crypt('5678', extensions.gen_salt('bf')) WHERE role = 'kitchen';
UPDATE profiles SET pin_hash = extensions.crypt('0000', extensions.gen_salt('bf')) WHERE role = 'cashier';
