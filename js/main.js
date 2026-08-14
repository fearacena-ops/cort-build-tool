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
  DISC_NAMES.forEach(n=> manualState.dlvl[n]=0);
  expandedManualKeys.clear();
}
resetManualState(60);

function manualDpSpent(){ return DISC_NAMES.reduce((s,n)=> s+costForDlvl(manualState.dlvl[n]), 0); }
function manualPpSpent(){
  let s=0;
  DISC_NAMES.forEach(n=> CLASS.disciplines[n].spells.forEach((sp,idx)=> s += manualState.ranks[n+'|'+idx]||0));
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
function applyArchetypeToManual(preset){
  const build = computeBuild(manualState.level, ctxCustom({
    context: preset.context, role: preset.role, priorityDiscipline: preset.priorityDiscipline
  }), null, true);
  manualState.dlvl = {...build.dlvl};
  manualState.ranks = {...build.ranks};
  expandedManualKeys.clear();
  renderManualPanel();
}

function manualPpLeft(){ return totalPP(manualState.level) - manualPpSpent(); }

function clearArchetypeActive(){
  const el = document.getElementById('pc-archetype-presets');
  if(el) el.querySelectorAll('.choice-btn').forEach(b=>b.classList.remove('active'));
  const blurb = document.getElementById('pc-archetype-blurb');
  if(blurb) blurb.textContent = '';
}
function manualChangeDlvl(name, delta){
  const cur = manualState.dlvl[name];
  const next = cur + delta;
  if(next < 0 || next > MAXDLEVEL) return;
  if(delta > 0){
    if(charLevelReq(next) > manualState.level) return;
    const cost = costForDlvl(next) - costForDlvl(cur);
    if(cost > manualDpLeft()) return;
  }
  manualState.dlvl[name] = next;
  CLASS.disciplines[name].spells.forEach((sp, idx)=>{
    const key = name+'|'+idx;
    const cap = spellCap(name, idx, next);
    if((manualState.ranks[key]||0) > cap) manualState.ranks[key] = cap;
  });
  clearArchetypeActive();
  renderManualPanel();
}
function manualChangeRank(name, idx, delta){
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

  document.getElementById('pc-summary').innerHTML = `<div class="summary-grid">
    <div class="stat-card"><div class="label">Nivel</div><div class="value">${level}</div></div>
    <div class="stat-card"><div class="label">Disciplina</div><div class="value">${dpBudget-dpLeft}<span style="color:var(--ink-faint);font-size:13px"> / ${dpBudget}</span></div></div>
    <div class="stat-card"><div class="label">Poder</div><div class="value">${ppBudget-ppLeft}<span style="color:var(--ink-faint);font-size:13px"> / ${ppBudget}</span></div></div>
  </div>`;

  const warnBox = document.getElementById('pc-warning');
  let warnHtml = '';
  (CLASS.weaponGroups||[]).forEach(group=>{
    const investedOpts = group.options.filter(o=> manualState.dlvl[o.discipline] > 0);
    if(investedOpts.length > 1){
      const names = investedOpts.map(o=>`<b>${CLASS.disciplines[o.discipline].es}</b>`).join(' y ');
      warnHtml += `<div class="callout warn"><div class="mark">!</div><div>Tienes puntos en ${names} a la vez. En combate solo puedes tener un ${group.label.toLowerCase()} equipado — repártelos así solo si quieres tener ambos disponibles para cambiar de equipo.</div></div>`;
    }
  });
  warnBox.innerHTML = warnHtml;

  let rail = `<div class="tab-rail">`;
  let panes = `<div class="tab-panes">
    <div class="pane-toolbar">
      <button class="mini-btn" onclick="expandAllManual()">Desplegar todo</button>
      <button class="mini-btn" onclick="collapseAllManual()">Ocultar todo</button>
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
    d.spells.forEach((sp, idx)=>{
      const key = name+'|'+idx;
      const rank = manualState.ranks[key] || 0;
      const cap = spellCap(name, idx, lvl);
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
        <div class="sicon${rank===0?' dim':''}" style="${iconStyle(d.icon, idx+1, 38)}"></div>
        <div class="rank-pips">${pips}</div>
        <div class="spell-info">
          <div class="spell-name">${sp.name} <span class="rk">Nv.${rank}/${MAXPLEVEL}</span> ${roleTags(sp)}${flagChips(sp)}</div>
          <div class="spell-desc">${sp.desc}</div>
        </div>
        <button class="spell-expand" onclick="toggleSpellDetailManual('${key}')">▸</button>
        <div class="mctrl">${isLocked ? '' : `
          <button class="mbtn" onclick="manualChangeRank('${name}',${idx},-1)" ${canRankDown?'':'disabled'}>−</button>
          <button class="mbtn" onclick="manualChangeRank('${name}',${idx},1)" ${canRankUp?'':'disabled'}>+</button>
        `}</div>
        <div class="spell-detail">${buildSpellDetailHTML(name, sp, idx, lvl, rank)}</div>
      </div>`;
    });
    panes += `</div>`;
  });
  rail += `</div>`; panes += `</div>`;
  document.getElementById('pc-build').innerHTML = `<div class="tabframe">${rail}${panes}</div>`;
}
function manualSelectTab(i){ manualActiveTab = i; renderManualPanel(); }
function toggleSpellDetailManual(key){
  if(expandedManualKeys.has(key)) expandedManualKeys.delete(key);
  else expandedManualKeys.add(key);
  renderManualPanel();
}
function expandAllManual(){
  const name = DISC_NAMES[manualActiveTab];
  CLASS.disciplines[name].spells.forEach((sp,idx)=> expandedManualKeys.add(name+'|'+idx));
  renderManualPanel();
}
function collapseAllManual(){
  const name = DISC_NAMES[manualActiveTab];
  CLASS.disciplines[name].spells.forEach((sp,idx)=> expandedManualKeys.delete(name+'|'+idx));
  renderManualPanel();
}

function loadHtml2Canvas(cb){
  if(window.html2canvas){ cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  s.onload = cb;
  s.onerror = ()=>{ msgAllExports('No se pudo cargar el exportador de imágenes (revisa tu conexión). Prueba "Copiar resumen como texto" si está disponible.'); };
  document.head.appendChild(s);
}
function msgAllExports(text){
  ['pa-export-msg','pb-export-msg','pc-export-msg'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.textContent = text;
  });
}

// Generic export trigger: given a build-like object + level, renders offscreen and downloads a PNG
function exportBuildAsImage(buildLike, level, titleSub, filenameSuffix, msgElId, customName){
  const msg = document.getElementById(msgElId);
  if(msg) msg.textContent = 'Generando imagen…';
  loadHtml2Canvas(()=>{
    const temp = document.createElement('div');
    temp.style.cssText = 'position:fixed;left:-9999px;top:0;width:640px;';
    temp.innerHTML = buildExportCardFromBuild(buildLike, level, titleSub, customName);
    document.body.appendChild(temp);
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
      if(msg) msg.textContent = 'Imagen descargada.';
    }).catch(()=>{
      document.body.removeChild(temp);
      if(msg) msg.textContent = 'No se pudo generar la imagen. Prueba "Copiar resumen como texto" si está disponible.';
    });
  });
}

function switchClass(newClass){
  currentClass = newClass;
  CLASS = ROOT.classes[currentClass];
  DISC_NAMES = Object.keys(CLASS.disciplines);
  WM_NAME = DISC_NAMES.find(n=> CLASS.disciplines[n].group === "wm");

  document.getElementById('current-class-label').textContent = CLASS.label;
  document.getElementById('hero-meta-class').textContent = `Prototipo · clase ${CLASS.label}`;

  renderWeaponPanel('pa-weapon-panel');
  renderWeaponPanel('pb-bow', 'pb-weapon-section');
  renumberPanelsB();
  populatePriorityDropdown();

  resetManualState(60);
  document.getElementById('pc-level').value = 60;
  manualActiveTab = 0;
  renderArchetypeSuggestions();

  document.getElementById('pa-output').innerHTML = '';
  document.getElementById('pb-output').innerHTML = '';

  renderProgression(false);
  renderCustomBuild(false);
  renderManualPanel();
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
    renderManualPanel();
    document.getElementById('pc-export-msg').textContent = '';
  });
  document.getElementById('pc-reset').addEventListener('click', ()=>{
    resetManualState(manualState.level);
    clearArchetypeActive();
    renderManualPanel();
    document.getElementById('pc-export-msg').textContent = '';
  });
  document.getElementById('pc-export-img').addEventListener('click', ()=>{
    const customName = document.getElementById('pc-build-name').value.trim() || null;
    exportBuildAsImage(manualState, manualState.level, `Build manual · Nivel ${manualState.level}`, `manual_nv${manualState.level}`, 'pc-export-msg', customName);
  });
  document.getElementById('pc-export-txt').addEventListener('click', ()=>{
    let lines = [`${CLASS.label} — Build manual — Nivel ${manualState.level}`, ''];
    DISC_NAMES.forEach(name=>{
      const lvl = manualState.dlvl[name];
      if(lvl<=0) return;
      lines.push(`${CLASS.disciplines[name].es}: disciplina ${lvl}/${MAXDLEVEL}`);
      CLASS.disciplines[name].spells.forEach((sp, idx)=>{
        const rank = manualState.ranks[name+'|'+idx] || 0;
        if(rank>0) lines.push(`  - ${sp.name}: rango ${rank}/${MAXPLEVEL}`);
      });
    });
    const text = lines.join('\n');
    const msg = document.getElementById('pc-export-msg');
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(()=>{ msg.textContent = 'Resumen copiado al portapapeles.'; })
        .catch(()=>{ msg.textContent = 'No se pudo copiar automáticamente. Build en consola (F12).'; console.log(text); });
    } else {
      console.log(text);
      msg.textContent = 'Tu navegador no permite copiar automáticamente. Revisa la consola (F12).';
    }
  });

  // --- Clase y reino ---
  wireChoiceGroup('class-switch');
  document.getElementById('class-switch').querySelectorAll('.choice-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> switchClass(btn.dataset.v));
  });
  
  wireChoiceGroup('realm-switch');
  document.getElementById('realm-switch').querySelectorAll('.choice-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.documentElement.setAttribute('data-realm', btn.dataset.v);
    });
  });

  // --- Render inicial ---
  document.getElementById('app-version').textContent = `Herramienta v${APP_VERSION}`;
  renderWeaponPanel('pa-weapon-panel');
  renderWeaponPanel('pb-bow', 'pb-weapon-section');
  renumberPanelsB();
  populatePriorityDropdown();
  renderArchetypeSuggestions();
  renderProgression(false);
  renderCustomBuild(false);
  renderManualPanel();
  }
