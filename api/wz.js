// Proxy para el estado de guerra de CoRT (cort.ovh).
//
// El archivo real (https://cort.ovh/api/var/wstatus.json) solo permite
// que JavaScript lo lea desde cort.ovh mismo (su header
// Access-Control-Allow-Origin no incluye ningún otro origen) — un fetch
// directo desde el navegador de un visitante nuestro queda bloqueado por
// CORS, sin importar qué tan seguido se pida. Esta función corre del
// lado del servidor (entre servidores no aplica CORS) y le devuelve el
// dato a nuestra propia página, sirviendo desde nuestro propio origen.
//
// runtime:'edge' a propósito, no el runtime Node por defecto: con Node
// (que en Vercel corre sobre AWS Lambda) la conexión a cort.ovh:443 daba
// timeout siempre — todo indica un bloqueo de red contra rangos de IP de
// proveedores cloud (medida anti-scraping habitual), no un tema de headers
// ni de CORS. Edge corre sobre una red distinta (no AWS), así que esquiva
// ese bloqueo puntual.
//
// Cache-Control con s-maxage hace que Vercel cachee la respuesta en su
// borde: aunque entren muchos visitantes a la vez, o el mismo visitante
// pida varias veces seguidas, esta función (y por lo tanto cort.ovh) no
// se llama más de una vez por minuto en total — mismo ritmo que usa el
// propio sitio de CoRT para consultarse a sí mismo.
export const config = { runtime: 'edge' };

export default async function handler() {
  try {
    const upstream = await fetch('https://cort.ovh/api/var/wstatus.json', {
      headers: {
        'User-Agent': 'cort-build-tool/1.0 (+https://cort-build-tool.vercel.app; proxy de solo lectura para el estado de guerra en el mapa interactivo)',
      },
    });
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `CoRT respondió ${upstream.status}` }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'Cache-Control': 's-maxage=60, stale-while-revalidate=30',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: String((err && err.message) || err),
      code: err && err.code,
      cause: err && err.cause && String(err.cause.message || err.cause),
    }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
