-- =======================================================================
-- STRUKTUR DATABASE CLOUDFLARE D1
-- File: schema.sql
-- Silakan salin dan jalankan langsung di konsol database D1 Cloudflare Anda.
-- =======================================================================
-- 1. Tabel Sesi Meja (Sumber Validasi Keamanan Utama Sisi Server)
DROP TABLE IF EXISTS table_sessions;
CREATE TABLE table_sessions (
    table_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'vacant', -- 'vacant', 'ordering', 'locked', 'done'
    customer_name TEXT,
    active_order_id TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- 2. Tabel Pesanan / Transaksi
DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
    order_id TEXT PRIMARY KEY,
    table_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    items_json TEXT NOT NULL,              -- JSON String berisi daftar produk yang dibeli
    subtotal REAL NOT NULL,
    tax REAL NOT NULL,
    total_amount REAL NOT NULL,
    order_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'cooking', 'served', 'completed'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- 3. Tabel Master Produk
DROP TABLE IF EXISTS products;
CREATE TABLE products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready',   -- 'ready', 'habis'
    image TEXT DEFAULT 'fa-cookie'
);
-- 4. Tabel Master Kategori
DROP TABLE IF EXISTS categories;
CREATE TABLE categories (
    name TEXT PRIMARY KEY
);
-- 5. Tabel Konfigurasi Sistem POS
DROP TABLE IF EXISTS settings;
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- INJEKSI DATA AWAL (SEEDING) UNTUK KEPERLUAN OPERASIONAL PERTAMA
INSERT OR REPLACE INTO categories (name) VALUES ('Minuman'), ('Makanan'), ('Snack');
INSERT OR REPLACE INTO products (id, name, price, category, status, image) VALUES 
('P01', 'Signature Coffee Aren', 25000, 'Minuman', 'ready', 'fa-mug-hot'),
('P02', 'Cyber Matcha Latte', 28000, 'Minuman', 'ready', 'fa-glass-water'),
('P03', 'Nasi Goreng Wagyu', 45000, 'Makanan', 'ready', 'fa-bowl-food'),
('P04', 'Truffle French Fries', 22000, 'Snack', 'ready', 'fa-plate-wheat'),
('P05', 'Neon Citrus Mojito', 24000, 'Minuman', 'habis', 'fa-martini-glass-citrus'),
('P06', 'Spaghetti Carbonara', 38000, 'Makanan', 'ready', 'fa-utensils');
INSERT OR REPLACE INTO settings (key, value) VALUES 
('store_name', 'Kasir Mandiri Kiosk'),
('store_slogan', 'Sistem Pemesanan Cepat & Mudah'),
('admin_pin', '1234'),
('tax_rate', '0.10'),
('num_tables', '12'),
('webhook_kitchen', ''),
('webhook_cashier', ''),
('store_status', 'open'),
('promos', '["https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=800&q=80","https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=80"]');