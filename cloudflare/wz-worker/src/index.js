// Worker del estado de guerra de CoRT (fuertes, gemas, historial de
// eventos). Corre en Cloudflare porque es la única pata gratis de las que
// evaluamos con cron de verdad cada minuto, sin depender de que alguien
// tenga el sitio abierto (Vercel Hobby solo permite 1 cron al día) ni de
// un servicio externo de terceros para dispararlo.
//
// Dos entradas en el mismo Worker, comparten el mismo KV:
// - scheduled(): el cron. Scrapea championsofregnum.com, compara contra
//   lo último guardado, arma el historial de eventos, guarda todo de
//   nuevo en KV.
// - fetch(): HTTP simple. Devuelve tal cual lo último guardado en KV --
//   lo consulta nuestro /api/wz de Vercel (ver ese archivo), que sigue
//   siendo la URL fija que usa el frontend (js/wz.js no cambia).
//
// Alcance (a propósito, ver conversación): forts + gems + eventos de
// fuerte/gema. NO se arma relics (esta web no los muestra) ni el evento
// "pedir un deseo" (heurística más compleja del script original de CoRT,
// deja afuera de esta primera versión).

const SOURCE_URL = 'https://www.championsofregnum.com/index.php?l=1&sec=3';
const KV_KEY = 'wz_status';
const MAX_EVENTS = 100;
// Mismo resguardo que trae el script original de CoRT: si de repente
// aparecen muchos "cambios" a la vez, es más probable que sea un scrapeo
// roto (HTML cortado, reinicio del sitio oficial) que 12 capturas reales
// en el mismo minuto -- mejor no escribir nada y reintentar el próximo
// minuto que ensuciar el historial con eventos falsos.
const MAX_EVENTS_PER_RUN = 12;

const REALMS = ['Alsius', 'Ignis', 'Syrtis'];

function parseGems(html) {
  const realmBlockRe = /<div class="war-status-realm">\s*<div style="float: left;">Realm of (\w+)<\/div>\s*<div style="float: right;">([\s\S]*?)<\/div>\s*<\/div>/g;
  const porRealm = {};
  let m;
  while ((m = realmBlockRe.exec(html))) {
    const realm = m[1];
    const imgs = [...m[2].matchAll(/src="[^"]*\/(gem_\d+\.png)"/g)].map(x => x[1]);
    porRealm[realm] = imgs;
  }
  const gems = [];
  REALMS.forEach(realm => gems.push(...(porRealm[realm] || [])));
  return gems;
}

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

// Eventos de fuerte: uno por cada fuerte cuyo dueño cambió respecto de lo
// guardado la corrida anterior. En la primerísima corrida (sin estado
// previo) no se genera ningún evento -- se toma como foto inicial, no
// como 12 "capturas" que recién pasaron.
function fortEvents(forts, oldForts, timestamp) {
  if (!oldForts) return [];
  const events = [];
  forts.forEach((fort, i) => {
    const old = oldForts[i];
    if (!old || fort.owner !== old.owner) {
      events.push({ date: timestamp, name: fort.name, location: fort.location, owner: fort.owner, type: 'fort' });
    }
  });
  return events;
}

// Mismo criterio que warstatus.php: cada posición es "¿tiene ESTE reino
// (el del bloque de 6 al que pertenece) esta identidad de gema ahora?" --
// un evento se registra solo cuando pasa a tenerla (gem_0 -> algo), no
// cuando la pierde (ese lado lo cuenta el bloque del reino que la gana).
function gemEvents(gems, oldGems, timestamp) {
  if (!oldGems || oldGems.length !== 18) return [];
  const events = [];
  gems.forEach((gem, i) => {
    const old = oldGems[i];
    if (gem !== old && gem !== 'gem_0.png') {
      const gemLocationNum = parseInt(gem.replace('gem_', '').replace('.png', ''), 10);
      // El orden de "a qué reino pertenece originalmente" cada número de
      // gema en el HTML es Ignis/Alsius/Syrtis (ver $realms_gem en
      // warstatus.php) -- distinto del orden Alsius/Ignis/Syrtis que sí
      // usamos para los bloques de "quién la tiene ahora".
      const gemOwnerOriginal = ['Ignis', 'Alsius', 'Syrtis'][gemLocationNum - 1] || null;
      const gemOwner = REALMS[Math.floor(i / 6)];
      const gemNumber = (i - Math.floor(i / 6) * 6) < 3 ? '1' : '2';
      events.push({ date: timestamp, name: gemNumber, location: gemOwnerOriginal || gemOwner, owner: gemOwner, type: 'gem' });
    }
  });
  return events;
}

async function runCheck(env) {
  const upstream = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent': 'cort-build-tool/1.0 (+https://cort-build-tool.vercel.app; lee el estado de guerra directo de la pagina oficial del juego)',
    },
  });
  if (!upstream.ok) throw new Error(`${SOURCE_URL} respondió ${upstream.status}`);
  const html = await upstream.text();

  const forts = parseForts(html);
  const gems = parseGems(html);
  if (gems.length !== 18) throw new Error(`Conteo inesperado de gemas: ${gems.length} (se esperaban 18)`);

  const prevRaw = await env.WZ_KV.get(KV_KEY);
  const prev = prevRaw ? JSON.parse(prevRaw) : null;
  const timestamp = Math.floor(Date.now() / 1000);

  const newEvents = [
    ...fortEvents(forts, prev && prev.forts, timestamp),
    ...gemEvents(gems, prev && prev.gems, timestamp),
  ];

  if (newEvents.length >= MAX_EVENTS_PER_RUN) {
    // Scrapeo probablemente roto -- no escribir nada, reintentar el
    // próximo minuto con HTML (ojalá) sano de nuevo.
    throw new Error(`Demasiados cambios a la vez (${newEvents.length}), probable HTML roto -- no se guarda nada esta corrida`);
  }

  const events_log = [...newEvents, ...((prev && prev.events_log) || [])].slice(0, MAX_EVENTS);

  const status = { forts, gems, events_log, generated: timestamp };
  await env.WZ_KV.put(KV_KEY, JSON.stringify(status));
  return status;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCheck(env).catch(err => console.error('wz cron error:', err.message)));
  },

  async fetch(request, env) {
    const raw = await env.WZ_KV.get(KV_KEY);
    if (!raw) {
      return new Response(JSON.stringify({ error: 'Todavía no hay datos guardados (el cron recién va a correr)' }), {
        status: 503,
        headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    return new Response(raw, {
      status: 200,
      headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  },
};
