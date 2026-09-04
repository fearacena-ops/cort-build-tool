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
// Cache-Control con s-maxage hace que Vercel cachee la respuesta en su
// borde: aunque entren muchos visitantes a la vez, o el mismo visitante
// pida varias veces seguidas, esta función (y por lo tanto cort.ovh) no
// se llama más de una vez por minuto en total — mismo ritmo que usa el
// propio sitio de CoRT para consultarse a sí mismo.
module.exports = async function handler(req, res) {
  try {
    const upstream = await fetch('https://cort.ovh/api/var/wstatus.json', {
      headers: {
        'User-Agent': 'cort-build-tool/1.0 (+https://cort-build-tool.vercel.app; proxy de solo lectura para el estado de guerra en el mapa interactivo)',
      },
    });
    if (!upstream.ok) {
      res.status(502).json({ error: `CoRT respondió ${upstream.status}` });
      return;
    }
    const data = await upstream.json();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    res.status(200).json(data);
  } catch (err) {
    // Detalle extra (código de red, causa de bajo nivel) mientras se
    // diagnostica por qué falla desde el entorno de Vercel — "fetch
    // failed" solo no alcanza para saber si es DNS, TLS, timeout, o un
    // bloqueo por IP del lado de cort.ovh.
    res.status(502).json({
      error: String((err && err.message) || err),
      code: err && err.code,
      cause: err && err.cause && String(err.cause.message || err.cause),
    });
  }
}
