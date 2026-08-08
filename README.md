# Recomendador de Build — Champions of Regnum

Herramienta web gratuita para armar builds de las 6 subclases de Champions of Regnum (Cazador, Tirador, Conjurador, Brujo, Bárbaro, Caballero), con tres formas de uso:

- **Progreso de leveo**: te arma la progresión de puntos piso a piso, desde tu nivel actual hasta la meta, con desglose nivel a nivel.
- **Build a medida**: generá una build a nivel 60 según prioridad de disciplina, rol (DPS/CC/Apoyo/Tanque/Flanqueador) y contexto de juego (PvE, PvP, RvR, solo o en grupo).
- **Tu build**: armá tu propia build a mano, punto por punto, con exportación a imagen.

Incluye tres temas de color (Syrtis, Alsius, Ignis) y es totalmente responsive (celular, tablet, escritorio).

## Sobre los datos

Los datos de disciplinas, habilidades y costos de puntos vienen del proyecto open source [CoRT](https://cort.ovh) (licencia AGPLv3), la fuente de datos del propio Entrenador del juego. Las prioridades de las builds automáticas combinan:

- Descripciones y mecánicas reales de cada habilidad.
- Estadísticas de uso real de la comunidad (vía la API pública de estadísticas de CoRT), para calibrar qué tan seguido invierte la gente en cada habilidad y hasta qué rango.
- Guías e información de la comunidad y de la wiki oficial.

## Estructura del proyecto

```
cort-build-tool/
├── index.html              → markup + carga de los archivos de abajo
├── css/
│   └── styles.css          → todos los estilos, incluidos los 3 temas de reino
├── js/
│   ├── engine.js           → motor de cálculo puro (sin tocar el DOM)
│   ├── render.js           → funciones que arman HTML (tarjetas, tablas, export)
│   ├── main.js              → estado de la interfaz, botones, arranque (initApp)
│   └── data-loader.js       → pide data/game-data.json y llama a initApp()
└── data/
    ├── game-data.json      → clases, disciplinas, habilidades, puntajes
    └── icons/               → un .webp por disciplina (hoja de sprites)
```

No hay ningún paso de build: son archivos estáticos que se sirven tal cual — `<script>` clásicos, sin `type="module"`, que comparten alcance entre sí igual que si fuera un solo archivo.

**Importante**: como `data-loader.js` usa `fetch()` para pedir `data/game-data.json`, el sitio necesita servirse por HTTP — no funciona abriendo `index.html` directo desde el disco (protocolo `file://`), los navegadores bloquean `fetch()` ahí por seguridad. Para probarlo en tu compu, corré un servidor local simple, por ejemplo:

```
python3 -m http.server 8000
```

y abrí `http://localhost:8000`. En Vercel/GitHub Pages esto no es un problema — ya sirven todo por HTTP.

## Dependencias

Ninguna en tiempo de desarrollo. La única dependencia externa en tiempo de ejecución es [html2canvas](https://html2canvas.hertzen.com/) (cargada bajo demanda solo al exportar una build como imagen).

---

*Este es un proyecto de fans, sin afiliación oficial con NGD Studios ni Champions of Regnum.*
