// Минимальный service worker: делает приложение устанавливаемым (PWA) и даёт
// простой офлайн-кэш оболочки. Без сторонних библиотек.
// v2 (DEC-040): смена имени кэша заставляет activate удалить прежний кэш, в
// котором могли остаться страницы закрытой ссылки-брифа /b/ с контактами.
const CACHE = "remhaos-v2";
const SHELL = ["/", "/login"];
// Страницы по токену и кабинет несут персональные данные — в Cache Storage
// устройства они не кладутся (офлайн-фолбэк для них — оболочка "/").
const NO_STORE_PREFIXES = ["/b/", "/i/", "/p/", "/room/", "/join/", "/projectceo/", "/dashboard"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network-first для навигаций (свежие данные), фолбэк на кэш при офлайне.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const path = new URL(req.url).pathname;
          if (!NO_STORE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/"))),
    );
  }
});
