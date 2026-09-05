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
// Editor de zonas (mobs/materiales), colgado de la misma herramienta
// ?refpick=1 que ya sirve para dibujar el contorno — separado de mapEdits
// porque acá cada cambio es una zona entera (guardar o eliminar), no una
// edición puntual de un marcador. Mismo motivo que arriba para guardarlo
// en localStorage: sitio estático, sin backend, alguien tiene que aplicar
// el export a mano.
const REFPICK_MODE = new URLSearchParams(location.search).get('refpick') === '1';
const ZONE_TOOL_STORAGE_KEY = 'cort-zone-tool-changes';
let zoneToolChanges = [];
if(REFPICK_MODE){
  try { zoneToolChanges = JSON.parse(localStorage.getItem(ZONE_TOOL_STORAGE_KEY) || '[]'); } catch(e){ zoneToolChanges = []; }
}
function saveZoneToolChanges(){
  try { localStorage.setItem(ZONE_TOOL_STORAGE_KEY, JSON.stringify(zoneToolChanges)); } catch(e){}
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
// Lo mismo pero para una zona (nombre, no hay __key) mostrada a la fuerza
// por la búsqueda pese a tener Mobs/Materiales o el reino apagados — ver
// wireRegnumSearchAndFilters y el tooltipclose en initRegnumMapIfNeeded.
let forcedVisibleZoneKey = null;
function latLngToPoint(latlng){ return regnumMap.project(latlng, 0); }
function pointToLatLng(pt){ return regnumMap.unproject([pt.x, pt.y], 0); }

// El mapa fuente es cuadrado (18x18 mosaicos) — si el recuadro no lo es,
// "llenarlo entero" (sin bandas negras) y "mostrar el mundo completo" se
// contradicen. Haciendo el recuadro cuadrado se cumplen las dos cosas a la
// vez: ancho = min(ancho disponible hasta 1180px, 85% del alto de ventana).
//
// Se probó calcular el alto disponible "real" (contra dónde arranca el
// recuadro y cuánto queda hasta el borde de la ventana) para que el mapa
// entrara siempre sin scrollear — pero como el recuadro es CUADRADO, ese
// alto termina siendo también el ancho: en pantallas con poca altura
// disponible (la mayoría de los monitores normales, una vez descontado
// título+pestañas+buscador+pie de página) el mapa se veía mucho más
// angosto que antes, no solo más bajo. Se vuelve al 85vh de siempre — de
// nuevo puede hacer falta scrollear un poco para verlo completo, pero
// mantiene el ancho de siempre en vez de angostarse con la altura.
function sizeMapSquare(){
  const frame = document.querySelector('.map-frame');
  const container = document.getElementById('regnum-map');
  if(!frame || !container) return;
  // Se resetea el ancho ANTES de medir frame.clientWidth: si se dejara el
  // valor ya achicado de la última vez, cada llamada mediría contra ESE
  // ancho reducido en vez del disponible de verdad, y el recuadro se
  // iría achicando de a poco cada vez que se llama esta función (resize,
  // cambio de pestaña, etc.) en vez de mantenerse estable.
  frame.style.width = '';
  const baseSide = Math.min(frame.clientWidth, window.innerHeight * 0.85);
  // 7% más chico que el cálculo de siempre, a pedido (primero 5%, después
  // 2% más) — nada más que un factor sobre el mismo lado ya calculado.
  const side = Math.max(320, baseSide * 0.93);
  // Hay que fijar ancho Y alto: el CSS de base solo da width:100% (hasta los
  // 1180px del recuadro), así que si sólo se fija el alto acá el contenedor
  // queda rectangular (más ancho que alto) en vez de cuadrado. Con un
  // contenedor no-cuadrado, el cálculo de zoom mínimo (que asume que "cubrir
  // el recuadro" y "mostrar el mundo entero" son la misma cosa, ver más
  // abajo) termina sobre-acercando el zoom para cubrir el lado más ancho, y
  // eso recorta contenido de los bordes superior/inferior del mundo.
  container.style.width = side + 'px';
  container.style.height = side + 'px';
  // El recuadro (.map-frame) también se achica al mismo tamaño exacto —
  // antes se quedaba con su ancho de siempre (hasta 1180px) aunque el
  // mapa de adentro fuera más angosto por la altura, y eso dejaba a la
  // brújula (posicionada contra el recuadro completo, no contra el mapa)
  // más ancha que el cuadrado real — por eso "E" terminaba cayendo fuera
  // del mapa. Con el recuadro exactamente del tamaño del mapa, y
  // margin:0 auto ya puesto en .map-frame (ver css/map.css), el conjunto
  // queda centrado solo y la brújula siempre coincide con el borde real.
  frame.style.width = side + 'px';
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
    // Por defecto Leaflet deja "pasarse" del mínimo/máximo mientras se hace
    // pinch-zoom con el dedo (efecto elástico) y recién al soltar vuelve de
    // golpe al límite real — en celular eso se veía como que el mapa se
    // achicaba de más (dejando el fondo negro a la vista) o el zoom se
    // pasaba del máximo, y "rebotaba" al soltar. Con esto en false, el
    // pinch-zoom se frena directo en el límite, sin pasarse ni rebotar.
    bounceAtZoomLimits: false,
    // Mismo espíritu que bounceAtZoomLimits pero para los BORDES del mundo
    // (setMaxBounds más abajo): por defecto (0.0) esos límites son
    // "blandos" -- con dos dedos (pinch) se puede arrastrar el mapa más
    // allá del borde igual, sin ninguna resistencia, y recién al soltar
    // vuelve de un salto a donde corresponde. En 1.0 el límite es sólido,
    // no se puede arrastrar más allá ni un toque, con uno o dos dedos.
    maxBoundsViscosity: 1.0,
  });

  // Indicador visual del nivel de zoom — el número crudo de Leaflet (que
  // puede ser negativo y cambia de mínimo según el tamaño del recuadro) no
  // dice mucho por sí solo, así que se muestra como "escalón X de Y".
  //
  // El zoom en sí es continuo (zoomSnap:0, ver más arriba) a propósito, para
  // que el mundo se vea siempre completo sin recortar bordes — pero el
  // "total" de escalones NO puede salir de ahí redondeando el rango real
  // (getMaxZoom()-getMinZoom()), porque ese rango es fraccionario y varía
  // con el tamaño del recuadro: según cómo cayera el redondeo, el total
  // mostrado saltaba entre 5 y 6 de una sesión a otra, y encima dejaba un
  // click de más disponible cerca de las puntas antes de llegar de verdad
  // al límite. TOTAL_ZOOM_STEPS es fijo — el escalón se calcula como la
  // posición PROPORCIONAL del zoom actual dentro del rango real, mapeada a
  // esos 5 escalones, así el total mostrado nunca cambia y "1"/"5" quedan
  // pegados de verdad a los extremos reales.
  const TOTAL_ZOOM_STEPS = 5;
  const zoomBadge = document.getElementById('map-zoom-badge');
  function updateZoomBadge(){
    if(!zoomBadge) return;
    const min = regnumMap.getMinZoom(), max = regnumMap.getMaxZoom();
    const ratio = max > min ? (regnumMap.getZoom() - min) / (max - min) : 0;
    const step = Math.min(TOTAL_ZOOM_STEPS, Math.max(1, Math.round(ratio * (TOTAL_ZOOM_STEPS - 1)) + 1));
    zoomBadge.textContent = `Zoom ${step}/${TOTAL_ZOOM_STEPS}`;
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

  // Dos resoluciones por mosaico: los livianos de siempre (512px,
  // data/map-tiles/) para la vista alejada -- con el mundo completo a la
  // vista los 324 entran en memoria a la vez, por eso tienen que ser
  // livianos (ver el commit que los achicó, motivado por un crash de
  // memoria en celulares) -- y los originales de 1024px (data/map-tiles/hi/,
  // recuperados del historial de git) recién cuando se está bastante
  // acercado, donde Leaflet ya solo mantiene en pantalla un puñado de
  // mosaicos (el resto se podan solos por estar fuera del recuadro
  // visible), así que no hay riesgo de repetir el mismo problema de memoria.
  // El umbral (0.6) es sobre la MISMA posición proporcional 0..1 dentro del
  // rango de zoom real que ya usa updateZoomBadge más arriba -- a partir de
  // ahí quedan en pantalla unos pocos mosaicos nomás (visto a mano con la
  // herramienta de pruebas), bien lejos de volver a acercarse a los ~324 de
  // la vista completa.
  const TILE_RES_HI_RATIO = 0.6;
  function tileUrlFor(c, r, hi){
    return hi ? `data/map-tiles/hi/tile_${c}_${r}.jpg` : `data/map-tiles/tile_${c}_${r}.jpg`;
  }
  function wantsHiRes(){
    const min = regnumMap.getMinZoom(), max = regnumMap.getMaxZoom();
    const ratio = max > min ? (regnumMap.getZoom() - min) / (max - min) : 0;
    return ratio >= TILE_RES_HI_RATIO;
  }
  let tileResIsHi = false; // se corrige solo apenas se calcula el minZoom real, más abajo
  let regnumTilesLayer = null;
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
      // de r/c acá — por eso se piden invertidos. data-col/data-row quedan
      // guardados en el propio elemento para poder encontrarlo de nuevo y
      // cambiarle la resolución sin recrearlo (ver updateTileResolution).
      tile.dataset.col = c;
      tile.dataset.row = r;
      // Clase para el fade-in (ver css/map.css) -- sin esto cada mosaico
      // aparece de golpe apenas termina de bajar, y como no bajan todos
      // exactamente juntos se nota mucho el efecto de "se van armando los
      // recuadros" al cargar o recargar. Con un fundido cortito queda
      // igual de rápido pero mucho menos brusco.
      tile.className = 'regnum-tile-img';
      tile.src = tileUrlFor(c, r, tileResIsHi);
      tile.onload = () => { tile.classList.add('regnum-tile-loaded'); done(null, tile); };
      tile.onerror = () => done(null, tile);
      return tile;
    }
  });
  // GridLayer trae su propio minZoom:0 por defecto (separado del minZoom
  // -dinámico- del mapa) — sin esto, al alejar el zoom por debajo de ese
  // default la capa se considera "fuera de su propio rango" y deja de pedir
  // tiles del todo (mapa en negro). -10 es solo "bien por debajo de
  // cualquier minZoom que el mapa vaya a tener nunca", no un valor real.
  regnumTilesLayer = new RegnumTiles({
    tileSize: TILE_SIZE, noWrap: true, bounds, minNativeZoom:0, maxNativeZoom:0, minZoom:-10, maxZoom:2,
    // Con zoom continuo (zoomSnap:0) un scroll o pinch dispara muchísimos
    // eventos 'zoom' seguidos mientras el gesto todavía se está moviendo.
    // updateWhenZooming:true (el default) hace que Leaflet pode/agregue
    // mosaicos en CADA uno de esos pasos intermedios -- y de paso, que
    // updateTileResolution (más abajo) intente cambiar la resolución de
    // varios mosaicos a mitad del gesto, más de una vez. En false, Leaflet
    // solo escala con CSS mientras se mueve y recién reacomoda los
    // mosaicos de verdad una vez que el gesto se frena del todo (zoomend) --
    // mismo espíritu que pasar el swap de resolución a 'zoomend' más abajo.
    updateWhenZooming: false,
  }).addTo(regnumMap);

  // Los mosaicos YA CREADOS no se recrean solos al hacer zoom (es el mismo
  // único "nivel nativo" de siempre, Leaflet solo los escala con CSS) — para
  // que cambien de resolución de verdad hay que pisarles el src a mano acá,
  // pero SOLO a los que sigan puestos (los de fuera del recuadro visible ya
  // se podaron solos, y los nuevos que se creen de acá en más ya salen
  // pedidos en la resolución correcta desde createTile).
  function updateTileResolution(){
    const hi = wantsHiRes();
    if(hi === tileResIsHi) return;
    tileResIsHi = hi;
    Object.values(regnumTilesLayer._tiles).forEach(t => {
      const img = t.el;
      if(img.dataset.col === undefined) return; // mosaico vacío (fuera de rango)
      const url = tileUrlFor(img.dataset.col, img.dataset.row, tileResIsHi);
      // Precargar en un <img> aparte (fuera del documento) ANTES de pisarle
      // el src al mosaico visible: asignar el src directo lo deja en blanco
      // (se ve el fondo oscuro del mapa) mientras baja la imagen nueva, y
      // con 16 mosaicos cambiando a la vez ese "parpadeo negro" se nota
      // bastante. Precargando aparte, el mosaico visible se queda mostrando
      // el anterior sin cortes hasta el instante justo en que la imagen
      // nueva ya está lista para pintarse.
      const pre = new Image();
      pre.onload = () => { img.src = url; };
      pre.src = url;
    });
  }
  // 'zoomend', no 'zoom': con zoom continuo, 'zoom' dispara seguido
  // mientras el gesto se sigue moviendo -- cambiar la resolución recién
  // cuando el zoom se frena del todo evita re-disparar el swap varias
  // veces seguidas a mitad de un mismo scroll/pinch (ver también
  // updateWhenZooming:false más arriba, mismo motivo).
  regnumMap.on('zoomend', updateTileResolution);

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

  // Mismo mecanismo que arriba pero para una zona mostrada a la fuerza
  // por la búsqueda (ver wireRegnumSearchAndFilters) — las zonas usan
  // tooltip (hover) en vez de popup (click), así que se engancha en
  // 'tooltipclose' en vez de 'popupclose'.
  regnumMap.on('tooltipclose', (e)=>{
    if(!forcedVisibleZoneKey) return;
    const z = regnumAllZoneObjs.find(x=> x.nombre === forcedVisibleZoneKey);
    forcedVisibleZoneKey = null;
    if(z && e.tooltip === z._leaflet.getTooltip() && !passesZoneFilters(z)){
      regnumZonesLayer.removeLayer(z._leaflet);
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
  // Además, cada click se va acumulando en un panel flotante (abajo a la
  // derecha) que dibuja el polígono en vivo — para delimitar el área de
  // una zona de mobs/materiales click a click por el borde y después
  // copiar todos los puntos de una — ver buildRegnumZones. Una zona puede
  // tener varias piezas separadas (por ejemplo si una ciudad la corta al
  // medio) — "Cerrar pieza" guarda el anillo actual y arranca uno nuevo,
  // sin perder los anteriores.
  // zoneToolSetupFn: el panel de "Editor de zonas" (más abajo) necesita
  // la lista de zonas ya cargadas, que recién existe después del fetch de
  // más abajo — por eso arma su función pero la guarda acá para llamarla
  // recién ahí, en vez de armar todo el panel de una.
  let zoneToolSetupFn = null;
  if(REFPICK_MODE){
    const refpickPieces = []; // piezas ya cerradas: array de anillos (cada uno, array de {col,row})
    let refpickPieceChecked = []; // paralelo a refpickPieces: cuáles se incluyen al guardar una zona (ver "Editor de zonas")
    let refpickPieceSource = []; // paralelo a refpickPieces: null si la dibujaste a mano ahora, o el nombre de la zona de la que vino (via "Cargar")
    let refpickCurrent = []; // anillo que se está dibujando ahora
    let refpickPreview = null;
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:9999;background:#0f1410;border:1px solid #2c3a2a;color:#e7ecdf;font-family:monospace;font-size:12px;padding:10px;border-radius:6px;max-width:260px;';
    panel.innerHTML = `<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="refpick-poly-mode"> Modo polígono (sin globo)</label>
      <b>Puntos de zona</b><br>
      <span id="refpick-count">pieza actual: 0 puntos · piezas cerradas: 0</span><br>
      <button type="button" id="refpick-undo-point" style="margin-top:6px">Eliminar último punto</button>
      <button type="button" id="refpick-clear-current" style="margin-top:6px">Reiniciar pieza actual</button><br>
      <button type="button" id="refpick-close-piece" style="margin-top:6px">Cerrar pieza y empezar otra</button><br>
      <button type="button" id="refpick-copy-poly" style="margin-top:6px">Copiar todo</button>
      <button type="button" id="refpick-reset" style="margin-top:6px">Reiniciar todo</button>`;
    document.body.appendChild(panel);
    const polyModeCheckbox = document.getElementById('refpick-poly-mode');
    function refreshRefpickPanel(){
      document.getElementById('refpick-count').textContent =
        `pieza actual: ${refpickCurrent.length} punto${refpickCurrent.length===1?'':'s'} · piezas cerradas: ${refpickPieces.length}`;
      if(refpickPreview) regnumMap.removeLayer(refpickPreview);
      refpickPreview = null;
      // Las piezas tildadas (ver lista en "Editor de zonas") se dibujan
      // distinto de las destildadas — así se ve de un vistazo cuáles se
      // van a guardar si se toca "Guardar zona" ahora mismo, y cuáles
      // quedan aparte (guardadas para otra zona, sin tocar).
      const checkedRings = refpickPieces.filter((_,i)=> refpickPieceChecked[i] !== false);
      const uncheckedRings = refpickPieces.filter((_,i)=> refpickPieceChecked[i] === false);
      const armedRings = [...checkedRings, refpickCurrent].filter(a=>a.length>=2);
      const layers = [];
      if(armedRings.length){
        layers.push(L.polygon(armedRings.map(a=>a.map(p=>tileToLatLng(p.col,p.row))), {color:'#e8c14a', weight:2, fillOpacity:0.12, dashArray:'4,4'}));
      }
      if(uncheckedRings.length){
        layers.push(L.polygon(uncheckedRings.map(a=>a.map(p=>tileToLatLng(p.col,p.row))), {color:'#777', weight:2, fillOpacity:0.05, dashArray:'2,6'}));
      }
      if(layers.length){
        refpickPreview = L.layerGroup(layers).addTo(regnumMap);
      }
      // El panel del editor de zonas (más abajo) tiene la lista de piezas
      // con sus checkboxes — se refresca acá también para no duplicar
      // esta lógica en dos lugares (declarada como function así queda
      // "hoisted" y se puede llamar aunque esté definida más abajo).
      ztRenderPieceList();
    }
    document.getElementById('refpick-undo-point').addEventListener('click', ()=>{
      // Solo saca de la pieza que se está dibujando ahora — las piezas ya
      // cerradas (refpickPieces) no se tocan, para eso está "Reiniciar
      // pieza actual" o "Reiniciar todo" más abajo.
      refpickCurrent.pop();
      refreshRefpickPanel();
    });
    document.getElementById('refpick-clear-current').addEventListener('click', ()=>{
      // Igual que el botón de arriba pero de una: vacía la pieza sin
      // cerrar entera, sin tocar las que ya quedaron cerradas.
      refpickCurrent = [];
      refreshRefpickPanel();
    });
    document.getElementById('refpick-close-piece').addEventListener('click', function(){
      if(refpickCurrent.length < 3){
        this.textContent = 'Faltan puntos (mín. 3)';
        setTimeout(()=> this.textContent = 'Cerrar pieza y empezar otra', 1200);
        return;
      }
      refpickPieces.push(refpickCurrent);
      refpickPieceChecked.push(true);
      refpickPieceSource.push(null);
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
      refpickPieceChecked.length = 0;
      refpickPieceSource.length = 0;
      refpickCurrent = [];
      refreshRefpickPanel();
    });
    // El checkbox decide cuál de las dos cosas hace cada click — antes
    // hacía las dos siempre, y el globo de referencia (pensado para un
    // punto suelto) se volvía molesto al ir clickeando muchos puntos
    // seguidos para armar un polígono.
    regnumMap.on('click', (e)=>{
      const pt = regnumMap.project(e.latlng, 0);
      const col = Number((pt.x/TILE_SIZE).toFixed(3));
      const row = Number((pt.y/TILE_SIZE).toFixed(3));
      if(polyModeCheckbox.checked){
        refpickCurrent.push({col, row});
        refreshRefpickPanel();
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

    // ------------------------------------------------------------------
    // Editor de zonas: lista las zonas ya cargadas, permite cargar una
    // para seguir agregándole piezas/mobs/materiales, sacarle o agregarle
    // mobs/materiales sueltos, guardarla (a la lista de cambios
    // pendientes) o marcarla para eliminar. Todo junto se copia con
    // "Exportar cambios" — mismo mecanismo que el modo edición de NPCs/
    // lugares (sin backend, alguien tiene que aplicar el export a mano).
    const zonePanel = document.createElement('div');
    zonePanel.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;background:#0f1410;border:1px solid #2c3a2a;color:#e7ecdf;font-family:monospace;font-size:12px;padding:10px;border-radius:6px;max-width:280px;max-height:82vh;overflow-y:auto;';
    zonePanel.innerHTML = `
      <b>Editor de zonas</b>
      <div style="margin-top:6px">Zonas existentes:</div>
      <select id="zt-list" style="width:100%;margin-top:2px;box-sizing:border-box"></select>
      <div style="margin-top:6px;display:flex;gap:6px;">
        <button type="button" id="zt-load" style="flex:1">Cargar</button>
        <button type="button" id="zt-delete" style="flex:1">Eliminar</button>
      </div>
      <hr style="border-color:#2c3a2a;margin:10px 0">
      <div>Nombre de la zona:</div>
      <input type="text" id="zt-name" style="width:100%;box-sizing:border-box;margin:2px 0 6px">
      <div>Reino:</div>
      <select id="zt-reino" style="width:100%;box-sizing:border-box;margin:2px 0 6px">
        <option value="Syrtis">Syrtis</option>
        <option value="Alsius">Alsius</option>
        <option value="Ignis">Ignis</option>
      </select>
      <div style="color:#9fae95">Piezas dibujadas (tildadas = se guardan con esta zona; el panel de abajo es para dibujar más):</div>
      <div id="zt-piece-list" style="max-height:110px;overflow-y:auto;margin:4px 0 6px;padding:4px;background:#161d17;border:1px solid #2c3a2a;border-radius:4px"></div>
      <div style="margin-top:8px"><b>Mobs</b></div>
      <ul id="zt-mobs-list" style="margin:4px 0;padding-left:18px"></ul>
      <div style="display:flex;gap:4px">
        <input type="text" id="zt-mob-name" placeholder="Nombre" style="flex:2;min-width:0">
        <input type="text" id="zt-mob-nivel" placeholder="Nivel" style="flex:1;min-width:0">
      </div>
      <button type="button" id="zt-mob-add" style="margin-top:4px;width:100%">Agregar mob</button>
      <div style="margin-top:8px"><b>Jefes</b> <span style="color:#9fae95;font-weight:normal">(mobs especiales, con etiqueta de rareza)</span></div>
      <ul id="zt-jefes-list" style="margin:4px 0;padding-left:18px"></ul>
      <div style="display:flex;gap:4px">
        <input type="text" id="zt-jefe-name" placeholder="Nombre" style="flex:2;min-width:0">
        <input type="text" id="zt-jefe-etiqueta" placeholder="Etiqueta (Campeón, Legendario...)" style="flex:2;min-width:0">
        <input type="text" id="zt-jefe-nivel" placeholder="Nivel" style="flex:1;min-width:0">
      </div>
      <button type="button" id="zt-jefe-add" style="margin-top:4px;width:100%">Agregar jefe</button>
      <div style="margin-top:8px"><b>Materiales</b></div>
      <ul id="zt-mats-list" style="margin:4px 0;padding-left:18px"></ul>
      <input type="text" id="zt-mat-name" placeholder="Nombre" style="width:100%;box-sizing:border-box">
      <button type="button" id="zt-mat-add" style="margin-top:4px;width:100%">Agregar material</button>
      <hr style="border-color:#2c3a2a;margin:10px 0">
      <button type="button" id="zt-save" style="width:100%">Guardar zona (a cambios pendientes)</button>
      <div style="margin-top:6px">Cambios pendientes: <span id="zt-changes-count">0</span></div>
      <button type="button" id="zt-export" style="margin-top:4px;width:100%">Exportar cambios</button>
      <button type="button" id="zt-clear-exported" style="margin-top:4px;width:100%">Limpiar cambios ya exportados</button>
    `;
    document.body.appendChild(zonePanel);

    let ztMobs = [];
    let ztJefes = [];
    let ztMats = [];

    function ztRefreshChangesCount(){
      document.getElementById('zt-changes-count').textContent = zoneToolChanges.length;
    }
    function ztRefreshLists(){
      // Se ordena EN el mismo array (sort muta in-place) antes de mostrar
      // -- así el índice que ve cada botón "✕" en el HTML coincide con el
      // índice real en el array para el splice() de abajo, ya ordenado.
      ztMobs.sort((a, b) => nivelSortKey(a.nivel) - nivelSortKey(b.nivel));
      ztJefes.sort((a, b) => nivelSortKey(a.nivel) - nivelSortKey(b.nivel));
      const mobsUl = document.getElementById('zt-mobs-list');
      mobsUl.innerHTML = ztMobs.map((it,i)=>`<li>${it.nombre} · Nv.${it.nivel||'?'} <a href="#" data-i="${i}" class="zt-mob-del" style="color:#c0392b;text-decoration:none">✕</a></li>`).join('');
      mobsUl.querySelectorAll('.zt-mob-del').forEach(a=> a.addEventListener('click', (e)=>{ e.preventDefault(); ztMobs.splice(+a.dataset.i, 1); ztRefreshLists(); }));
      const jefesUl = document.getElementById('zt-jefes-list');
      jefesUl.innerHTML = ztJefes.map((it,i)=>`<li>${it.nombre} (${it.etiqueta||'?'}) · Nv.${it.nivel||'?'} <a href="#" data-i="${i}" class="zt-jefe-del" style="color:#c0392b;text-decoration:none">✕</a></li>`).join('');
      jefesUl.querySelectorAll('.zt-jefe-del').forEach(a=> a.addEventListener('click', (e)=>{ e.preventDefault(); ztJefes.splice(+a.dataset.i, 1); ztRefreshLists(); }));
      const matsUl = document.getElementById('zt-mats-list');
      matsUl.innerHTML = ztMats.map((it,i)=>`<li>${it.nombre} <a href="#" data-i="${i}" class="zt-mat-del" style="color:#c0392b;text-decoration:none">✕</a></li>`).join('');
      matsUl.querySelectorAll('.zt-mat-del').forEach(a=> a.addEventListener('click', (e)=>{ e.preventDefault(); ztMats.splice(+a.dataset.i, 1); ztRefreshLists(); }));
    }
    function ztApplyLive(entry){
      // Aplica el mismo cambio (guardar/actualizar o eliminar) también
      // en vivo, sobre el mapa que se está viendo ahora mismo — para
      // poder probar cómo queda de una, sin tener que exportar, mandarlo
      // y esperar a que se aplique de verdad al sitio. Es solo en este
      // navegador y se pierde al recargar la página; lo único que
      // persiste de verdad es "Exportar cambios".
      regnumMapData.zonas = regnumMapData.zonas || [];
      if(entry.eliminar){
        regnumMapData.zonas = regnumMapData.zonas.filter(z=> z.nombre !== entry.eliminar);
      } else {
        // Copia aparte, no el mismo objeto que se guardó en
        // zoneToolChanges: buildRegnumZones() le cuelga un ._leaflet (el
        // polígono de Leaflet, que tiene referencias circulares) a cada
        // zona de regnumMapData — si fuera el mismo objeto, "Exportar
        // cambios" (JSON.stringify de zoneToolChanges) reventaba con
        // "Converting circular structure to JSON".
        const copia = {...entry};
        const idx = regnumMapData.zonas.findIndex(z=> z.nombre === entry.nombre);
        if(idx >= 0) regnumMapData.zonas[idx] = copia;
        else regnumMapData.zonas.push(copia);
      }
    }
    function ztGetCurrentZone(nombre){
      // El estado "actual" de una zona: si en esta misma sesión ya hay
      // un cambio pendiente para ese nombre (se le sacaron piezas para
      // armar otra zona, se le editaron mobs, etc.), se parte de ahí —
      // si no, del dato ya cargado. Sin esto, usar la misma zona de
      // origen dos veces seguidas en una sesión "olvida" lo que ya se
      // le había sacado la primera vez.
      for(let i = zoneToolChanges.length - 1; i >= 0; i--){
        if(zoneToolChanges[i].nombre === nombre) return zoneToolChanges[i];
      }
      return (regnumMapData.zonas||[]).find(zz=> zz.nombre === nombre) || null;
    }
    function ztRenderPieceList(){
      const box = document.getElementById('zt-piece-list');
      if(!box) return;
      const nombreActual = document.getElementById('zt-name')?.value.trim();
      const rows = refpickPieces.map((ring,i)=>{
        const src = refpickPieceSource[i];
        // Si la pieza vino de la misma zona que se está armando ahora,
        // mostrar el origen es redundante (obvio, es la que se cargó) —
        // solo importa avisar cuando es de OTRA zona distinta.
        const tag = (src && src !== nombreActual) ? ` <span style="color:#9fae95">— de "${src}"</span>` : '';
        return `<label style="display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer">
           <input type="checkbox" class="zt-piece-chk" data-i="${i}" ${refpickPieceChecked[i] !== false ? 'checked' : ''}>
           Pieza ${i+1} (${ring.length} puntos)${tag}
         </label>`;
      });
      if(refpickCurrent.length >= 3){
        rows.push(`<div style="color:#9fae95;padding:2px 0">Pieza actual sin cerrar (${refpickCurrent.length} puntos) — se incluye siempre</div>`);
      }
      box.innerHTML = rows.length ? rows.join('') : '<span style="color:#9fae95">(ninguna todavía)</span>';
      box.querySelectorAll('.zt-piece-chk').forEach(chk=>{
        chk.addEventListener('change', ()=>{
          refpickPieceChecked[+chk.dataset.i] = chk.checked;
          refreshRefpickPanel();
        });
      });
    }
    function ztRefreshZoneList(){
      const sel = document.getElementById('zt-list');
      const zonas = regnumMapData.zonas || [];
      sel.innerHTML = zonas.map(z=>
        `<option value="${z.nombre.replace(/"/g,'&quot;')}">${z.nombre} (${z.reino}) — ${(z.mobs||[]).length} mobs, ${(z.jefes||[]).length} jefes, ${(z.materiales||[]).length} mat.</option>`
      ).join('');
    }
    // Si se edita el nombre a mano, la lista de piezas se refresca — así
    // la etiqueta "de tal zona" (que se oculta cuando coincide con el
    // nombre actual) queda al día sin esperar a otra acción.
    document.getElementById('zt-name').addEventListener('input', ()=> ztRenderPieceList());
    document.getElementById('zt-mob-add').addEventListener('click', ()=>{
      const nombre = document.getElementById('zt-mob-name').value.trim();
      const nivel = document.getElementById('zt-mob-nivel').value.trim();
      if(!nombre) return;
      ztMobs.push({nombre, nivel});
      document.getElementById('zt-mob-name').value = '';
      document.getElementById('zt-mob-nivel').value = '';
      ztRefreshLists();
    });
    document.getElementById('zt-jefe-add').addEventListener('click', ()=>{
      const nombre = document.getElementById('zt-jefe-name').value.trim();
      const etiqueta = document.getElementById('zt-jefe-etiqueta').value.trim();
      const nivel = document.getElementById('zt-jefe-nivel').value.trim();
      if(!nombre) return;
      ztJefes.push({nombre, etiqueta, nivel});
      document.getElementById('zt-jefe-name').value = '';
      document.getElementById('zt-jefe-etiqueta').value = '';
      document.getElementById('zt-jefe-nivel').value = '';
      ztRefreshLists();
    });
    document.getElementById('zt-mat-add').addEventListener('click', ()=>{
      const nombre = document.getElementById('zt-mat-name').value.trim();
      if(!nombre) return;
      ztMats.push({nombre});
      document.getElementById('zt-mat-name').value = '';
      ztRefreshLists();
    });
    document.getElementById('zt-load').addEventListener('click', ()=>{
      const nombre = document.getElementById('zt-list').value;
      // Se usa el estado más actualizado (si ya se le sacaron piezas o
      // se le cambiaron mobs/materiales en esta misma sesión, eso es lo
      // que se carga) — no el dato original, para no volver a ofrecer
      // piezas que ya se le dieron a otra zona nueva.
      const z = ztGetCurrentZone(nombre);
      if(!z) return;
      document.getElementById('zt-name').value = nombre;
      document.getElementById('zt-reino').value = z.reino || 'Syrtis';
      ztMobs = (z.mobs||[]).map(it=>({...it}));
      ztJefes = (z.jefes||[]).map(it=>({...it}));
      ztMats = (z.materiales||[]).map(it=>({...it}));
      ztRefreshLists();
      // Antes de traer las piezas de esta zona, sacamos de la lista
      // cualquier pieza que hubiera quedado ahí de haber "Cargado" OTRA
      // zona existente antes (repasarla no debe dejarla pegada para
      // siempre) — pero las que dibujaste vos a mano en esta sesión y
      // todavía no guardaste (source null) se respetan tal cual.
      const keepPieces = [], keepChecked = [], keepSource = [];
      refpickPieces.forEach((p,i)=>{
        if(!refpickPieceSource[i]){ keepPieces.push(p); keepChecked.push(refpickPieceChecked[i]); keepSource.push(refpickPieceSource[i]); }
      });
      refpickPieces.length = 0; keepPieces.forEach(p=> refpickPieces.push(p));
      refpickPieceChecked.length = 0; keepChecked.forEach(c=> refpickPieceChecked.push(c));
      refpickPieceSource.length = 0; keepSource.forEach(s=> refpickPieceSource.push(s));
      // Y ahora sí sumamos las piezas propias de esta zona, tildadas y
      // etiquetadas con su nombre (para que se vea de dónde vinieron).
      (z.poligonos||[]).forEach(pieza=> { refpickPieces.push(pieza); refpickPieceChecked.push(true); refpickPieceSource.push(nombre); });
      refpickCurrent = [];
      refreshRefpickPanel();
    });
    document.getElementById('zt-delete').addEventListener('click', ()=>{
      const nombre = document.getElementById('zt-list').value;
      if(!nombre) return;
      if(!confirm(`¿Marcar "${nombre}" para eliminar? La saca ya mismo del mapa que estás viendo (para probar) — el archivo de datos real recién cambia cuando se exporten los cambios y se apliquen.`)) return;
      const entry = {eliminar: nombre};
      zoneToolChanges.push(entry);
      ztApplyLive(entry);
      saveZoneToolChanges();
      ztRefreshChangesCount();
      buildRegnumZones();
      ztRefreshZoneList();
    });
    document.getElementById('zt-save').addEventListener('click', ()=>{
      const nombre = document.getElementById('zt-name').value.trim();
      const reino = document.getElementById('zt-reino').value;
      if(!nombre){ alert('Falta el nombre de la zona.'); return; }
      // Solo las piezas tildadas en la lista de arriba entran en esta
      // zona — así piezas pensadas para otra zona distinta no se cuelan
      // acá. La pieza actual sin cerrar (si tiene forma) se suma siempre,
      // igual que antes.
      const checkedIdx = refpickPieces.map((_,i)=>i).filter(i=> refpickPieceChecked[i] !== false);
      const poligonos = [...checkedIdx.map(i=> refpickPieces[i]), ...(refpickCurrent.length>=3 ? [refpickCurrent] : [])];
      if(poligonos.length === 0){ alert('No hay ninguna pieza tildada para guardar — dibujá una (panel de abajo), tildá alguna de la lista de piezas, o "Cargar" una zona existente para seguir agregándole cosas.'); return; }
      const entradas = [{nombre, reino, poligonos, mobs: ztMobs, jefes: ztJefes, materiales: ztMats}];
      // Si alguna pieza tildada vino de OTRA zona ya existente (se trajo
      // acá con "Cargar" y se reusa con un nombre distinto), esa pieza
      // se saca también de la zona de origen — si no, queda viviendo
      // duplicada en las dos a la vez (esto fue justo lo que pasó con
      // "Zona de prueba" al separar las primeras zonas por nombre).
      const porOrigen = new Map(); // nombre de zona de origen -> Set de piezas (por referencia) a sacarle
      checkedIdx.forEach(i=>{
        const src = refpickPieceSource[i];
        if(src && src !== nombre){
          if(!porOrigen.has(src)) porOrigen.set(src, new Set());
          porOrigen.get(src).add(refpickPieces[i]);
        }
      });
      porOrigen.forEach((piezasASacar, srcNombre)=>{
        const srcActual = ztGetCurrentZone(srcNombre);
        const restantes = (srcActual?.poligonos||[]).filter(r=> !piezasASacar.has(r));
        const srcMobs = srcActual ? (srcActual.mobs||[]) : [];
        const srcJefes = srcActual ? (srcActual.jefes||[]) : [];
        const srcMats = srcActual ? (srcActual.materiales||[]) : [];
        if(restantes.length === 0 && srcMobs.length === 0 && srcJefes.length === 0 && srcMats.length === 0){
          // no le queda nada propio: se marca para eliminar en vez de
          // dejar un cascarón vacío dando vueltas.
          entradas.push({eliminar: srcNombre});
        } else {
          entradas.push({nombre: srcNombre, reino: srcActual ? srcActual.reino : reino, poligonos: restantes, mobs: srcMobs, jefes: srcJefes, materiales: srcMats});
        }
      });
      // Cada entrada se suma a los cambios pendientes (lo que se manda a
      // exportar más tarde) Y se aplica en vivo al mapa que se está
      // viendo ahora — así se puede probar cómo queda de una.
      entradas.forEach(e=>{ zoneToolChanges.push(e); ztApplyLive(e); });
      saveZoneToolChanges();
      ztRefreshChangesCount();
      // Si la zona nueva tiene mobs/materiales pero el checkbox
      // correspondiente estaba apagado, se prende solo — si no, quedaría
      // invisible pese a acabar de guardarla, dando la falsa impresión de
      // que algo salió mal.
      if(ztMobs.length && !document.getElementById('map-toggle-mobs').checked) document.getElementById('map-toggle-mobs').checked = true;
      if(ztJefes.length && !document.getElementById('map-toggle-jefes').checked) document.getElementById('map-toggle-jefes').checked = true;
      if(ztMats.length && !document.getElementById('map-toggle-materiales').checked) document.getElementById('map-toggle-materiales').checked = true;
      buildRegnumZones(); // reconstruye la capa de zonas (aplica los filtros de nuevo al final)
      ztRefreshZoneList();
      // Las piezas recién guardadas se sacan de la lista para que no se
      // vuelvan a colar solas en la próxima zona (era justo el problema:
      // todo lo dibujado quedaba pegado a cada zona que se guardara
      // después). Las que hayan quedado destildadas se mantienen ahí.
      const checkedSet = new Set(checkedIdx);
      const keepPieces = refpickPieces.filter((_,i)=> !checkedSet.has(i));
      const keepChecked = refpickPieceChecked.filter((_,i)=> !checkedSet.has(i));
      const keepSource = refpickPieceSource.filter((_,i)=> !checkedSet.has(i));
      refpickPieces.length = 0; keepPieces.forEach(p=> refpickPieces.push(p));
      refpickPieceChecked.length = 0; keepChecked.forEach(c=> refpickPieceChecked.push(c));
      refpickPieceSource.length = 0; keepSource.forEach(s=> refpickPieceSource.push(s));
      if(refpickCurrent.length>=3) refpickCurrent = [];
      // Y el formulario se limpia entero para la próxima zona — si no, los
      // mobs/materiales cargados acá también se colarían en la próxima
      // por el mismo motivo.
      document.getElementById('zt-name').value = '';
      ztMobs = [];
      ztMats = [];
      ztRefreshLists();
      refreshRefpickPanel();
      alert(`"${nombre}" ya se ve en el mapa (y quedó sumada a los cambios pendientes, ${zoneToolChanges.length} en total, para cuando quieras exportarlos). Las piezas y datos del formulario ya se limpiaron para la próxima zona.`);
    });
    document.getElementById('zt-export').addEventListener('click', function(){
      const json = JSON.stringify(zoneToolChanges, null, 1);
      const box = document.createElement('textarea');
      box.value = json;
      box.readOnly = true;
      box.style.cssText = 'position:fixed;inset:8vh 10vw;z-index:9999;background:#161d17;color:#e7ecdf;border:1px solid #2c3a2a;border-radius:6px;padding:14px;font-family:monospace;font-size:12px;';
      document.body.appendChild(box);
      box.focus();
      box.select();
      navigator.clipboard?.writeText(json).catch(()=>{});
      const closeHint = document.createElement('div');
      closeHint.textContent = 'Copiado al portapapeles. Click afuera del cuadro para cerrar.';
      closeHint.style.cssText = 'position:fixed;left:10vw;top:calc(8vh - 26px);z-index:9999;color:#c9a15a;font-size:12px;';
      document.body.appendChild(closeHint);
      const close = (e)=>{
        if(e.target === box) return;
        box.remove(); closeHint.remove();
        document.removeEventListener('click', close);
      };
      setTimeout(()=> document.addEventListener('click', close), 0);
    });
    document.getElementById('zt-clear-exported').addEventListener('click', ()=>{
      if(!confirm('¿Vaciar la lista de cambios pendientes? Hacé esto solo después de confirmar que el último export ya se aplicó — si todavía no, se pierde ese registro.')) return;
      zoneToolChanges = [];
      saveZoneToolChanges();
      ztRefreshChangesCount();
    });
    ztRefreshChangesCount();
    zoneToolSetupFn = ztRefreshZoneList;
  }

  fetch('data/map-data.json')
    .then(r => r.json())
    .then(data => {
      regnumMapData = data;
      buildRegnumMarkers();
      buildRegnumZones();
      populateRegnumFilters();
      wireRegnumSearchAndFilters();
      zoneToolSetupFn?.();
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
// Ciudad/Pueblo/Aldea(ex-Villa) comparten el ícono de casa, con color de
// reino igual que el resto de los marcadores, y tamaño creciente Aldea <
// Pueblo < Ciudad para diferenciarlas de un vistazo. Puerto usa el tamaño
// de Pueblo (mismo checkbox). "Villa" queda como alias de "Aldea" por si
// algún registro viejo todavía usa ese nombre.
const PLACE_SHAPE = {Ciudad:'ciudad', Pueblo:'pueblo', Puerto:'pueblo', Aldea:'aldea', Villa:'aldea', Muralla:'muralla', Fuerte:'fuerte', Castillo:'castillo', Altar:'altar'};
// muralla agrandada un par de veces ya (15 -> 30 -> 42): con el glifo
// genérico ('▬') quedaba chico y poco legible comparado con el resto, y
// después el ícono SVG nuevo se lucía más grande.
const PLACE_SIZE = {ciudad:34, pueblo:26, aldea:18, castillo:44, fuerte:32, altar:24, muralla:42};
// Cada categoría se filtra con su propio checkbox — ver #map-layers-block.
const PLACE_TOGGLE_ID = {Ciudad:'map-toggle-ciudad', Pueblo:'map-toggle-pueblo', Puerto:'map-toggle-pueblo', Aldea:'map-toggle-aldea', Villa:'map-toggle-aldea', Fuerte:'map-toggle-fuerte', Castillo:'map-toggle-castillo', Muralla:'map-toggle-muralla', Altar:'map-toggle-altar'};
// El carácter de texto "⌂" sale hueco (solo el contorno) en la mayoría de
// las fuentes — no hay forma de "rellenarlo" solo con color de texto. Un
// SVG con fill:currentColor sí queda relleno del color que le pongamos.
const HOUSE_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M12 2 L2 11 L5 11 L5 22 L19 22 L19 11 L22 11 Z"/></svg>';
// Muralla: no es un glifo de texto/SVG como el resto — es un <div> vacío
// que CSS rellena con la imagen data/icons/muralla.svg vía mask-image (ver
// .muralla-icon en css/map.css), así se recolorea por reino igual que los
// demás sin necesitar un archivo distinto por color. Va envuelto en otro
// <div> (.muralla-icon-wrap) que es quien lleva el contorno negro — ver
// el comentario largo en css/map.css sobre por qué no puede ir el mismo
// elemento que tiene el mask-image.
const MURALLA_ICON_HTML = '<div class="muralla-icon-wrap"><div class="muralla-icon"></div></div>';
const PLACE_GLYPH = {ciudad:HOUSE_SVG, pueblo:HOUSE_SVG, aldea:HOUSE_SVG, muralla:MURALLA_ICON_HTML, fuerte:'♜', castillo:'♜', altar:'◎'};

// Dueño actual (según el estado de guerra en vivo de CoRT) de cada
// fuerte/castillo/muralla, por NUESTRO nombre en español — alimentado
// por applyWzFortStatus más abajo, llamada desde js/wz.js cada vez que
// llega dato nuevo (una vez por minuto). Vacío hasta que llega el primer
// dato, o si CoRT no responde — en ese caso el marcador se pinta con su
// reino real de siempre (ver iconFor), no queda "sin color".
let wzLiveFortOwner = {};

function iconFor(m){
  if(m.tipo === 'mision') return L.divIcon({className:'regnum-marker regnum-marker-mision', html:'!', iconSize:[10,14]});
  if(m.tipo === 'npc') return L.divIcon({className:`regnum-marker regnum-marker-npc realm-color-${REALM_SLUG[m.reino]||'syrtis'}`, html:'●', iconSize:[14,14]});
  // ciudad/lugar: la forma sale de la categoría (Ciudad/Fuerte/Castillo/...)
  const shape = PLACE_SHAPE[m.categoria] || 'ciudad';
  const size = PLACE_SIZE[shape] || 34;
  // Fuerte/Castillo/Muralla: si CoRT dice quién lo tiene AHORA, se pinta
  // de ESE reino en vez del original — el nombre en español que se
  // muestra en todos lados (popup, buscador) no cambia, solo el color
  // del ícono en el mapa.
  const liveOwner = (shape === 'fuerte' || shape === 'castillo' || shape === 'muralla') ? wzLiveFortOwner[m.nombre] : null;
  const cls = `regnum-marker regnum-marker-${shape} realm-color-${REALM_SLUG[liveOwner || m.reino]||'syrtis'}`;
  return L.divIcon({className:cls, html:PLACE_GLYPH[shape], iconSize:[size,size]});
}

// Llamada por js/wz.js cada vez que llega un estado de guerra nuevo (ver
// wzTick ahí) — WZ_FORT_NAME_MAP (definido en ese mismo archivo) empareja
// el nombre de CoRT ("Fort Aggersborg (2)") con el nuestro ("Fuerte
// Aggersborg"). Solo repinta los 12 marcadores afectados (setIcon en el
// lugar), no reconstruye toda la capa — así no se cierran popups
// abiertos ni se pierde ningún otro estado por un refresco de fondo.
function applyWzFortStatus(forts){
  if(!Array.isArray(forts) || typeof WZ_FORT_NAME_MAP === 'undefined') return;
  wzLiveFortOwner = {};
  forts.forEach(f=>{
    const nombre = WZ_FORT_NAME_MAP[f.name];
    if(nombre) wzLiveFortOwner[nombre] = f.owner;
  });
  regnumAllMarkerObjs.forEach(m=>{
    if(m.tipo === 'ciudad' && wzLiveFortOwner[m.nombre] !== undefined && m._leaflet){
      m._leaflet.setIcon(iconFor(m));
    }
  });
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

// Mismos colores que .realm-color-syrtis/alsius/ignis (ver css/map.css) —
// una zona se pinta según su reino, igual que ya se distinguen NPCs/
// fuertes/castillos, en vez de según lo que tenga cargado (mobs/
// materiales) como era antes.
const ZONE_COLOR_REINO = { Syrtis: '#7fae5a', Alsius: '#5b9cc9', Ignis: '#c9622f' };
const ZONE_COLOR_DEFAULT = '#a09a8c'; // por si a alguna zona le faltara el reino
// Morado para los jefes en el tooltip -- a propósito distinto de los
// colores de reino (que ya significan otra cosa acá) para que un jefe
// especial resalte de un vistazo en el detalle de la zona.
const JEFE_COLOR = '#a56dd6';

function zoneHasMobs(z){ return (z.mobs||[]).length > 0; }
function zoneHasMateriales(z){ return (z.materiales||[]).length > 0; }
// Jefes: mobs especiales con una etiqueta de rareza (Campeón, Legendario,
// Épico...) -- viven en su propio array (z.jefes) separado de z.mobs para
// poder prenderlos/apagarlos con su propio checkbox independiente.
function zoneHasJefes(z){ return (z.jefes||[]).length > 0; }

// Orden por nivel para mostrar (mobs y jefes): "nivel" es texto libre (en
// general un número como "22", pero el campo del editor no fuerza formato,
// así que también podría ser un rango tipo "5-8") -- se ordena por el
// primer número que aparezca. Sin número (vacío o texto raro) va al final,
// no al principio, para no mezclarse con los niveles bajos reales.
function nivelSortKey(nivel){
  const m = String(nivel == null ? '' : nivel).match(/\d+/);
  return m ? parseInt(m[0], 10) : Infinity;
}
function sortedPorNivel(lista){
  return (lista || []).slice().sort((a, b) => nivelSortKey(a.nivel) - nivelSortKey(b.nivel));
}

function zoneColor(z){
  return ZONE_COLOR_REINO[z.reino] || ZONE_COLOR_DEFAULT;
}

// forzarTodo: cuando la búsqueda muestra una zona a la fuerza (ver
// wireRegnumSearchAndFilters) porque encontró un mob/material puntual
// ahí, se le muestra todo el contenido aunque el checkbox de Mobs o
// Materiales esté apagado — si no, buscar un material y que el tooltip
// no lo muestre por tener Materiales apagado sería muy raro.
function buildZonePopupHTML(z, forzarTodo){
  const mobsOn = forzarTodo || document.getElementById('map-toggle-mobs').checked;
  const matsOn = forzarTodo || document.getElementById('map-toggle-materiales').checked;
  const jefesOn = forzarTodo || document.getElementById('map-toggle-jefes').checked;
  const partes = [`<b>${z.nombre}</b>`, z.reino];
  // Si tenés solo Mobs prendido no hace falta ver los materiales de la
  // zona (y viceversa) — el tooltip muestra nada más lo que se está
  // filtrando en ese momento, no todo lo que la zona tenga cargado.
  // Ordenados por nivel (ver nivelSortKey/sortedPorNivel) para que el
  // detalle de la zona se lea de más fácil a más difícil.
  if(zoneHasMobs(z) && mobsOn){
    partes.push('<u>Mobs</u><br>' + sortedPorNivel(z.mobs).map(it=> `${it.nombre}${it.nivel ? ' · Nv. '+it.nivel : ''}`).join('<br>'));
  }
  if(zoneHasJefes(z) && jefesOn){
    const listaJefes = sortedPorNivel(z.jefes).map(it=> `${it.nombre} (${it.etiqueta})${it.nivel ? ' · Nv. '+it.nivel : ''}`).join('<br>');
    partes.push(`<span style="color:${JEFE_COLOR}"><u>Jefes</u><br>${listaJefes}</span>`);
  }
  if(zoneHasMateriales(z) && matsOn){
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
    // Tooltip (con el mouse encima) en vez de popup (con click): a
    // diferencia de un marcador puntual, pasar el mouse por un área es más
    // natural que tener que acertarle con un click — y así no compite con
    // el resto de la lógica de click de marcadores/edición.
    polygon.bindTooltip(buildZonePopupHTML(z), {sticky:true});
    // El tooltip "sticky" sigue al mouse — si se abre cerca de un borde
    // del recuadro del mapa, sale del contenedor y queda cortado (el
    // contenedor tiene overflow hidden). Se corrige igual que el popup
    // de arriba (mismo cálculo de margen), pero acá hay que repetirlo en
    // cada mousemove, no solo al abrir, porque Leaflet reposiciona el
    // tooltip todo el tiempo mientras el mouse se mueve sobre la zona.
    polygon.on('mousemove tooltipopen', ()=> nudgeZoneTooltip(polygon));
    z._leaflet = polygon;
    regnumAllZoneObjs.push(z);
  });
  applyZoneFilters();
}

function nudgeZoneTooltip(layer){
  const tooltip = layer.getTooltip && layer.getTooltip();
  if(!tooltip || !tooltip.isOpen()) return;
  const el = tooltip.getElement ? tooltip.getElement() : tooltip._container;
  const mapEl = document.getElementById('regnum-map');
  if(!el || !mapEl) return;
  const margin = 10;
  const mr = mapEl.getBoundingClientRect();
  const tr = el.getBoundingClientRect();
  let dx = 0, dy = 0;
  if(tr.left < mr.left + margin) dx = (mr.left + margin) - tr.left;
  else if(tr.right > mr.right - margin) dx = (mr.right - margin) - tr.right;
  if(tr.top < mr.top + margin) dy = (mr.top + margin) - tr.top;
  else if(tr.bottom > mr.bottom - margin) dy = (mr.bottom - margin) - tr.bottom;
  if(dx || dy){
    // Se suma al transform que Leaflet ACABA de aplicarle (por el
    // mousemove), no se reemplaza — mismo truco que con el popup.
    el.style.transform += ` translate(${dx}px, ${dy}px)`;
  }
}

// Una zona puede tener mobs, jefes Y materiales a la vez — se muestra si
// cualquiera de los checkboxes que le correspondan (según lo que tenga
// cargado) está prendido, no necesita que estén todos.
function passesZoneFilters(z){
  const mobsOn = document.getElementById('map-toggle-mobs').checked;
  const matsOn = document.getElementById('map-toggle-materiales').checked;
  const jefesOn = document.getElementById('map-toggle-jefes').checked;
  if(!((zoneHasMobs(z) && mobsOn) || (zoneHasMateriales(z) && matsOn) || (zoneHasJefes(z) && jefesOn))) return false;
  const reino = document.getElementById('map-filter-reino').value;
  if(reino && z.reino !== reino) return false;
  return true;
}

function applyZoneFilters(){
  regnumZonesLayer.clearLayers();
  regnumAllZoneObjs.forEach(z=>{
    // El contenido del tooltip depende de qué checkbox está prendido
    // (ver buildZonePopupHTML) — se rearma acá para que quede al día
    // cada vez que se toca Mobs/Materiales, no solo la primera vez que
    // se construyó la zona.
    z._leaflet.setTooltipContent(buildZonePopupHTML(z));
    if(passesZoneFilters(z)) z._leaflet.addTo(regnumZonesLayer);
  });
}

function editableFieldsFor(m){
  if(m.tipo === 'npc') return [['nombre','Nombre'], ['profesion','Profesión'], ['zona','Zona'], ['reino','Reino']];
  if(m.tipo === 'ciudad') return [['nombre','Nombre'], ['categoria','Categoría'], ['zona','Zona'], ['reino','Reino']];
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
  [...PLACE_TOGGLE_IDS,'map-toggle-npc','map-toggle-mision','map-toggle-mobs','map-toggle-jefes','map-toggle-materiales','map-filter-reino','map-filter-profesion','map-filter-nivel'].forEach(id=>{
    document.getElementById(id).addEventListener('change', refreshMapLayers);
  });

  const input = document.getElementById('map-search');
  const results = document.getElementById('map-search-results');
  function searchGlyph(m){
    if(m.tipo === 'mision') return '!';
    if(m.tipo === 'npc') return '●';
    return PLACE_GLYPH[PLACE_SHAPE[m.categoria] || 'ciudad'];
  }
  // Además de NPCs/misiones/lugares, el buscador encuentra zonas por su
  // nombre, y también por el nombre de cada mob o material que tengan
  // cargado — para poder buscar "Lobo Acechador" o "Mineral de hierro" y
  // que te lleve directo a la zona donde aparecen, no solo al nombre de
  // la zona en sí. Se arma de nuevo en cada búsqueda (son pocas zonas,
  // no vale la pena cachearlo) para reflejar cualquier zona nueva/editada.
  function buildZoneSearchEntries(){
    const entries = [];
    regnumAllZoneObjs.forEach(z=>{
      entries.push({kind:'zona', zona:z, label:z.nombre, meta:`Zona · ${z.reino}`});
      (z.mobs||[]).forEach(mob=> entries.push({kind:'mob', zona:z, label:mob.nombre, meta:`Mob en "${z.nombre}"${mob.nivel ? ' · Nv.'+mob.nivel : ''}`}));
      (z.jefes||[]).forEach(jefe=> entries.push({kind:'jefe', zona:z, label:jefe.nombre, meta:`${jefe.etiqueta||'Jefe'} en "${z.nombre}"${jefe.nivel ? ' · Nv.'+jefe.nivel : ''}`}));
      (z.materiales||[]).forEach(mat=> entries.push({kind:'material', zona:z, label:mat.nombre, meta:`Material en "${z.nombre}"`}));
    });
    return entries;
  }
  function zoneEntryGlyph(kind){
    return kind === 'zona' ? '▦' : kind === 'mob' ? '☠' : kind === 'jefe' ? '★' : '◆';
  }
  input.addEventListener('input', ()=>{
    const q = input.value.trim().toLowerCase();
    if(q.length < 2){ results.classList.remove('is-open'); results.innerHTML=''; return; }
    const markerMatches = regnumAllMarkerObjs.filter(m=> m.nombre.toLowerCase().includes(q)).map(m=>({kind:'marker', m}));
    const zoneMatches = buildZoneSearchEntries().filter(e=> e.label.toLowerCase().includes(q));
    const matches = [...markerMatches, ...zoneMatches].slice(0, 30);
    if(matches.length === 0){ results.classList.remove('is-open'); results.innerHTML=''; return; }
    results.innerHTML = matches.map(match=>{
      if(match.kind === 'marker'){
        const m = match.m;
        return `<div class="map-result-item" data-kind="marker" data-idx="${regnumAllMarkerObjs.indexOf(m)}">
          <div class="mri-name">${searchGlyph(m)} ${m.nombre}</div>
          <div class="mri-meta">${m.tipo==='npc' ? (m.profesion||m.clase||'') : m.tipo==='ciudad' ? (m.categoria==='Altar' && m.zona ? m.zona : m.categoria) : 'Nivel '+m.nivel+' · La da: '+m.la_da} · ${m.reino}</div>
        </div>`;
      }
      return `<div class="map-result-item" data-kind="zona" data-zona="${match.zona.nombre.replace(/"/g,'&quot;')}">
        <div class="mri-name">${zoneEntryGlyph(match.kind)} ${match.label}</div>
        <div class="mri-meta">${match.meta}</div>
      </div>`;
    }).join('');
    results.classList.add('is-open');
    results.querySelectorAll('.map-result-item').forEach(el=>{
      el.addEventListener('click', ()=>{
        results.classList.remove('is-open');
        if(el.dataset.kind === 'zona'){
          const z = regnumAllZoneObjs.find(zz=> zz.nombre === el.dataset.zona);
          if(!z) return;
          input.value = z.nombre;
          regnumMap.fitBounds(z._leaflet.getBounds().pad(0.2));
          if(!regnumZonesLayer.hasLayer(z._leaflet)){
            // Mobs/Materiales apagados, o el reino no calza: se muestra
            // igual porque lo pidió la búsqueda, pero queda anotada para
            // ocultarse de nuevo al cerrar su tooltip (ver tooltipclose
            // en initRegnumMapIfNeeded) — sin tocar ninguna otra zona.
            z._leaflet.addTo(regnumZonesLayer);
            forcedVisibleZoneKey = z.nombre;
          }
          // Se buscó un mob/material puntual (o la zona misma) — se
          // muestra todo el contenido aunque Mobs/Materiales esté
          // apagado, si no el tooltip podría no mostrar justo lo que se
          // encontró. Se restaura al filtro normal en el próximo cambio
          // de checkbox (ver applyZoneFilters).
          z._leaflet.setTooltipContent(buildZonePopupHTML(z, true));
          z._leaflet.openTooltip(z._leaflet.getBounds().getCenter());
          return;
        }
        const m = regnumAllMarkerObjs[parseInt(el.dataset.idx)];
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
