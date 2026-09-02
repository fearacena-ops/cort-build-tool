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
    maxZoom: 2,
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
    regnumMap.setMinZoom(regnumMap.getBoundsZoom(bounds, true));
    updateZoomBadge();
  }
  fitMinZoomToContainer();
  window.addEventListener('resize', ()=>{
    if(!regnumMap) return;
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
// no en píxeles de nuestros mosaicos — y encima con los ejes invertidos
// (mismo patrón que los mosaicos: lo que mueve la posición horizontal en
// el mapa es la "y" del juego, y lo que mueve la vertical es la "x").
// Ajuste lineal calculado con dos referencias conocidas (centro de
// Fisgael City y de Korsum Town, Syrtis, ubicadas a mano en los mosaicos
// 03_13 y 04_11): con esto, 1463 de 1464 NPCs/misiones caen dentro del
// mapa (el único que queda afuera es un caso de borde real del mundo).
const GAME_COORD_FIT = { a: 0.6735216548170755, b: 2630.0706401028315, c: 1.01215053331882, e: -916.0918767976746 };
function gameCoordsToPixel(gameX, gameY){
  return [
    GAME_COORD_FIT.a * gameY + GAME_COORD_FIT.b,
    GAME_COORD_FIT.c * gameX + GAME_COORD_FIT.e,
  ];
}

// pixel del mosaico -> latLng de Leaflet (con CRS.Simple, lat=y invertido)
function pixelToLatLng(gameX, gameY){
  const [px, py] = gameCoordsToPixel(gameX, gameY);
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
  const showNpc = document.getElementById('map-toggle-npc').checked;
  const showMision = document.getElementById('map-toggle-mision').checked;
  const reino = document.getElementById('map-filter-reino').value;
  const prof = document.getElementById('map-filter-profesion').value;
  const nivel = document.getElementById('map-filter-nivel').value;

  regnumMarkersLayer.clearLayers();
  regnumAllMarkerObjs.forEach(m=>{
    if(m.tipo === 'npc' && !showNpc) return;
    if(m.tipo === 'mision' && !showMision) return;
    if(reino && m.reino !== reino) return;
    if(prof && m.profesion !== prof) return;
    if(nivel && String(m.nivel) !== nivel) return;
    m._leaflet.addTo(regnumMarkersLayer);
  });
}

function wireRegnumSearchAndFilters(){
  ['map-toggle-npc','map-toggle-mision','map-filter-reino','map-filter-profesion','map-filter-nivel'].forEach(id=>{
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
