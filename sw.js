// Service worker de Regnum Companion (PWA).
//
// Estrategia deliberadamente simple, en dos partes:
//
// 1) "App shell" (HTML/CSS/JS del sitio): se precachea en la instalación,
//    así el sitio abre al toque en visitas repetidas incluso con mala señal.
//    CACHE_VERSION hay que subirla a mano en cada cambio de alguno de estos
//    archivos -- es lo que hace que una visita futura note que hay una
//    versión nueva y reemplace la cache vieja (ver 'activate' más abajo).
//
// 2) Todo lo demás que el sitio pide (mosaicos del mapa, íconos, audio,
//    game-data.json) se cachea "sobre la marcha" la primera vez que se
//    usa (cache-first con relleno de cache en segundo plano) -- ninguno
//    de estos archivos cambia solo, así que no hace falta invalidarlos
//    nunca, y de paso evita precachear a la fuerza los ~9.5MB de mosaicos
//    del mapa (que muchos visitantes ni van a abrir) en la instalación.
//
// El proxy de estado de guerra (/api/wz) queda deliberadamente AFUERA de
// todo esto: no se cachea nunca, se deja pasar directo a la red (ver el
// primer chequeo dentro de 'fetch'), porque esos datos cambian todo el
// tiempo y ya tienen su propio manejo de caché (ver fetch(...,
// {cache:'no-store'}) en js/wz.js).

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `regnum-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `regnum-runtime-${CACHE_VERSION}`;

const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/css/theme.css',
  '/css/layout.css',
  '/css/build.css',
  '/css/map.css',
  '/js/weights.js',
  '/js/vocabulario.js',
  '/js/engine.js',
  '/js/render.js',
  '/js/main.js',
  '/js/data-loader.js',
  '/js/map.js',
  '/js/wz.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names
        .filter((n) => n !== SHELL_CACHE && n !== RUNTIME_CACHE)
        .map((n) => caches.delete(n))
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

  // Resto del sitio (leaflet de unpkg incluido, por descarte de origin más
  // arriba no aplica) -- cache-first, guardando en cache lo que se vaya
  // pidiendo por primera vez (mosaicos del mapa, data/*.json, íconos, audio).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
