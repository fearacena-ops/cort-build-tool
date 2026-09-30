/* ========================================================================
   calc.js — pestaña "Calculador de daños". Implementa la fórmula oficial
   de daño publicada por NGD (ver FormulaDañoRegnumOficial.txt): PASO 1
   (daño de arma por tipo), PASO 2 (bono de atributo + BCMT repartido
   proporcionalmente) y PASO 3 (daño final, min/max en vez de tirada
   aleatoria — igual que la Hoja de Personaje). La fórmula de Armadura y
   Resistencias (daño RECIBIDO) no está implementada todavía: esto calcula
   el daño que el personaje INFLIGE, que es lo que se pidió primero.

   Verificación: los pasos 1-3 se probaron contra el caso de uso oficial
   del documento (Espada Ancestral, resultado 918-964) y coinciden exacto.
   Contra el equipo real de Cazador que se cargó de ejemplo NO coincide
   con el 153-184 que muestra la Hoja de Personaje del juego -- el
   supuesto más dudoso es cómo cuentan los anillos con "Daño: X-Y" (acá
   se toma esa línea una sola vez, ignorando la línea repetida "Daño
   <tipo> +X/Y" para no duplicarla). Si el desfasaje viene de ahí, avisale
   a Claude con el mecanismo real para ajustar el cálculo.
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
  const SUBCLASS_LABEL = {barbaro:'Bárbaro', caballero:'Caballero', tirador:'Tirador', cazador:'Cazador', brujo:'Brujo', conjurador:'Conjurador'};
  const SUBCLASS_CLASS = {barbaro:'Guerrero', caballero:'Guerrero', tirador:'Arquero', cazador:'Arquero', brujo:'Mago', conjurador:'Mago'};

  const DAMAGE_TYPES = [
    {key:'cortante', label:'Cortante'},
    {key:'punzante', label:'Punzante'},
    {key:'aplastante', label:'Aplastante'},
    {key:'fuego', label:'Fuego'},
    {key:'frio', label:'Frío'},
    {key:'electrico', label:'Eléctrico'},
  ];

  const ATTRS = [
    {key:'INT', label:'Inteligencia'},
    {key:'DXT', label:'Destreza'},
    {key:'CONC', label:'Concentración'},
    {key:'STR', label:'Fuerza'},
    {key:'CON', label:'Constitución'},
  ];

  // Solo Cazador tiene slots cargados por ahora (pedido explícito: "por
  // ahora probemos con el cazador"). Las demás subclases quedan con []
  // hasta que se sume su carpeta de equipamiento.
  const CALC_SLOTS = {
    cazador: [
      {key:'arco', label:'Arco', emoji:'🏹'},
      {key:'flechas', label:'Flechas', emoji:'🎯'},
      {key:'yelmo', label:'Yelmo', emoji:'⛑️'},
      {key:'pechera', label:'Pechera', emoji:'👕'},
      {key:'hombreras', label:'Hombreras', emoji:'🎽'},
      {key:'guanteletes', label:'Guanteletes', emoji:'🧤'},
      {key:'perneras', label:'Perneras', emoji:'👖'},
      {key:'amuleto', label:'Amuleto', emoji:'📿'},
      {key:'anilloIzq', label:'Anillo izquierdo', emoji:'💍'},
      {key:'anilloDer', label:'Anillo derecho', emoji:'💍'},
    ],
  };

  // Ejemplo real (Fenrirblack, Cazador nivel 40) para no arrancar con la
  // grilla vacía -- se puede editar o borrar libremente desde la UI.
  const EXAMPLE_GEAR = {
    cazador: {
      arco:      {nombre:'Arco largo alas de dragón compuesto de Madera blanda (Maestre)', min:88,  max:115, tipo:'punzante', bcmt:13},
      flechas:   {nombre:'Flecha Sanguinaria',                                             min:35,  max:43,  tipo:'punzante', bcmt:0},
      anilloIzq: {nombre:'Anillo de visión mortal',                                        min:15,  max:25,  tipo:'cortante',  bcmt:0},
      anilloDer: {nombre:'Anillo de visión mortal',                                        min:15,  max:25,  tipo:'cortante',  bcmt:0},
      amuleto:   {nombre:'Amuleto del Arquero Maestro'},
      yelmo:      {nombre:'Yelmo compuesto de brigantina de Cuero blando (Común)'},
      pechera:    {nombre:'Pechera de brigantina compuesta de Cuero blando (Común)'},
      hombreras:  {nombre:'Hombreras de brigantina compuestas de Cuero blando (Común)'},
      guanteletes:{nombre:'Guanteletes compuestos de brigantina de Cuero blando (Común)'},
      perneras:   {nombre:'Perneras de Brigantina Compuestas de Cuero blando (Común)'},
    },
  };
  const EXAMPLE_ATTRS = {cazador: {INT:44, DXT:70, CONC:67, STR:49, CON:63}};

  const COMPANIONS = [
    {key:'', label:'Ninguno'},
    {key:'tchulu', label:'Tchulu', desc:'Intercambia 10 de Concentración por 5 de Atributo de clase', apply(st){ st.conc-=10; st.classAttrFlat+=5; }, affectsCalc:true},
    {key:'faethie', label:'Faethie', desc:'Intercambia 10% de daño de arma por 10% de resistencia a daño físico', apply(st){ st.weaponPercentGlobalDelta-=10; }, affectsCalc:true, note:'La resistencia a daño físico no se ve reflejada acá (este cálculo es de daño infligido, no recibido).'},
    {key:'soldado_zombie', label:'Compañero Soldado Zombie', desc:'Intercambia 250 de salud por 125 de mana', affectsCalc:false},
    {key:'na_thar', label:'Na Thar', desc:'Intercambia 15 de concentración por 5% de regeneración de salud', apply(st){ st.conc-=15; }, affectsCalc:false},
    {key:'zul_nah', label:'Zul Nah', desc:'Intercambia 30% de chance de crítico por 300 de salud', affectsCalc:false},
    {key:'mukharr', label:'Mukharr', desc:'Intercambia 5% de velocidad de ataque por 10% de protección', affectsCalc:false},
    {key:'tortugo', label:'Tortugo', desc:'Intercambia 75 de mana por 10 de constitución', apply(st){ st.con+=10; }, affectsCalc:false},
    {key:'zoathie', label:'Zoathie', desc:'Intercambia 10 de Concentración por 25% de daño crítico', apply(st){ st.conc-=10; }, affectsCalc:false},
    {key:'domthan', label:'Domthan', desc:'Intercambia 8% de velocidad de invocación por 15% de bonus de curación', affectsCalc:false},
    {key:'goblinch', label:'Compañero Goblinch', desc:'Intercambia 50 de salud por 100 de mana', affectsCalc:false},
    {key:'espiritu_futuro', label:'Espíritu del Futuro', desc:'Intercambia 15 de concentración por 275 de salud', apply(st){ st.conc-=15; }, affectsCalc:false},
    {key:'fenvetir', label:'Fenvetir', desc:'Intercambia 30% de chance de crítico por 150 de mana', affectsCalc:false},
    {key:'mohere', label:'Mohere', desc:'Intercambia 150 de salud por 10 de Atributo de clase', apply(st){ st.classAttrFlat+=10; }, affectsCalc:true},
  ];

  let calcInited = false;
  let currentSubclass = 'cazador';
  let slotState = {}; // slotKey -> {nombre,min,max,tipo,bcmt,gemaMin? no, gema single value, gemaTipo}

  function slotsForCurrent(){ return CALC_SLOTS[currentSubclass] || []; }

  function seedSlotState(subclass){
    const slots = CALC_SLOTS[subclass] || [];
    const example = EXAMPLE_GEAR[subclass] || {};
    slotState = {};
    slots.forEach(s=>{
      const ex = example[s.key] || {};
      slotState[s.key] = {
        nombre: ex.nombre || '',
        min: ex.min != null ? ex.min : '',
        max: ex.max != null ? ex.max : '',
        tipo: ex.tipo || 'punzante',
        bcmt: ex.bcmt != null ? ex.bcmt : '',
        gema: '',
        gemaTipo: 'punzante',
      };
    });
  }

  function renderSubclassHint(){
    const hint = document.getElementById('calc-subclass-hint');
    if(!hint) return;
    const clase = SUBCLASS_CLASS[currentSubclass];
    const f = ATTR_BONUS_FORMULA[currentSubclass];
    const attrLabel = {STR:'Fuerza', DXT:'Destreza', INT:'Inteligencia'}[f.attr];
    hint.textContent = `Clase: ${clase}. Bono de atributo: (${attrLabel} - 20) × ${f.mult}.`;
  }

  function renderAttrs(){
    const row = document.getElementById('calc-attrs-row');
    if(!row) return;
    const defaults = EXAMPLE_ATTRS[currentSubclass] || {};
    row.innerHTML = ATTRS.map(a=>`
      <div class="field" style="min-width:110px;flex:0 0 auto">
        <label>${a.label}</label>
        <div class="num-inputs"><input type="number" class="calc-attr-input" data-attr="${a.key}" value="${defaults[a.key] != null ? defaults[a.key] : ''}"></div>
      </div>
    `).join('');
    row.querySelectorAll('.calc-attr-input').forEach(inp=> inp.addEventListener('input', recomputeAndRender));
  }

  function slotRowHTML(slot){
    const st = slotState[slot.key] || {};
    const typeOptions = DAMAGE_TYPES.map(t=>`<option value="${t.key}" ${st.tipo===t.key?'selected':''}>${t.label}</option>`).join('');
    const gemaTypeOptions = DAMAGE_TYPES.map(t=>`<option value="${t.key}" ${st.gemaTipo===t.key?'selected':''}>${t.label}</option>`).join('');
    return `
      <div class="calc-slot" data-slot="${slot.key}">
        <div class="calc-slot-head">
          <span class="calc-slot-icon">${slot.emoji}</span>
          <span class="calc-slot-name">${slot.label}</span>
        </div>
        <div class="calc-slot-row">
          <div class="calc-slot-field" style="flex:1 1 100%">
            <label>Ítem (referencia)</label>
            <input type="text" class="calc-slot-nombre" value="${(st.nombre||'').replace(/"/g,'&quot;')}" placeholder="Nombre del ítem equipado">
          </div>
        </div>
        <div class="calc-slot-row">
          <div class="calc-slot-field narrow"><label>Daño mín.</label><input type="number" class="calc-slot-min" value="${st.min}"></div>
          <div class="calc-slot-field narrow"><label>Daño máx.</label><input type="number" class="calc-slot-max" value="${st.max}"></div>
          <div class="calc-slot-field"><label>Tipo</label><select class="calc-slot-tipo">${typeOptions}</select></div>
          <div class="calc-slot-field narrow"><label>BCMT (+X)</label><input type="number" class="calc-slot-bcmt" value="${st.bcmt}"></div>
        </div>
        <div class="calc-slot-row">
          <div class="calc-slot-field narrow"><label>Gema (+X)</label><input type="number" class="calc-slot-gema" value="${st.gema}"></div>
          <div class="calc-slot-field"><label>Tipo de gema</label><select class="calc-slot-gema-tipo">${gemaTypeOptions}</select></div>
        </div>
      </div>
    `;
  }

  function renderSlots(){
    const grid = document.getElementById('calc-slots-grid');
    if(!grid) return;
    const slots = slotsForCurrent();
    if(slots.length === 0){
      grid.innerHTML = `<div class="calc-slot-unavailable">Todavía no cargamos el equipamiento de ${SUBCLASS_LABEL[currentSubclass]} — por ahora está disponible para Cazador.</div>`;
      return;
    }
    grid.innerHTML = slots.map(slotRowHTML).join('');
    grid.querySelectorAll('.calc-slot').forEach(el=>{
      const key = el.dataset.slot;
      const bind = (sel, field, isNumber)=>{
        const input = el.querySelector(sel);
        input.addEventListener('input', ()=>{
          slotState[key][field] = input.value;
          recomputeAndRender();
        });
      };
      bind('.calc-slot-nombre', 'nombre');
      bind('.calc-slot-min', 'min');
      bind('.calc-slot-max', 'max');
      bind('.calc-slot-tipo', 'tipo');
      bind('.calc-slot-bcmt', 'bcmt');
      bind('.calc-slot-gema', 'gema');
      bind('.calc-slot-gema-tipo', 'gemaTipo');
    });
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

  function renderTypePercentSelect(){
    const sel = document.getElementById('calc-type-percent-type');
    if(!sel || sel.options.length) return;
    sel.innerHTML = DAMAGE_TYPES.map(t=> `<option value="${t.key}">${t.label}</option>`).join('');
    sel.addEventListener('change', recomputeAndRender);
  }

  function num(v){ const n = Number(v); return isNaN(n) ? 0 : n; }

  // Implementa PASOS 1-3 de FormulaDañoRegnumOficial.txt. Verificado
  // contra el caso de uso oficial (Espada Ancestral -> 918-964, exacto).
  function computeDamage(){
    const types = DAMAGE_TYPES.map(t=> t.key);
    const slots = slotsForCurrent();

    // Estado de atributos + compañero (PASO 2a: bono de atributo).
    const attrInputs = {};
    document.querySelectorAll('.calc-attr-input').forEach(inp=> attrInputs[inp.dataset.attr] = num(inp.value));
    const companionKey = document.getElementById('calc-companion')?.value || '';
    const companion = COMPANIONS.find(c=> c.key === companionKey);
    const st = {conc:attrInputs.CONC||0, con:attrInputs.CON||0, classAttrFlat:0, weaponPercentGlobalDelta:0};
    if(companion && companion.apply) companion.apply(st);

    const attrFormula = ATTR_BONUS_FORMULA[currentSubclass];
    const baseAttrValue = attrInputs[attrFormula.attr] || 0;
    const attrValue = baseAttrValue + st.classAttrFlat;
    const attributeBonus = (attrValue - 20) * attrFormula.mult;

    // PASO 1a: sumar daño nominal de cada pieza equipada, por tipo.
    const raw = {}; types.forEach(t=> raw[t] = {min:0, max:0});
    let totalBCMT = 0;
    const specialByType = {}; types.forEach(t=> specialByType[t] = 0);
    slots.forEach(slot=>{
      const s = slotState[slot.key];
      if(!s) return;
      const t = s.tipo || 'punzante';
      raw[t].min += num(s.min);
      raw[t].max += num(s.max);
      totalBCMT += num(s.bcmt);
      if(num(s.gema)) specialByType[s.gemaTipo || 'punzante'] += num(s.gema);
    });
    const totalDamageMaxStep1a = types.reduce((sum,t)=> sum + raw[t].max, 0);

    // PASO 1b: Daño de Arma por Tipo % (un solo modificador de poder, ej.
    // "Atlético +10% Daño Cortante").
    const typePercentType = document.getElementById('calc-type-percent-type')?.value;
    const typePercentValue = num(document.getElementById('calc-type-percent-value')?.value);
    const boosted = {}; types.forEach(t=> boosted[t] = {min:raw[t].min, max:raw[t].max});
    if(typePercentType && typePercentValue){
      boosted[typePercentType].min += raw[typePercentType].min / 100 * typePercentValue;
      boosted[typePercentType].max += raw[typePercentType].max / 100 * typePercentValue;
    }

    // PASO 2b: extra_damage_per_type, repartido proporcional al daño
    // máximo (post 1b) de cada tipo sobre el total (pre 1b -- así lo
    // hace el caso de uso oficial, ver el comentario de más arriba).
    const extraPerType = {};
    types.forEach(t=>{
      const ratio = totalDamageMaxStep1a > 0 ? (boosted[t].max / totalDamageMaxStep1a) : 0;
      extraPerType[t] = (attributeBonus + totalBCMT) * ratio;
    });

    const weaponPercentGlobal = num(document.getElementById('calc-weapon-percent')?.value) + st.weaponPercentGlobalDelta;
    const damageBonus = num(document.getElementById('calc-damage-bonus')?.value);
    const damageBonusPercent = num(document.getElementById('calc-damage-bonus-percent')?.value);

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
    return {
      min: minResult.total, max: maxResult.total,
      perTypeMin: minResult.perType, perTypeMax: maxResult.perType,
      attributeBonus, totalBCMT, raw, boosted, specialByType, types, companion,
    };
  }

  function renderResult(){
    const result = computeDamage();
    const summary = document.getElementById('calc-result-summary');
    if(summary){
      summary.innerHTML = `
        <div class="stat-card"><div class="label">Daño</div><div class="value">${result.min} - ${result.max}</div></div>
        <div class="stat-card"><div class="label">Bono de atributo</div><div class="value">${result.attributeBonus.toFixed(1)}</div></div>
        <div class="stat-card"><div class="label">BCMT total</div><div class="value">${result.totalBCMT}</div></div>
      `;
    }
    const detailBox = document.getElementById('calc-detail-box');
    if(detailBox){
      const rows = result.types.map(t=>{
        const label = DAMAGE_TYPES.find(dt=> dt.key===t).label;
        const rawMax = result.raw[t].max;
        const cls = rawMax === 0 ? 'zero' : '';
        return `<tr><td class="${cls}">${label}</td><td class="${cls}">${result.raw[t].min}-${result.raw[t].max}</td><td class="${cls}">${Math.round(result.perTypeMin[t])}</td><td class="${cls}">${Math.round(result.perTypeMax[t])}</td></tr>`;
      }).join('');
      detailBox.innerHTML = `
        <table class="calc-detail-table">
          <thead><tr><th>Tipo</th><th>Daño de arma</th><th>Resultado mín.</th><th>Resultado máx.</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }
    const note = document.getElementById('calc-companion-note');
    if(note){
      if(result.companion && result.companion.note){
        note.style.display = '';
        note.innerHTML = `<div class="mark">✦</div><div>${result.companion.note}</div>`;
      } else if(result.companion && result.companion.affectsCalc === false && result.companion.key){
        note.style.display = '';
        note.innerHTML = `<div class="mark">✦</div><div>El intercambio de "${result.companion.label}" no mueve el resultado de este cálculo (afecta salud, maná, velocidad u otro stat que la fórmula de daño infligido no usa).</div>`;
      } else {
        note.style.display = 'none';
      }
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
        renderAttrs();
        renderSlots();
        recomputeAndRender();
      });
    });
  }

  function wirePowerInputs(){
    ['calc-type-percent-value','calc-weapon-percent','calc-damage-bonus','calc-damage-bonus-percent'].forEach(id=>{
      document.getElementById(id)?.addEventListener('input', recomputeAndRender);
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
    renderTypePercentSelect();
    wireSubclassSwitch();
    wirePowerInputs();
    const toggleBtn = document.getElementById('calc-toggle-detail');
    const detailBox = document.getElementById('calc-detail-box');
    toggleBtn?.addEventListener('click', ()=>{
      detailBox.classList.toggle('open');
      toggleBtn.textContent = detailBox.classList.contains('open') ? 'Ocultar desglose por tipo de daño' : 'Ver desglose por tipo de daño';
    });
    recomputeAndRender();
  };
})();
