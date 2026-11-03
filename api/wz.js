// Proxy para el estado de guerra de CoRT.
//
// Hasta acá esto le pedía el wstatus.json ya armado a cort.ovh / un mirror
// (cort.go.yo.fr) -- dejó de funcionar: cort.ovh puso un desafío anti-bot
// (BunnyCDN Shield) específicamente contra pedidos desde proveedores
// serverless/CDN como Vercel (confirmado en su propio repo, api/SSE.md:
// "Requests from known CDN or serverless providers (Vercel, Cloudflare,
// AWS, etc.) are blocked" y api/README.md: "cort.ovh API URLs are for
// CoRT's internal, private use only"). No es un bug nuestro ni algo que
// se arregle con headers -- es una política explícita de ellos.
//
// Fuente principal ahora: un Worker propio en Cloudflare (ver
// cloudflare/wz-worker/) que scrapea championsofregnum.com con un cron
// cada minuto y guarda forts/gems + el historial de eventos en Workers
// KV -- corre solo, sin depender de que alguien tenga este sitio abierto
// (a diferencia de este archivo, que Vercel solo ejecuta cuando alguien
// pide /api/wz). Ese Worker es el único lado que arma events_log.
//
// Si el Worker no responde (todavía no desplegado, caído, o WZ_WORKER_URL
// sin configurar), esta función cae a scrapear championsofregnum.com
// directo, igual que antes de sumar el Worker -- sin events_log, pero sin
// dejar el mapa/gemas en vivo sin datos por un problema del lado del
// historial.
export const config = { runtime: 'edge' };

const SOURCE_URL = 'https://www.championsofregnum.com/index.php?l=1&sec=3';

// Mismo orden que usa el propio HTML del juego para location (fuertes) y
// para a qué realm pertenece cada bloque de 6 gemas.
const REALMS = ['Alsius', 'Ignis', 'Syrtis'];

// Un solo bloque ".war-status-realm" trae: el nombre del reino (texto
// "Realm of X") y, en el div "float: right" de al lado, las 6 <img> de
// gema de ese reino (gem_0.png = nadie la tiene ahí, cualquier otro
// nombre = sí). Se repite 3 veces en el HTML, una por reino.
function parseGems(html) {
  const realmBlockRe = /<div class="war-status-realm">\s*<div style="float: left;">Realm of (\w+)<\/div>\s*<div style="float: right;">([\s\S]*?)<\/div>\s*<\/div>/g;
  const porRealm = {};
  let m;
  while ((m = realmBlockRe.exec(html))) {
    const realm = m[1];
    const imgs = [...m[2].matchAll(/src="[^"]*\/(gem_\d+\.png)"/g)].map(x => x[1]);
    porRealm[realm] = imgs;
  }
  // Se arma siempre en el mismo orden (Alsius, Ignis, Syrtis) sin importar
  // el orden real en que aparecieron en el HTML -- así el array plano de
  // 18 queda compatible con WZ_GEM_REALMS de js/wz.js.
  const gems = [];
  REALMS.forEach(realm => gems.push(...(porRealm[realm] || [])));
  return gems;
}

// Los fuertes vienen en dos listas paralelas separadas en el HTML (una
// ".war-status-bulding-icons" con el ícono del dueño actual, una
// ".war-status-bulding-name" con el nombre) -- 12 de cada una, en el mismo
// orden (Alsius 0-3, Ignis 4-7, Syrtis 8-11, 4 por reino).
function parseForts(html) {
  const iconRe = /class="war-status-bulding-icons">\s*<img src="[^"]*\/(keep_[a-z]+\.gif)"/g;
  const nameRe = /class="war-status-bulding-name">([^<]+)<\/div>/g;
  const icons = [...html.matchAll(iconRe)].map(m => m[1]);
  const names = [...html.matchAll(nameRe)].map(m => m[1].trim());
  if (icons.length !== 12 || names.length !== 12) {
    throw new Error(`Conteo inesperado de fuertes: ${names.length} nombres, ${icons.length} íconos (se esperaban 12 y 12)`);
  }
  return names.map((name, i) => {
    const owner = icons[i].replace('keep_', '').replace('.gif', '');
    const ownerCap = owner.charAt(0).toUpperCase() + owner.slice(1);
    return {
      name,
      location: REALMS[Math.floor(i / 4)],
      owner: ownerCap,
      icon: icons[i],
    };
  });
}

async function fetchFromWorker() {
  const workerUrl = process.env.WZ_WORKER_URL;
  if (!workerUrl) throw new Error('WZ_WORKER_URL no configurado');
  const upstream = await fetch(workerUrl);
  if (!upstream.ok) throw new Error(`Worker respondió ${upstream.status}`);
  const data = await upstream.json();
  if (data.error) throw new Error(data.error);
  if (!Array.isArray(data.forts) || !Array.isArray(data.gems)) throw new Error('Respuesta del Worker sin forts/gems');
  return data;
}

async function fetchDirecto() {
  const upstream = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent': 'cort-build-tool/1.0 (+https://cort-build-tool.vercel.app; lee el estado de guerra directo de la pagina oficial del juego)',
    },
  });
  if (!upstream.ok) throw new Error(`${SOURCE_URL} respondió ${upstream.status}`);
  const html = await upstream.text();

  const forts = parseForts(html);
  const gems = parseGems(html);
  if (gems.length !== 18) {
    throw new Error(`Conteo inesperado de gemas: ${gems.length} (se esperaban 18)`);
  }

  return { forts, gems, generated: Math.floor(Date.now() / 1000) };
}

export default async function handler() {
  let data;
  let lastErr = null;
  try {
    data = await fetchFromWorker();
  } catch (err) {
    lastErr = err;
    try {
      data = await fetchDirecto();
    } catch (err2) {
      return new Response(JSON.stringify({
        error: `Worker: ${String(lastErr.message || lastErr)} | Directo: ${String(err2.message || err2)}`,
      }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'Cache-Control': 's-maxage=60, stale-while-revalidate=30',
    },
  });
}
