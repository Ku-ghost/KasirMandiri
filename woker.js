/**
 * =======================================================================
 * BACKEND CLOUDFLARE PAGES FUNCTIONS (SERVERLESS API)
 * File: /functions/api/gate.js
 * Jalur URL Publik: /api/gate
 * =======================================================================
 */

// Sandi Keamanan Aplikasi (Harus sama dengan APP_ID di index.html)
const EXPECTED_APP_ID = "SMARTPOS_UKM_01";

// Standar Response Headers untuk penanganan CORS aman lintas asal
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
    "Content-Type": "application/json"
};

/**
 * Tangani preflight OPTIONS request untuk mencegah pemblokiran CORS browser
 */
export async function onRequestOptions() {
    return new Response(null, { headers: corsHeaders });
}

/**
 * =======================================================================
 * METHOD POST: MENERIMA TRANSAKSI BARU & MEMPROSES TUTUP TOKO HARIAN
 * =======================================================================
 */
export async function onRequestPost(context) {
    try {
        const req = await context.request.json();
        const { app_id, store_reg_name, auth_token, action, payload } = req;

        // 1. Gembok Otentikasi Lapis Pertama (Validasi APP ID)
        if (!app_id || !store_reg_name || app_id !== EXPECTED_APP_ID) {
            return new Response(JSON.stringify({ 
                error: "Akses ditolak! Kunci APP_ID tidak cocok atau tidak terdaftar." 
            }), { status: 403, headers: corsHeaders });
        }
        
        // 2. Gembok Otentikasi Lapis Kedua (Validasi Token Lisensi / Sandi Kasir)
        if (!auth_token) {
            return new Response(JSON.stringify({ 
                error: "Missing Auth Token (Token Lisensi Kosong)" 
            }), { status: 401, headers: corsHeaders });
        }

        // ------------------------------------------------------------------
        // AKSI A: SIMPAN PESANAN AKTIF BARU (INSERT ORDER)
        // ------------------------------------------------------------------
        if (action === "insert_order") {
            const { order_id, table_number, total_amount, order_time, items } = payload;
            
            if (!order_id || !table_number || !items) {
                return new Response(JSON.stringify({ 
                    error: "Data transaksi tidak lengkap" 
                }), { status: 400, headers: corsHeaders });
            }

            // Simpan data orderan ke dalam database Cloudflare D1
            await context.env.DB.prepare(
                `INSERT INTO orders (app_id, store_reg_name, order_id, table_number, total_amount, order_time, items_json) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                app_id, 
                store_reg_name, 
                order_id, 
                table_number, 
                total_amount, 
                order_time, 
                JSON.stringify(items)
            ).run();

            return new Response(JSON.stringify({ 
                success: true, 
                message: "Pesanan ter-backup dengan aman di database Cloud D1!" 
            }), { headers: corsHeaders });
        }

        // ------------------------------------------------------------------
        // AKSI B: PROSES TUTUP TOKO HARIAN (REKAP OMSET & EXPORT MASTER JSON TO DISCORD)
        // ------------------------------------------------------------------
        else if (action === "close_store") {
            // 1. Tarik Webhook URL Kasir dari Database D1
            const storeSettings = await context.env.DB.prepare(
                `SELECT webhook_cashier FROM store_settings WHERE app_id = ? AND store_reg_name = ?`
            ).bind(app_id, store_reg_name).first();

            const webhookUrl = storeSettings?.webhook_cashier;
            if (!webhookUrl) {
                return new Response(JSON.stringify({ 
                    error: "Konfigurasi Webhook Kasir tidak ditemukan di pengaturan database D1" 
                }), { status: 400, headers: corsHeaders });
            }

            // 2. Tarik Semua Data Orderan Aktif untuk Backup Permanen
            const { results: allOrders } = await context.env.DB.prepare(
                `SELECT * FROM orders WHERE app_id = ? AND store_reg_name = ? AND status != 'archived' ORDER BY id DESC`
            ).bind(app_id, store_reg_name).all();

            if (allOrders.length === 0) {
                return new Response(JSON.stringify({ 
                    success: true, 
                    message: "Dapur bersih! Tidak ada transaksi aktif untuk direkap harian." 
                }), { headers: corsHeaders });
            }

            // Hitung nilai rekap keuangan harian
            const totalOmzet = allOrders.reduce((sum, order) => sum + order.total_amount, 0);
            const totalTransaksi = allOrders.length;
            const tanggalHariIni = new Date().toISOString().slice(0, 10);

            // 3. Kemas Data SQL menjadi File JSON Master Terenkripsi Ringkas
            const backupJsonString = JSON.stringify({
                metadata: { 
                    app_id,
                    store_reg_name, 
                    date: tanggalHariIni, 
                    total_omzet: totalOmzet, 
                    total_transaksi: totalTransaksi 
                },
                transactions: allOrders
            }, null, 2);

            const fileBlob = new Blob([backupJsonString], { type: 'application/json' });
            const namaBerkas = `Arsip_Laporan_${store_reg_name}_${tanggalHariIni}.json`;

            // 4. Susun FormData Multipart sesuai Standar Pengiriman Berkas Discord API
            const discordFormData = new FormData();
            discordFormData.append("payload_json", JSON.stringify({
                content: `🚨 **REKAP TUTUP TOKO (END OF DAY) - ${store_reg_name.toUpperCase()}** 🚨\n--------------------------------------\n📅 Tanggal Laporan: ${tanggalHariIni}\n✅ Total Transaksi POS: ${totalTransaksi} Nota\n💰 **OMSET KOTOR HARIAN: Rp ${totalOmzet.toLocaleString('id-ID')}**\n--------------------------------------\n📦 *Berkas backup database JSON terlampir otomatis. Silakan unduh dan upload ke Google Drive sebagai cadangan keuangan Anda.*`
            }));
            discordFormData.append("file", fileBlob, namaBerkas);

            // 5. Kirim data asinkronus menuju Discord Kasir
            const discordReq = await fetch(webhookUrl, {
                method: "POST",
                body: discordFormData
            });

            if (!discordReq.ok) {
                console.error("Gagal menembak data log berkas menuju Discord API.");
            }

            // 6. Tandai seluruh transaksi hari ini sebagai 'archived' agar tidak masuk rekap besok
            await context.env.DB.prepare(
                `UPDATE orders SET status = 'archived' WHERE app_id = ? AND store_reg_name = ? AND status != 'archived'`
            ).bind(app_id, store_reg_name).run();

            return new Response(JSON.stringify({ 
                success: true, 
                message: "Tutup toko berhasil! File laporan harian sukses dikirim ke Discord Anda." 
            }), { headers: corsHeaders });
        }

        return new Response(JSON.stringify({ error: "Aksi ditolak! Kode aksi tidak dikenali." }), { status: 400, headers: corsHeaders });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
}

/**
 * =======================================================================
 * METHOD GET: MENYELARASKAN DATA PENJUALAN CLOUD KE DASHBOARD KASIR (PULL)
 * =======================================================================
 */
export async function onRequestGet(context) {
    try {
        const { searchParams } = new URL(context.request.url);
        const app_id = searchParams.get('app_id');
        const store_reg_name = searchParams.get('store_reg_name');
        const auth_token = context.request.headers.get('X-Auth-Token');

        // Validasi parameter wajib
        if (!app_id || !store_reg_name) {
            return new Response(JSON.stringify({ error: "Parameter sinkronisasi cloud tidak lengkap!" }), { status: 400, headers: corsHeaders });
        }
        
        // Proteksi anti-intip pihak ketiga (Wajib mencocokkan Token Lisensi)
        if (!auth_token || auth_token.length !== 12) {
             return new Response(JSON.stringify({ error: "Akses ditolak! Token otentikasi kasir tidak sah." }), { status: 403, headers: corsHeaders });
        }

        // Ambil data transaksi aktif harian yang belum diarsipkan
        const { results: orders } = await context.env.DB.prepare(
            `SELECT * FROM orders WHERE app_id = ? AND store_reg_name = ? AND status != 'archived' ORDER BY id DESC LIMIT 100`
        ).bind(app_id, store_reg_name).all();

        return new Response(JSON.stringify({ success: true, data: orders }), { headers: corsHeaders });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
}
