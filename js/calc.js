/* ========================================================================
   calc.js — pestaña "Calculador de daños". Implementa la fórmula oficial
   de daño publicada por NGD (ver FormulaDañoRegnumOficial.txt):
   - Daño infligido: PASO 1 (daño de arma por tipo), PASO 2 (bono de
     atributo + BCMT repartido proporcionalmente) y PASO 3 (daño final,
     min/max en vez de tirada aleatoria -- igual que la Hoja de
     Personaje). Verificado exacto contra el caso de uso oficial del
     documento (Espada Ancestral -> 918-964).
   - Armadura y resistencias: PASO 1 (protección por tipo, según PBA +
     calidad de cada pieza + Clase de Armadura) y PASO 2 (resistencias
     porcentuales, tal cual se cargaron). No simula un golpe recibido
     (necesitaría modelar un atacante) -- muestra el perfil defensivo
     propio, como "Armor Bonus%"/"Resist%" en calculadoras de referencia
     (ver poludnica.shinyapps.io/rcalc).

   Cada pieza de equipo es genérica: hasta 7 filas de "stat suelto"
   (catálogo STAT_CATALOG más abajo) en vez de nombre de ítem + campos
   fijos -- así no importa que dos ítems compartan nombre con distinto
   nivel/rareza, y cubre piezas de armadura reales (Armadura + las 6
   calidades de protección por tipo = 7 líneas, visto en tooltips reales).
   ======================================================================== */
(function(){

  const ATTR_BONUS_FORMULA = {
    barbaro:   {attr:'STR', mult:2.0},
    caballero: {attr:'STR', mult:1.5},
    tirador:   {attr:'DXT', mult:1.5},
    cazador:   {attr:'DXT', mult:1.0},
    brujo:     {attr:'INT', mult:1.75},
    conjurador:{attr:'INT', mult:1.3},
  };
  const ARMOR_CLASS = {barbaro:1.40, caballero:1.40, tirador:1.35, cazador:1.30, conjurador:1.20, brujo:1.20};
  const SUBCLASS_LABEL = {barbaro:'Bárbaro', caballero:'Caballero', tirador:'Tirador', cazador:'Cazador', brujo:'Brujo', conjurador:'Conjurador'};
  const SUBCLASS_CLASS = {barbaro:'Guerrero', caballero:'Guerrero', tirador:'Arquero', cazador:'Arquero', brujo:'Mago', conjurador:'Mago'};
  const ATTR_LABEL = {INT:'Inteligencia', DXT:'Destreza', CONC:'Concentración', STR:'Fuerza', CON:'Constitución'};

  const DAMAGE_TYPES = [
    {key:'cortante', label:'Cortante'},
    {key:'punzante', label:'Punzante'},
    {key:'aplastante', label:'Aplastante'},
    {key:'fuego', label:'Fuego'},
    {key:'frio', label:'Frío'},
    {key:'electrico', label:'Eléctrico'},
  ];
  const QUALITY_LEVELS = ['Muy Mala','Mala','Normal','Buena','Muy Buena'];
  const QUALITY_FACTOR = {'Muy Mala':0.2, 'Mala':0.35, 'Normal':0.5, 'Buena':0.65, 'Muy Buena':0.8};

  // Cuánto aporta cada pieza de armadura a la Armadura total (ver PASO 1a
  // de la fórmula de Armadura y Resistencias) -- "role" en CALC_SLOTS
  // referencia esta tabla, no el nombre del slot, para que subclases
  // futuras con otros nombres de pieza reusen lo mismo.
  const ROLE_DISTRIBUTION = {torso:0.28, cabeza:0.24, piernas:0.20, brazos:0.16, guanteletes:0.12, escudo:0.25, manoderecha:0.20};

  const STAT_ROWS_PER_SLOT = 7; // ver comentario de arriba: PBA + 6 calidades de protección es el máximo real visto

  // Catálogo de stats sueltos que puede dar CUALQUIER pieza. "kind" define
  // qué sub-campos pide la fila:
  //  - flatAttr: sub = atributo (INT/DXT/CONC/STR/CON), value = número
  //  - typedRange: sub = tipo de daño, value/value2 = mínimo/máximo
  //  - typedFlat: sub = tipo de daño, value = número
  //  - typedQuality: sub = tipo de daño, value = una de QUALITY_LEVELS
  //  - plain: value = número, sin sub-campo
  const STAT_CATALOG = [
    {key:'flatAttr', label:'Atributo (+X)', kind:'flatAttr', group:'Atributos'},
    {key:'armorBase', label:'Armadura (PBA) +X', kind:'plain', group:'Armadura'},
    {key:'protectionQuality', label:'Calidad de protección (tipo)', kind:'typedQuality', group:'Armadura'},
    {key:'weaponQuality', label:'Calidad de ítem / BCMT (+X)', kind:'plain', group:'Armadura y daño'},
    {key:'dmgRange', label:'Daño de arma (mín-máx, tipo)', kind:'typedRange', group:'Daño'},
    {key:'dmgExtraFlat', label:'Daño adicional (tipo) +X', kind:'typedFlat', group:'Daño'},
    {key:'dmgPercentType', label:'+% Daño (tipo)', kind:'typedFlat', group:'Daño'},
    {key:'gemDamage', label:'Daño de gema (tipo) +X', kind:'typedFlat', group:'Daño'},
    {key:'weaponDamagePercentGlobal', label:'+% Daño de Arma (global)', kind:'plain', group:'Daño'},
    {key:'damageBonusFlat', label:'Bonus de Daño +X (plano)', kind:'plain', group:'Daño'},
    {key:'damageBonusPercent', label:'Bonus de Daño +%', kind:'plain', group:'Daño'},
    {key:'critChance', label:'Chance de crítico +%', kind:'plain', group:'Combate'},
    {key:'critDamagePercent', label:'Daño crítico +%', kind:'plain', group:'Combate'},
    {key:'evasion', label:'Chance de evasión +%', kind:'plain', group:'Combate'},
    {key:'block', label:'Chance de bloqueo +%', kind:'plain', group:'Combate'},
    {key:'attackSpeedPercent', label:'Velocidad de ataque +%', kind:'plain', group:'Combate'},
    {key:'armorBonusPercent', label:'+% Bono de Armadura (global)', kind:'plain', group:'Resistencias'},
    {key:'protectionBonusTyped', label:'+% Protección (tipo)', kind:'typedFlat', group:'Resistencias'},
    {key:'physResist', label:'Resistencia a Daño Físico +%', kind:'plain', group:'Resistencias'},
    {key:'magResist', label:'Resistencia a Daño Mágico +%', kind:'plain', group:'Resistencias'},
    {key:'resistTyped', label:'Resistencia a Daño (tipo) +%', kind:'typedFlat', group:'Resistencias'},
    {key:'receivedDamagePercent', label:'Daño recibido +% (negativo reduce)', kind:'plain', group:'Resistencias'},
    {key:'powerResist', label:'Resistencia a Poderes +%', kind:'plain', group:'Resistencias'},
    {key:'knockResist', label:'Resistencia a Noqueo +%', kind:'plain', group:'Resistencias'},
    {key:'stunResist', label:'Resistencia a Aturdir +%', kind:'plain', group:'Resistencias'},
    {key:'paralyzeResist', label:'Resistencia a Paralizar +%', kind:'plain', group:'Resistencias'},
    {key:'dazeResist', label:'Resistencia a Marear +%', kind:'plain', group:'Resistencias'},
    {key:'immobilizeResist', label:'Resistencia a Inmovilizar +%', kind:'plain', group:'Resistencias'},
    {key:'cantAttackResist', label:'Resistencia a No puede atacar +%', kind:'plain', group:'Resistencias'},
    {key:'healthFlat', label:'Salud +X', kind:'plain', group:'Vitalidad y velocidad'},
    {key:'manaFlat', label:'Maná +X', kind:'plain', group:'Vitalidad y velocidad'},
    {key:'healthRegenPercent', label:'Regeneración de salud +%', kind:'plain', group:'Vitalidad y velocidad'},
    {key:'manaRegenPercent', label:'Regeneración de maná +%', kind:'plain', group:'Vitalidad y velocidad'},
    {key:'moveSpeedPercent', label:'Velocidad de movimiento +%', kind:'plain', group:'Vitalidad y velocidad'},
    {key:'summonSpeedPercent', label:'Bonus velocidad de invocación +%', kind:'plain', group:'Vitalidad y velocidad'},
    {key:'healBonusPercent', label:'Bonus de curación +%', kind:'plain', group:'Vitalidad y velocidad'},
  ];
  const STAT_BY_KEY = {}; STAT_CATALOG.forEach(s=> STAT_BY_KEY[s.key] = s);
  const STAT_GROUPS = [...new Set(STAT_CATALOG.map(s=> s.group))];

  // Solo Cazador tiene slots cargados por ahora (pedido explícito: "por
  // ahora probemos con el cazador"). Las demás subclases quedan con []
  // hasta que se sume su carpeta de equipamiento. "role" referencia
  // ROLE_DISTRIBUTION para la fórmula de Armadura -- solo lo tienen las
  // piezas que de verdad dan puntos de armadura.
  const CALC_SLOTS = {
    cazador: [
      {key:'arco', label:'Arco', emoji:'🏹'},
      {key:'flechas', label:'Flechas', emoji:'🎯'},
      {key:'yelmo', label:'Yelmo', emoji:'⛑️', role:'cabeza'},
      {key:'pechera', label:'Pechera', emoji:'👕', role:'torso'},
      {key:'hombreras', label:'Hombreras', emoji:'🎽', role:'brazos'},
      {key:'guanteletes', label:'Guanteletes', emoji:'🧤', role:'guanteletes'},
      {key:'perneras', label:'Perneras', emoji:'👖', role:'piernas'},
      {key:'amuleto', label:'Amuleto', emoji:'📿'},
      {key:'anilloIzq', label:'Anillo izquierdo', emoji:'💍'},
      {key:'anilloDer', label:'Anillo derecho', emoji:'💍'},
    ],
  };

  // Ejemplo real (Fenrirblack, Cazador nivel 40) para no arrancar con la
  // grilla vacía. El daño de cada anillo se carga UNA sola vez (15-25
  // Cortante) porque su tooltip repite la misma cifra en dos líneas
  // ("Daño: 15-25" y "Daño cortante +15/25") y no hay forma de saber
  // desde el texto si es la misma línea mostrada dos veces o un bono
  // real aparte -- si en el juego se suma de nuevo, avisale a Claude.
  const EXAMPLE_GEAR = {
    cazador: {
      arco: [
        {stat:'dmgRange', sub:'punzante', value:88, value2:115},
        {stat:'weaponQuality', value:13},
        {stat:'dmgExtraFlat', sub:'punzante', value:9},
        {stat:'critChance', value:10},
      ],
      flechas: [
        {stat:'dmgRange', sub:'punzante', value:35, value2:43},
      ],
      anilloIzq: [
        {stat:'dmgRange', sub:'cortante', value:15, value2:25},
      ],
      anilloDer: [
        {stat:'dmgRange', sub:'cortante', value:15, value2:25},
      ],
      amuleto: [
        {stat:'flatAttr', sub:'DXT', value:4},
      ],
      yelmo: armorSetRows(),
      pechera: armorSetRows(),
      hombreras: armorSetRows(),
      guanteletes: armorSetRows(),
      perneras: armorSetRows(),
    },
  };
  // Las 5 piezas de armadura del ejemplo son del mismo set (mismo PBA=168
  // y misma calidad por tipo) -- se genera una sola vez para no repetir.
  function armorSetRows(){
    return [
      {stat:'armorBase', value:168},
      {stat:'protectionQuality', sub:'cortante', value:'Normal'},
      {stat:'protectionQuality', sub:'punzante', value:'Buena'},
      {stat:'protectionQuality', sub:'aplastante', value:'Muy Buena'},
      {stat:'protectionQuality', sub:'fuego', value:'Mala'},
      {stat:'protectionQuality', sub:'frio', value:'Muy Mala'},
      {stat:'protectionQuality', sub:'electrico', value:'Normal'},
    ];
  }

  const COMPANIONS = [
    {key:'', label:'Ninguno'},
    {key:'tchulu', label:'Tchulu', desc:'Intercambia 10 de Concentración por 5 de Atributo de clase', apply(st){ st.conc-=10; st.classAttrFlat+=5; }, affectsCalc:true},
    {key:'faethie', label:'Faethie', desc:'Intercambia 10% de daño de arma por 10% de resistencia a daño físico', apply(st){ st.weaponPercentGlobalDelta-=10; st.physResistDelta+=10; }, affectsCalc:true},
    {key:'soldado_zombie', label:'Compañero Soldado Zombie', desc:'Intercambia 250 de salud por 125 de mana', apply(st){ st.healthDelta-=250; st.manaDelta+=125; }, affectsCalc:true},
    {key:'na_thar', label:'Na Thar', desc:'Intercambia 15 de concentración por 5% de regeneración de salud', apply(st){ st.conc-=15; st.healthRegenDelta+=5; }, affectsCalc:true},
    {key:'zul_nah', label:'Zul Nah', desc:'Intercambia 30% de chance de crítico por 300 de salud', apply(st){ st.critChanceDelta-=30; st.healthDelta+=300; }, affectsCalc:true},
    {key:'mukharr', label:'Mukharr', desc:'Intercambia 5% de velocidad de ataque por 10% de protección', apply(st){ st.attackSpeedDelta-=5; st.armorBonusPercentDelta+=10; }, affectsCalc:true},
    {key:'tortugo', label:'Tortugo', desc:'Intercambia 75 de mana por 10 de constitución', apply(st){ st.manaDelta-=75; st.con+=10; }, affectsCalc:true},
    {key:'zoathie', label:'Zoathie', desc:'Intercambia 10 de Concentración por 25% de daño critico', apply(st){ st.conc-=10; st.critDamageDelta+=25; }, affectsCalc:true},
    {key:'domthan', label:'Domthan', desc:'Intercambia 8% de velocidad de invocación por 15% de bonus de curación', apply(st){ st.summonSpeedDelta-=8; st.healBonusDelta+=15; }, affectsCalc:true},
    {key:'goblinch', label:'Compañero Goblinch', desc:'Intercambia 50 de salud por 100 de mana', apply(st){ st.healthDelta-=50; st.manaDelta+=100; }, affectsCalc:true},
    {key:'espiritu_futuro', label:'Espíritu del Futuro', desc:'Intercambia 15 de concentración por 275 de salud', apply(st){ st.conc-=15; st.healthDelta+=275; }, affectsCalc:true},
    {key:'fenvetir', label:'Fenvetir', desc:'Intercambia 30% de chance de crítico por 150 de mana', apply(st){ st.critChanceDelta-=30; st.manaDelta+=150; }, affectsCalc:true},
    {key:'mohere', label:'Mohere', desc:'Intercambia 150 de salud por 10 de Atributo de clase', apply(st){ st.healthDelta-=150; st.classAttrFlat+=10; }, affectsCalc:true},
  ];

  let calcInited = false;
  let currentSubclass = 'cazador';
  let slotState = {}; // slotKey -> [{stat,sub,value,value2}, ...]

  function slotsForCurrent(){ return CALC_SLOTS[currentSubclass] || []; }
  function num(v){ const n = Number(v); return isNaN(n) ? 0 : n; }

  function seedSlotState(subclass){
    const slots = CALC_SLOTS[subclass] || [];
    const example = EXAMPLE_GEAR[subclass] || {};
    slotState = {};
    slots.forEach(s=>{
      const rows = (example[s.key] || []).map(r=> ({...r}));
      while(rows.length < STAT_ROWS_PER_SLOT) rows.push({stat:'', sub:'', value:'', value2:''});
      slotState[s.key] = rows.slice(0, STAT_ROWS_PER_SLOT);
    });
  }

  function renderSubclassHint(){
    const hint = document.getElementById('calc-subclass-hint');
    if(!hint) return;
    const clase = SUBCLASS_CLASS[currentSubclass];
    const f = ATTR_BONUS_FORMULA[currentSubclass];
    hint.textContent = `Clase: ${clase}. Bono de atributo: (${ATTR_LABEL[f.attr]} - 20) × ${f.mult}. Clase de Armadura: ${ARMOR_CLASS[currentSubclass]}.`;
  }

  function renderAttrs(){
    const row = document.getElementById('calc-attrs-row');
    if(!row) return;
    row.className = 'calc-attrs-rail';
    row.innerHTML = Object.keys(ATTR_LABEL).map(k=>`
      <div class="field">
        <label>${ATTR_LABEL[k]}</label>
        <input type="number" class="calc-attr-input" data-attr="${k}" value="">
      </div>
    `).join('');
    row.querySelectorAll('.calc-attr-input').forEach(inp=> inp.addEventListener('input', recomputeAndRender));
  }

  function statSubFieldHTML(row, idx, kind){
    if(kind === 'flatAttr'){
      return `<select class="calc-stat-sub" data-idx="${idx}">${Object.keys(ATTR_LABEL).map(k=>`<option value="${k}" ${row.sub===k?'selected':''}>${ATTR_LABEL[k]}</option>`).join('')}</select>`;
    }
    if(kind === 'typedRange' || kind === 'typedFlat' || kind === 'typedQuality'){
      return `<select class="calc-stat-sub" data-idx="${idx}">${DAMAGE_TYPES.map(t=>`<option value="${t.key}" ${row.sub===t.key?'selected':''}>${t.label}</option>`).join('')}</select>`;
    }
    return '';
  }

  function statValueFieldHTML(row, idx, kind){
    if(kind === 'typedQuality'){
      return `<select class="calc-stat-value" data-idx="${idx}" style="flex:1 1 auto">${QUALITY_LEVELS.map(q=>`<option value="${q}" ${row.value===q?'selected':''}>${q}</option>`).join('')}</select>`;
    }
    if(kind === 'typedRange'){
      return `<input type="number" class="calc-stat-value" data-idx="${idx}" value="${row.value}" placeholder="mín">
              <input type="number" class="calc-stat-value2" data-idx="${idx}" value="${row.value2}" placeholder="máx">`;
    }
    if(!kind) return `<input type="number" class="calc-stat-value" data-idx="${idx}" value="" disabled placeholder="—">`;
    return `<input type="number" class="calc-stat-value" data-idx="${idx}" value="${row.value}">`;
  }

  function statRowHTML(row, idx){
    const kind = row.stat ? STAT_BY_KEY[row.stat].kind : null;
    const options = STAT_GROUPS.map(g=>
      `<optgroup label="${g}">${STAT_CATALOG.filter(s=> s.group===g).map(s=> `<option value="${s.key}" ${row.stat===s.key?'selected':''}>${s.label}</option>`).join('')}</optgroup>`
    ).join('');
    return `
      <div class="calc-stat-row" data-idx="${idx}">
        <select class="calc-stat-kind" data-idx="${idx}"><option value="">(sin usar)</option>${options}</select>
        ${statSubFieldHTML(row, idx, kind)}
        ${statValueFieldHTML(row, idx, kind)}
      </div>
    `;
  }

  function slotRowsHTML(slot){
    const rows = slotState[slot.key] || [];
    return `
      <div class="calc-slot" data-slot="${slot.key}">
        <div class="calc-slot-head">
          <span class="calc-slot-icon">${slot.emoji}</span>
          <span class="calc-slot-name">${slot.label}</span>
        </div>
        ${rows.map((r,i)=> statRowHTML(r,i)).join('')}
      </div>
    `;
  }

  function wireSlotEl(el, slotKey){
    function rerenderRow(idx){
      const rowEl = el.querySelector(`.calc-stat-row[data-idx="${idx}"]`);
      rowEl.outerHTML = statRowHTML(slotState[slotKey][idx], idx);
      wireRow(idx);
    }
    function wireRow(idx){
      const rowEl = el.querySelector(`.calc-stat-row[data-idx="${idx}"]`);
      const kindSel = rowEl.querySelector('.calc-stat-kind');
      kindSel.addEventListener('change', ()=>{
        slotState[slotKey][idx].stat = kindSel.value;
        slotState[slotKey][idx].sub = '';
        slotState[slotKey][idx].value = '';
        slotState[slotKey][idx].value2 = '';
        rerenderRow(idx);
        recomputeAndRender();
      });
      const subSel = rowEl.querySelector('.calc-stat-sub');
      if(subSel) subSel.addEventListener('change', ()=>{ slotState[slotKey][idx].sub = subSel.value; recomputeAndRender(); });
      const valInp = rowEl.querySelector('.calc-stat-value');
      if(valInp) valInp.addEventListener('input', ()=>{ slotState[slotKey][idx].value = valInp.value; recomputeAndRender(); });
      const val2Inp = rowEl.querySelector('.calc-stat-value2');
      if(val2Inp) val2Inp.addEventListener('input', ()=>{ slotState[slotKey][idx].value2 = val2Inp.value; recomputeAndRender(); });
    }
    slotState[slotKey].forEach((_,idx)=> wireRow(idx));
  }

  function renderSlots(){
    const grid = document.getElementById('calc-slots-grid');
    if(!grid) return;
    const slots = slotsForCurrent();
    if(slots.length === 0){
      grid.innerHTML = `<div class="calc-slot-unavailable">Todavía no cargamos el equipamiento de ${SUBCLASS_LABEL[currentSubclass]} — por ahora está disponible para Cazador.</div>`;
      return;
    }
    grid.innerHTML = slots.map(slotRowsHTML).join('');
    grid.querySelectorAll('.calc-slot').forEach(el=> wireSlotEl(el, el.dataset.slot));
  }

  function renderCompanionSelect(){
    const sel = document.getElementById('calc-companion');
    if(!sel || sel.options.length) return; // se arma una sola vez
    sel.innerHTML = COMPANIONS.map(c=> `<option value="${c.key}">${c.label}</option>`).join('');
    sel.addEventListener('change', ()=>{
      const c = COMPANIONS.find(x=> x.key === sel.value);
      const hint = document.getElementById('calc-companion-hint');
      if(hint) hint.textContent = c && c.desc ? c.desc : '';
      recomputeAndRender();
    });
  }

  // Recorre todas las piezas y junta cada stat suelto en las estructuras
  // que después usan computeAttack()/computeArmor(). Una sola pasada,
  // reutilizada por las dos.
  function gatherStats(){
    const types = DAMAGE_TYPES.map(t=> t.key);
    const slots = slotsForCurrent();
    const itemAttrBonus = {INT:0, DXT:0, CONC:0, STR:0, CON:0};
    const weaponDamage = {}; types.forEach(t=> weaponDamage[t] = {min:0, max:0});
    const dmgPercentByType = {}; types.forEach(t=> dmgPercentByType[t] = 0);
    const specialByType = {}; types.forEach(t=> specialByType[t] = 0);
    const resistByType = {}; types.forEach(t=> resistByType[t] = 0);
    const protectionBonusByType = {}; types.forEach(t=> protectionBonusByType[t] = 0);
    const protectionQuality = {}; // slotKey -> {type: 'Normal'|...}
    const armorBase = {}; // slotKey -> number
    const slotBCMT = {}; // slotKey -> number
    let totalBCMT = 0;
    const totals = {}; // stat key -> summed value, para los "plain"

    slots.forEach(slot=>{
      const rows = slotState[slot.key] || [];
      protectionQuality[slot.key] = {};
      armorBase[slot.key] = 0;
      slotBCMT[slot.key] = 0;
      rows.forEach(r=>{
        if(!r.stat) return;
        const def = STAT_BY_KEY[r.stat];
        if(!def) return;
        const v = num(r.value);
        if(def.kind === 'flatAttr'){
          if(r.sub && itemAttrBonus[r.sub] != null) itemAttrBonus[r.sub] += v;
        } else if(r.stat === 'armorBase'){
          armorBase[slot.key] += v;
        } else if(r.stat === 'protectionQuality'){
          if(r.sub) protectionQuality[slot.key][r.sub] = r.value || 'Normal';
        } else if(r.stat === 'weaponQuality'){
          slotBCMT[slot.key] += v; totalBCMT += v;
        } else if(r.stat === 'dmgRange'){
          if(r.sub){ weaponDamage[r.sub].min += v; weaponDamage[r.sub].max += num(r.value2); }
        } else if(r.stat === 'dmgExtraFlat'){
          if(r.sub){ weaponDamage[r.sub].min += v; weaponDamage[r.sub].max += v; }
        } else if(r.stat === 'dmgPercentType'){
          if(r.sub) dmgPercentByType[r.sub] += v;
        } else if(r.stat === 'gemDamage'){
          if(r.sub) specialByType[r.sub] += v;
        } else if(r.stat === 'resistTyped'){
          if(r.sub) resistByType[r.sub] += v;
        } else if(r.stat === 'protectionBonusTyped'){
          if(r.sub) protectionBonusByType[r.sub] += v;
        } else {
          totals[r.stat] = (totals[r.stat] || 0) + v;
        }
      });
    });

    return {types, itemAttrBonus, weaponDamage, dmgPercentByType, specialByType, resistByType, protectionBonusByType, protectionQuality, armorBase, slotBCMT, totalBCMT, totals};
  }

  function getCompanionState(){
    const companionKey = document.getElementById('calc-companion')?.value || '';
    const companion = COMPANIONS.find(c=> c.key === companionKey);
    const st = {conc:0, con:0, classAttrFlat:0, weaponPercentGlobalDelta:0, physResistDelta:0, healthDelta:0, manaDelta:0,
      healthRegenDelta:0, critChanceDelta:0, armorBonusPercentDelta:0, critDamageDelta:0, summonSpeedDelta:0, healBonusDelta:0, attackSpeedDelta:0};
    if(companion && companion.apply) companion.apply(st);
    return {companion, st};
  }

  // PASOS 1-3 de la fórmula de Daño (daño INFLIGIDO). Verificado contra
  // el caso de uso oficial (Espada Ancestral -> 918-964, exacto).
  function computeAttack(gathered, attrTotals, companionSt){
    const {types, weaponDamage, dmgPercentByType, specialByType, totalBCMT, totals} = gathered;
    const attrFormula = ATTR_BONUS_FORMULA[currentSubclass];
    const attributeBonus = (attrTotals[attrFormula.attr] - 20) * attrFormula.mult;

    const totalDamageMaxStep1a = types.reduce((sum,t)=> sum + weaponDamage[t].max, 0);

    // PASO 1b: +% Daño (tipo) -- puede venir de varias piezas, se suman.
    const boosted = {};
    types.forEach(t=>{
      const pct = dmgPercentByType[t];
      boosted[t] = {min: weaponDamage[t].min + weaponDamage[t].min/100*pct, max: weaponDamage[t].max + weaponDamage[t].max/100*pct};
    });

    // PASO 2b: bono de atributo + BCMT, repartido proporcional al daño
    // máximo (post 1b) de cada tipo sobre el total (pre 1b -- así lo
    // hace el caso de uso oficial).
    const extraPerType = {};
    types.forEach(t=>{
      const ratio = totalDamageMaxStep1a > 0 ? (boosted[t].max / totalDamageMaxStep1a) : 0;
      extraPerType[t] = (attributeBonus + totalBCMT) * ratio;
    });

    const weaponPercentGlobal = (totals.weaponDamagePercentGlobal || 0) + companionSt.weaponPercentGlobalDelta;
    const damageBonus = totals.damageBonusFlat || 0;
    const damageBonusPercent = totals.damageBonusPercent || 0;

    function computeEnd(which){
      const perType = {};
      let total = 0;
      types.forEach(t=>{
        let dmg = boosted[t][which]; // 3a: extremos en vez de tirada aleatoria
        dmg += dmg / 100 * weaponPercentGlobal; // 3b
        dmg += extraPerType[t]; // 3c
        dmg = (dmg + damageBonus) * (1 + damageBonusPercent / 100); // 3d
        perType[t] = dmg;
        total += dmg;
      });
      types.forEach(t=> total += specialByType[t]); // 3e
      return {total: Math.floor(total), perType};
    }

    const minResult = computeEnd('min');
    const maxResult = computeEnd('max');
    return {min:minResult.total, max:maxResult.total, perTypeMin:minResult.perType, perTypeMax:maxResult.perType, attributeBonus, totalBCMT, raw:weaponDamage, types};
  }

  // PASO 1-2 de la fórmula de Armadura y Resistencias: protección por
  // tipo (propia, sin simular un ataque recibido) + resistencias tal
  // cual se cargaron.
  function computeArmor(gathered){
    const {types, protectionQuality, armorBase, slotBCMT, resistByType, protectionBonusByType, totals} = gathered;
    const slots = slotsForCurrent();
    const ca = ARMOR_CLASS[currentSubclass];
    const protection = {}; types.forEach(t=> protection[t] = 0);
    slots.filter(s=> s.role).forEach(slot=>{
      const dist = ROLE_DISTRIBUTION[slot.role] || 0;
      const pba = armorBase[slot.key] || 0;
      const bcmt = slotBCMT[slot.key] || 0;
      const quality = protectionQuality[slot.key] || {};
      types.forEach(t=>{
        const factor = QUALITY_FACTOR[quality[t]] != null ? QUALITY_FACTOR[quality[t]] : QUALITY_FACTOR['Normal'];
        let piece = Math.ceil(pba * dist * factor) + bcmt; // 1a, 1b
        piece *= ca; // 1e (se aplica por pieza, ver caso de uso oficial)
        protection[t] += piece;
      });
    });
    // 1c/1d: bonos porcentuales de protección, por tipo y globales.
    types.forEach(t=>{
      protection[t] += protection[t] * (protectionBonusByType[t]||0) / 100;
      protection[t] += protection[t] * (totals.armorBonusPercent||0) / 100;
    });
    return {protection, resistByType, physResist: totals.physResist||0, magResist: totals.magResist||0, types};
  }

  function renderResult(){
    const gathered = gatherStats();
    const {companion, st} = getCompanionState();
    const attrInputs = {};
    document.querySelectorAll('.calc-attr-input').forEach(inp=> attrInputs[inp.dataset.attr] = num(inp.value));
    const attrTotals = {};
    Object.keys(ATTR_LABEL).forEach(k=> attrTotals[k] = attrInputs[k] + gathered.itemAttrBonus[k]);
    attrTotals.CONC += st.conc; attrTotals.CON += st.con;
    const attrFormula = ATTR_BONUS_FORMULA[currentSubclass];
    attrTotals[attrFormula.attr] += st.classAttrFlat;

    const attack = computeAttack(gathered, attrTotals, st);
    const armor = computeArmor(gathered);

    const summary = document.getElementById('calc-result-summary');
    if(summary){
      summary.innerHTML = `
        <div class="stat-card"><div class="label">Daño</div><div class="value">${attack.min} - ${attack.max}</div></div>
        <div class="stat-card"><div class="label">Bono de atributo</div><div class="value">${attack.attributeBonus.toFixed(1)}</div></div>
        <div class="stat-card"><div class="label">BCMT total</div><div class="value">${attack.totalBCMT}</div></div>
      `;
    }
    const detailBox = document.getElementById('calc-detail-box');
    if(detailBox){
      const rows = attack.types.map(t=>{
        const label = DAMAGE_TYPES.find(dt=> dt.key===t).label;
        const cls = attack.raw[t].max === 0 ? 'zero' : '';
        return `<tr><td class="${cls}">${label}</td><td class="${cls}">${attack.raw[t].min}-${attack.raw[t].max}</td><td class="${cls}">${Math.round(attack.perTypeMin[t])}</td><td class="${cls}">${Math.round(attack.perTypeMax[t])}</td></tr>`;
      }).join('');
      detailBox.innerHTML = `<table class="calc-detail-table"><thead><tr><th>Tipo</th><th>Daño de arma</th><th>Resultado mín.</th><th>Resultado máx.</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    const note = document.getElementById('calc-companion-note');
    if(note){
      if(companion && companion.key){
        note.style.display = '';
        note.innerHTML = `<div class="mark">✦</div><div>"${companion.label}": ${companion.desc}.</div>`;
      } else note.style.display = 'none';
    }

    const armorSummary = document.getElementById('calc-armor-summary');
    if(armorSummary){
      armorSummary.innerHTML = `
        <div class="stat-card"><div class="label">Resist. Física</div><div class="value">${armor.physResist}%</div></div>
        <div class="stat-card"><div class="label">Resist. Mágica</div><div class="value">${armor.magResist}%</div></div>
      `;
    }
    const armorDetail = document.getElementById('calc-armor-detail-box');
    if(armorDetail){
      const rows = armor.types.map(t=>{
        const label = DAMAGE_TYPES.find(dt=> dt.key===t).label;
        return `<tr><td>${label}</td><td>${Math.round(armor.protection[t])}</td><td>${armor.resistByType[t]||0}%</td></tr>`;
      }).join('');
      armorDetail.innerHTML = `<table class="calc-detail-table"><thead><tr><th>Tipo</th><th>Protección</th><th>Resistencia</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    // Estadísticas derivadas: lo que viene de los ítems (gathered.totals)
    // más las 4 reglas de atributo pasado cierto umbral.
    const derived = document.getElementById('calc-derived-summary');
    if(derived){
      const t = gathered.totals;
      const stunResist = (t.stunResist||0) + Math.max(0, attrTotals.CON - 70) * 0.2;
      const knockResist = (t.knockResist||0) + Math.max(0, attrTotals.STR - 70) * 0.2;
      const summonSpeed = (t.summonSpeedPercent||0) + st.summonSpeedDelta + Math.max(0, attrTotals.CONC - 70) * 0.2;
      const critChance = (t.critChance||0) + st.critChanceDelta + Math.max(0, attrTotals.CONC - 40) * 0.1;
      const cards = [
        ['Chance de crítico', critChance.toFixed(1)+'%'],
        ['Daño crítico', ((t.critDamagePercent||0)+st.critDamageDelta)+'%'],
        ['Chance de evasión', (t.evasion||0)+'%'],
        ['Chance de bloqueo', (t.block||0)+'%'],
        ['Velocidad de ataque', ((t.attackSpeedPercent||0)+st.attackSpeedDelta)+'%'],
        ['Resistencia a Aturdir', stunResist.toFixed(1)+'%'],
        ['Resistencia a Noqueo', knockResist.toFixed(1)+'%'],
        ['Bonus vel. invocación', summonSpeed.toFixed(1)+'%'],
        ['Salud', (t.healthFlat||0)+st.healthDelta],
        ['Maná', (t.manaFlat||0)+st.manaDelta],
        ['Regen. de salud', ((t.healthRegenPercent||0)+st.healthRegenDelta)+'%'],
        ['Regen. de maná', (t.manaRegenPercent||0)+'%'],
      ];
      derived.innerHTML = cards.map(([label,value])=> `<div class="stat-card"><div class="label">${label}</div><div class="value" style="font-size:16px">${value}</div></div>`).join('');
    }
  }

  function recomputeAndRender(){ renderResult(); }

  function wireSubclassSwitch(){
    document.querySelectorAll('#calc-subclass-switch .choice-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        document.querySelectorAll('#calc-subclass-switch .choice-btn').forEach(b=> b.classList.remove('active'));
        btn.classList.add('active');
        currentSubclass = btn.dataset.v;
        seedSlotState(currentSubclass);
        renderSubclassHint();
        renderSlots();
        recomputeAndRender();
      });
    });
  }

  window.initCalcIfNeeded = function(){
    if(calcInited) return;
    calcInited = true;
    seedSlotState(currentSubclass);
    renderSubclassHint();
    renderAttrs();
    renderSlots();
    renderCompanionSelect();
    wireSubclassSwitch();
    const wireToggle = (btnId, boxId, labelOn, labelOff)=>{
      const btn = document.getElementById(btnId), box = document.getElementById(boxId);
      btn?.addEventListener('click', ()=>{
        box.classList.toggle('open');
        btn.textContent = box.classList.contains('open') ? labelOn : labelOff;
      });
    };
    wireToggle('calc-toggle-detail', 'calc-detail-box', 'Ocultar desglose por tipo de daño', 'Ver desglose por tipo de daño');
    wireToggle('calc-toggle-armor-detail', 'calc-armor-detail-box', 'Ocultar desglose por tipo de daño', 'Ver desglose por tipo de daño');
    recomputeAndRender();
  };
  // Este script es el último <script defer> del documento -- si al
  // llegar acá main.js ya pasó por la pestaña "Calculador de daños"
  // (dejó la marca window.calcTabActive porque el fetch de
  // game-data.json le ganó la carrera a que este archivo terminara de
  // bajar), hay que inicializar ahora mismo en vez de esperar a un
  // click que ya pasó.
  if(window.calcTabActive) window.initCalcIfNeeded();
})();
