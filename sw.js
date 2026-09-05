// Service worker de Regnum Companion (PWA).
//
// Estrategia: "red primero, cache como respaldo" para TODO lo del sitio
// (excepto /api/, ver más abajo) -- no cache-first.
//
// La primera versión de esto precacheaba el "app shell" (html/css/js) en la
// instalación y lo servía cache-first, pensando que así el sitio abría más
// rápido en visitas repetidas. El problema real: este sitio se actualiza
// seguido (varias veces por sesión de trabajo), y cache-first significa que
// una vez que el navegador de alguien cachea una versión, seguía viendo ESA
// versión para siempre -- sin importar cuántas veces se subiera un cambio
// nuevo -- hasta acordarse de subir CACHE_VERSION a mano en cada cambio (y
// ya se me pasó). Con la pestaña abierta a internet, no tiene sentido
// arriesgarse a mostrar algo viejo por una mejora de velocidad chica; mejor
// pedirle siempre la version mas nueva a la red primero, y usar la cache
// solo como red de contención si de verdad no hay conexión.
//
// El proxy de estado de guerra (/api/wz) queda deliberadamente AFUERA de
// todo esto: no se cachea nunca, se deja pasar directo a la red, porque esos
// datos cambian todo el tiempo y ya tienen su propio manejo de caché (ver
// fetch(..., {cache:'no-store'}) en js/wz.js).

const CACHE_VERSION = 'v2';
const RUNTIME_CACHE = `regnum-runtime-${CACHE_VERSION}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Bumpear CACHE_VERSION (si hiciera falta alguna vez forzar un borrado
  // total de lo que la gente tenga cacheado) limpia acá las caches viejas.
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n !== RUNTIME_CACHE).map((n) => caches.delete(n))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // El estado de guerra nunca se cachea -- siempre a la red, tal cual.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
