/**
 * Service Worker untuk Caching Offline Aset POS Mandiri
 */

const CACHE_NAME = "smartpos-offline-v2";

// Daftar aset krusial yang disimpan secara lokal di browser fisik
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "https://cdn.tailwindcss.com",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("Caching aset krusial untuk mode offline...");
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("Menghapus cache versi lama:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Hanya intercept request GET
  if (event.request.method !== "GET") return;

  // Lewati pangkalan luar Cloudflare Worker API dari caching lokal
  if (event.request.url.includes("/api/gate")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        // Fallback jika tidak ada internet
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
      });
    })
  );
});