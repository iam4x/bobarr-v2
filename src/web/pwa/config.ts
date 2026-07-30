export const SERVICE_WORKER_SOURCE = `
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.map((name) => caches.delete(name))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
`;

export const NO_CACHE_HEADERS = {
  "cache-control": "no-store, no-cache, must-revalidate",
  expires: "0",
  pragma: "no-cache",
} as const;
