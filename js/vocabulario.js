/* =========================================================================
   vocabulario.js — categorías, nombres y reglas de clasificación, en un
   solo lugar
   Recomendador de build — Champions of Regnum

   Este archivo NO decide el puntaje de nada (eso vive en weights.js) y NO
   asigna categorías a habilidades puntuales (eso vive en el catálogo/Excel
   y termina en data/game-data.json). Lo que sí junta acá:

   - Los nombres visibles de cada categoría (rol grande, rol seleccionable,
     abreviaturas de Contenido).
   - Las REGLAS que arman una categoría compuesta a partir de otras más
     finas — por ejemplo, qué combinaciones de rol/función hacen que una
     habilidad cuente como "Off-Tank".

   Para agregar una categoría nueva (un rol, una función, un valor de
   Contenido) alcanza con sumarla acá — no hace falta tocar engine.js ni
   render.js, salvo que la categoría nueva necesite una regla de
   clasificación realmente distinta a las que ya existen.
   ========================================================================= */
const VOCAB = {

  // Etiqueta grande que se ve junto al nombre de cada habilidad (hasta 2 por
  // habilidad), según tu propia recategorización manual.
  rolGrande: {
    dps: "DPS",
    tank: "Tanque",
    healer: "Curador",
    support: "Soporte",
    cc: "Control",
  },

  // Nombres de los botones de rol en "Build a medida" — mismo vocabulario
  // que el de arriba, ya no hace falta un set separado ni reglas compuestas
  // (Off-Tank/Off-Healer quedaron retirados en la recategorización).
  rolSeleccionableLabel: {
    dps: "DPS",
    tank: "Tanque",
    healer: "Curador",
    support: "Soporte",
    cc: "Control",
  },

  // Con el vocabulario simplificado, cada rol seleccionable coincide
  // directamente con el mismo valor en "cat" — sin reglas compuestas.
  reglasRolSeleccionable: {
    dps: [{ cat: ['dps'] }],
    tank: [{ cat: ['tank'] }],
    healer: [{ cat: ['healer'] }],
    support: [{ cat: ['support'] }],
    cc: [{ cat: ['cc'] }],
  },

  // Abreviaturas de los tags de Contenido que se ven sin desplegar la
  // habilidad (con el nombre completo al pasar el mouse).
  contenidoAbreviaturas: {
    'PvP': 'PVP',
    'PvE': 'PVE',
    'RvR': 'RVR',
    'Grupo PvE': 'GPVE',
    'Grupo PvP': 'GPVP',
    'Leveo PvE': 'LPVE',
    'Leveo grupo PvE': 'LGPVE',
  },
};
