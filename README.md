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

## Sobre este archivo

Es un único archivo HTML autocontenido (HTML + CSS + JavaScript, sin dependencias de build ni backend). Todo el motor de cálculo corre en el navegador. La única dependencia externa es [html2canvas](https://html2canvas.hertzen.com/) (cargada bajo demanda solo al exportar una build como imagen).

## Desarrollo

No hace falta ningún paso de build. Para probarlo localmente, simplemente abrí `index.html` en el navegador.

---

*Este es un proyecto de fans, sin afiliación oficial con NGD Studios ni Champions of Regnum.*
