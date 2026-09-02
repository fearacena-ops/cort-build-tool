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

function initRegnumMapIfNeeded(){
  if(regnumMap) return; // ya inicializado
  const container = document.getElementById('regnum-map');
  if(!container || typeof L === 'undefined') return;

  regnumMap = L.map('regnum-map', {
    crs: L.CRS.Simple,
    minZoom: -2,
    maxZoom: 2,
    zoomControl: true,
    attributionControl: false,
  });

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
      tile.src = `data/map-tiles/tile_${r}_${c}.jpg`;
      tile.onload = () => done(null, tile);
      tile.onerror = () => done(null, tile);
      return tile;
    }
  });
  new RegnumTiles({ tileSize: TILE_SIZE, noWrap: true, bounds, minNativeZoom:0, maxNativeZoom:0 }).addTo(regnumMap);

  regnumMarkersLayer = L.layerGroup().addTo(regnumMap);

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

// pixel del mosaico -> latLng de Leaflet (con CRS.Simple, lat=y invertido)
function pixelToLatLng(px, py){
  return regnumMap.unproject([px, MAP_PX - py], 0);
}

function buildRegnumMarkers(){
  regnumMarkersLayer.clearLayers();
  regnumAllMarkerObjs = [];
  const icons = {
    npc: L.divIcon({className:'regnum-marker regnum-marker-npc', html:'●', iconSize:[14,14]}),
    mision: L.divIcon({className:'regnum-marker regnum-marker-mision', html:'★', iconSize:[14,14]}),
  };
  const todos = [...regnumMapData.npcs, ...regnumMapData.misiones];
  todos.forEach(m=>{
    const latlng = pixelToLatLng(m.x, m.y);
    const marker = L.marker(latlng, {icon: icons[m.tipo]});
    marker.bindPopup(buildRegnumPopupHTML(m));
    m._leaflet = marker;
    regnumAllMarkerObjs.push(m);
  });
  applyRegnumFilters();
}

function buildRegnumPopupHTML(m){
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
  const tipo = document.getElementById('map-filter-tipo').value;
  const reino = document.getElementById('map-filter-reino').value;
  const prof = document.getElementById('map-filter-profesion').value;
  const nivel = document.getElementById('map-filter-nivel').value;

  regnumMarkersLayer.clearLayers();
  regnumAllMarkerObjs.forEach(m=>{
    if(tipo && m.tipo !== tipo) return;
    if(reino && m.reino !== reino) return;
    if(prof && m.profesion !== prof) return;
    if(nivel && String(m.nivel) !== nivel) return;
    m._leaflet.addTo(regnumMarkersLayer);
  });
}

function wireRegnumSearchAndFilters(){
  ['map-filter-tipo','map-filter-reino','map-filter-profesion','map-filter-nivel'].forEach(id=>{
    document.getElementById(id).addEventListener('change', applyRegnumFilters);
  });

  const input = document.getElementById('map-search');
  const results = document.getElementById('map-search-results');
  input.addEventListener('input', ()=>{
    const q = input.value.trim().toLowerCase();
    if(q.length < 2){ results.classList.remove('is-open'); results.innerHTML=''; return; }
    const matches = regnumAllMarkerObjs.filter(m=> m.nombre.toLowerCase().includes(q)).slice(0, 30);
    if(matches.length === 0){ results.classList.remove('is-open'); results.innerHTML=''; return; }
    results.innerHTML = matches.map((m,i)=>`
      <div class="map-result-item" data-idx="${regnumAllMarkerObjs.indexOf(m)}">
        <div class="mri-name">${m.tipo==='mision'?'★':'●'} ${m.nombre}</div>
        <div class="mri-meta">${m.tipo==='npc' ? (m.profesion||m.clase||'') : 'Nivel '+m.nivel+' · La da: '+m.la_da} · ${m.reino}</div>
      </div>`).join('');
    results.classList.add('is-open');
    results.querySelectorAll('.map-result-item').forEach(el=>{
      el.addEventListener('click', ()=>{
        const m = regnumAllMarkerObjs[parseInt(el.dataset.idx)];
        results.classList.remove('is-open');
        input.value = m.nombre;
        const latlng = pixelToLatLng(m.x, m.y);
        regnumMap.setView(latlng, 0);
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
