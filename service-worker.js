const CACHE_NAME = "am-gadget-app-shell-v1";
const APP_SHELL = [
  "/app.html",
  "/rider.app.html",
  "/app.webmanifest",
  "/rider.webmanifest",
  "/app-shell.css",
  "/styles.css",
  "/app.js",
  "/rider.js",
  "/pwa.js",
  "/app-icon.svg",
  "/rider-icon.svg"
];
const APP_PAGES = new Set(["/app", "/app.html", "/rider", "/rider.html", "/rider.app.html"]);
const STATIC_ASSETS = new Set([
  "/app-shell.css",
  "/styles.css",
  "/app.js",
  "/rider.js",
  "/pwa.js",
  "/app-icon.svg",
  "/rider-icon.svg",
  "/app.webmanifest",
  "/rider.webmanifest"
]);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key =>
        key.startsWith("am-gadget-app-shell-") && key !== CACHE_NAME
      ).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate" && APP_PAGES.has(url.pathname)) {
    event.respondWith(
      fetch(request).then(response => {
        if (!response.ok) return response;
        return caches.open(CACHE_NAME)
          .then(cache => cache.put(request, response.clone()).then(() => response));
      }).catch(() => caches.match(request).then(cached => cached || caches.match(url.pathname)))
    );
    return;
  }

  if (STATIC_ASSETS.has(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request).then(response => {
          if (!response.ok) return response;
          return caches.open(CACHE_NAME)
            .then(cache => cache.put(request, response.clone()).then(() => response));
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
