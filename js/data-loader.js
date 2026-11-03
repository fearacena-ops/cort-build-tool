/* =========================================================================
   data-loader.js — carga data/game-data.json y arranca la aplicación
   Recomendador de build — Champions of Regnum

   Se carga último (después de engine.js, render.js y main.js) para que
   ROOT/REQUIRED/initApp ya existan cuando la promesa del fetch se resuelve.
   ========================================================================= */
fetchConTimeout('data/game-data.json')
  .then(res => {
    if(!res.ok) throw new Error('No se pudo cargar data/game-data.json (' + res.status + ')');
    return res.json();
  })
  .then(data => {
    ROOT = data;
    REQUIRED = data.required;
    CLASS = ROOT.classes[currentClass];
    DISC_NAMES = Object.keys(CLASS.disciplines);
    WM_NAME = DISC_NAMES.find(n => CLASS.disciplines[n].group === "wm");
    initApp();
  })
  .catch(err => {
    console.error(err);
    // name === 'AbortError' es lo que tira fetchConTimeout al cortar la
    // espera -- mensaje aparte porque "AbortError" tal cual no le dice
    // nada a quien lo lee, a diferencia de un 404/500 (err.message ya es
    // claro) o de abrir el archivo suelto desde el disco (mensaje de abajo).
    const motivo = err.name === 'AbortError'
      ? 'la conexión tardó demasiado en responder'
      : err.message;
    const wrap = document.querySelector('.wrap');
    if(wrap){
      wrap.insertAdjacentHTML('afterbegin', `<div class="callout warn"><div class="mark">!</div><div>No se pudieron cargar los datos del juego (${motivo}). Revisa tu conexión y recarga la página. Si estás abriendo este archivo directo desde el disco, probalo desde un servidor local o la versión publicada — los navegadores bloquean fetch() sobre archivos file:// por seguridad.</div></div>`);
    }
  });
