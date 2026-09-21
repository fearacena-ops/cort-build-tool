// Panel de "Estado de guerra" al costado del mapa: quién tiene las gemas
// y el log de capturas recientes. Datos reales de CoRT, traídos a través
// de /api/wz (ver ese archivo — hace falta un proxy propio porque CoRT no
// habilita CORS para otros sitios). Quién tiene cada fuerte/castillo/
// muralla AHORA se ve directo en el mapa (los marcadores cambian de
// color solos, ver applyWzFortStatus en map.js) — no hace falta
// repetirlo en una lista aparte acá.
//
// Todo lo de acá vive aparte de map.js a propósito: no depende de
// Leaflet ni de regnumMapData, solo del mismo sistema de tabs (y de la
// función global applyWzFortStatus, si map.js ya se cargó, para pintar
// los marcadores del mapa con este mismo dato).

// Mismos colores que .realm-color-syrtis/alsius/ignis en css/map.css —
// repetidos acá (no hay forma simple de compartir constantes entre estos
// dos scripts sueltos) para no depender de que map.js se haya cargado.
const WZ_REALM_COLOR = { Alsius: '#5b9cc9', Ignis: '#c9622f', Syrtis: '#7fae5a' };
// Hay 6 gemas en TOTAL en el juego (no 18) -- 2 por reino, cada una con
// su propio color fijo de siempre (no cambia aunque la capture otro
// reino). El array de 18 que manda CoRT son esas mismas 6 identidades
// repetidas una vez por cada posible reino TENEDOR: values[reino*6 + i]
// dice si ESE reino tiene ahora mismo la identidad #i -- "gem_0.png" si
// no la tiene, cualquier otro valor si sí. Quién la tiene ahora se
// entera por en QUÉ BLOQUE de 6 aparece el valor no-cero, no por el
// valor en sí (el valor (1/2/3) es el reino DUEÑO ORIGINAL de esa
// identidad -- información redundante con la posición, no del tenedor
// actual; confirmado cruzando un caso real con capturas visibles en el
// juego, ver commit).
const WZ_GEM_IDENTITY = [
  { realm: 'Syrtis', variant: 0 }, // posición 0: Syrtis Gema #1 (verde oscuro)
  { realm: 'Alsius', variant: 0 }, // posición 1: Alsius Gema #1 (celeste)
  { realm: 'Ignis',  variant: 0 }, // posición 2: Ignis  Gema #1 (rojo)
  { realm: 'Alsius', variant: 1 }, // posición 3: Alsius Gema #2 (azul oscuro)
  { realm: 'Ignis',  variant: 1 }, // posición 4: Ignis  Gema #2 (amarillo)
  { realm: 'Syrtis', variant: 1 }, // posición 5: Syrtis Gema #2 (verde claro)
];
// Íconos de gema reales (no puntos de color) — data/icons/gem-*.png. Dos
// por reino, uno por cada identidad fija de WZ_GEM_IDENTITY (variant
// 0/1) -- ya NO se alternan por orden de aparición, cada identidad
// siempre usa el mismo ícono venga de donde venga.
const WZ_GEM_ICON = {
  none: ['data/icons/gem-none.png'],
  Ignis: ['data/icons/gem-ignis-1.png', 'data/icons/gem-ignis-2.png'],
  Alsius: ['data/icons/gem-alsius-1.png', 'data/icons/gem-alsius-2.png'],
  Syrtis: ['data/icons/gem-syrtis-1.png', 'data/icons/gem-syrtis-2.png'],
};
// Las 18 gemas del JSON vienen en un solo array plano: las primeras 6
// dicen qué tiene Alsius (de las 6 identidades de WZ_GEM_IDENTITY), las
// siguientes 6 qué tiene Ignis, las últimas 6 qué tiene Syrtis.
const WZ_GEM_REALMS = [
  ['Alsius', 0, 6],
  ['Ignis', 6, 12],
  ['Syrtis', 12, 18],
];
// Nombre de CoRT (como viene en forts[].name, con el número entre
// paréntesis) -> nuestro propio nombre en español (data/map-data.json),
// para pintar los marcadores del mapa real con el dueño actual sin dejar
// de mostrar el nombre en español de siempre. Lista fija de 12 — no hay
// necesidad de "adivinar" el emparejamiento con texto suelto.
const WZ_FORT_NAME_MAP = {
  'Imperia Castle (1)': 'Castillo Imperia',
  'Fort Aggersborg (2)': 'Fuerte Aggersborg',
  'Fort Trelleborg (3)': 'Fuerte Trelleborg',
  'Great Wall of Alsius (4)': 'Gran muralla de Alsius',
  'Fort Menirah (5)': 'Fuerte Menirah',
  'Fort Samal (6)': 'Fuerte Samal',
  'Shaanarid Castle (7)': 'Castillo Shaanarid',
  'Great Wall of Ignis (8)': 'Gran muralla de Ignis',
  'Fort Algaros (9)': 'Fuerte Algaros',
  'Fort Herbred (10)': 'Fuerte Herbred',
  'Eferias Castle (11)': 'Castillo Eferias',
  'Great Wall of Syrtis (12)': 'Gran muralla de Syrtis',
};

let wzPollTimer = null;

// dd/MM/aa hh:mm, en la hora local de quien mira la página (Date ya
// convierte el timestamp UTC de CoRT a la zona horaria del navegador
// solo) y 24 horas a propósito, sin AM/PM. Formato fijo armado a mano en
// vez de toLocaleString: ese depende del idioma del navegador y no
// garantiza este orden día/mes/año en particular.
function wzFormatDateTime(unixSeconds) {
  const dt = new Date(unixSeconds * 1000);
  const pad = n => String(n).padStart(2, '0');
  const dd = pad(dt.getDate());
  const mm = pad(dt.getMonth() + 1);
  const aa = pad(dt.getFullYear() % 100);
  const hh = pad(dt.getHours());
  const mi = pad(dt.getMinutes());
  return `${dd}/${mm}/${aa} ${hh}:${mi}`;
}

function wzRelTime(unixSeconds) {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}

// El nombre de CoRT trae siempre un número entre paréntesis al final
// ("Fort Aggersborg (2)") que identifica el fuerte puertas adentro de su
// sistema, pero no aporta nada acá — se saca para mostrar.
function wzCleanName(name) {
  return (name || '').replace(/\s*\(\d+\)\s*$/, '');
}

// "el Fuerte X" / "el Castillo X" pero "la Gran muralla de X" -- el único
// caso femenino entre los 12 nombres de WZ_FORT_NAME_MAP.
function wzArticulo(nombreEs) {
  return nombreEs.startsWith('Gran muralla') ? 'la' : 'el';
}
// Nombre de fuerte/castillo/muralla, ya en español y con su artículo (ver
// WZ_FORT_NAME_MAP, arriba — el mismo diccionario que ya se usa para
// pintar los marcadores del mapa). Si no está en el diccionario (no
// debería pasar con los 12 fijos que manda CoRT) se cae al nombre en
// inglés tal cual, sin partir nada.
function wzNombreFuerteConArticulo(nombreCrudo) {
  const nombreEs = WZ_FORT_NAME_MAP[nombreCrudo];
  if (!nombreEs) return wzCleanName(nombreCrudo);
  return `${wzArticulo(nombreEs)} ${nombreEs}`;
}
// Para las 3 "Gran muralla de X": si el reino que aparece como sujeto de
// la frase (quien la recupera) es ESE MISMO X, mencionarlo de nuevo en el
// nombre es puro repetir lo mismo dos veces ("Alsius ha recuperado la
// Gran muralla de Alsius") -- se acorta a solo "la Gran muralla". Si en
// cambio la recupera OTRO reino (le tocó de rebote a un tercero antes de
// volver a caer en quien la tiene ahora), el nombre completo sigue
// haciendo falta para saber cuál muralla es, y se deja tal cual.
function wzNombreSinReinoPropio(nombre, reino) {
  const sufijo = ` de ${reino}`;
  return nombre.endsWith(sufijo) ? nombre.slice(0, -sufijo.length) : nombre;
}

function wzRenderGems(gems) {
  const box = document.getElementById('wz-gems');
  if (!box || !Array.isArray(gems)) return;
  box.innerHTML = WZ_GEM_REALMS.map(([reino, from, to]) => {
    const dots = gems.slice(from, to).map((g, i) => {
      // Tiene esta identidad ESTA fila (reino) ahora mismo, sí o no --
      // el valor de "g" (gem_0/1/2/3) más allá de "es gem_0 o no" no se
      // usa acá, ver el comentario grande de WZ_GEM_IDENTITY más arriba.
      const tenida = g !== 'gem_0.png';
      const identidad = WZ_GEM_IDENTITY[i];
      const icon = tenida ? WZ_GEM_ICON[identidad.realm][identidad.variant] : WZ_GEM_ICON.none[0];
      // Si el DUEÑO ORIGINAL de esta identidad es el MISMO reino de la
      // fila, no es que la tenga un enemigo -- es una gema que
      // capturaron y ya recuperó su propio reino (vuelve a su color de
      // siempre, pero CoRT la distingue igual de una que nunca se
      // tocó). Decir "Capturada por Ignis" para una gema DE Ignis que
      // ya está de vuelta en casa sonaba a que seguía en poder de un
      // enemigo.
      const titulo = !tenida ? `Gema de ${identidad.realm} (a salvo)`
        : identidad.realm === reino ? `Gema de ${identidad.realm} (recuperada)`
        : `Gema de ${identidad.realm}, capturada por ${reino}`;
      return `<img class="wz-gem-icon" src="${icon}" alt="${titulo}" title="${titulo}">`;
    }).join('');
    return `<div class="wz-gems-row">
      <span class="wz-gems-label" style="color:${WZ_REALM_COLOR[reino]}">${reino}</span>
      <span class="wz-gem-dots">${dots}</span>
    </div>`;
  }).join('');
}

function wzDescribeEvent(ev) {
  if (ev.type === 'wish') {
    // Cuando un reino junta sus 6 gemas puede "pedir un deseo", lo que
    // resetea las gemas a su posición original -- no es una captura, así
    // que no tiene name/owner como los demás, el reino que pidió el deseo
    // viene en location (ver el ejemplo usado para probar esto).
    return `${ev.location} pidió un deseo`;
  }
  if (ev.type === 'relic') {
    const nombre = wzCleanName(ev.name);
    if (ev.location === 'altar') {
      // Vuelve sola al altar de SU reino (ev.owner acá es justamente eso
      // -- a quién pertenece ese altar, no quién la "capturó").
      return `Reliquia de ${nombre} ha regresado a ${ev.owner}`;
    }
    // 'transit' (recién capturada, todavía no llegó a destino) no aporta
    // nada como ubicación -- se omite. Cualquier otro valor (un reino) sí
    // se muestra, para el caso de que se la saquen a otro reino directo.
    const de = ev.location && ev.location !== 'transit' && ev.location !== ev.owner ? ` (de ${ev.location})` : '';
    return `${ev.owner} capturó la reliquia de ${nombre}${de}`;
  }
  if (ev.type === 'gem') {
    // "name" es el número de la gema dentro de su reino (1, 2...) -- a
    // pedido, se muestra (antes se descartaba). Vale para los 3 reinos
    // igual, no es un caso especial de ninguno.
    const gema = `Gema #${ev.name}`;
    if (ev.owner === ev.location) return `${ev.owner} recuperó la ${gema}`;
    return `${ev.owner} capturó la ${gema} de ${ev.location}`;
  }
  // type === 'fort' (y cualquier otro tipo no contemplado, para no
  // dejarlo sin texto — mejor una descripción genérica que una vacía).
  // El nombre siempre en español y con artículo -- ver WZ_FORT_NAME_MAP y
  // wzNombreFuerteConArticulo más arriba (mismo diccionario que ya
  // recolorea los marcadores del mapa).
  const nombre = wzNombreFuerteConArticulo(ev.name);
  if (ev.owner === ev.location) {
    return `${ev.owner} ha recuperado ${wzNombreSinReinoPropio(nombre, ev.owner)}`;
  }
  // Las 3 "Gran muralla de X" ya llevan el reino en su propio nombre --
  // agregar "(de X)" ahí es puro repetir lo mismo dos veces (ej. "la Gran
  // muralla de Alsius (de Alsius)"). Se omite SOLO cuando de verdad
  // coincide con el nombre propio -- si algún día una de estas murallas
  // se recaptura de un tercer reino (no el de su nombre), "(de Y)" sigue
  // aportando algo real y se muestra igual.
  const deEsRedundante = ev.location && nombre.endsWith(ev.location);
  if (ev.owner) return `${ev.owner} capturó ${nombre}${deEsRedundante ? '' : ` (de ${ev.location})`}`;
  return `${nombre || ev.location || 'Evento'}`;
}

// A qué reino corresponde colorear cada línea del log -- normalmente el
// que hizo la captura (owner), pero "wish" no tiene owner (no es una
// captura), ahí el reino relevante viene en location (ver wzDescribeEvent).
function wzEventRealm(ev) {
  return ev.type === 'wish' ? ev.location : ev.owner;
}

function wzRenderLog(events) {
  const box = document.getElementById('wz-log');
  if (!box || !Array.isArray(events)) return;
  box.innerHTML = events.slice(0, 25).map(ev => `
    <li>
      <span class="wz-log-time">${wzFormatDateTime(ev.date)} · ${wzRelTime(ev.date)}</span>
      <span style="color:${WZ_REALM_COLOR[wzEventRealm(ev)] || 'inherit'}">${wzDescribeEvent(ev)}</span>
    </li>`).join('');
}

async function wzTick() {
  const errBox = document.getElementById('wz-error');
  try {
    // cache:'no-store' para que el navegador nunca reuse una respuesta
    // vieja por su cuenta — el Cache-Control de /api/wz (s-maxage) es
    // para el borde de Vercel (no pegarle a la fuente más de una vez por
    // minuto), no para el caché propio del navegador; sin esto, algunos
    // navegadores guardaban la respuesta y el panel quedaba pegado en el
    // primer dato que había traído, sin actualizarse más.
    const r = await fetch('/api/wz', { cache: 'no-store' });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
    if (errBox) { errBox.hidden = true; errBox.textContent = ''; }
    wzRenderGems(data.gems);
    wzRenderLog(data.events_log);
    // Pinta los marcadores de Fuerte/Castillo/Muralla en el mapa real
    // con el dueño actual — función expuesta por map.js; si ese script
    // todavía no corrió (o el usuario nunca abrió el mapa), no existe
    // todavía y no pasa nada.
    if (typeof applyWzFortStatus === 'function') applyWzFortStatus(data.forts);
    const updated = document.getElementById('wz-updated');
    if (updated && data.generated) updated.textContent = wzFormatDateTime(parseInt(data.generated, 10));
  } catch (err) {
    // No se limpia lo ya mostrado — mejor dejar el último dato bueno que
    // se tenía (con un aviso) que vaciar todo el panel por un fallo
    // pasajero de red.
    if (errBox) {
      errBox.hidden = false;
      errBox.textContent = 'No se pudo actualizar el estado de guerra (reintenta en un minuto).';
    }
  }
}

function initWzIfNeeded() {
  if (wzPollTimer) return; // ya arrancado
  wzTick();
  // Mismo ritmo que usa CoRT para consultarse a sí mismo (una vez por
  // minuto) — /api/wz además cachea 60s de su lado, así que aunque haya
  // varias pestañas/visitantes abiertos a la vez no se le pega a la
  // fuente más seguido que eso en total.
  wzPollTimer = setInterval(wzTick, 60000);
}

// Sin DOMContentLoaded a propósito -- mismo motivo que en map.js (wz.js
// también es "defer", el documento ya está listo cuando esto corre) y
// mismo chequeo de respaldo: si la pestaña del mapa ya quedó activa
// mientras este script todavía bajaba (internet lento + restoreLastTab
// disparando su click sintético antes de tiempo), se auto-inicializa acá
// igual, sin depender de haber enganchado el click a tiempo.
const wzMapTabBtn = document.querySelector('.main-tab[data-panel="panel-map"]');
if (wzMapTabBtn) {
  wzMapTabBtn.addEventListener('click', () => initWzIfNeeded());
  if (document.getElementById('panel-map')?.classList.contains('active')) {
    initWzIfNeeded();
  }
}
