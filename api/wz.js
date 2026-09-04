// Proxy para el estado de guerra de CoRT.
//
// El archivo real solo permite que JavaScript lo lea desde el propio
// sitio de CoRT (su Access-Control-Allow-Origin no incluye ningún otro
// origen) — un fetch directo desde el navegador de un visitante nuestro
// queda bloqueado por CORS, sin importar qué tan seguido se pida. Esta
// función corre del lado del servidor (entre servidores no aplica CORS)
// y le devuelve el dato a nuestra propia página, sirviendo desde nuestro
// propio origen.
//
// Fuente: cort.go.yo.fr, NO cort.ovh — el sitio "oficial" (cort.ovh)
// tiene su propio generador de wstatus.json trabado del lado de ellos
// (confirmado: su "generated" quedó más de 4 horas viejo mientras
// go.yo.fr estaba a minutos), aparentemente la razón por la que el
// equipo de CoRT armó go.yo.fr como mirror aparte. Si algún día se
// recupera cort.ovh, queda como respaldo si go.yo.fr llegara a fallar.
//
// runtime:'edge' a propósito, no el runtime Node por defecto: con Node
// (que en Vercel corre sobre AWS Lambda) la conexión a cort.ovh:443 daba
// timeout siempre — todo indica un bloqueo de red contra rangos de IP de
// proveedores cloud (medida anti-scraping habitual), no un tema de
// headers ni de CORS. Edge corre sobre una red distinta (no AWS), así
// que esquiva ese bloqueo puntual (y de paso corre bien contra go.yo.fr
// también).
//
// Cache-Control con s-maxage hace que Vercel cachee la respuesta en su
// borde: aunque entren muchos visitantes a la vez, o el mismo visitante
// pida varias veces seguidas, esta función no se llama más de una vez
// por minuto en total — mismo ritmo que usa el propio CoRT para
// consultarse a sí mismo.
export const config = { runtime: 'edge' };

const SOURCES = [
  'https://cort.go.yo.fr/CoRT/api/var/wstatus.json',
  'https://cort.ovh/api/var/wstatus.json',
];

async function fetchFrom(url) {
  const upstream = await fetch(url, {
    headers: {
      'User-Agent': 'cort-build-tool/1.0 (+https://cort-build-tool.vercel.app; proxy de solo lectura para el estado de guerra en el mapa interactivo)',
    },
  });
  if (!upstream.ok) throw new Error(`${url} respondió ${upstream.status}`);
  return upstream.json();
}

export default async function handler() {
  let lastErr = null;
  for (const url of SOURCES) {
    try {
      const data = await fetchFrom(url);
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'Cache-Control': 's-maxage=60, stale-while-revalidate=30',
        },
      });
    } catch (err) {
      lastErr = err;
    }
  }
  return new Response(JSON.stringify({
    error: String((lastErr && lastErr.message) || lastErr),
    code: lastErr && lastErr.code,
    cause: lastErr && lastErr.cause && String(lastErr.cause.message || lastErr.cause),
  }), {
    status: 502,
    headers: { 'content-type': 'application/json' },
  });
}
