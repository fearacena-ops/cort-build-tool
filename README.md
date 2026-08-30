# Recomendador de Build — Champions of Regnum

Herramienta web gratuita para armar builds de las 6 subclases de Champions of Regnum (Cazador, Tirador, Conjurador, Brujo, Bárbaro, Caballero).

**Estado actual**: solo la pestaña **Tu build** está activa — armá tu propia build a mano, punto por punto, con exportación a imagen. **Progreso de leveo** y **Build a medida** están temporalmente desactivadas mientras se termina de actualizar el catálogo de habilidades (roles, funciones y contexto de juego de cada una, categorizados a mano). Van a volver a activarse cuando ese trabajo esté completo.

Incluye tres temas de color (Syrtis, Alsius, Ignis) y es totalmente responsive (celular, tablet, escritorio).

## Sobre los datos

Los datos de disciplinas, habilidades y costos de puntos vienen del proyecto open source [CoRT](https://cort.ovh) (licencia AGPLv3), la fuente de datos del propio Entrenador del juego.

El catálogo se complementa con una capa de categorización manual, revisada habilidad por habilidad:

- **Rol** (DPS / Tanque / Curador / Soporte / Control): el efecto directo e inmediato de la habilidad, no su consecuencia indirecta más lejana.
- **Funciones**: chips más finos (Self_buffer, Self_debuff, Buff, Debuff, Burst, DoT, DPS_melee, DPS_ranged, tipo de daño, etc).
- **Contenido Principal / Secundario**: para qué situación de juego sirve cada habilidad (PvP, PvE, RvR, Grupo PvE, Grupo PvP, Leveo PvE, Leveo grupo PvE).
- **Estadísticas de uso real de la comunidad** (vía la API pública de estadísticas de CoRT), para calibrar qué tan seguido invierte la gente en cada habilidad y hasta qué rango.

## Estructura del proyecto

```
cort-build-tool/
├── index.html              → markup + carga de los archivos de abajo
├── css/
│   └── styles.css          → todos los estilos, incluidos los 3 temas de reino
├── js/
│   ├── weights.js           → todos los pesos numéricos del motor, centralizados
│   ├── vocabulario.js       → nombres de rol/categorías y reglas de coincidencia
│   ├── engine.js            → motor de cálculo puro (sin tocar el DOM)
│   ├── render.js            → funciones que arman HTML (tarjetas, tablas, export)
│   ├── main.js               → estado de la interfaz, botones, arranque (initApp)
│   └── data-loader.js        → pide data/game-data.json y llama a initApp()
└── data/
    ├── game-data.json      → clases, disciplinas, habilidades, puntajes, categorización
    └── icons/               → un .webp por disciplina (hoja de sprites)
```

No hay ningún paso de build: son archivos estáticos que se sirven tal cual — `<script>` clásicos, sin `type="module"`, que comparten alcance entre sí igual que si fuera un solo archivo. Orden de carga: `weights.js` → `vocabulario.js` → `engine.js` → `render.js` → `main.js` → `data-loader.js`.

**Importante**: como `data-loader.js` usa `fetch()` para pedir `data/game-data.json`, el sitio necesita servirse por HTTP — no funciona abriendo `index.html` directo desde el disco (protocolo `file://`), los navegadores bloquean `fetch()` ahí por seguridad. Para probarlo en tu compu, corré un servidor local simple, por ejemplo:

```
python3 -m http.server 8000
```

y abrí `http://localhost:8000`. En Vercel/GitHub Pages esto no es un problema — ya sirven todo por HTTP.

## Dependencias

Ninguna en tiempo de desarrollo. La única dependencia externa en tiempo de ejecución es [html2canvas](https://html2canvas.hertzen.com/) (cargada bajo demanda solo al exportar una build como imagen).

---

*Este es un proyecto de fans, sin afiliación oficial con NGD Studios ni Champions of Regnum.*
