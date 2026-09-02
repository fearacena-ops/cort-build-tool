/* =========================================================================
   main.js — estado de interfaz, cableado de eventos y arranque
   Recomendador de build — Champions of Regnum

   Depende de engine.js y render.js (deben cargarse antes). No se ejecuta
   nada hasta que data-loader.js llama a initApp() con los datos del juego
   ya cargados — por eso todo lo que antes corría "suelto" al final del
   archivo ahora vive adentro de esa función.
   ========================================================================= */

// Bump esto con cada versión publicada — es la única fuente de verdad,
// se refleja solo en el encabezado de la página.
const APP_VERSION = '1.0.0';

function wireChoiceGroup(id){
  const el = document.getElementById(id);
  el.querySelectorAll('.choice-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      el.querySelectorAll('.choice-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}
function getChoiceValue(id){
  const el = document.querySelector(`#${id} .choice-btn.active`);
  return el ? el.dataset.v : null;
}

function renderWeaponPanel(containerId, hideTargetId){
  const container = document.getElementById(containerId);
  const hideTarget = hideTargetId ? document.getElementById(hideTargetId) : container;
  const groups = CLASS.weaponGroups || [];
  if(groups.length === 0){
    container.innerHTML = '';
    hideTarget.style.display = 'none';
    return;
  }
  hideTarget.style.display = '';
  let html = '';
  groups.forEach((group)=>{
    html += `<label style="display:block;font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin-bottom:10px;font-family:var(--font-mono)">${group.label}</label>`;
    html += `<div class="choice-group" data-glabel="${group.label}">`;
    group.options.forEach((opt,oi)=>{
      html += `<button class="choice-btn${oi===0?' active':''}" data-v="${opt.key}">${opt.label}</button>`;
    });
    html += `</div>`;
  });
  html += `<div class="hint" data-role="weapon-hint">Excluyentes en combate — la build solo invierte en la opción activa.</div>`;
  container.innerHTML = html;

  if(currentClass === 'barbarian'){
    wireBarbarianWeaponPanel(container);
  } else {
    container.querySelectorAll('.choice-group').forEach(cg=>{
      cg.querySelectorAll('.choice-btn').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          cg.querySelectorAll('.choice-btn').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    });
  }
}

function wireBarbarianWeaponPanel(container){
  const gripGroup = container.querySelector('.choice-group[data-glabel="Empuñadura"]');
  const typeGroup = container.querySelector('.choice-group[data-glabel="Tipo de arma"]');
  const hint = container.querySelector('[data-role="weapon-hint"]');
  if(!gripGroup || !typeGroup) return;

  function refreshHint(){
    const grip = gripGroup.querySelector('.choice-btn.active').dataset.v;
    hint.textContent = grip === 'dual'
      ? 'Con dos armas de una mano puedes marcar hasta 2 tipos — si dejas solo uno activo, se asume que ambas armas son de ese tipo.'
      : 'El arma a dos manos usa un único tipo de daño.';
  }

  gripGroup.querySelectorAll('.choice-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      gripGroup.querySelectorAll('.choice-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      if(btn.dataset.v === 'twohand'){
        // collapse weapon-type selection down to a single choice
        const active = Array.from(typeGroup.querySelectorAll('.choice-btn.active'));
        active.slice(1).forEach(b=>b.classList.remove('active'));
        if(active.length === 0) typeGroup.querySelector('.choice-btn').classList.add('active');
      }
      refreshHint();
    });
  });

  typeGroup.querySelectorAll('.choice-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const grip = gripGroup.querySelector('.choice-btn.active').dataset.v;
      const allBtns = Array.from(typeGroup.querySelectorAll('.choice-btn'));

      if(grip === 'twohand'){
        allBtns.forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        return;
      }
      // dual-wield: up to 2 active, at least 1 always active
      const activeBtns = allBtns.filter(b=>b.classList.contains('active'));
      if(btn.classList.contains('active')){
        if(activeBtns.length > 1) btn.classList.remove('active'); // never let it drop to 0
        return;
      }
      if(activeBtns.length >= 2) activeBtns[0].classList.remove('active');
      btn.classList.add('active');
    });
  });

  refreshHint();
}

function getWeaponChoice(containerId){
  const container = document.getElementById(containerId);
  const choice = {};
  container.querySelectorAll('.choice-group').forEach(cg=>{
    const label = cg.dataset.glabel;
    const actives = Array.from(cg.querySelectorAll('.choice-btn.active')).map(b=>b.dataset.v);
    choice[label] = actives.length > 1 ? actives : (actives[0] || null);
  });
  return choice;
}

let stageCounter = 0;
let progressionExportConfigs = [];

let pisoContents = [];
let pisoActiveIdx = 0;
function renderProgression(scroll){
  const current = Math.max(10, Math.min(59, parseInt(document.getElementById('pa-current').value) || 10));
  const goal = Math.max(current+1, Math.min(60, parseInt(document.getElementById('pa-goal').value) || 60));
  const weaponChoice = getWeaponChoice('pa-weapon-panel');
  const mode = getChoiceValue('pa-mode');
  const ctxFn = ctxLeveling(mode, weaponChoice);
  const checkpoints = getCheckpoints(current, goal);
  const sequence = buildLevelSequence(current, goal, ctxFn);
  const out = document.getElementById('pa-output');
  out.innerHTML = '';
  progressionExportConfigs = [];
  pisoContents = [];
  pisoActiveIdx = 0;
  let strip = `<div class="path-strip"><span class="lvl">Nv.${current}</span>`;
  checkpoints.forEach(cp=>{ strip += ` <span class="sep">→</span> <span class="lvl">Nv.${cp}</span>`; });
  strip += `</div>`;
  out.insertAdjacentHTML('beforeend', strip);
  const calloutText = mode === 'solo' ? CLASS.soloCallout : CLASS.groupCallout;
  out.insertAdjacentHTML('beforeend', `<div class="callout"><div class="mark">✦</div><div>${calloutText}</div></div>`);
  let prevBuild = sequence[current];
  let prevLevel = current;
  checkpoints.forEach((cp, i)=>{
    const build = sequence[cp];
    const items = diffBuilds(prevBuild, build);
    stageCounter++;
    const fullId = `full-a-${stageCounter}`;
    const lvlId = `lvl-a-${stageCounter}`;
    const exportIdx = progressionExportConfigs.length;
    progressionExportConfigs.push({build, label: `Piso ${i+1} · Nivel ${cp}`, suffix: `leveo_piso${i+1}_nv${cp}`});
    const html = `<div class="stage">
      <div class="stage-head">
        <div class="stage-title"><h3>Hasta nivel ${cp}</h3></div>
        <div class="stage-stats"><span><b>${build.dpBudget-build.dpLeft}</b>/${build.dpBudget} disciplina</span><span><b>${build.ppBudget-build.ppLeft}</b>/${build.ppBudget} poder</span></div>
      </div>
      <div class="stage-body">
        <div class="diff-title">Qué agregar / cambiar desde ${i===0?'tu nivel actual':'el piso anterior'}</div>
        ${renderDiff(items)}
        <button class="toggle-full" onclick="document.getElementById('${fullId}').classList.toggle('open')">Ver build completa en este piso ▾</button>
        <div class="full-build" id="${fullId}">${renderFullBuild(build)}</div>
        <button class="toggle-full" onclick="document.getElementById('${lvlId}').classList.toggle('open')">Ver nivel a nivel (Nv.${prevLevel}→${cp}) ▾</button>
        <div class="full-build lvl-breakdown" id="${lvlId}">${renderLevelByLevel(prevLevel, cp, sequence)}</div>
        <button class="toggle-full" onclick="exportProgressionStage(${exportIdx})">Exportar este piso como imagen ⬇</button>
      </div>
    </div>`;
    pisoContents.push(html);
    prevBuild = build;
    prevLevel = cp;
  });
  let tabs = `<div class="piso-tabs">`;
  checkpoints.forEach((cp,i)=>{ tabs += `<button class="piso-tab${i===0?' active':''}" onclick="selectPiso(${i})">Piso ${i+1}</button>`; });
  tabs += `</div>`;
  out.insertAdjacentHTML('beforeend', tabs);
  out.insertAdjacentHTML('beforeend', `<div id="piso-content">${pisoContents[0]||''}</div>`);
  out.insertAdjacentHTML('beforeend', `<div id="pa-export-msg" class="hint"></div>`);
  if(scroll && out.scrollIntoView) out.scrollIntoView({behavior:'smooth', block:'start'});
}

function exportProgressionStage(idx){
  const cfg = progressionExportConfigs[idx];
  if(!cfg) return;
  exportBuildAsImage(cfg.build, cfg.build.level, `Progreso de leveo · ${cfg.label}`, cfg.suffix, 'pa-export-msg');
}
function selectPiso(idx){
  pisoActiveIdx = idx;
  document.querySelectorAll('.piso-tab').forEach((btn,i)=> btn.classList.toggle('active', i===idx));
  document.getElementById('piso-content').innerHTML = pisoContents[idx] || '';
}

const prioritySelect = document.getElementById('pb-priority');

function populatePriorityDropdown(){
  prioritySelect.innerHTML = '<option value="">Ninguna en particular</option>';
  DISC_NAMES.filter(n=> CLASS.disciplines[n].group !== 'wm').forEach(name=>{
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = CLASS.disciplines[name].es;
    prioritySelect.appendChild(opt);
  });
}

const CONTEXT_LABEL = {group_pve:"grupo PvE", group_pvp:"grupo PvP", rvr:"RvR", solo_pvp:"solo PvP", solo_pve:"solo PvE"};
function weaponSummaryLabel(weaponChoice){
  const groups = CLASS.weaponGroups || [];
  if(groups.length === 0) return null;
  return groups.map(g=>{
    const chosen = weaponChoice[g.label];
    const keys = Array.isArray(chosen) ? chosen : [chosen];
    const labels = keys.map(k=>{
      const opt = g.options.find(o=>o.key===k);
      return opt ? opt.label.toLowerCase() : '';
    }).filter(Boolean);
    return labels.join(' + ');
  }).filter(Boolean).join(', ');
}
// Named community archetypes — shown as quick-start suggestions in "Tu build" (Tab C)
const ARCHETYPE_PRESETS = {
  knight: [
    {key:'tank', label:'Tanque', priorityDiscipline:'Vanguard', role:'tank', context:'rvr',
     blurb:'Absorbe daño puro con poco soporte — la línea de frente clásica, todo en aguantar golpes.'},
    {key:'defender', label:'Defensor', priorityDiscipline:'Vanguard', role:'cc', context:'rvr',
     blurb:'Protege a magos y bárbaros controlando enemigos (Retar, Provocar, Finta) en vez de solo tanquear.'},
    {key:'paladin', label:'Paladín', priorityDiscipline:'Shields', role:'support', context:'rvr',
     blurb:'Mitad guerrero, mitad conjurador — vive lanzando auras de área a sus aliados (Escudo estelar, Barrera deflectora).'},
  ],
};

function renumberPanelsB(){
  const weaponVisible = (CLASS.weaponGroups||[]).length > 0;
  let n = 1;
  const wNum = document.getElementById('pb-num-weapon');
  const wSection = document.getElementById('pb-weapon-section');
  if(weaponVisible){ wSection.style.display=''; wNum.textContent = n++; }
  else { wSection.style.display='none'; }
  document.getElementById('pb-num-context').textContent = n++;
  document.getElementById('pb-num-priority').textContent = n++;
  document.getElementById('pb-num-role').textContent = n++;
}

let lastCustomBuild = null;

function renderCustomBuild(scroll){
  const level = 60;
  const weaponChoice = getWeaponChoice('pb-bow');
  const context = getChoiceValue('pb-context');
  const role = getChoiceValue('pb-role');
  const priorityDiscipline = prioritySelect.value || null;
  const excludeWM = !document.getElementById('pb-include-wm').checked;
  const build = computeBuild(level, ctxCustom({weaponChoice, context, role, priorityDiscipline, excludeWM}), null, true);
  lastCustomBuild = build;
  const out = document.getElementById('pb-output');
  out.innerHTML = '';
  let summary = `Build a nivel <b>${build.level}</b> pensada para <b>${CONTEXT_LABEL[context]}</b>`;
  const wLabel = weaponSummaryLabel(weaponChoice);
  if(wLabel) summary += `, usando <b>${wLabel}</b>`;
  if(role) summary += `, con rol de <b>${ROLE_LABEL[role]}</b>`;
  if(priorityDiscipline) summary += `, priorizando <b>${CLASS.disciplines[priorityDiscipline].es}</b> y apoyándola con el resto de disciplinas`;
  summary += '.';
  summary += ' Incluye la rama de Maestría en Guerra, disponible solo a nivel 60.';
  out.insertAdjacentHTML('beforeend', `<div class="callout"><div class="mark">✦</div><div>${summary}</div></div>`);
  out.insertAdjacentHTML('beforeend', `<div class="stage"><div class="stage-body">${renderFullBuild(build)}</div></div>`);
  out.insertAdjacentHTML('beforeend', `<div class="export-row"><button class="go-btn secondary" onclick="exportCustomBuild()">Exportar como imagen</button></div><div id="pb-export-msg" class="hint"></div>`);
  if(scroll && out.scrollIntoView) out.scrollIntoView({behavior:'smooth', block:'start'});
}

function exportCustomBuild(){
  if(!lastCustomBuild) return;
  exportBuildAsImage(lastCustomBuild, lastCustomBuild.level, 'Build a medida · Nivel 60', `medida_nv60`, 'pb-export-msg');
}

let manualState = { level: 60, dlvl: {}, ranks: {} };
let expandedManualKeys = new Set();
function resetManualState(level){
  manualState = { level: level, dlvl: {}, ranks: {} };
  // Every discipline's first level costs 0 discipline points in the game —
  // it's effectively free and always available, so a fresh character starts
  // with it already there, not at an untouched 0.
  DISC_NAMES.forEach(n=> manualState.dlvl[n]=1);
  expandedManualKeys.clear();
}
resetManualState(60);

function manualDpSpent(){ return DISC_NAMES.reduce((s,n)=> s+costForDlvl(manualState.dlvl[n]), 0); }
function manualPpSpent(){
  let s=0;
  DISC_NAMES.forEach(n=>{
    if(n === WM_NAME) return; // Maestría en Guerra nunca consume puntos de poder
    CLASS.disciplines[n].spells.forEach((sp,idx)=> s += manualState.ranks[n+'|'+idx]||0);
  });
  return s;
}
function manualDpLeft(){ return totalDP(manualState.level) - manualDpSpent(); }

function renderArchetypeSuggestions(){
  const section = document.getElementById('pc-archetypes-section');
  const presets = ARCHETYPE_PRESETS[currentClass];
  document.getElementById('pc-archetype-blurb').textContent = '';
  if(!presets){ section.style.display = 'none'; return; }
  section.style.display = '';
  const el = document.getElementById('pc-archetype-presets');
  el.innerHTML = presets.map(p=>`<button class="choice-btn" data-v="${p.key}">${p.label}</button>`).join('');
  el.querySelectorAll('.choice-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      el.querySelectorAll('.choice-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const preset = presets.find(p=>p.key===btn.dataset.v);
      document.getElementById('pc-archetype-blurb').textContent = preset.blurb;
      applyArchetypeToManual(preset);
    });
  });
}
let manualActiveArchetypeLabel = null;
function applyArchetypeToManual(preset){
  const build = computeBuild(manualState.level, ctxCustom({
    context: preset.context, role: preset.role, priorityDiscipline: preset.priorityDiscipline
  }), null, true);
  manualState.dlvl = {...build.dlvl};
  manualState.ranks = {...build.ranks};
  manualActiveArchetypeLabel = preset.label;
  expandedManualKeys.clear();
  renderManualPanel();
}

function manualPpLeft(){ return totalPP(manualState.level) - manualPpSpent(); }

function clearArchetypeActive(){
  const el = document.getElementById('pc-archetype-presets');
  if(el) el.querySelectorAll('.choice-btn').forEach(b=>b.classList.remove('active'));
  const blurb = document.getElementById('pc-archetype-blurb');
  if(blurb) blurb.textContent = '';
  manualActiveArchetypeLabel = null;
}
function manualChangeDlvl(name, delta){
  const cur = manualState.dlvl[name];
  const next = cur + delta;
  if(next < 1 || next > MAXDLEVEL) return;
  if(delta > 0){
    if(charLevelReq(next) > manualState.level) return;
    const cost = costForDlvl(next) - costForDlvl(cur);
    if(cost > manualDpLeft()) return;
  }
  manualState.dlvl[name] = next;
  const isWM = name === WM_NAME;
  CLASS.disciplines[name].spells.forEach((sp, idx)=>{
    const key = name+'|'+idx;
    const cap = spellCap(name, idx, next);
    // Maestría en Guerra no se "recorta hacia abajo si excede" como el resto
    // — su rango real ES el tope siempre (0 o 5), así que se sincroniza
    // exacto en los dos sentidos, no solo cuando el tope baja.
    if(isWM) manualState.ranks[key] = cap;
    else if((manualState.ranks[key]||0) > cap) manualState.ranks[key] = cap;
  });
  clearArchetypeActive();
  renderManualPanel();
}
function manualChangeRank(name, idx, delta){
  if(name === WM_NAME) return; // se desbloquea sola, nunca a mano
  const key = name+'|'+idx;
  const cur = manualState.ranks[key] || 0;
  const cap = spellCap(name, idx, manualState.dlvl[name]);
  const next = cur + delta;
  if(next < 0 || next > cap) return;
  if(delta > 0 && manualPpLeft() <= 0) return;
  manualState.ranks[key] = next;
  clearArchetypeActive();
  renderManualPanel();
}

let manualActiveTab = 0;

function renderManualPanel(){
  const level = manualState.level;
  const dpLeft = manualDpLeft(), ppLeft = manualPpLeft();
  const dpBudget = totalDP(level), ppBudget = totalPP(level);
  // renderManualPanel reconstruye todo el HTML del panel en cada cambio, lo
  // que resetea el scroll a 0 por defecto — guardamos dónde estaba parado
  // antes de tocar el DOM, para devolverlo ahí después.
  const prevActivePane = document.querySelector(`#pc-build .tab-pane[data-idx="${manualActiveTab}"]`);
  const savedScrollTop = prevActivePane ? prevActivePane.scrollTop : 0;

  document.getElementById('pc-summary').innerHTML = `<div class="summary-grid">
    <div class="stat-card"><div class="label">Nivel</div><div class="value">${level}</div></div>
    <div class="stat-card"><div class="label">Disciplina</div><div class="value">${dpBudget-dpLeft}<span style="color:var(--ink-faint);font-size:13px"> / ${dpBudget}</span></div></div>
    <div class="stat-card"><div class="label">Poder</div><div class="value">${ppBudget-ppLeft}<span style="color:var(--ink-faint);font-size:13px"> / ${ppBudget}</span></div></div>
  </div>`;

  let rail = `<div class="tab-rail">`;
  const activeDiscName = DISC_NAMES[manualActiveTab];
  const activeSpellsForToggle = CLASS.disciplines[activeDiscName].spells;
  const anyExpandedNow = activeSpellsForToggle.some((sp,idx)=> expandedManualKeys.has(activeDiscName+'|'+idx));
  let panes = `<div class="tab-panes">
    <div class="pane-toolbar">
      <button class="mini-btn" onclick="toggleAllManual()">${anyExpandedNow ? 'Ocultar todo' : 'Desplegar todo'}</button>
    </div>`;
  DISC_NAMES.forEach((name, i)=>{
    const d = CLASS.disciplines[name];
    const lvl = manualState.dlvl[name];
    const pct = Math.round(lvl/MAXDLEVEL*100);
    const nextCost = lvl<MAXDLEVEL ? costForDlvl(lvl+1)-costForDlvl(lvl) : null;
    const canUp = lvl<MAXDLEVEL && charLevelReq(lvl+1)<=level && nextCost<=dpLeft;
    const canDown = lvl>0;
    rail += `<div class="rail-btn${i===manualActiveTab?' active':''}" role="button" tabindex="0" onclick="manualSelectTab(${i})">
      <div class="ricon" style="${iconStyle(d.icon,0,30)}"></div>
      <div class="rinfo">
        <div class="rname">${d.es}</div>
        <div class="rlvl">Disciplina ${lvl}/${MAXDLEVEL}</div>
        <div class="rbar"><i style="width:${pct}%"></i></div>
        <div class="mctrl">
          <button class="mbtn" onclick="event.stopPropagation();manualChangeDlvl('${name}',-1)" ${canDown?'':'disabled'}>−</button>
          <button class="mbtn" onclick="event.stopPropagation();manualChangeDlvl('${name}',1)" ${canUp?'':'disabled'}>+</button>
        </div>
      </div>
    </div>`;
    panes += `<div class="tab-pane${i===manualActiveTab?' active':''}" data-idx="${i}">`;
    const isWM = name === WM_NAME;
    d.spells.forEach((sp, idx)=>{
      const key = name+'|'+idx;
      const cap = spellCap(name, idx, lvl);
      // Maestría en Guerra no se ajusta a mano: cada habilidad se desbloquea
      // completa (o no) según el nivel de disciplina, nunca con puntos de
      // poder — así que acá el rango mostrado ES el tope, siempre.
      const rank = isWM ? cap : (manualState.ranks[key] || 0);
      let pips = '';
      for(let p=1;p<=MAXPLEVEL;p++){
        if(p<=rank) pips += '<div class="pip filled"></div>';
        else if(p<=cap) pips += '<div class="pip"></div>';
        else pips += '<div class="pip locked"></div>';
      }
      const canRankUp = rank<cap && ppLeft>0;
      const canRankDown = rank>0;
      const isLocked = cap===0;
      const isExpanded = expandedManualKeys.has(key);
      panes += `<div class="spell-row${isLocked?' row-locked':''}${isExpanded?' expanded':''}">
        <div class="sicon${rank===0?' dim':''}" style="${iconStyle(d.icon, sp.spriteIdx, 38)}"></div>
        <div class="rank-pips"${isWM?' style="visibility:hidden"':''}>${pips}</div>
        <div class="spell-info">
          <div class="spell-name">${sp.name} <span class="rk">Nv.${rank}/${MAXPLEVEL}</span> ${roleTags(sp)}${flagChips(sp)}</div>
          <div class="spell-desc">${sp.desc}</div>
        </div>
        <button class="spell-expand" onclick="toggleSpellDetailManual('${key}')">▸</button>
        <div class="mctrl">${isWM ? '' : (isLocked ? '' : `
          <button class="mbtn" onclick="manualChangeRank('${name}',${idx},-1)" ${canRankDown?'':'disabled'}>−</button>
          <button class="mbtn" onclick="manualChangeRank('${name}',${idx},1)" ${canRankUp?'':'disabled'}>+</button>
        `)}</div>
        <div class="spell-detail">${buildSpellDetailHTML(name, sp, idx, lvl, rank)}</div>
      </div>`;
    });
    panes += `</div>`;
  });
  rail += `</div>`; panes += `</div>`;
  document.getElementById('pc-build').innerHTML = `<div class="tabframe">${rail}${panes}</div>`;
  captureNaturalHeightIfNeeded(DISC_NAMES[manualActiveTab]);
  const activePane = document.querySelector(`#pc-build .tab-pane[data-idx="${manualActiveTab}"]`);
  if(activePane){
    const hasExpanded = activePane.querySelector('.spell-row.expanded') !== null;
    if(hasExpanded && manualSharedNaturalHeight !== undefined){
      activePane.style.maxHeight = manualSharedNaturalHeight + 'px';
      activePane.style.overflowY = 'auto';
      activePane.style.paddingRight = '14px';
    }
    activePane.scrollTop = savedScrollTop;
  }
}
function manualSelectTab(i){ manualActiveTab = i; renderManualPanel(); }
// Las disciplinas no tienen todas la misma cantidad de habilidades — Maestría
// en Guerra por ejemplo tiene bastante menos que el resto. En vez de que cada
// panel tenga su propio techo de scroll (lo que hacía ver a Maestría en
// Guerra recortada con scroll mientras podía haber usado más espacio hacia
// abajo), se comparte UN SOLO techo entre todas: el más alto que se haya
// visto hasta ahora, sin desplegar nada, en cualquier disciplina visitada.
let manualSharedNaturalHeight = undefined;
function captureNaturalHeightIfNeeded(discName){
  const hasAnyExpanded = CLASS.disciplines[discName].spells.some((sp,idx)=> expandedManualKeys.has(discName+'|'+idx));
  if(hasAnyExpanded) return; // ya había algo desplegado antes de empezar a rastrear esta disciplina
  const pane = document.querySelector(`#pc-build .tab-pane[data-idx="${manualActiveTab}"]`);
  if(!pane) return;
  const h = pane.scrollHeight;
  if(manualSharedNaturalHeight === undefined || h > manualSharedNaturalHeight){
    manualSharedNaturalHeight = h;
  }
}
function toggleSpellDetailManual(key){
  captureNaturalHeightIfNeeded(key.split('|')[0]);
  if(expandedManualKeys.has(key)) expandedManualKeys.delete(key);
  else expandedManualKeys.add(key);
  renderManualPanel();
}
function expandAllManual(){
  const name = DISC_NAMES[manualActiveTab];
  captureNaturalHeightIfNeeded(name);
  CLASS.disciplines[name].spells.forEach((sp,idx)=> expandedManualKeys.add(name+'|'+idx));
  renderManualPanel();
}
function collapseAllManual(){
  const name = DISC_NAMES[manualActiveTab];
  CLASS.disciplines[name].spells.forEach((sp,idx)=> expandedManualKeys.delete(name+'|'+idx));
  renderManualPanel();
}
function toggleAllManual(){
  const name = DISC_NAMES[manualActiveTab];
  const spells = CLASS.disciplines[name].spells;
  const anyExpanded = spells.some((sp,idx)=> expandedManualKeys.has(name+'|'+idx));
  if(anyExpanded) collapseAllManual();
  else expandAllManual();
}

// Mensaje flotante que aparece y desaparece solo — reemplaza los textos que
// antes quedaban pegados en la pantalla hasta reiniciar o refrescar.
function showToast(message){
  let container = document.getElementById('toast-container');
  if(!container){
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(()=> toast.classList.add('show'));
  setTimeout(()=>{
    toast.classList.remove('show');
    setTimeout(()=> toast.remove(), 300);
  }, 3200);
}

function loadHtml2Canvas(cb){
  if(window.html2canvas){ cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  s.onload = cb;
  s.onerror = ()=>{ showToast('No se pudo cargar el exportador de imágenes (revisa tu conexión). Prueba "Copiar resumen como texto" si está disponible.'); };
  document.head.appendChild(s);
}

// Generic export trigger: given a build-like object + level, renders offscreen and downloads a PNG
function exportBuildAsImage(buildLike, level, titleSub, filenameSuffix, customName, archetypeLabel){
  loadHtml2Canvas(()=>{
    const temp = document.createElement('div');
    temp.style.cssText = 'position:fixed;left:-9999px;top:0;width:820px;';
    temp.innerHTML = buildExportCardFromBuild(buildLike, level, titleSub, customName, archetypeLabel);
    document.body.appendChild(temp);
    const imgsToWait = Array.from(temp.querySelectorAll('img')).filter(img=> !img.complete);
    const waitForIcon = imgsToWait.length
      ? Promise.all(imgsToWait.map(img=> new Promise(res=>{ img.onload = res; img.onerror = res; })))
      : Promise.resolve();
    waitForIcon.then(()=>{
      const themeBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-1').trim() || '#161d17';
      window.html2canvas(temp.firstElementChild, {backgroundColor:themeBg, scale:2}).then(canvas=>{
        document.body.removeChild(temp);
        const link = document.createElement('a');
        const namePart = customName ? '_' + customName.trim().toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
          .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40) : '';
        link.download = `${currentClass}${namePart}_${filenameSuffix}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('Imagen descargada.');
      }).catch(()=>{
        document.body.removeChild(temp);
        showToast('No se pudo generar la imagen. Prueba "Copiar resumen como texto" si está disponible.');
      });
    });
  });
}

// Links para compartir: toda la build (subclase, nivel, nombre, y cada
// punto puesto) se codifica dentro del propio link — no hay ningún servidor
// guardando nada. En vez de JSON completo (con nombres de campo, comillas,
// corchetes de sobra), cada dato ocupa lo mínimo posible: 1 carácter por
// clase, 2 por nivel, 1 por nivel de cada disciplina, y 1 por rango de cada
// habilidad — el resultado es mucho más corto que un JSON codificado entero.
const SHARE_CLASS_CODE = {hunter:'h', marksman:'m', conjurer:'c', warlock:'w', barbarian:'b', knight:'k'};
const SHARE_CLASS_CODE_REV = {h:'hunter', m:'marksman', c:'conjurer', w:'warlock', b:'barbarian', k:'knight'};
function buildShareLink(){
  const classChar = SHARE_CLASS_CODE[currentClass] || 'h';
  const levelChars = manualState.level.toString(36).padStart(2,'0');
  const dlvlChars = DISC_NAMES.map(n=> (manualState.dlvl[n]||1).toString(36)).join('');
  const rankChars = DISC_NAMES.map(n=>
    CLASS.disciplines[n].spells.map((sp,idx)=> (manualState.ranks[n+'|'+idx]||0).toString()).join('')
  ).join('');
  const name = document.getElementById('pc-build-name').value.trim();
  let code = classChar + levelChars + dlvlChars + rankChars;
  if(name) code += '~' + encodeURIComponent(name);
  return `${location.origin}${location.pathname}#b=${code}`;
}
function applyShareLinkIfPresent(){
  const match = location.hash.match(/#b=([^&]+)/);
  if(!match) return false;
  try {
    let code = match[1];
    let name = '';
    const tildeIdx = code.indexOf('~');
    if(tildeIdx >= 0){ name = decodeURIComponent(code.slice(tildeIdx+1)); code = code.slice(0, tildeIdx); }
    const classKey = SHARE_CLASS_CODE_REV[code[0]];
    if(!classKey || !ROOT.classes[classKey]) return false;
    const level = Math.max(10, Math.min(60, parseInt(code.slice(1,3), 36) || 60));
    switchClass(classKey);
    clearTimeout(switchClassRenderTimer); // este flujo arma y renderiza su propio estado final más abajo
    document.querySelectorAll('#class-switch .choice-btn').forEach(b=> b.classList.toggle('active', b.dataset.v===classKey));
    resetManualState(level);
    document.getElementById('pc-level').value = level;
    if(name) document.getElementById('pc-build-name').value = name;

    const discCount = DISC_NAMES.length;
    const dlvlPart = code.slice(3, 3+discCount);
    const ranksPart = code.slice(3+discCount);
    let pos = 0;
    DISC_NAMES.forEach((discName, i)=>{
      const dlvl = Math.max(1, Math.min(MAXDLEVEL, parseInt(dlvlPart[i], 36) || 1));
      manualState.dlvl[discName] = dlvl;
      CLASS.disciplines[discName].spells.forEach((sp, idx)=>{
        const rankChar = ranksPart[pos]; pos++;
        const cap = spellCap(discName, idx, dlvl);
        manualState.ranks[discName+'|'+idx] = Math.max(0, Math.min(cap, parseInt(rankChar,10) || 0));
      });
    });
    manualActiveTab = 0;
    manualActiveArchetypeLabel = null;
    clearArchetypeActive();
    renderManualPanel();
    showToast('Build cargada desde el link compartido.');
    return true;
  } catch(e){
    console.error('No se pudo leer el link compartido', e);
    showToast('El link compartido no es válido o está dañado.');
    return false;
  }
}

const REALM_LABEL = {syrtis:'Syrtis', alsius:'Alsius', ignis:'Ignis'};
// En pantallas angostas no hay lugar para el escudo grande ni la barra
// lateral al costado — en vez de duplicar ese HTML, se mueven los mismos
// elementos reales a un lugar sensato dentro de la página (el escudo, chico,
// junto al título; la barra de configuración, justo antes del panel de
// disciplinas) y se devuelven a su lugar de siempre apenas hay espacio.
const NARROW_QUERY = window.matchMedia
  ? window.matchMedia('(max-width: 1440px)')
  : {matches: window.innerWidth <= 1440, addEventListener: function(){}};
function applyResponsiveLayout(isNarrow){
  const shield = document.getElementById('hero-realm-shield');
  const shieldAnchor = document.getElementById('hero-shield-anchor');
  const shieldRail = document.querySelector('.shield-rail');
  const rail = document.querySelector('.config-rail');
  const railAnchor = document.getElementById('config-rail-anchor');
  const pageFlex = document.querySelector('.page-flex');
  const mapLayers = document.getElementById('map-layers-block');
  const mapLayersAnchor = document.getElementById('map-layers-anchor');
  if(!shield || !shieldAnchor || !shieldRail || !rail || !railAnchor || !pageFlex) return;

  if(isNarrow){
    if(shield.parentElement !== shieldAnchor){ shieldAnchor.appendChild(shield); shield.classList.add('hero-realm-shield-small'); }
    if(rail.parentElement !== railAnchor){ railAnchor.appendChild(rail); }
    rail.style.marginTop = '';
    rail.classList.remove('rail-measuring');
    if(mapLayers && mapLayersAnchor && mapLayers.parentElement !== mapLayersAnchor){
      mapLayersAnchor.appendChild(mapLayers);
      mapLayers.classList.add('map-layers-inline');
    }
  } else {
    if(shield.parentElement !== shieldRail){ shieldRail.appendChild(shield); shield.classList.remove('hero-realm-shield-small'); }
    if(rail.parentElement !== pageFlex){ pageFlex.appendChild(rail); }
    scheduleAlignConfigRail();
    if(mapLayers && mapLayers.parentElement !== shieldRail){
      shieldRail.appendChild(mapLayers);
      mapLayers.classList.remove('map-layers-inline');
    }
  }
}
NARROW_QUERY.addEventListener('change', e => applyResponsiveLayout(e.matches));

const REALM_MUSIC_VOLUME = 0.05; // acompaña de fondo, sin molestar
const savedMusicMuted = localStorage.getItem('cort-music-muted');
let musicMuted = savedMusicMuted === null ? true : savedMusicMuted === '1';
function updateRealmMusic(realmKey){
  const audio = document.getElementById('realm-music');
  if(!audio) return;
  const src = `data/audio/${realmKey}.ogg`;
  if(!audio.src.endsWith(src)){
    audio.src = src;
    audio.volume = REALM_MUSIC_VOLUME;
  }
  if(!musicMuted) tryPlayMusic();
}
function tryPlayMusic(){
  const audio = document.getElementById('realm-music');
  if(!audio || !audio.src || musicMuted) return;
  // Si el navegador bloquea la reproducción automática, no se reintenta
  // solo con "el próximo clic sea cual sea" — eso enganchaba la carga de
  // audio con cualquier otra cosa que la persona estuviera haciendo en ese
  // momento (como cambiar de subclase varias veces seguidas). Ahora sólo
  // se reintenta cuando se toca el botón de sonido a propósito.
  const p = audio.play();
  if(p && p.catch) p.catch(()=>{});
}
function setMusicMuted(muted){
  musicMuted = muted;
  localStorage.setItem('cort-music-muted', muted ? '1' : '0');
  const audio = document.getElementById('realm-music');
  const btn = document.getElementById('music-mute-btn');
  if(audio) audio.muted = muted;
  if(btn){
    btn.textContent = muted ? '🔇' : '🔊';
    btn.classList.toggle('is-muted', muted);
    btn.title = muted ? 'Activar música ambiental' : 'Silenciar música ambiental';
  }
  if(!muted) tryPlayMusic();
}

function updateRealmShield(realmKey){
  const img = document.getElementById('hero-realm-shield');
  if(!img) return;
  img.src = `${ICONS_BASE_PATH}/shield-${realmKey}.webp`;
  img.alt = REALM_LABEL[realmKey] || realmKey;
}

// La barra de Subclase/Nivel/Nombre solo vive al costado en pantallas anchas
// (ver el breakpoint de 1440px en el CSS) — ahí, en vez de un padding fijo
// que se desalinea apenas cambia algo arriba (el header, un aviso, etc), se
// mide dónde arranca de verdad el panel de disciplinas y se empareja con eso.
function alignConfigRail(){
  const rail = document.querySelector('.config-rail');
  const stage = document.getElementById('pc-capture');
  if(!rail || !stage) return;
  if(window.innerWidth <= 1440){ rail.style.marginTop = ''; rail.classList.remove('rail-measuring'); return; }
  rail.style.marginTop = '0px'; // reset antes de medir, para partir de una base limpia
  const stageTop = stage.getBoundingClientRect().top;
  const railTop = rail.getBoundingClientRect().top;
  const diff = stageTop - railTop;
  rail.style.marginTop = Math.max(0, diff) + 'px';
  rail.classList.remove('rail-measuring');
}
let alignConfigRailTimer = null;
function scheduleAlignConfigRail(){
  clearTimeout(alignConfigRailTimer);
  alignConfigRailTimer = setTimeout(alignConfigRail, 60);
}
window.addEventListener('resize', scheduleAlignConfigRail);

// Mismo truco que alignConfigRail: los checkboxes de capas viven bajo el
// escudo, pero tienen que arrancar a la altura del mapa, no pegados al
// escudo — se mide dónde arranca de verdad .map-frame y se empareja con eso.
function alignMapLayers(){
  const layers = document.getElementById('map-layers-block');
  const frame = document.querySelector('.map-frame');
  if(!layers || !frame) return;
  if(window.innerWidth <= 1440){ layers.style.marginTop = ''; return; }
  layers.style.marginTop = '0px';
  const frameTop = frame.getBoundingClientRect().top;
  const layersTop = layers.getBoundingClientRect().top;
  const diff = frameTop - layersTop;
  layers.style.marginTop = Math.max(0, diff) + 'px';
}
let alignMapLayersTimer = null;
function scheduleAlignMapLayers(){
  clearTimeout(alignMapLayersTimer);
  alignMapLayersTimer = setTimeout(alignMapLayers, 60);
}
window.addEventListener('resize', scheduleAlignMapLayers);

function updateHeroHeader(){
  document.getElementById('hero-title-class').textContent = CLASS.label;
  document.getElementById('hero-class-icon').src = `${ICONS_BASE_PATH}/class-${currentClass}.webp`;
  document.getElementById('hero-class-icon').alt = CLASS.label;
}
let switchClassRenderTimer = null;
function updateSharedChromeForTab(panelId){
  const isBuildTab = panelId === 'panel-manual';
  const eyebrow = document.getElementById('hero-eyebrow');
  const titleH1 = document.getElementById('hero-title-h1');
  const noticeText = document.getElementById('notice-build-text');
  const rail = document.querySelector('.config-rail');
  const mapLayers = document.getElementById('map-layers-block');
  const isMapTab = panelId === 'panel-map';
  if(eyebrow) eyebrow.textContent = isMapTab ? 'Mapa Interactivo' : 'Constructor de builds';
  if(noticeText) noticeText.textContent = isMapTab
    ? 'Buscá NPCs y misiones, filtrá por reino o profesión, y hacé clic en un marcador para ver el detalle.'
    : 'Arma tu build a mano, habilidad por habilidad, y expórtala como imagen para compartir.';
  // visibility en vez de display: así el título grande y el rail siguen
  // ocupando su lugar (240px escudo + rail 320px) y el resto del contenido
  // no se corre ni sube/baja al cambiar de pestaña. El aviso ahora se
  // muestra siempre (con texto distinto), no hace falta ocultarlo.
  if(titleH1) titleH1.style.visibility = isBuildTab ? '' : 'hidden';
  if(rail) rail.style.visibility = isBuildTab ? '' : 'hidden';
  if(mapLayers) mapLayers.style.display = isMapTab ? '' : 'none';
  if(isMapTab) scheduleAlignMapLayers();
}

function switchClass(newClass){
  currentClass = newClass;
  localStorage.setItem('cort-last-class', currentClass);
  CLASS = ROOT.classes[currentClass];
  DISC_NAMES = Object.keys(CLASS.disciplines);
  WM_NAME = DISC_NAMES.find(n=> CLASS.disciplines[n].group === "wm");

  // Lo liviano (título, ícono, qué botón se ve marcado) se actualiza al
  // instante en cada clic, para que la interfaz se sienta responsiva.
  updateHeroHeader();

  // Lo pesado (reconstruir todos los paneles, sobre todo el de disciplinas y
  // habilidades, que puede llegar a ~75 filas de HTML) se agrupa un poco —
  // si la persona clickea varias subclases seguidas muy rápido, esta parte
  // corre una sola vez, con la última que quedó elegida, en vez de una vez
  // por cada clic intermedio en el camino.
  clearTimeout(switchClassRenderTimer);
  switchClassRenderTimer = setTimeout(()=>{
    renderWeaponPanel('pa-weapon-panel');
    renderWeaponPanel('pb-bow', 'pb-weapon-section');
    renumberPanelsB();
    populatePriorityDropdown();

    resetManualState(60);
    manualActiveArchetypeLabel = null;
    document.getElementById('pc-level').value = 60;
    manualActiveTab = 0;
    renderArchetypeSuggestions();

    document.getElementById('pa-output').innerHTML = '';
    document.getElementById('pb-output').innerHTML = '';

    renderProgression(false);
    renderCustomBuild(false);
    renderManualPanel();
    scheduleAlignConfigRail();
  }, 120);
}
/* =========================================================================
   initApp — arranca la aplicación una vez que los datos del juego llegaron
   ========================================================================= */
function initApp(){
  // --- Tab A: Progreso ---
  document.querySelectorAll('.main-tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.main-tab').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.main-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.panel).classList.add('active');
      updateSharedChromeForTab(btn.dataset.panel);
    });
  });
  wireChoiceGroup('pa-mode');
  document.getElementById('pa-go').addEventListener('click', ()=>renderProgression(true));

  // --- Tab B: Build a medida ---
  wireChoiceGroup('pb-context');
  wireChoiceGroup('pb-role');
  document.getElementById('pb-go').addEventListener('click', ()=>renderCustomBuild(true));

  // --- Tab C: Tu build ---
  resetManualState(60);
  document.getElementById('pc-level').addEventListener('change', ()=>{
    const v = Math.max(10, Math.min(60, parseInt(document.getElementById('pc-level').value) || 60));
    document.getElementById('pc-level').value = v;
    resetManualState(v);
    manualActiveTab = 0;
    clearArchetypeActive();
    document.getElementById('pc-build-name').value = '';
    renderManualPanel();
  });
  document.getElementById('pc-reset').addEventListener('click', ()=>{
    resetManualState(manualState.level);
    clearArchetypeActive();
    document.getElementById('pc-build-name').value = '';
    renderManualPanel();
  });
  document.getElementById('pc-export-img').addEventListener('click', ()=>{
    const customName = document.getElementById('pc-build-name').value.trim() || null;
    exportBuildAsImage(manualState, manualState.level, `Build manual · Nivel ${manualState.level}`, `manual_nv${manualState.level}`, customName, manualActiveArchetypeLabel);
  });
  document.getElementById('pc-export-txt').addEventListener('click', ()=>{
    const url = buildShareLink();
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(()=>{ showToast('Link copiado al portapapeles.'); })
        .catch(()=>{ showToast('No se pudo copiar automáticamente. Link en consola (F12).'); console.log(url); });
    } else {
      console.log(url);
      showToast('Tu navegador no permite copiar automáticamente. Revisa la consola (F12).');
    }
  });

  // --- Clase y reino ---
  wireChoiceGroup('class-switch');
  document.getElementById('class-switch').querySelectorAll('.choice-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> switchClass(btn.dataset.v));
  });
  // La subclase ya se leyó de lo último guardado (o Brujo, si es la primera
  // visita) al declarar currentClass — acá solo hace falta que el botón
  // correcto se vea marcado como activo, ya que el HTML estático siempre
  // trae a Brujo marcado por default.
  document.querySelectorAll('#class-switch .choice-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.v === currentClass);
  });

  const VALID_REALM_KEYS = ['syrtis','alsius','ignis'];
  const savedRealm = localStorage.getItem('cort-last-realm');
  const startRealm = (savedRealm && VALID_REALM_KEYS.includes(savedRealm)) ? savedRealm : 'syrtis';

  wireChoiceGroup('realm-switch');
  document.getElementById('realm-switch').querySelectorAll('.choice-btn.realm-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.documentElement.setAttribute('data-realm', btn.dataset.v);
      localStorage.setItem('cort-last-realm', btn.dataset.v);
      updateRealmShield(btn.dataset.v);
      updateRealmMusic(btn.dataset.v);
    });
  });
  document.documentElement.setAttribute('data-realm', startRealm);
  document.querySelectorAll('#realm-switch .choice-btn.realm-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.v === startRealm);
  });
  updateRealmShield(startRealm);
  setMusicMuted(musicMuted);
  updateRealmMusic(startRealm);
  document.getElementById('music-mute-btn').addEventListener('click', ()=> setMusicMuted(!musicMuted));

  // --- Render inicial ---
  document.getElementById('app-version').textContent = `Herramienta v${APP_VERSION}`;
  updateHeroHeader();
  renderWeaponPanel('pa-weapon-panel');
  renderWeaponPanel('pb-bow', 'pb-weapon-section');
  renumberPanelsB();
  populatePriorityDropdown();
  renderArchetypeSuggestions();
  renderProgression(false);
  renderCustomBuild(false);
  renderManualPanel();
  applyShareLinkIfPresent();
  applyResponsiveLayout(NARROW_QUERY.matches);
  updateSharedChromeForTab('panel-manual');
  setTimeout(alignConfigRail, 150);
  setTimeout(()=> document.querySelector('.config-rail')?.classList.remove('rail-measuring'), 600);
  }
