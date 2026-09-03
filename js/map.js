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

// Modo edición (?editmode=1): arrastrar cualquier marcador para moverlo,
// editar sus campos o borrarlo, y exportar todos los cambios de la sesión
// como un bloque de texto para pasar y aplicar. Como el sitio es estático
// (sin base de datos), nada de esto se guarda solo — por eso además de
// acumularse en memoria se van guardando en localStorage (para no perder
// el trabajo si se recarga la página sin haber exportado todavía) y hay
// que exportar y mandar los cambios a mano al terminar.
const EDIT_MODE = new URLSearchParams(location.search).get('editmode') === '1';
const EDIT_STORAGE_KEY = 'cort-map-edits';
let mapEdits = {};
if(EDIT_MODE){
  try { mapEdits = JSON.parse(localStorage.getItem(EDIT_STORAGE_KEY) || '{}'); } catch(e){ mapEdits = {}; }
}
function saveMapEdits(){
  try { localStorage.setItem(EDIT_STORAGE_KEY, JSON.stringify(mapEdits)); } catch(e){}
}
// Clave estable por marcador: nombre no siempre alcanza solo (podría
// repetirse), así que se suma zona/categoría/dador de misión como
// desempate. No depende de la posición en el array, así que sigue
// funcionando aunque se reordene o se agreguen/saquen otros registros.
function markerKey(m){
  const extra = m.tipo === 'npc' ? (m.zona||'') : m.tipo === 'ciudad' ? (m.categoria||'') : (m.la_da||'');
  return `${m.tipo}|${m.nombre}|${extra}`;
}

// Selección múltiple (modo edición): con el modo activo, click en un
// marcador lo selecciona/deselecciona en vez de abrir su popup. Arrastrar
// cualquier marcador que forme parte de una selección de 2 o más mueve a
// todos juntos, manteniendo la posición relativa entre ellos.
let selectionMode = false;
let selectedKeys = new Set();
let markersByKey = {};
function latLngToPoint(latlng){ return regnumMap.project(latlng, 0); }
function pointToLatLng(pt){ return regnumMap.unproject([pt.x, pt.y], 0); }

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

// Las ciudades/lugares no vienen de coordenadas del juego (que pasan por el
// ajuste de arriba, con su margen de error) — vienen directo de un click
// exacto sobre el mosaico correcto (herramienta ?refpick=1), en fracciones
// de mosaico con decimales — no un número de mosaico entero que haya que
// centrar, por eso NO se suma TILE_SIZE/2 acá.
function tileToLatLng(col, row){
  return regnumMap.unproject([col*TILE_SIZE, row*TILE_SIZE], 0);
}

const REALM_SLUG = {Syrtis:'syrtis', Alsius:'alsius', Ignis:'ignis'};
// Ciudad/Pueblo/Villa/Puerto comparten el ícono de casa, sin color de reino
// (ya se distinguen por reino con el filtro y el popup). Muralla/Fuerte/
// Castillo sí llevan color de reino, para reconocerlos de un vistazo.
const PLACE_SHAPE = {Ciudad:'ciudad', Pueblo:'ciudad', Villa:'ciudad', Puerto:'ciudad', Muralla:'muralla', Fuerte:'fuerte', Castillo:'castillo'};
const PLACE_GLYPH = {ciudad:'⌂', muralla:'▬', fuerte:'♜', castillo:'♜'};

function iconFor(m){
  if(m.tipo === 'mision') return L.divIcon({className:'regnum-marker regnum-marker-mision', html:'!', iconSize:[10,14]});
  if(m.tipo === 'npc') return L.divIcon({className:`regnum-marker regnum-marker-npc realm-color-${REALM_SLUG[m.reino]||'syrtis'}`, html:'●', iconSize:[14,14]});
  // ciudad/lugar: la forma sale de la categoría (Ciudad/Fuerte/Castillo/...)
  const shape = PLACE_SHAPE[m.categoria] || 'ciudad';
  const size = shape === 'castillo' ? 22 : shape === 'fuerte' ? 16 : shape === 'muralla' ? 15 : 17;
  const cls = shape === 'ciudad'
    ? 'regnum-marker regnum-marker-ciudad'
    : `regnum-marker regnum-marker-${shape} realm-color-${REALM_SLUG[m.reino]||'syrtis'}`;
  return L.divIcon({className:cls, html:PLACE_GLYPH[shape], iconSize:[size,size]});
}

function buildRegnumMarkers(){
  regnumMarkersLayer.clearLayers();
  regnumAllMarkerObjs = [];
  const todos = [...regnumMapData.npcs, ...regnumMapData.misiones, ...(regnumMapData.ciudades||[])];
  todos.forEach(m=>{
    // La clave hay que calcularla ANTES de aplicar ediciones guardadas (si
    // ya se renombró en una sesión anterior, recalcularla ahora daría una
    // clave distinta y se perdería el vínculo con lo guardado) — por eso
    // se cachea en m.__key y de ahí en más siempre se usa esa, nunca se
    // vuelve a calcular con markerKey().
    const key = markerKey(m);
    const edit = mapEdits[key];
    if(edit && edit.deleted) return; // no se agrega al mapa ni a la lista
    if(edit && edit.fields) Object.assign(m, edit.fields);
    m.__key = key;

    const latlng = edit && edit.move
      ? tileToLatLng(edit.move.col, edit.move.row)
      : m.tipo === 'ciudad' ? tileToLatLng(m.col, m.row) : pixelToLatLng(m.x, m.y);
    const marker = L.marker(latlng, {icon: iconFor(m), draggable: EDIT_MODE});
    if(EDIT_MODE){
      marker.bindPopup(buildEditPopupHTML(m));
      markersByKey[key] = {marker, m};
      wireEditMarker(marker, m);
    } else {
      marker.bindPopup(buildRegnumPopupHTML(m));
    }
    m._leaflet = marker;
    regnumAllMarkerObjs.push(m);
  });
  applyRegnumFilters();
  if(EDIT_MODE) setupEditModeUI();
}

function editableFieldsFor(m){
  if(m.tipo === 'npc') return [['nombre','Nombre'], ['profesion','Profesión'], ['zona','Zona'], ['reino','Reino']];
  if(m.tipo === 'ciudad') return [['nombre','Nombre'], ['categoria','Categoría'], ['reino','Reino']];
  return [['nombre','Nombre'], ['nivel','Nivel'], ['la_da','La da'], ['xp','XP'], ['oro','Oro']];
}

function buildEditPopupHTML(m){
  const pendiente = mapEdits[m.__key] && (mapEdits[m.__key].move || mapEdits[m.__key].fields) ? ' <span style="color:var(--bronze)">● sin exportar</span>' : '';
  const inputs = editableFieldsFor(m).map(([f,label])=>
    `<label style="display:block;margin-top:5px;font-size:11px;color:var(--ink-faint)">${label}<br>
      <input type="text" data-field="${f}" value="${String(m[f]==null?'':m[f]).replace(/"/g,'&quot;')}" style="width:100%;box-sizing:border-box;"></label>`
  ).join('');
  return `<div class="edit-popup">
    <b>Editar${pendiente}</b>
    ${inputs}
    <div style="margin-top:8px;display:flex;gap:6px;">
      <button type="button" class="ep-save">Guardar</button>
      <button type="button" class="ep-delete" style="color:#c0392b">Eliminar</button>
    </div>
  </div>`;
}

// Vuelve a armar el contenido del popup (por si cambió algo) y engancha los
// botones — hay que llamarla cada vez que el contenido se reemplaza, porque
// setPopupContent() tira los botones/listeners viejos.
function refreshEditPopup(marker, m){
  marker.setPopupContent(buildEditPopupHTML(m));
  const root = marker.getPopup()?.getElement();
  if(!root) return;
  root.querySelector('.ep-save')?.addEventListener('click', ()=>{
    const fields = {};
    root.querySelectorAll('input[data-field]').forEach(inp=>{ fields[inp.dataset.field] = inp.value; });
    Object.assign(m, fields);
    mapEdits[m.__key] = Object.assign({}, mapEdits[m.__key], {fields});
    saveMapEdits();
    refreshEditPopup(marker, m);
  });
  root.querySelector('.ep-delete')?.addEventListener('click', ()=>{
    if(!confirm(`¿Eliminar "${m.nombre}"? Se puede deshacer volviendo a exportar sin este cambio.`)) return;
    mapEdits[m.__key] = Object.assign({}, mapEdits[m.__key], {deleted:true});
    saveMapEdits();
    regnumMarkersLayer.removeLayer(marker);
    regnumAllMarkerObjs = regnumAllMarkerObjs.filter(x=> x !== m);
    delete markersByKey[m.__key];
    selectedKeys.delete(m.__key);
    updateSelectionUI();
  });
}

function saveMarkerPosition(marker, m){
  const pt = latLngToPoint(marker.getLatLng());
  const move = {col: +(pt.x/TILE_SIZE).toFixed(3), row: +(pt.y/TILE_SIZE).toFixed(3)};
  mapEdits[m.__key] = Object.assign({}, mapEdits[m.__key], {move});
  saveMapEdits();
}

function setMarkerSelected(marker, key, on){
  if(on) selectedKeys.add(key); else selectedKeys.delete(key);
  marker._icon?.classList.toggle('regnum-marker-selected', on);
}

function updateSelectionUI(){
  const counter = document.getElementById('map-edit-selcount');
  if(counter) counter.textContent = selectedKeys.size ? `${selectedKeys.size} seleccionados` : '';
}

// Al arrastrar, guarda la nueva posición (siempre en mosaico col/row, igual
// que la herramienta ?refpick=1). Si el marcador arrastrado forma parte de
// una selección de 2+ (modo selección múltiple), mueve a todos los
// seleccionados juntos, manteniendo la posición relativa entre ellos.
function wireEditMarker(marker, m){
  marker.on('popupopen', ()=>{
    if(selectionMode){
      marker.closePopup();
      setMarkerSelected(marker, m.__key, !selectedKeys.has(m.__key));
      updateSelectionUI();
      return;
    }
    refreshEditPopup(marker, m);
  });

  let groupOrigin = null; // {anchor: LatLng, others: {key: LatLng}}
  marker.on('dragstart', ()=>{
    groupOrigin = null;
    if(selectedKeys.has(m.__key) && selectedKeys.size >= 2){
      groupOrigin = {anchor: marker.getLatLng(), others: {}};
      selectedKeys.forEach(k=>{
        if(k === m.__key) return;
        const other = markersByKey[k];
        if(other) groupOrigin.others[k] = other.marker.getLatLng();
      });
    }
  });
  marker.on('drag', ()=>{
    if(!groupOrigin) return;
    const p1 = latLngToPoint(groupOrigin.anchor);
    const p2 = latLngToPoint(marker.getLatLng());
    const delta = {x: p2.x-p1.x, y: p2.y-p1.y};
    Object.entries(groupOrigin.others).forEach(([k, startLatLng])=>{
      const other = markersByKey[k];
      if(!other) return;
      const sp = latLngToPoint(startLatLng);
      other.marker.setLatLng(pointToLatLng({x: sp.x+delta.x, y: sp.y+delta.y}));
    });
  });
  marker.on('dragend', ()=>{
    saveMarkerPosition(marker, m);
    if(groupOrigin){
      Object.keys(groupOrigin.others).forEach(k=>{
        const other = markersByKey[k];
        if(other) saveMarkerPosition(other.marker, other.m);
      });
      groupOrigin = null;
    }
    if(marker.isPopupOpen()) refreshEditPopup(marker, m);
  });
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

// Arma un resumen legible de todos los cambios acumulados en esta sesión
// (movidos/editados/borrados), identificando cada uno por su clave estable
// (tipo|nombre original|zona-categoría-dador) para poder encontrarlo en los
// datos aunque se le haya cambiado el nombre.
function exportMapEdits(){
  const entries = Object.entries(mapEdits).filter(([,e])=> e.move || e.fields || e.deleted);
  const out = {generado: new Date().toISOString(), cambios: entries.length, detalle: entries.map(([key,e])=>{
    const rec = {clave: key};
    if(e.deleted) rec.accion = 'eliminar';
    else {
      rec.accion = 'actualizar';
      if(e.move) rec.nuevaPosicion = e.move;
      if(e.fields) rec.camposNuevos = e.fields;
    }
    return rec;
  })};
  return JSON.stringify(out, null, 1);
}

function setupEditModeUI(){
  if(document.getElementById('map-edit-toolbar')) return; // ya armada
  const frame = document.querySelector('.map-frame');
  if(!frame) return;
  const bar = document.createElement('div');
  bar.id = 'map-edit-toolbar';
  // left:54px para no pisar los botones +/- de zoom, que viven en esa misma
  // esquina; flex-wrap para que no se corte en recuadros angostos.
  bar.style.cssText = 'position:absolute;left:54px;top:10px;right:10px;z-index:600;display:flex;flex-wrap:wrap;gap:8px;align-items:center;';
  bar.innerHTML = `
    <span style="background:rgba(10,14,20,.82);border:1px solid var(--line);border-radius:14px;padding:5px 12px;font-family:var(--font-mono);font-size:11px;color:var(--bronze);">✎ Modo edición — arrastrá para mover, click para editar/borrar</span>
    <button type="button" id="map-edit-multi" class="mini-btn">Selección múltiple</button>
    <button type="button" id="map-edit-clearsel" class="mini-btn" style="display:none">Deseleccionar todo</button>
    <span id="map-edit-selcount" style="font-family:var(--font-mono);font-size:11px;color:var(--ink-faint);"></span>
    <button type="button" id="map-edit-export" class="mini-btn">Exportar cambios</button>
  `;
  frame.appendChild(bar);

  const multiBtn = document.getElementById('map-edit-multi');
  const clearBtn = document.getElementById('map-edit-clearsel');
  multiBtn.addEventListener('click', ()=>{
    selectionMode = !selectionMode;
    multiBtn.textContent = selectionMode ? 'Selección múltiple (activa)' : 'Selección múltiple';
    multiBtn.classList.toggle('active', selectionMode);
    clearBtn.style.display = selectionMode ? '' : 'none';
    if(!selectionMode){
      // salir del modo no borra la selección, por si se vuelve a entrar,
      // pero conviene despejar el resaltado visual mientras tanto
    }
  });
  clearBtn.addEventListener('click', ()=>{
    selectedKeys.forEach(k=>{
      const other = markersByKey[k];
      other?.marker._icon?.classList.remove('regnum-marker-selected');
    });
    selectedKeys.clear();
    updateSelectionUI();
  });

  document.getElementById('map-edit-export').addEventListener('click', ()=>{
    const json = exportMapEdits();
    const box = document.createElement('textarea');
    box.value = json;
    box.readOnly = true;
    box.style.cssText = 'position:fixed;inset:8vh 10vw;z-index:9999;background:var(--bg-1);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:14px;font-family:var(--font-mono);font-size:12px;';
    document.body.appendChild(box);
    box.focus();
    box.select();
    navigator.clipboard?.writeText(json).catch(()=>{});
    const closeHint = document.createElement('div');
    closeHint.textContent = 'Copiado al portapapeles. Click afuera del cuadro para cerrar.';
    closeHint.style.cssText = 'position:fixed;left:10vw;top:calc(8vh - 26px);z-index:9999;color:var(--bronze);font-size:12px;';
    document.body.appendChild(closeHint);
    const close = (e)=>{
      if(e.target === box) return;
      box.remove(); closeHint.remove();
      document.removeEventListener('click', close);
    };
    setTimeout(()=> document.addEventListener('click', close), 0);
  });
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
  function searchGlyph(m){
    if(m.tipo === 'mision') return '!';
    if(m.tipo === 'npc') return '●';
    return PLACE_GLYPH[PLACE_SHAPE[m.categoria] || 'ciudad'];
  }
  input.addEventListener('input', ()=>{
    const q = input.value.trim().toLowerCase();
    if(q.length < 2){ results.classList.remove('is-open'); results.innerHTML=''; return; }
    const matches = regnumAllMarkerObjs.filter(m=> m.nombre.toLowerCase().includes(q)).slice(0, 30);
    if(matches.length === 0){ results.classList.remove('is-open'); results.innerHTML=''; return; }
    results.innerHTML = matches.map((m,i)=>`
      <div class="map-result-item" data-idx="${regnumAllMarkerObjs.indexOf(m)}">
        <div class="mri-name">${searchGlyph(m)} ${m.nombre}</div>
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
