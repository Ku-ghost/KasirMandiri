/**
 * Cloudflare Worker Backend API untuk Smart Kiosk & POS Mandiri
 * Hubungkan worker ini dengan D1 Database binding bernama "DB"
 */

export default {
  async fetch(request, env, ctx) {
    // Tangani preflight request CORS secara aman
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Pastikan hanya menerima request POST
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
        status: 405,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    try {
      const url = new URL(request.url);
      
      // Routing endpoint murni ke /api/gate
      if (url.pathname !== "/api/gate") {
        return new Response(JSON.stringify({ error: "Endpoint not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      const body = await request.json();
      const { app_id, store_reg_name, auth_token, action, payload } = body;

      // Proteksi Parameter Enkripsi & Validitas Hak Cipta Sederhana
      if (!app_id || app_id !== "SMARTPOS_UKM_01") {
        return new Response(JSON.stringify({ error: "Unauthorized APP ID" }), {
          status: 403,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      // Pastikan binding database D1 "DB" telah dikonfigurasi dengan benar
      if (!env.DB) {
        return new Response(JSON.stringify({ error: "Database binding 'DB' is missing on Cloudflare Worker" }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      // ==========================================
      // AKSI: MEMASUKKAN ORDERAN BARU KLIEN KE D1
      // ==========================================
      if (action === "insert_order") {
        const { order_id, table_number, total_amount, order_time, items } = payload;

        if (!order_id || !table_number || !items || !Array.isArray(items)) {
          return new Response(JSON.stringify({ error: "Payload order data tidak lengkap" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        // Jalankan transaksi penulisan berlapis secara serial dalam D1 batch
        const statements = [
          env.DB.prepare(
            "INSERT INTO orders (order_id, table_number, total_amount, order_time, status) VALUES (?, ?, ?, ?, 'pending')"
          ).bind(order_id, table_number, total_amount, order_time)
        ];

        for (const item of items) {
          statements.push(
            env.DB.prepare(
              "INSERT INTO order_items (order_id, product_id, name, qty, price) VALUES (?, ?, ?, ?, ?)"
            ).bind(order_id, item.id, item.name, item.qty, item.price)
          );
        }

        await env.DB.batch(statements);

        return new Response(JSON.stringify({ success: true, message: `Order ${order_id} berhasil tercatat di database D1!` }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      // ==========================================
      // AKSI: PROSES REKAP HARIAN (CLOSE STORE)
      // ==========================================
      if (action === "close_store") {
        // Ambil semua order aktif yang belum di-archive
        const activeOrdersQuery = await env.DB.prepare(
          "SELECT * FROM orders WHERE status != 'archived'"
        ).all();

        const activeOrders = activeOrdersQuery.results || [];
        
        if (activeOrders.length === 0) {
          return new Response(JSON.stringify({ success: true, message: "Dapur bersih! Tidak ada transaksi aktif untuk direkap hari ini." }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        const totalOrders = activeOrders.length;
        const totalRevenue = activeOrders.reduce((sum, ord) => sum + ord.total_amount, 0);

        // Simpan data mentah ke JSON log untuk audit trail kepemilikan yang sah
        const closingDataJson = JSON.stringify(activeOrders);

        // Simpan log ke tabel penutupan toko
        await env.DB.prepare(
          "INSERT INTO store_closings (total_orders, total_revenue, closing_data_json) VALUES (?, ?, ?)"
        ).bind(totalOrders, totalRevenue, closingDataJson);

        // Tandai seluruh order hari ini menjadi 'archived' agar tidak masuk dalam laporan hari berikutnya
        await env.DB.prepare(
          "UPDATE orders SET status = 'archived' WHERE status != 'archived'"
        ).run();

        return new Response(JSON.stringify({ 
          success: true, 
          total_orders: totalOrders, 
          total_revenue: totalRevenue,
          message: "Tutup toko harian sukses! Database D1 berhasil diarsipkan." 
        }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      // Jika Aksi tidak dikenali
      return new Response(JSON.stringify({ error: "Aksi tidak dikenali oleh gerbang API" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
  },
};