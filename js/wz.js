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
// gem_0.png = todavía en su reino de origen (gris, "a salvo"). gem_1/2/3
// identifican qué reino la tiene ahora — Ignis/Alsius/Syrtis en ESE orden
// fijo, no según la posición de la gema (así lo arma el propio wztools.js
// de CoRT: js/wztools/wztools.js, generate_gem(realm_colors[...])).
const WZ_GEM_HOLDER = { 'gem_0.png': null, 'gem_1.png': 'Ignis', 'gem_2.png': 'Alsius', 'gem_3.png': 'Syrtis' };
// Íconos de gema reales (no puntos de color) — data/icons/gem-*.png. Dos
// variantes por reino (se alternan según la posición de cada gema en su
// fila de 6, solo para que no queden seis copias idénticas en línea).
const WZ_GEM_ICON = {
  none: ['data/icons/gem-none.png'],
  Ignis: ['data/icons/gem-ignis-1.png', 'data/icons/gem-ignis-2.png'],
  Alsius: ['data/icons/gem-alsius-1.png', 'data/icons/gem-alsius-2.png'],
  Syrtis: ['data/icons/gem-syrtis-1.png', 'data/icons/gem-syrtis-2.png'],
};
// Las 18 gemas del JSON vienen en un solo array plano: las primeras 6 son
// las de Alsius, las siguientes 6 las de Ignis, las últimas 6 las de
// Syrtis (mismo orden que los <span id="wz-gems-N"> del wz.html
// original, agrupados de a 6 por reino).
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

function wzRenderGems(gems) {
  const box = document.getElementById('wz-gems');
  if (!box || !Array.isArray(gems)) return;
  box.innerHTML = WZ_GEM_REALMS.map(([reino, from, to]) => {
    // La variante (1/2) alterna según el ORDEN en que aparece cada gema
    // de un mismo dueño, de izquierda a derecha — no según su posición
    // absoluta en la fila de 6. Con la posición absoluta, las dos gemas
    // capturadas de un reino podían caer las dos en índice par (o las
    // dos en impar) y terminaban mostrando la misma variante, en vez de
    // alternar como se ve en el juego.
    const ocurrencias = {};
    const dots = gems.slice(from, to).map(g => {
      const holder = WZ_GEM_HOLDER[g];
      const clave = holder || 'none';
      const ocurrencia = ocurrencias[clave] || 0;
      ocurrencias[clave] = ocurrencia + 1;
      const iconos = WZ_GEM_ICON[clave];
      const icon = iconos[ocurrencia % iconos.length];
      const titulo = holder ? `Capturada por ${holder}` : `Gema de ${reino} (a salvo)`;
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
      // Vuelve sola a su altar de origen (se resetea) -- no es una
      // captura de nadie, por eso no se menciona a ev.owner acá (ver
      // también wzEventRealm, más abajo, para el color de la línea).
      return `Reliquia de ${nombre} ha regresado`;
    }
    // 'transit' (recién capturada, todavía no llegó a destino) no aporta
    // nada como ubicación -- se omite. Cualquier otro valor (un reino) sí
    // se muestra, para el caso de que se la saquen a otro reino directo.
    const de = ev.location && ev.location !== 'transit' && ev.location !== ev.owner ? ` (de ${ev.location})` : '';
    return `${ev.owner} capturó la reliquia de ${nombre}${de}`;
  }
  if (ev.type === 'gem') {
    // acá "name" es el número de la gema dentro de su reino (1, 2...),
    // no un nombre propio — no vale la pena mostrarlo, alcanza con de
    // qué reino era y quién la tiene ahora.
    if (ev.owner === ev.location) return `${ev.owner} recuperó una gema`;
    return `${ev.owner} capturó una gema de ${ev.location}`;
  }
  // type === 'fort' (y cualquier otro tipo no contemplado, para no
  // dejarlo sin texto — mejor una descripción genérica que una vacía).
  // El nombre siempre en español y con artículo -- ver WZ_FORT_NAME_MAP y
  // wzNombreFuerteConArticulo más arriba (mismo diccionario que ya
  // recolorea los marcadores del mapa).
  const nombre = wzNombreFuerteConArticulo(ev.name);
  if (ev.owner === ev.location) return `${ev.owner} recuperó ${nombre}`;
  if (ev.owner) return `${ev.owner} capturó ${nombre} (de ${ev.location})`;
  return `${nombre || ev.location || 'Evento'}`;
}

// A qué reino corresponde colorear cada línea del log -- normalmente el
// que hizo la captura (owner), pero "wish" no tiene owner (no es una
// captura), ahí el reino relevante viene en location (ver wzDescribeEvent).
// La reliquia que "ha regresado" a su altar tampoco es de nadie -- ningún
// reino en particular, así que sin color (se cae a 'inherit').
function wzEventRealm(ev) {
  if (ev.type === 'relic' && ev.location === 'altar') return null;
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

document.addEventListener('DOMContentLoaded', () => {
  const mapTabBtn = document.querySelector('.main-tab[data-panel="panel-map"]');
  if (!mapTabBtn) return;
  mapTabBtn.addEventListener('click', () => initWzIfNeeded());
});
