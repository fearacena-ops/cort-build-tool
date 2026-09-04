// Panel de "Estado de guerra" al costado del mapa: quién tiene las gemas,
// quién tiene cada fuerte/castillo/muralla ahora mismo, y el log de
// capturas recientes. Datos reales de CoRT (cort.ovh), traídos a través
// de /api/wz (ver ese archivo — hace falta un proxy propio porque CoRT no
// habilita CORS para otros sitios). Todo lo de acá vive aparte de map.js
// a propósito: no depende de Leaflet ni de regnumMapData, solo del mismo
// sistema de tabs.

// Mismos colores que .realm-color-syrtis/alsius/ignis en css/map.css —
// repetidos acá (no hay forma simple de compartir constantes entre estos
// dos scripts sueltos) para no depender de que map.js se haya cargado.
const WZ_REALM_COLOR = { Alsius: '#5b9cc9', Ignis: '#c9622f', Syrtis: '#7fae5a' };
const WZ_GEM_NEUTRAL = '#4a4a4a';
// gem_0.png = todavía en su reino de origen (gris, "a salvo"). gem_1/2/3
// identifican qué reino la tiene ahora — Ignis/Alsius/Syrtis en ESE orden
// fijo, no según la posición de la gema (así lo arma el propio wztools.js
// de CoRT: js/wztools/wztools.js, generate_gem(realm_colors[...])).
const WZ_GEM_HOLDER = { 'gem_0.png': null, 'gem_1.png': 'Ignis', 'gem_2.png': 'Alsius', 'gem_3.png': 'Syrtis' };
// Las 18 gemas del JSON vienen en un solo array plano: las primeras 6 son
// las de Alsius, las siguientes 6 las de Ignis, las últimas 6 las de
// Syrtis (mismo orden que los <span id="wz-gems-N"> del wz.html
// original, agrupados de a 6 por reino).
const WZ_GEM_REALMS = [
  ['Alsius', 0, 6],
  ['Ignis', 6, 12],
  ['Syrtis', 12, 18],
];

let wzPollTimer = null;

function wzRelTime(unixSeconds) {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}

function wzRenderGems(gems) {
  const box = document.getElementById('wz-gems');
  if (!box || !Array.isArray(gems)) return;
  box.innerHTML = WZ_GEM_REALMS.map(([reino, from, to]) => {
    const dots = gems.slice(from, to).map(g => {
      const holder = WZ_GEM_HOLDER[g];
      const color = holder ? WZ_REALM_COLOR[holder] : WZ_GEM_NEUTRAL;
      const titulo = holder ? `Capturada por ${holder}` : `Gema de ${reino} (a salvo)`;
      return `<span class="wz-gem-dot" style="background:${color}" title="${titulo}"></span>`;
    }).join('');
    return `<div class="wz-gems-row">
      <span class="wz-gems-label" style="color:${WZ_REALM_COLOR[reino]}">${reino}</span>
      <span class="wz-gem-dots">${dots}</span>
    </div>`;
  }).join('');
}

function wzRenderForts(forts) {
  const box = document.getElementById('wz-forts');
  if (!box || !Array.isArray(forts)) return;
  box.innerHTML = forts.map(f => {
    const color = WZ_REALM_COLOR[f.owner] || WZ_GEM_NEUTRAL;
    const capturado = f.owner !== f.location
      ? `<span class="wz-fort-captured">de ${f.location}</span>`
      : '';
    return `<div class="wz-fort" title="${f.name} — ${f.owner}${f.owner !== f.location ? ' (originalmente ' + f.location + ')' : ''}">
      <span class="wz-fort-dot" style="background:${color}"></span>
      <span class="wz-fort-name">${f.name}</span>
      ${capturado}
    </div>`;
  }).join('');
}

function wzDescribeEvent(ev) {
  if (ev.type === 'relic') {
    const de = ev.location && ev.location !== 'transit' && ev.location !== ev.owner ? ` (de ${ev.location})` : '';
    return `${ev.owner} capturó la reliquia ${ev.name}${de}`;
  }
  // type === 'fort'
  if (ev.owner === ev.location) return `${ev.owner} recuperó ${ev.name}`;
  return `${ev.owner} capturó ${ev.name} (de ${ev.location})`;
}

function wzRenderLog(events) {
  const box = document.getElementById('wz-log');
  if (!box || !Array.isArray(events)) return;
  box.innerHTML = events.slice(0, 25).map(ev => `
    <li>
      <span class="wz-log-time">${wzRelTime(ev.date)}</span>
      <span style="color:${WZ_REALM_COLOR[ev.owner] || 'inherit'}">${wzDescribeEvent(ev)}</span>
    </li>`).join('');
}

async function wzTick() {
  const errBox = document.getElementById('wz-error');
  try {
    const r = await fetch('/api/wz');
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
    if (errBox) { errBox.hidden = true; errBox.textContent = ''; }
    wzRenderGems(data.gems);
    wzRenderForts(data.forts);
    wzRenderLog(data.events_log);
    const updated = document.getElementById('wz-updated');
    if (updated && data.generated) {
      const dt = new Date(parseInt(data.generated, 10) * 1000);
      updated.textContent = dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
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
  // varias pestañas/visitantes abiertos a la vez no se le pega a cort.ovh
  // más seguido que eso en total.
  wzPollTimer = setInterval(wzTick, 60000);
}

document.addEventListener('DOMContentLoaded', () => {
  const mapTabBtn = document.querySelector('.main-tab[data-panel="panel-map"]');
  if (!mapTabBtn) return;
  mapTabBtn.addEventListener('click', () => initWzIfNeeded());
});
