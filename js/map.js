// ========================================================================
// Mapa interactivo — visor con Leaflet, mosaicos propios, marcadores de
// NPCs y misiones, búsqueda y filtros.
// El mapa se inicializa recién la primera vez que se abre el tab, para no
// cargar nada de esto si la persona nunca lo visita.
// ========================================================================

let regnumMap = null;
let regnumMapData = null;
let regnumMarkersLayer = null;
let regnumAllMarkerObjs = []; // {tipo, nombre, ..., leafletMarker}

const TILE_SIZE = 1024;
const GRID = 18;
const MAP_PX = TILE_SIZE * GRID;

// El mapa fuente es cuadrado (18x18 mosaicos) — si el recuadro no lo es,
// "llenarlo entero" (sin bandas negras) y "mostrar el mundo completo" se
// contradicen. Haciendo el recuadro cuadrado se cumplen las dos cosas a la
// vez: ancho = min(ancho disponible hasta 1180px, 85% del alto de ventana).
function sizeMapSquare(){
  const frame = document.querySelector('.map-frame');
  const container = document.getElementById('regnum-map');
  if(!frame || !container) return;
  const side = Math.max(320, Math.min(frame.clientWidth, window.innerHeight * 0.85));
  container.style.height = side + 'px';
}

function initRegnumMapIfNeeded(){
  if(regnumMap) return; // ya inicializado
  const container = document.getElementById('regnum-map');
  if(!container || typeof L === 'undefined') return;
  sizeMapSquare();

  regnumMap = L.map('regnum-map', {
    crs: L.CRS.Simple,
    // Tope en 0 = resolución nativa de los mosaicos. Pasarse de ahí no
    // muestra más detalle, solo agranda (emborrona) la misma imagen.
    maxZoom: 0,
    zoomControl: true,
    attributionControl: false,
  });

  // Indicador visual del nivel de zoom — el número crudo de Leaflet (que
  // puede ser negativo y cambia de mínimo según el tamaño del recuadro) no
  // dice mucho por sí solo, así que se muestra como "escalón X de Y".
  const zoomBadge = document.getElementById('map-zoom-badge');
  function updateZoomBadge(){
    if(!zoomBadge) return;
    const step = Math.round(regnumMap.getZoom() - regnumMap.getMinZoom()) + 1;
    const total = Math.round(regnumMap.getMaxZoom() - regnumMap.getMinZoom()) + 1;
    zoomBadge.textContent = `Zoom ${step}/${total}`;
  }
  regnumMap.on('zoom', updateZoomBadge);

  // OJO: estos límites hay que expresarlos con unproject(), no en píxeles
  // crudos — con CRS.Simple la latitud queda invertida respecto al eje Y
  // de la imagen (lat = -y). Pasar [[0,0],[MAP_PX,MAP_PX]] directo describe
  // una franja que no se solapa con los mosaicos reales y Leaflet termina
  // empujando la cámara fuera del área con contenido (mapa en negro).
  const bounds = L.latLngBounds(
    regnumMap.unproject([0, MAP_PX], 0),
    regnumMap.unproject([MAP_PX, 0], 0)
  );
  regnumMap.setMaxBounds(bounds);
  // El mínimo de zoom se calcula según el tamaño real del recuadro (no un
  // número fijo) para que alejar del todo llene todo el recuadro con mapa,
  // sin bandas negras a los costados — se recalcula en cada resize por si
  // cambia el tamaño del recuadro (por ejemplo, al girar el celular).
  // getBoundsZoom(bounds, true) da el zoom mínimo con el que el mapa sigue
  // *cubriendo* todo el recuadro (en vez del zoom con el que el mapa entero
  // *entra* en el recuadro, que es lo que devuelve sin el "true" y deja
  // bandas negras cuando el recuadro no es cuadrado como el mapa). Además
  // recorta su resultado al minZoom/maxZoom que el mapa tenga en ESE
  // momento, así que hay que aflojar el mínimo antes de preguntarle, si no
  // siempre devuelve el mínimo anterior en vez del que realmente hace falta.
  function fitMinZoomToContainer(){
    regnumMap.setMinZoom(-10);
    // +0.15 de margen: el cálculo exacto a veces deja un borde de un par de
    // píxeles sin cubrir (redondeo, o la barra de scroll aparece/desaparece
    // justo después de medir) — mejor pasarse un poquito de zoom que dejar
    // una banda negra apenas perceptible en el borde.
    const fitZoom = regnumMap.getBoundsZoom(bounds, true) + 0.15;
    regnumMap.setMinZoom(Math.min(regnumMap.getMaxZoom(), fitZoom));
    updateZoomBadge();
  }
  fitMinZoomToContainer();
  window.addEventListener('resize', ()=>{
    if(!regnumMap) return;
    sizeMapSquare();
    fitMinZoomToContainer();
    regnumMap.invalidateSize();
  });
  const center = regnumMap.unproject([MAP_PX/2, MAP_PX/2], 0);
  regnumMap.setView(center, 0);

  const RegnumTiles = L.GridLayer.extend({
    createTile: function(coords, done){
      const tile = document.createElement('img');
      const r = coords.y, c = coords.x;
      if(coords.z !== 0 || r < 0 || c < 0 || r >= GRID || c >= GRID){
        // fuera de rango o en un nivel de zoom sin mosaico propio: dejar vacío,
        // Leaflet re-escala visualmente los mosaicos del zoom nativo igual.
        setTimeout(()=>done(null, tile), 0);
        return tile;
      }
      // Los archivos vienen nombrados tile_<columna>_<fila> (el número que
      // avanza verticalmente en el mapa original es el segundo), al revés
      // de r/c acá — por eso se piden invertidos.
      tile.src = `data/map-tiles/tile_${c}_${r}.jpg`;
      tile.onload = () => done(null, tile);
      tile.onerror = () => done(null, tile);
      return tile;
    }
  });
  // GridLayer trae su propio minZoom:0 por defecto (separado del minZoom
  // -dinámico- del mapa) — sin esto, al alejar el zoom por debajo de ese
  // default la capa se considera "fuera de su propio rango" y deja de pedir
  // tiles del todo (mapa en negro). -10 es solo "bien por debajo de
  // cualquier minZoom que el mapa vaya a tener nunca", no un valor real.
  new RegnumTiles({ tileSize: TILE_SIZE, noWrap: true, bounds, minNativeZoom:0, maxNativeZoom:0, minZoom:-10, maxZoom:2 }).addTo(regnumMap);

  regnumMarkersLayer = L.layerGroup().addTo(regnumMap);

  // Herramienta de referencia, oculta: agregando ?refpick=1 a la URL, un
  // click en el mapa (en un lugar vacío, no sobre un marcador) muestra el
  // mosaico exacto (con decimales) de ese punto — para afinar a mano la
  // posición de ciudades y lugares de interés sin depender de capturas.
  if(new URLSearchParams(location.search).get('refpick') === '1'){
    regnumMap.on('click', (e)=>{
      const pt = regnumMap.project(e.latlng, 0);
      const text = `col=${(pt.x/TILE_SIZE).toFixed(3)} row=${(pt.y/TILE_SIZE).toFixed(3)}`;
      L.popup().setLatLng(e.latlng)
        .setContent(`<b>Referencia</b><br><code>${text}</code><br><button type="button" id="refpick-copy" style="margin-top:6px">Copiar</button>`)
        .openOn(regnumMap);
      setTimeout(()=>{
        document.getElementById('refpick-copy')?.addEventListener('click', function(){
          navigator.clipboard?.writeText(text).catch(()=>{});
          this.textContent = 'Copiado';
        });
      }, 0);
    });
  }

  fetch('data/map-data.json')
    .then(r => r.json())
    .then(data => {
      regnumMapData = data;
      buildRegnumMarkers();
      populateRegnumFilters();
      wireRegnumSearchAndFilters();
    })
    .catch(err => console.error('No se pudo cargar el mapa de datos', err));
}

// Las coordenadas de NPCs/misiones vienen en el sistema propio del juego,
// no en píxeles de nuestros mosaicos, y la relación entre ambos no es un
// simple invertir/escalar ejes — tiene algo de inclinación (rotación leve).
// Transformación afín completa (6 parámetros), ajustada por mínimos
// cuadrados con 18 referencias reales confirmadas a mano en el juego (un
// Alquimista por ciudad, repartido entre los tres reinos — ver PR/commit
// para el detalle de cada mosaico). Error promedio ~0.23 mosaicos (~235px)
// contra esas 18 referencias; antes, con solo 3 referencias cercanas entre
// sí, algunas ciudades lejanas quedaban a más de 500px de su lugar real.
const GAME_COORD_FIT = { A: 0.0182412688, B: 1.0227340852, C: 1723.511143, D: 0.9833468293, E: 0.0031612877, F: -802.199771 };
function gameCoordsToPixel(gameX, gameY){
  return [
    GAME_COORD_FIT.A * gameX + GAME_COORD_FIT.B * gameY + GAME_COORD_FIT.C,
    GAME_COORD_FIT.D * gameX + GAME_COORD_FIT.E * gameY + GAME_COORD_FIT.F,
  ];
}

// pixel del mosaico (fila 0 = arriba, igual que los mosaicos) -> latLng de
// Leaflet. OJO: no hay que invertir la fila acá — unproject() ya hace su
// propio invertido interno (lat = -y), y es EL MISMO que usa Leaflet para
// ubicar los mosaicos (ver createTile más arriba). Invertirla de nuevo acá
// (como hacía antes: MAP_PX - py) deja a los marcadores en el espejo
// vertical de donde va cada mosaico — misma fila del lado opuesto del mapa.
function pixelToLatLng(gameX, gameY){
  const [px, py] = gameCoordsToPixel(gameX, gameY);
  return regnumMap.unproject([px, py], 0);
}

// Las ciudades/pueblos/villas no vienen de coordenadas del juego (que pasan
// por el ajuste de arriba, con su margen de error) — vienen directo del
// mosaico donde están confirmadas a mano, así que van exactas al centro de
// ese mosaico sin pasar por gameCoordsToPixel.
function tileToLatLng(col, row){
  return regnumMap.unproject([col*TILE_SIZE + TILE_SIZE/2, row*TILE_SIZE + TILE_SIZE/2], 0);
}

function buildRegnumMarkers(){
  regnumMarkersLayer.clearLayers();
  regnumAllMarkerObjs = [];
  const icons = {
    npc: L.divIcon({className:'regnum-marker regnum-marker-npc', html:'●', iconSize:[14,14]}),
    mision: L.divIcon({className:'regnum-marker regnum-marker-mision', html:'★', iconSize:[14,14]}),
    ciudad: L.divIcon({className:'regnum-marker regnum-marker-ciudad', html:'◆', iconSize:[18,18]}),
  };
  const todos = [...regnumMapData.npcs, ...regnumMapData.misiones, ...(regnumMapData.ciudades||[])];
  todos.forEach(m=>{
    const latlng = m.tipo === 'ciudad' ? tileToLatLng(m.col, m.row) : pixelToLatLng(m.x, m.y);
    const marker = L.marker(latlng, {icon: icons[m.tipo]});
    marker.bindPopup(buildRegnumPopupHTML(m));
    m._leaflet = marker;
    regnumAllMarkerObjs.push(m);
  });
  applyRegnumFilters();
}

function buildRegnumPopupHTML(m){
  if(m.tipo === 'ciudad'){
    return `<b>${m.nombre}</b><br>${m.categoria}<br>${m.reino}`;
  }
  if(m.tipo === 'npc'){
    return `<b>${m.nombre}</b><br>${m.profesion || m.clase || ''}${m.zona ? ' · '+m.zona : ''}<br>${m.reino}`;
  }
  const pasos = m.pasos ? `<br><span style="font-size:11.5px">${m.pasos}</span>` : '';
  return `<b>${m.nombre}</b><br>Nivel ${m.nivel} · La da: ${m.la_da}<br>${m.xp||0} XP · ${m.oro||0} oro${pasos}`;
}

function populateRegnumFilters(){
  const profs = new Set();
  const niveles = new Set();
  regnumMapData.npcs.forEach(n=> n.profesion && profs.add(n.profesion));
  regnumMapData.misiones.forEach(q=> q.nivel && niveles.add(q.nivel));

  const selProf = document.getElementById('map-filter-profesion');
  Array.from(profs).sort().forEach(p=>{
    const opt = document.createElement('option'); opt.value = p; opt.textContent = p;
    selProf.appendChild(opt);
  });
  const selNivel = document.getElementById('map-filter-nivel');
  Array.from(niveles).sort((a,b)=> (parseInt(a)||0)-(parseInt(b)||0)).forEach(n=>{
    const opt = document.createElement('option'); opt.value = n; opt.textContent = 'Nivel '+n;
    selNivel.appendChild(opt);
  });
}

function applyRegnumFilters(){
  const showCiudad = document.getElementById('map-toggle-ciudad').checked;
  const showNpc = document.getElementById('map-toggle-npc').checked;
  const showMision = document.getElementById('map-toggle-mision').checked;
  const reino = document.getElementById('map-filter-reino').value;
  const prof = document.getElementById('map-filter-profesion').value;
  const nivel = document.getElementById('map-filter-nivel').value;

  regnumMarkersLayer.clearLayers();
  regnumAllMarkerObjs.forEach(m=>{
    if(m.tipo === 'ciudad' && !showCiudad) return;
    if(m.tipo === 'npc' && !showNpc) return;
    if(m.tipo === 'mision' && !showMision) return;
    if(reino && m.reino !== reino) return;
    // Profesión y nivel son propios de NPCs/misiones — las ciudades no
    // tienen esos campos, así que no las toca ninguno de estos dos filtros.
    if(m.tipo !== 'ciudad'){
      if(prof && m.profesion !== prof) return;
      if(nivel && String(m.nivel) !== nivel) return;
    }
    m._leaflet.addTo(regnumMarkersLayer);
  });
}

function wireRegnumSearchAndFilters(){
  ['map-toggle-ciudad','map-toggle-npc','map-toggle-mision','map-filter-reino','map-filter-profesion','map-filter-nivel'].forEach(id=>{
    document.getElementById(id).addEventListener('change', applyRegnumFilters);
  });

  const input = document.getElementById('map-search');
  const results = document.getElementById('map-search-results');
  const iconByTipo = {mision:'★', ciudad:'◆', npc:'●'};
  input.addEventListener('input', ()=>{
    const q = input.value.trim().toLowerCase();
    if(q.length < 2){ results.classList.remove('is-open'); results.innerHTML=''; return; }
    const matches = regnumAllMarkerObjs.filter(m=> m.nombre.toLowerCase().includes(q)).slice(0, 30);
    if(matches.length === 0){ results.classList.remove('is-open'); results.innerHTML=''; return; }
    results.innerHTML = matches.map((m,i)=>`
      <div class="map-result-item" data-idx="${regnumAllMarkerObjs.indexOf(m)}">
        <div class="mri-name">${iconByTipo[m.tipo]} ${m.nombre}</div>
        <div class="mri-meta">${m.tipo==='npc' ? (m.profesion||m.clase||'') : m.tipo==='ciudad' ? m.categoria : 'Nivel '+m.nivel+' · La da: '+m.la_da} · ${m.reino}</div>
      </div>`).join('');
    results.classList.add('is-open');
    results.querySelectorAll('.map-result-item').forEach(el=>{
      el.addEventListener('click', ()=>{
        const m = regnumAllMarkerObjs[parseInt(el.dataset.idx)];
        results.classList.remove('is-open');
        input.value = m.nombre;
        regnumMap.setView(m._leaflet.getLatLng(), 0);
        if(!regnumMarkersLayer.hasLayer(m._leaflet)) m._leaflet.addTo(regnumMarkersLayer);
        m._leaflet.openPopup();
      });
    });
  });
  document.addEventListener('click', (e)=>{
    if(!e.target.closest('.map-toolbar')) results.classList.remove('is-open');
  });
}

// Enganchar con el sistema de tabs ya existente: al activar el tab del mapa,
// inicializarlo (solo la primera vez) y refrescar su tamaño (Leaflet necesita
// esto cuando el contenedor estuvo oculto con display:none al calcular tamaño).
document.addEventListener('DOMContentLoaded', ()=>{
  const mapTabBtn = document.querySelector('.main-tab[data-panel="panel-map"]');
  if(!mapTabBtn) return;
  mapTabBtn.addEventListener('click', ()=>{
    setTimeout(()=>{
      initRegnumMapIfNeeded();
      if(regnumMap) regnumMap.invalidateSize();
    }, 50);
  });
});
