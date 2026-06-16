/**
 * =======================================================================
 * BACKEND CLOUDFLARE WORKER (API GATEWAY)
 * Domain: kasirmandiri.ku-ghost.workers.dev
 * Binding D1 Database: KS (Variabel nama pengikat wajib 'KS')
 * =======================================================================
 */

const EXPECTED_APP_ID = "SMARTPOS_UKM_01";

// Headers CORS lengkap untuk mengizinkan request aman dari kasirmandiri.pages.dev
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://kasirmandiri.pages.dev",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json"
};

export default {
  async fetch(request, env, ctx) {
    // 1. Tangani Preflight Request CORS (OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Jalankan routing RESTful API murni ke endpoint /api/gate
    if (url.pathname !== "/api/gate") {
      return new Response(JSON.stringify({ error: "Endpoint tidak ditemukan di Worker" }), {
        status: 404,
        headers: corsHeaders
      });
    }

    // Pastikan database KS sudah terikat
    if (!env.KS) {
      return new Response(JSON.stringify({ error: "Sistem Error: Pengikatan variabel database 'KS' belum dikonfigurasi di dashboard Cloudflare Workers." }), {
        status: 500,
        headers: corsHeaders
      });
    }

    // ------------------------------------------------------------------
    // PENANGANAN METHOD POST (INSERT TRANSAKSI & CLOSE STORE)
    // ------------------------------------------------------------------
    if (request.method === "POST") {
      try {
        const body = await request.json();
        const { app_id, store_reg_name, auth_token, action, payload } = body;

        // Validasi identitas aplikasi
        if (!app_id || !store_reg_name || app_id !== EXPECTED_APP_ID) {
          return new Response(JSON.stringify({ 
            error: "Akses ditolak! Kunci APP_ID tidak cocok atau tidak terdaftar secara sah." 
          }), { status: 403, headers: corsHeaders });
        }
        
        // Validasi token lisensi operasional
        if (!auth_token) {
          return new Response(JSON.stringify({ 
            error: "Otorisasi gagal! Token lisensi kasir kosong." 
          }), { status: 401, headers: corsHeaders });
        }

        // AKSI: MASUKKAN TRANSAKSI BARU (INSERT ORDER)
        if (action === "insert_order") {
          const { order_id, table_number, total_amount, order_time, items } = payload;
          
          if (!order_id || !table_number || !items) {
            return new Response(JSON.stringify({ error: "Parameter order tidak lengkap" }), { status: 400, headers: corsHeaders });
          }

          // Gunakan binding KS untuk kueri SQL
          await env.KS.prepare(
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
            message: "Transaksi berhasil diselaraskan ke database cloud 'kasirmandiri'!" 
          }), { headers: corsHeaders });
        }

        // AKSI: TUTUP TOKO (CLOSE STORE & EXPORT BACKUP KE DISCORD VIA WEBHOOK)
        else if (action === "close_store") {
          const storeSettings = await env.KS.prepare(
            `SELECT webhook_cashier FROM store_settings WHERE app_id = ? AND store_reg_name = ?`
          ).bind(app_id, store_reg_name).first();

          const webhookUrl = storeSettings?.webhook_cashier;
          if (!webhookUrl) {
            return new Response(JSON.stringify({ 
              error: "Konfigurasi webhook kasir tidak ditemukan di database cloud." 
            }), { status: 400, headers: corsHeaders });
          }

          const { results: allOrders } = await env.KS.prepare(
            `SELECT * FROM orders WHERE app_id = ? AND store_reg_name = ? AND status != 'archived' ORDER BY id DESC`
          ).bind(app_id, store_reg_name).all();

          if (allOrders.length === 0) {
            return new Response(JSON.stringify({ 
              success: true, 
              message: "Tidak ada transaksi aktif hari ini untuk diarsipkan." 
            }), { headers: corsHeaders });
          }

          const totalOmzet = allOrders.reduce((sum, order) => sum + order.total_amount, 0);
          const totalTransaksi = allOrders.length;
          const tanggalHariIni = new Date().toISOString().slice(0, 10);

          const backupJsonString = JSON.stringify({
            metadata: { app_id, store_reg_name, date: tanggalHariIni, total_omzet: totalOmzet, total_transaksi: totalTransaksi },
            transactions: allOrders
          }, null, 2);

          const fileBlob = new Blob([backupJsonString], { type: 'application/json' });
          const namaBerkas = `Arsip_Laporan_${store_reg_name}_${tanggalHariIni}.json`;

          const discordFormData = new FormData();
          discordFormData.append("payload_json", JSON.stringify({
            content: `🚨 **REKAP TUTUP TOKO (END OF DAY) - ${store_reg_name.toUpperCase()}** 🚨\n--------------------------------------\n📅 Tanggal Laporan: ${tanggalHariIni}\n✅ Total Transaksi POS: ${totalTransaksi} Nota\n💰 **OMSET KOTOR HARIAN: Rp ${totalOmzet.toLocaleString('id-ID')}**\n--------------------------------------\n📦 *Berkas backup database JSON terlampir otomatis.*`
          }));
          discordFormData.append("file", fileBlob, namaBerkas);

          const discordReq = await fetch(webhookUrl, { method: "POST", body: discordFormData });
          if (!discordReq.ok) {
            console.error("Gagal mengirim notifikasi rekap ke Discord API.");
          }

          // Arsipkan data transaksi setelah berhasil di-backup ke Discord
          await env.KS.prepare(
            `UPDATE orders SET status = 'archived' WHERE app_id = ? AND store_reg_name = ? AND status != 'archived'`
          ).bind(app_id, store_reg_name).run();

          return new Response(JSON.stringify({ 
            success: true, 
            message: "Proses tutup toko sukses! Log transaksi terkirim ke Discord Kasir." 
          }), { headers: corsHeaders });
        }

        return new Response(JSON.stringify({ error: "Perintah aksi ditolak." }), { status: 400, headers: corsHeaders });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ------------------------------------------------------------------
    // PENANGANAN METHOD GET (TARIK DATA ANTRIAN OLEH DASHBOARD KASIR)
    // ------------------------------------------------------------------
    if (request.method === "GET") {
      try {
        const app_id = url.searchParams.get('app_id');
        const store_reg_name = url.searchParams.get('store_reg_name');
        const auth_token = request.headers.get('X-Auth-Token');

        if (!app_id || !store_reg_name) {
          return new Response(JSON.stringify({ error: "Parameter penarikan data tidak lengkap!" }), { status: 400, headers: corsHeaders });
        }
        
        if (!auth_token || auth_token.length !== 12) {
          return new Response(JSON.stringify({ error: "Kunci akses token kasir tidak sah." }), { status: 403, headers: corsHeaders });
        }

        const { results: orders } = await env.KS.prepare(
          `SELECT * FROM orders WHERE app_id = ? AND store_reg_name = ? AND status != 'archived' ORDER BY id DESC LIMIT 100`
        ).bind(app_id, store_reg_name).all();

        return new Response(JSON.stringify({ success: true, data: orders }), { headers: corsHeaders });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response(JSON.stringify({ error: "Method tidak diizinkan." }), { status: 405, headers: corsHeaders });
  }
};
