-- Seed data for OrderFlow MVP
-- Demo users must be created in Supabase Auth first, then profiles linked

INSERT INTO restaurant_settings (name, phone, address, table_count, service_charge_percent)
VALUES ('Choyxona Premium', '+998 90 123 45 67', 'Toshkent, Amir Temur ko''chasi 15', 30, 10);

-- Tables 1-30
INSERT INTO restaurant_tables (number, status, capacity)
SELECT n, 'empty', 4 FROM generate_series(1, 30) AS n;

-- Categories
INSERT INTO menu_categories (name, slug, sort_order) VALUES
  ('Osh', 'osh', 1),
  ('Sho''rva', 'shorva', 2),
  ('Kabob', 'kabob', 3),
  ('Go''shtli taomlar', 'goshtli', 4),
  ('Salatlar', 'salatlar', 5),
  ('Non', 'non', 6),
  ('Ichimliklar', 'ichimliklar', 7),
  ('Choy', 'choy', 8),
  ('Desertlar', 'desertlar', 9);

-- Menu items with placeholder images
INSERT INTO menu_items (category_id, name, description, price, image_url, prep_time_minutes, sort_order)
SELECT c.id, v.name, v.description, v.price, v.image_url, v.prep_time, v.sort_order
FROM (VALUES
  ('osh', 'Osh palov', 'An''anaviy o''zbek palovi', 40000, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400', 25, 1),
  ('osh', 'Devzira palov', 'Qizil guruchli maxsus palov', 45000, 'https://images.unsplash.com/photo-1563379926898-05f4575a58d8?w=400', 30, 2),
  ('shorva', 'Sho''rva', 'Go''shtli an''anaviy sho''rva', 35000, 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=400', 20, 1),
  ('shorva', 'Lag''mon sho''rva', 'Uy uslubidagi lag''mon', 32000, 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400', 18, 2),
  ('kabob', 'Qo''y kabob', 'Tandirda pishirilgan', 25000, 'https://images.unsplash.com/photo-1529042410819-b791f0a79140?w=400', 15, 1),
  ('kabob', 'Jigar kabob', 'Yengil va mazali', 20000, 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400', 12, 2),
  ('kabob', 'Lulya kabob', '3 dona', 30000, 'https://images.unsplash.com/photo-1594041680534-e8c8cdebd659?w=400', 15, 3),
  ('goshtli', 'Manti', '6 dona', 28000, 'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=400', 20, 1),
  ('goshtli', 'Somsa', '2 dona', 15000, 'https://images.unsplash.com/photo-1601056639572-9f1d1509f899?w=400', 10, 2),
  ('salatlar', 'Achchiq-chuchuk', 'Yengil salat', 12000, 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400', 5, 1),
  ('salatlar', 'Olivye', 'Klassik salat', 18000, 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=400', 5, 2),
  ('non', 'Non', 'Issiq non', 5000, 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400', 3, 1),
  ('non', 'Qatlama', 'Qatlamali non', 8000, 'https://images.unsplash.com/photo-1586444248902-2f64eddc13df?w=400', 5, 2),
  ('ichimliklar', 'Coca-Cola', '0.5L', 10000, 'https://images.unsplash.com/photo-1629203851122-3729814c932e?w=400', 1, 1),
  ('ichimliklar', 'Fanta', '0.5L', 10000, 'https://images.unsplash.com/photo-1624517452488-04869289c4ca?w=400', 1, 2),
  ('ichimliklar', 'Suv', '0.5L', 5000, 'https://images.unsplash.com/photo-1548839140-5a941f94e586?w=400', 1, 3),
  ('choy', 'Ko''k choy', 'Choynak', 15000, 'https://images.unsplash.com/photo-1564890369478-c89ca6d734cb?w=400', 5, 1),
  ('choy', 'Qora choy', 'Choynak', 12000, 'https://images.unsplash.com/photo-1576092762793-f8a949b5029a?w=400', 5, 2),
  ('desertlar', 'Halva', 'Porsiya', 15000, 'https://images.unsplash.com/photo-1606312619070-d48b4cbc7255?w=400', 2, 1),
  ('desertlar', 'Medovik', 'Tort bo''lagi', 20000, 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400', 2, 2)
) AS v(cat_slug, name, description, price, image_url, prep_time, sort_order)
JOIN menu_categories c ON c.slug = v.cat_slug;
