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
    healer_self: "Curador (Personal)",
    healer_ally: "Curador (Aliado)",
    healer_pet: "Curador (Mascota)",
    support: "Soporte",
    cc: "Control",
    mobility: "Movilidad",
  },

  // Nombres de los botones de rol en "Build a medida". Vocabulario propio,
  // más amplio que el de arriba porque incluye combinaciones (Off-Tank,
  // Off-Healer) que agrupan varios roles finos a la vez — ver
  // "reglasRolSeleccionable" más abajo para cómo se arma cada uno.
  rolSeleccionableLabel: {
    dps: "DPS",
    tank: "Tanque",
    healer: "Curador",
    support: "Buffer / Debuffer",
    cc: "Control de masas",
    offtank: "Off-Tank",
    offhealer: "Off-Healer",
  },

  // Reglas que definen cuándo una habilidad cuenta para cada rol
  // seleccionable. Cada rol es una lista de "condiciones" — con que cumpla
  // UNA le alcanza. Una condición puede pedir solo "cat" (alguno de estos
  // roles grandes), o "cat" + "funciones" (alguno de estos roles grandes,
  // Y ADEMÁS alguna de estas funciones específicas).
  //
  // Ejemplo de cómo leer "offtank": cuenta si tiene rol Control (cat: cc),
  // O SI ADEMÁS de tener rol Soporte también tiene alguna de esas tres
  // funciones de mitigación/anti-control/agro — es decir, apoyo que
  // protege o controla en vez de apoyo que solo cura o bufea.
  reglasRolSeleccionable: {
    dps: [{ cat: ['dps'] }],
    tank: [{ cat: ['tank'] }],
    healer: [{ cat: ['healer_self', 'healer_ally', 'healer_pet'] }],
    support: [{ cat: ['support'] }],
    cc: [{ cat: ['cc'] }],
    offtank: [
      { cat: ['cc'] },
      { cat: ['support'], funciones: ['Mitigación / absorción', 'Anti-control', 'Amenaza / agro'] },
    ],
    offhealer: [
      { cat: ['healer_ally'] },
      { cat: ['support'], funciones: ['Disipación / limpieza'] },
    ],
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
