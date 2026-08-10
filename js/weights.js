/* =========================================================================
   weights.js — todos los números que ajustan el puntaje, en un solo lugar
   Recomendador de build — Champions of Regnum

   Este archivo NO contiene lógica de cálculo, solo valores. Se carga antes
   que engine.js, que lee estos números en vez de tenerlos escritos adentro
   de cada función. La idea: para cambiar cuánto pesa algo, alcanza con
   tocar un número acá — no hace falta encontrar la línea exacta dentro del
   motor ni entender cómo está armada la fórmula completa.

   Todos los valores de acá son ADITIVOS a la puntuación base de una
   habilidad (sp.lvl o sp.pvp, de 0 a 3), salvo donde se aclara lo
   contrario (el rol elegido MULTIPLICA en vez de sumar).
   ========================================================================= */
const WEIGHTS = {

  // Cuánto más vale una habilidad cuando su "Contenido" (para qué contexto
  // sirve, según tu propia clasificación) coincide con lo que se está
  // buscando. Principal pesa más que Secundario porque es el uso que vos
  // marcaste como el más importante de esa habilidad.
  contenido: {
    principal: 1.2,
    secundario: 0.5,
  },

  // El rol que elegís en "Build a medida" (DPS, Tanque, Curador, etc) no
  // suma un número fijo — MULTIPLICA la puntuación que la habilidad ya
  // tenía. Coincide con el rol → se multiplica por "coincide" (la vuelve
  // bastante más atractiva). No coincide → se multiplica por "noCoincide"
  // (un descuento suave, no la elimina).
  rolElegido: {
    multiplicadorCoincide: 1.8,
    multiplicadorNoCoincide: 0.9,
  },

  // Empujón fijo para la disciplina que marcaste como prioritaria en
  // "Build a medida". Se suma DESPUÉS del multiplicador de rol, a propósito
  // — es una preferencia tuya aparte, no algo que deba amplificarse si
  // además coincide con el rol elegido.
  disciplinaPrioritaria: 1.5,

  // Empujón fijo para cualquier habilidad que suba el atributo principal
  // de tu clase (Destreza para Arquero, Fuerza para Guerrero, Inteligencia
  // para Mago, Constitución para Caballero).
  atributoPrincipal: 1.2,

  // Penalización fija para habilidades con un costo propio real — un
  // "trade-off" que se aplica a vos mismo, no al enemigo (como Instancia
  // ofensiva, que sube daño a costa de tu propia protección).
  costoPropio: -0.3,

  // Bonos específicos de "Progreso de leveo" (Cazador, Guerrero, etc.
  // levando, en solitario o en grupo).
  leveo: {
    aoeEnGrupo: 1.5,        // habilidades de área, solo cuando levéas en grupo
    utilidadGrupal: 0.5,    // habilidades pensadas para grupo, solo en grupo
    sostenSolo: 1.5,        // habilidades que te ayudan a sostenerte vos solo
    personalSolo: 1,        // buffs/beneficios personales, solo en solitario
    defensaSolo: 0.6,       // cualquier habilidad de rol Tanque, solo en solitario
    aura: 2,                // habilidades tipo Aura — dan experiencia pasiva
                             // por cercanía incluso solo, clave desde nivel 40
                             // para las misiones de Zona de Guerra
  },

  // Bonos de "Build a medida" según el contexto elegido (PvE/PvP/RvR,
  // en solitario o en grupo) — cuánto más vale un ataque en área, una
  // habilidad pensada para grupo, o una pensada específicamente para RvR.
  buildAMedida: {
    grupo_pve: { area: 1.5, grupo: 1,   rvr: 0 },
    solo_pve:  { area: 0,   grupo: 0,   rvr: 0 },
    grupo_pvp: { area: 1,   grupo: 1.5, rvr: 0 },
    solo_pvp:  { area: 0,   grupo: 0,   rvr: 0 },
    rvr:       { area: 1,   grupo: 1,   rvr: 2 },
  },

  // Cómo se decide qué disciplinas compiten por puntos: una disciplina
  // se descarta de la primera ronda si su puntaje total queda muy por
  // debajo de la mejor (ratioPoda), salvo que tenga al menos una habilidad
  // individual con puntaje alto de verdad (puntajeMinimoIndividual) — ahí
  // se la deja competir igual, aunque el resto de la disciplina sea floja.
  seleccionDisciplinas: {
    ratioPoda: 0.25,
    puntajeMinimoIndividual: 4.5,
  },
};
