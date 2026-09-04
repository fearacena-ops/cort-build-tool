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
// Zonas (áreas de mobs/materiales, ver buildRegnumZones): capa aparte de
// regnumMarkersLayer porque son polígonos, no marcadores puntuales — el
// resto de la lógica de click/arrastre/selección de modo edición no les
// aplica, así que conviene no mezclarlas con regnumAllMarkerObjs.
let regnumZonesLayer = null;
let regnumAllZoneObjs = [];

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
  // Para 'ciudad' se usa zona si existe (p.ej. los altares: varios
  // comparten nombre "Altar de Resurrección" Y categoría "Altar", así que
  // sin la zona como desempate todos colisionarían en la misma clave) y
  // si no hay zona se cae a categoria como antes (lugares que no la tienen).
  const extra = m.tipo === 'npc' ? (m.zona||'') : m.tipo === 'ciudad' ? (m.zona || m.categoria || '') : (m.la_da||'');
  return `${m.tipo}|${m.nombre}|${extra}`;
}

// Selección múltiple (modo edición): con el modo activo, click en un
// marcador lo selecciona/deselecciona en vez de abrir su popup. Arrastrar
// cualquier marcador que forme parte de una selección de 2 o más mueve a
// todos juntos, manteniendo la posición relativa entre ellos.
let selectionMode = false;
let selectedKeys = new Set();
let markersByKey = {};

// Clave del marcador que la búsqueda mostró a la fuerza pese a tener su
// categoría apagada (si hay uno) — ver wireRegnumSearchAndFilters y el
// popupclose en initRegnumMapIfNeeded.
let forcedVisibleKey = null;
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
  // Hay que fijar ancho Y alto: el CSS de base solo da width:100% (hasta los
  // 1180px del recuadro), así que si sólo se fija el alto acá el contenedor
  // queda rectangular (más ancho que alto) en vez de cuadrado. Con un
  // contenedor no-cuadrado, el cálculo de zoom mínimo (que asume que "cubrir
  // el recuadro" y "mostrar el mundo entero" son la misma cosa, ver más
  // abajo) termina sobre-acercando el zoom para cubrir el lado más ancho, y
  // eso recorta contenido de los bordes superior/inferior del mundo.
  container.style.width = side + 'px';
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
    // zoomSnap:0 = zoom continuo (sin esto Leaflet redondea todo zoom al
    // entero más cercano por defecto). Con el mundo cuadrado casi nunca
    // encaja justo en un escalón entero: el zoom mínimo "exacto" para que
    // el mundo entero cubra el recuadro suele ser fraccionario (p.ej.
    // -4.59), y redondearlo a -4 agranda el mapa renderizado ~66% de más,
    // recortando franjas enteras arriba/abajo del recuadro (esto es lo que
    // hacía que Skolheim/Gokstad, cerca del borde norte/oeste, quedaran
    // fuera del recuadro visible al zoom mínimo).
    zoomSnap: 0,
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
  const center = regnumMap.unproject([MAP_PX/2, MAP_PX/2], 0);
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
  // Al zoom mínimo (escalón 1, el mapa completo ya entra en el recuadro) no
  // hay a dónde más "arrastrar" — mover el mapa ahí no hace nada útil y
  // encima confunde al chocar con los límites. Se habilita recién a partir
  // del escalón 2.
  function updateDraggingForZoom(){
    if(!regnumMap) return;
    if(regnumMap.getZoom() <= regnumMap.getMinZoom() + 0.001) regnumMap.dragging.disable();
    else regnumMap.dragging.enable();
  }
  regnumMap.on('zoom', updateDraggingForZoom);

  // setMaxBounds() solo evita ARRASTRAR más allá del mundo — no recentra
  // solo al alejar el zoom. Por eso si uno mueve el mapa hacia un costado
  // con zoom adentro y después aleja hasta el mínimo, Leaflet no vuelve a
  // centrarlo: lo deja donde quedó (dentro de los límites, pero pegado a
  // un borde) y como al mínimo el mundo casi no tiene margen extra sobre
  // el recuadro, ahí sí se nota recortado de un lado. Es una limitación
  // conocida de Leaflet (setMaxBounds no "recentra", solo limita — ver
  // Leaflet/Leaflet#1475, "maxBounds not respected when zooming"); la
  // solución estándar es forzar el recentrado a mano al volver al
  // escalón mínimo.
  regnumMap.on('zoomend', ()=>{
    if(regnumMap.getZoom() > regnumMap.getMinZoom() + 0.001) return;
    const c = regnumMap.getCenter();
    if(Math.abs(c.lat - center.lat) > 0.5 || Math.abs(c.lng - center.lng) > 0.5){
      regnumMap.panTo(center, {animate:false});
    }
  });

  function fitMinZoomToContainer(){
    regnumMap.setMinZoom(-10);
    // +0.04 de margen (no más que eso): el cálculo exacto a veces deja un
    // borde de un par de píxeles sin cubrir (redondeo, o la barra de
    // scroll aparece/desaparece justo después de medir) — mejor pasarse
    // un poquito de zoom que dejar una banda negra apenas perceptible en
    // el borde. OJO: antes esto era +0.15, que con zoom continuo
    // (zoomSnap:0, ver más arriba) ya no hace falta y de hecho recorta
    // bastante de más — +0.15 de zoom es ~11% de la imagen de más (unos
    // 40px de cada lado en un recuadro de referencia de 769px), no "un
    // par de píxeles" — eso era lo que se veía como "recortado en todos
    // los bordes". +0.04 es bastante menos margen, unos pocos píxeles.
    const fitZoom = regnumMap.getBoundsZoom(bounds, true) + 0.04;
    regnumMap.setMinZoom(Math.min(regnumMap.getMaxZoom(), fitZoom));
    updateZoomBadge();
    updateDraggingForZoom();
  }
  fitMinZoomToContainer();
  window.addEventListener('resize', ()=>{
    if(!regnumMap) return;
    sizeMapSquare();
    fitMinZoomToContainer();
    regnumMap.invalidateSize();
  });
  // Arranca mostrando el mapa completo (escalón 1), no centrado a resolución
  // nativa — así lo primero que se ve es todo el mundo, no un recorte.
  // ("center" ya se calculó más arriba, junto con bounds.)
  regnumMap.setView(center, regnumMap.getMinZoom());

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
  regnumZonesLayer = L.layerGroup().addTo(regnumMap);

  // Si un resultado de búsqueda fuerza a mostrar un marcador cuya categoría
  // tiene el checkbox apagado (ver wireRegnumSearchAndFilters), que vuelva
  // a ocultarse al cerrar su popup — no debería quedar "colado" para
  // siempre solo por haberlo buscado una vez. OJO: 'popupclose' también
  // se dispara al abrir OTRO globo (Leaflet cierra el anterior solo,
  // "autoClose") y al hacer click en cualquier globo o marcador — por eso
  // acá NO se puede reconstruir toda la capa de marcadores (clearLayers +
  // volver a agregar todo) como se hacía antes: eso le cambia el nodo del
  // ícono por debajo a marcadores que están en medio de manejar ESE mismo
  // click, y termina rompiendo los clicks siguientes (globos que dejan de
  // abrir, mapa "pegado"). Por eso ahora solo se saca, puntualmente, el
  // marcador que quedó anotado como forzado por la búsqueda — nada más.
  regnumMap.on('popupclose', (e)=>{
    if(!forcedVisibleKey) return;
    const m = regnumAllMarkerObjs.find(x=> x.__key === forcedVisibleKey);
    forcedVisibleKey = null;
    if(m && e.popup === m._leaflet.getPopup() && !passesRegnumFilters(m)){
      regnumMarkersLayer.removeLayer(m._leaflet);
    }
  });

  // Si el globo se abre muy cerca de un borde del recuadro (por ejemplo un
  // marcador cerca del borde del mundo, al zoom mínimo) no entra completo
  // del lado en que aparece por defecto (arriba y centrado sobre el
  // marcador). En vez de mover todo el mapa para hacerle lugar (autoPan,
  // desactivado arriba porque al zoom mínimo no hay margen y termina
  // empujando y volviendo de golpe), se corre el globo mismo lo justo para
  // que quede adentro del recuadro — del lado que no choca con el borde.
  regnumMap.on('popupopen', (e)=>{
    const popup = e.popup;
    const popupEl = popup._container;
    const mapEl = document.getElementById('regnum-map');
    if(!popupEl || !mapEl) return;
    const margin = 10;
    const mr = mapEl.getBoundingClientRect();
    const pr = popupEl.getBoundingClientRect();
    let dx = 0, dy = 0;
    if(pr.left < mr.left + margin) dx = (mr.left + margin) - pr.left;
    else if(pr.right > mr.right - margin) dx = (mr.right - margin) - pr.right;
    if(pr.top < mr.top + margin) dy = (mr.top + margin) - pr.top;
    else if(pr.bottom > mr.bottom - margin) dy = (mr.bottom - margin) - pr.bottom;
    if(dx || dy){
      // Leaflet reposiciona el globo con su propio transform (vía
      // options.offset, pero solo lo aplica al bottom/left, no al
      // transform con animación de zoom activada — cambiar options.offset
      // y llamar a update() no lo mueve en la práctica). Más simple y
      // confiable: sumarle el corrimiento directo al transform ya puesto,
      // en vez de pelear con su sistema de offsets internos.
      popupEl.style.transform += ` translate(${dx}px, ${dy}px)`;
      // La puntita que apunta al marcador se mueve junto con el globo, así
      // que después de correrlo ya no señala al lugar correcto — mejor
      // ocultarla que dejarla apuntando para cualquier lado.
      const tip = popupEl.querySelector('.leaflet-popup-tip-container');
      if(tip) tip.style.display = 'none';
    }
  });

  // Herramienta de referencia, oculta: agregando ?refpick=1 a la URL, un
  // click en el mapa (en un lugar vacío, no sobre un marcador) muestra el
  // mosaico exacto (con decimales) de ese punto — para afinar a mano la
  // posición de ciudades y lugares de interés sin depender de capturas.
  // El selector de modo decide qué hace cada click:
  //  - Normal: el globo de siempre, con su botón de copiar.
  //  - Polígono: junta puntos en un panel (sin globo, molestaba al hacer
  //    muchos clicks seguidos) para delimitar el área de una zona de
  //    mobs/materiales — ver buildRegnumZones. Una zona puede tener varias
  //    piezas separadas (por ejemplo si una ciudad la corta al medio):
  //    "Cerrar pieza" guarda el anillo actual y arranca uno nuevo.
  //  - Ángulo: dos clicks (centro de la muralla, después un punto en la
  //    dirección hacia la que "mira" la pared real en el mosaico) y calcula
  //    los grados para el campo "angulo" de esa muralla — ver iconFor().
  if(new URLSearchParams(location.search).get('refpick') === '1'){
    const refpickPieces = []; // piezas ya cerradas: array de anillos (cada uno, array de {col,row})
    let refpickCurrent = []; // anillo que se está dibujando ahora
    let refpickPreview = null;
    let anguloCentro = null; // primer click del modo ángulo, en espera del segundo
    let anguloPreview = null;
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:9999;background:#0f1410;border:1px solid #2c3a2a;color:#e7ecdf;font-family:monospace;font-size:12px;padding:10px;border-radius:6px;max-width:260px;';
    panel.innerHTML = `<label style="display:flex;align-items:center;gap:6px">Modo:
        <select id="refpick-mode" style="flex:1">
          <option value="normal">Normal (con globo)</option>
          <option value="poligono">Polígono (zona)</option>
          <option value="angulo">Ángulo (muralla)</option>
        </select>
      </label>
      <div id="refpick-poly-panel" style="margin-top:6px">
        <b>Puntos de zona</b><br>
        <span id="refpick-count">pieza actual: 0 puntos · piezas cerradas: 0</span><br>
        <button type="button" id="refpick-close-piece" style="margin-top:6px">Cerrar pieza y empezar otra</button><br>
        <button type="button" id="refpick-copy-poly" style="margin-top:6px">Copiar todo</button>
        <button type="button" id="refpick-reset" style="margin-top:6px">Reiniciar</button>
      </div>
      <div id="refpick-angulo-panel" style="margin-top:6px;display:none">
        <b>Ángulo de muralla</b><br>
        <span id="refpick-angulo-estado">click el centro de la muralla</span><br>
        <button type="button" id="refpick-copy-angulo" style="margin-top:6px" disabled>Copiar ángulo</button>
      </div>`;
    document.body.appendChild(panel);
    const modeSelect = document.getElementById('refpick-mode');
    const polyPanel = document.getElementById('refpick-poly-panel');
    const anguloPanel = document.getElementById('refpick-angulo-panel');
    modeSelect.addEventListener('change', ()=>{
      polyPanel.style.display = modeSelect.value === 'poligono' ? '' : 'none';
      anguloPanel.style.display = modeSelect.value === 'angulo' ? '' : 'none';
    });
    function refreshRefpickPanel(){
      document.getElementById('refpick-count').textContent =
        `pieza actual: ${refpickCurrent.length} punto${refpickCurrent.length===1?'':'s'} · piezas cerradas: ${refpickPieces.length}`;
      if(refpickPreview) regnumMap.removeLayer(refpickPreview);
      const anillos = [...refpickPieces, refpickCurrent].filter(a=>a.length>=2);
      if(anillos.length){
        refpickPreview = L.polygon(anillos.map(a=>a.map(p=>tileToLatLng(p.col,p.row))), {color:'#e8c14a', weight:2, fillOpacity:0.12, dashArray:'4,4'}).addTo(regnumMap);
      } else {
        refpickPreview = null;
      }
    }
    document.getElementById('refpick-close-piece').addEventListener('click', function(){
      if(refpickCurrent.length < 3){
        this.textContent = 'Faltan puntos (mín. 3)';
        setTimeout(()=> this.textContent = 'Cerrar pieza y empezar otra', 1200);
        return;
      }
      refpickPieces.push(refpickCurrent);
      refpickCurrent = [];
      refreshRefpickPanel();
    });
    document.getElementById('refpick-copy-poly').addEventListener('click', function(){
      // La pieza actual se suma sola si ya tiene forma (3+ puntos) — no
      // hace falta cerrarla a mano antes de copiar si es la última.
      const anillos = [...refpickPieces, ...(refpickCurrent.length>=3 ? [refpickCurrent] : [])];
      const text = JSON.stringify(anillos);
      navigator.clipboard?.writeText(text).catch(()=>{});
      this.textContent = 'Copiado';
      setTimeout(()=> this.textContent = 'Copiar todo', 1200);
    });
    document.getElementById('refpick-reset').addEventListener('click', ()=>{
      refpickPieces.length = 0;
      refpickCurrent = [];
      refreshRefpickPanel();
    });
    let refpickAnguloValue = null;
    document.getElementById('refpick-copy-angulo').addEventListener('click', function(){
      if(refpickAnguloValue == null) return;
      navigator.clipboard?.writeText(String(refpickAnguloValue)).catch(()=>{});
      this.textContent = 'Copiado';
      setTimeout(()=> this.textContent = 'Copiar ángulo', 1200);
    });
    regnumMap.on('click', (e)=>{
      const pt = regnumMap.project(e.latlng, 0);
      const col = Number((pt.x/TILE_SIZE).toFixed(3));
      const row = Number((pt.y/TILE_SIZE).toFixed(3));

      if(modeSelect.value === 'poligono'){
        refpickCurrent.push({col, row});
        refreshRefpickPanel();
        return;
      }

      if(modeSelect.value === 'angulo'){
        if(!anguloCentro){
          anguloCentro = {col, row};
          document.getElementById('refpick-angulo-estado').textContent =
            `centro: col=${col.toFixed(3)} row=${row.toFixed(3)} — click hacia dónde mira la pared`;
          document.getElementById('refpick-copy-angulo').disabled = true;
          return;
        }
        // Convención: 0° = "mira hacia el norte" (fila menor), y crece en
        // sentido horario — el mismo sentido que usa CSS transform:rotate(),
        // así el valor calculado acá se puede pegar tal cual en el campo
        // "angulo" del lugar y el ícono queda mirando para donde se clickeó.
        const dCol = col - anguloCentro.col;
        const dRowNorte = -(row - anguloCentro.row);
        let angulo = Math.atan2(dCol, dRowNorte) * 180 / Math.PI;
        angulo = Math.round(((angulo % 360) + 360) % 360);
        refpickAnguloValue = angulo;
        document.getElementById('refpick-angulo-estado').textContent = `Ángulo: ${angulo}° (click de nuevo para medir otra)`;
        document.getElementById('refpick-copy-angulo').disabled = false;
        if(anguloPreview) regnumMap.removeLayer(anguloPreview);
        anguloPreview = L.polyline([tileToLatLng(anguloCentro.col, anguloCentro.row), e.latlng], {color:'#e8c14a', weight:2}).addTo(regnumMap);
        anguloCentro = null;
        return;
      }

      const text = `col=${col.toFixed(3)} row=${row.toFixed(3)}`;
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
      buildRegnumZones();
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
// Ciudad/Pueblo/Aldea(ex-Villa) comparten el ícono de casa, sin color de
// reino (ya se distinguen por reino con el filtro y el popup) pero con
// tamaño creciente Aldea < Pueblo < Ciudad para diferenciarlas de un
// vistazo. Puerto usa el tamaño de Pueblo (mismo checkbox). Muralla/Fuerte/
// Castillo/Altar sí llevan color de reino. "Villa" queda como alias de
// "Aldea" por si algún registro viejo todavía usa ese nombre.
const PLACE_SHAPE = {Ciudad:'ciudad', Pueblo:'pueblo', Puerto:'pueblo', Aldea:'aldea', Villa:'aldea', Muralla:'muralla', Fuerte:'fuerte', Castillo:'castillo', Altar:'altar'};
// muralla al doble de lo que tenía (15 -> 30): con el glifo genérico
// ('▬') quedaba chico y poco legible comparado con el resto.
const PLACE_SIZE = {ciudad:34, pueblo:26, aldea:18, castillo:44, fuerte:32, altar:24, muralla:30};
const PLACE_NO_REALM_COLOR = new Set(['ciudad', 'pueblo', 'aldea']);
// Cada categoría se filtra con su propio checkbox — ver #map-layers-block.
const PLACE_TOGGLE_ID = {Ciudad:'map-toggle-ciudad', Pueblo:'map-toggle-pueblo', Puerto:'map-toggle-pueblo', Aldea:'map-toggle-aldea', Villa:'map-toggle-aldea', Fuerte:'map-toggle-fuerte', Castillo:'map-toggle-castillo', Muralla:'map-toggle-muralla', Altar:'map-toggle-altar'};
// El carácter de texto "⌂" sale hueco (solo el contorno) en la mayoría de
// las fuentes — no hay forma de "rellenarlo" solo con color de texto. Un
// SVG con fill:currentColor sí queda relleno del color que le pongamos.
const HOUSE_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M12 2 L2 11 L5 11 L5 22 L19 22 L19 11 L22 11 Z"/></svg>';
const PLACE_GLYPH = {ciudad:HOUSE_SVG, pueblo:HOUSE_SVG, aldea:HOUSE_SVG, muralla:'▬', fuerte:'♜', castillo:'♜', altar:'◎'};

function iconFor(m){
  if(m.tipo === 'mision') return L.divIcon({className:'regnum-marker regnum-marker-mision', html:'!', iconSize:[10,14]});
  if(m.tipo === 'npc') return L.divIcon({className:`regnum-marker regnum-marker-npc realm-color-${REALM_SLUG[m.reino]||'syrtis'}`, html:'●', iconSize:[14,14]});
  // ciudad/lugar: la forma sale de la categoría (Ciudad/Fuerte/Castillo/...)
  const shape = PLACE_SHAPE[m.categoria] || 'ciudad';
  const size = PLACE_SIZE[shape] || 34;
  const cls = PLACE_NO_REALM_COLOR.has(shape)
    ? `regnum-marker regnum-marker-${shape}`
    : `regnum-marker regnum-marker-${shape} realm-color-${REALM_SLUG[m.reino]||'syrtis'}`;
  // m.angulo (grados, sentido horario, 0° = como viene el glifo por
  // defecto) — por ahora solo lo cargan las murallas, para que el ícono
  // quede orientado igual que la pared real en el mosaico de abajo. Se
  // rota un <div> interno, NUNCA el contenedor que arma Leaflet — ese ya
  // tiene su propio transform para ubicar el marcador, y pisárselo lo
  // deja mal posicionado.
  const html = (m.angulo)
    ? `<div style="transform:rotate(${m.angulo}deg);width:100%;height:100%;display:flex;align-items:center;justify-content:center;">${PLACE_GLYPH[shape]}</div>`
    : PLACE_GLYPH[shape];
  return L.divIcon({className:cls, html, iconSize:[size,size]});
}

function buildRegnumMarkers(){
  regnumMarkersLayer.clearLayers();
  regnumAllMarkerObjs = [];
  const todos = [...regnumMapData.npcs, ...regnumMapData.misiones, ...(regnumMapData.ciudades||[])];
  // Dónde quedó cada NPC ya calculado, por nombre — para que una misión sin
  // posición propia corregida use la de su dador en vez de su x/y original
  // (misiones y NPCs se corrigen por separado, así que si no hiciéramos
  // esto, mover al NPC no movería la misión que da, aunque sea el mismo
  // punto en el mundo real). npcs va primero en "todos", así que para
  // cuando se procesa una misión ya están todos calculados.
  const npcLatLngByName = {};
  todos.forEach(m=>{
    // La clave hay que calcularla ANTES de aplicar ediciones guardadas (si
    // ya se renombró en una sesión anterior, recalcularla ahora daría una
    // clave distinta y se perdería el vínculo con lo guardado) — por eso
    // se cachea en m.__key y de ahí en más siempre se usa esa, nunca se
    // vuelve a calcular con markerKey().
    const key = markerKey(m);
    const edit = mapEdits[key];
    // "disabled" persiste en los datos (data/map-data.json) y aplica para
    // todo el mundo, no solo en modo edición — un registro desactivado no
    // se borra, solo deja de mostrarse. Un "edit.disabled" de esta sesión
    // (todavía sin exportar) pisa lo que diga el dato ya guardado, en
    // cualquier sentido — así en el futuro alcanza con un cambio de
    // mapEdits para reactivar algo sin tener que tocar el JSON a mano.
    const isDisabled = edit && ('disabled' in edit) ? edit.disabled : !!m.disabled;
    if(isDisabled) return; // no se agrega al mapa ni a la lista
    if(edit && edit.fields) Object.assign(m, edit.fields);
    m.__key = key;

    // Prioridad: arrastre de esta sesión (todavía sin exportar) > posición
    // corregida a mano en una sesión anterior (posOverride, ya aplicada a
    // los datos) > para una misión sin posición propia, la del NPC que la
    // da > posición por defecto (mosaico exacto para lugares, fórmula de
    // coordenadas de juego para NPCs/misiones).
    const latlng = edit && edit.move
      ? tileToLatLng(edit.move.col, edit.move.row)
      : m.posOverride
      ? tileToLatLng(m.posOverride.col, m.posOverride.row)
      : m.tipo === 'mision' && npcLatLngByName[m.la_da]
      ? npcLatLngByName[m.la_da]
      : m.tipo === 'ciudad' ? tileToLatLng(m.col, m.row) : pixelToLatLng(m.x, m.y);
    if(m.tipo === 'npc') npcLatLngByName[m.nombre] = latlng;
    const marker = L.marker(latlng, {icon: iconFor(m), draggable: EDIT_MODE});
    // autoPan:false — por defecto Leaflet mueve todo el mapa para hacerle
    // lugar al popup, pero al zoom mínimo (el mapa completo ya cubre el
    // recuadro) no hay a dónde correrlo: lo intenta, maxBounds lo frena de
    // vuelta, y el popup queda a mitad de camino, cortado por el borde.
    if(EDIT_MODE){
      marker.bindPopup(buildEditPopupHTML(m), {autoPan:false});
      markersByKey[key] = {marker, m};
      wireEditMarker(marker, m);
    } else {
      marker.bindPopup(buildRegnumPopupHTML(m), {autoPan:false});
    }
    m._leaflet = marker;
    regnumAllMarkerObjs.push(m);
  });
  applyRegnumFilters();
  if(EDIT_MODE) setupEditModeUI();
}

// Colores fijos (no ligados al tema de reino, mismo motivo que los íconos
// de Aldea/Pueblo/Ciudad — ver comentario en css/map.css): rojo para
// "peligro" (mobs), verde-agua para "recurso" (materiales). Una zona con
// las dos cosas cargadas usa un tercer color propio en vez de mezclar los
// otros dos, para que de un vistazo se note que tiene ambas.
const ZONE_COLOR_MOBS = '#c0392b';
const ZONE_COLOR_MATERIALES = '#2f8f6b';
const ZONE_COLOR_MIXTA = '#a06be0';

function zoneHasMobs(z){ return (z.mobs||[]).length > 0; }
function zoneHasMateriales(z){ return (z.materiales||[]).length > 0; }

function zoneColor(z){
  const mobs = zoneHasMobs(z), mats = zoneHasMateriales(z);
  if(mobs && mats) return ZONE_COLOR_MIXTA;
  if(mobs) return ZONE_COLOR_MOBS;
  return ZONE_COLOR_MATERIALES;
}

function buildZonePopupHTML(z){
  const partes = [`<b>${z.nombre}</b>`, z.reino];
  if(zoneHasMobs(z)){
    partes.push('<u>Mobs</u><br>' + z.mobs.map(it=> `${it.nombre}${it.nivel ? ' · Nv. '+it.nivel : ''}`).join('<br>'));
  }
  if(zoneHasMateriales(z)){
    partes.push('<u>Materiales</u><br>' + z.materiales.map(it=> it.nombre).join('<br>'));
  }
  return partes.join('<br>');
}

// Zonas (áreas de mobs/materiales delimitadas a mano con la herramienta
// ?refpick=1, ver más arriba): polígonos con relleno transparente, no
// marcadores — se cargan y filtran aparte de buildRegnumMarkers. Cada zona
// puede tener varias piezas separadas (z.poligonos es un array de anillos
// de puntos, no un solo anillo) para el caso de un área que una ciudad
// corta al medio — Leaflet dibuja eso como un solo polígono (multipolígono
// nativo), con un solo popup, aunque se vea partido en pantalla.
function buildRegnumZones(){
  regnumZonesLayer.clearLayers();
  regnumAllZoneObjs = [];
  (regnumMapData.zonas||[]).forEach(z=>{
    const anillos = (z.poligonos||[]).filter(anillo => anillo && anillo.length >= 3);
    if(anillos.length === 0) return; // cada pieza necesita al menos 3 puntos
    const latlngRings = anillos.map(anillo => anillo.map(p=> tileToLatLng(p.col, p.row)));
    const color = zoneColor(z);
    const polygon = L.polygon(latlngRings, {color, fillColor:color, weight:2, fillOpacity:0.22});
    polygon.bindPopup(buildZonePopupHTML(z), {autoPan:false});
    z._leaflet = polygon;
    regnumAllZoneObjs.push(z);
  });
  applyZoneFilters();
}

// Una zona puede tener mobs Y materiales a la vez — se muestra si cualquiera
// de los dos checkboxes que le correspondan (según lo que tenga cargado)
// está prendido, no necesita que estén los dos.
function passesZoneFilters(z){
  const mobsOn = document.getElementById('map-toggle-mobs').checked;
  const matsOn = document.getElementById('map-toggle-materiales').checked;
  if(!((zoneHasMobs(z) && mobsOn) || (zoneHasMateriales(z) && matsOn))) return false;
  const reino = document.getElementById('map-filter-reino').value;
  if(reino && z.reino !== reino) return false;
  return true;
}

function applyZoneFilters(){
  regnumZonesLayer.clearLayers();
  regnumAllZoneObjs.forEach(z=>{
    if(passesZoneFilters(z)) z._leaflet.addTo(regnumZonesLayer);
  });
}

function editableFieldsFor(m){
  if(m.tipo === 'npc') return [['nombre','Nombre'], ['profesion','Profesión'], ['zona','Zona'], ['reino','Reino']];
  if(m.tipo === 'ciudad') return [['nombre','Nombre'], ['categoria','Categoría'], ['zona','Zona'], ['reino','Reino'], ['angulo','Ángulo (°, solo murallas)']];
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
      <button type="button" class="ep-delete" style="color:#c0392b">Desactivar</button>
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
    if(!confirm(`¿Desactivar "${m.nombre}"? No se borra — deja de mostrarse en el mapa, pero se puede reactivar después si fue un error.`)) return;
    mapEdits[m.__key] = Object.assign({}, mapEdits[m.__key], {disabled:true});
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
    // Los altares comparten el mismo nombre ("Altar de Resurrección") —
    // ahí conviene mostrar la zona en vez de repetir "Altar" en todos.
    const linea2 = m.categoria === 'Altar' && m.zona ? m.zona : m.categoria;
    return `<b>${m.nombre}</b><br>${linea2}<br>${m.reino}`;
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
  const entries = Object.entries(mapEdits).filter(([,e])=> e.move || e.fields || 'disabled' in e);
  const out = {generado: new Date().toISOString(), cambios: entries.length, detalle: entries.map(([key,e])=>{
    const rec = {clave: key};
    if('disabled' in e) rec.accion = e.disabled ? 'desactivar' : 'reactivar';
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
    <button type="button" id="map-edit-clearall" class="mini-btn">Limpiar cambios ya exportados</button>
  `;
  frame.appendChild(bar);

  document.getElementById('map-edit-clearall').addEventListener('click', ()=>{
    // Solo borra el registro local de "qué cambié en esta sesión" — no toca
    // nada de data/map-data.json. Usarlo después de confirmar que lo último
    // exportado ya se aplicó, para que el próximo export no repita todo.
    if(!confirm('¿Vaciar la lista de cambios acumulados? Hacé esto solo después de confirmar que el último export ya se aplicó — si todavía no, se pierde ese registro (aunque el mapa en pantalla no cambia, solo lo que se acumula para exportar).')) return;
    mapEdits = {};
    saveMapEdits();
    location.reload();
  });

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

const PLACE_TOGGLE_IDS = ['map-toggle-aldea','map-toggle-pueblo','map-toggle-ciudad','map-toggle-fuerte','map-toggle-castillo','map-toggle-muralla','map-toggle-altar'];

// Separado de applyRegnumFilters para poder reusarlo también al chequear
// un solo marcador puntual (ver popupclose más abajo) sin tener que
// reconstruir toda la capa de marcadores por eso.
function passesRegnumFilters(m){
  const showNpc = document.getElementById('map-toggle-npc').checked;
  const showMision = document.getElementById('map-toggle-mision').checked;
  const reino = document.getElementById('map-filter-reino').value;
  const prof = document.getElementById('map-filter-profesion').value;
  const nivel = document.getElementById('map-filter-nivel').value;

  if(m.tipo === 'npc' && !showNpc) return false;
  if(m.tipo === 'mision' && !showMision) return false;
  if(m.tipo === 'ciudad'){
    // Cada categoría de lugar (Aldea/Pueblo/Ciudad/Fuerte/Castillo/
    // Muralla/Altar) tiene su propio checkbox — ver PLACE_TOGGLE_ID.
    const toggleId = PLACE_TOGGLE_ID[m.categoria];
    const toggle = toggleId && document.getElementById(toggleId);
    if(toggle && !toggle.checked) return false;
  }
  if(reino && m.reino !== reino) return false;
  // Profesión y nivel son propios de NPCs/misiones — las ciudades no
  // tienen esos campos, así que no las toca ninguno de estos dos filtros.
  if(m.tipo !== 'ciudad'){
    if(prof && m.profesion !== prof) return false;
    if(nivel && String(m.nivel) !== nivel) return false;
  }
  return true;
}

function applyRegnumFilters(){
  regnumMarkersLayer.clearLayers();
  regnumAllMarkerObjs.forEach(m=>{
    if(passesRegnumFilters(m)) m._leaflet.addTo(regnumMarkersLayer);
  });
}

function wireRegnumSearchAndFilters(){
  // Un solo refresh para marcadores Y zonas: 'map-filter-reino' afecta a
  // los dos, y no cuesta nada reconstruir marcadores de más cuando cambia
  // un checkbox que en realidad es solo de zonas (o viceversa).
  function refreshMapLayers(){ applyRegnumFilters(); applyZoneFilters(); }
  [...PLACE_TOGGLE_IDS,'map-toggle-npc','map-toggle-mision','map-toggle-mobs','map-toggle-materiales','map-filter-reino','map-filter-profesion','map-filter-nivel'].forEach(id=>{
    document.getElementById(id).addEventListener('change', refreshMapLayers);
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
        <div class="mri-meta">${m.tipo==='npc' ? (m.profesion||m.clase||'') : m.tipo==='ciudad' ? (m.categoria==='Altar' && m.zona ? m.zona : m.categoria) : 'Nivel '+m.nivel+' · La da: '+m.la_da} · ${m.reino}</div>
      </div>`).join('');
    results.classList.add('is-open');
    results.querySelectorAll('.map-result-item').forEach(el=>{
      el.addEventListener('click', ()=>{
        const m = regnumAllMarkerObjs[parseInt(el.dataset.idx)];
        results.classList.remove('is-open');
        input.value = m.nombre;
        regnumMap.setView(m._leaflet.getLatLng(), 0);
        if(!regnumMarkersLayer.hasLayer(m._leaflet)){
          // Categoría apagada: se muestra igual porque lo pidió la
          // búsqueda, pero queda anotado para sacarlo de nuevo al cerrar
          // su globo (ver popupclose más abajo) — sin tocar ningún otro
          // marcador en el proceso.
          m._leaflet.addTo(regnumMarkersLayer);
          forcedVisibleKey = m.__key;
        }
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
      // El tamaño/encuadre (sizeMapSquare + fitMinZoomToContainer, colgados
      // del listener de 'resize' de más abajo) antes solo se calculaban una
      // vez, la primera vez que se inicializaba el mapa — si en ESE momento
      // puntual quedaban mal calculados (por ejemplo el layout del panel
      // recién mostrado todavía no había terminado de asentarse), se
      // quedaban así para siempre, sin corregirse nunca (el mapa no vuelve
      // a mostrar el mundo completo aunque después sí tenga el tamaño
      // correcto). Disparar 'resize' cada vez que se abre la pestaña fuerza
      // a recalcular todo contra el tamaño ACTUAL, ya asentado, sin
      // depender de que haya salido bien la primera vez.
      if(regnumMap) window.dispatchEvent(new Event('resize'));
    }, 50);
  });
});
