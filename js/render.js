/* =========================================================================
   render.js — construcción de HTML e interacciones ligadas al render
   Recomendador de build — Champions of Regnum

   Depende de engine.js (debe cargarse antes). No arma la página completa
   ni cablea los botones principales — eso vive en main.js.
   ========================================================================= */

/* Cada disciplina trae un sprite (hoja de 11 íconos: el de la disciplina +
   10 habilidades) como archivo real en data/icons/<Discplina>.webp — antes
   iba incrustado en base64 dentro del JSON de datos, ahora el navegador
   lo cachea y lo pide en paralelo como cualquier imagen. */
const ICONS_BASE_PATH = 'data/icons';
const SPRITE_OFFSETS = [0,-49,-97,-145,-193,-241,-289,-337,-385,-433,-481];
const SPRITE_CELL = 48; // pitch nativo (px) de cada ícono en la hoja de sprites
const SPRITE_COLS = 11; // ícono de disciplina + 10 casilleros de habilidad
function iconStyle(discKey, spellpos, boxSize){
  boxSize = boxSize || 40;
  const scale = boxSize / SPRITE_CELL;
  const off = (SPRITE_OFFSETS[spellpos] || 0) * scale;
  const sheetW = SPRITE_CELL * SPRITE_COLS * scale;
  const sheetH = SPRITE_CELL * scale;
  return `background-image:url(${ICONS_BASE_PATH}/${discKey}.webp);background-size:${sheetW}px ${sheetH}px;background-position:${off}px 0px;background-repeat:no-repeat;`;
}

function tagLabel(cat){ return {dmg:"Daño", control:"Control", defense:"Defensa", utility:"Utilidad"}[cat] || cat; }
const ROLE_LABEL = {dps:"DPS", cc:"Control", support:"Apoyo", tank:"Tanque", flanker:"Flanqueador"};

const TYPE_LABEL = {Passive:"Pasivo", Constant:"Constante", Direct:"Directo", Activable:"Activable", Aura:"Aura"};
function buildDetailTable(sp, rank, cap){
  const rows = [];
  if(sp.mana != null) rows.push({label:'Maná', value:sp.mana});
  if(sp.duration != null) rows.push({label:'Duración (s)', value:sp.duration});
  (sp.damage||[]).forEach(e=> rows.push({label:e.label, value:e.value}));
  (sp.debuffs||[]).forEach(e=> rows.push({label:e.label, value:e.value}));
  (sp.buffs||[]).forEach(e=> rows.push({label:e.label, value:e.value}));
  const tabular = rows.filter(r=> Array.isArray(r.value) || typeof r.value === 'number');
  if(tabular.length===0) return '';
  let html = `<table class="detail-table"><thead><tr><th style="width:34%"></th>`;
  for(let r=1;r<=MAXPLEVEL;r++){
    const cls = r===rank ? 'cur' : (r>cap ? 'locked' : '');
    html += `<th class="${cls}">${r}</th>`;
  }
  html += `</tr></thead><tbody>`;
  tabular.forEach(row=>{
    const arr = Array.isArray(row.value) ? row.value : [row.value,row.value,row.value,row.value,row.value];
    html += `<tr><th class="rowlabel">${row.label}</th>`;
    for(let r=1;r<=MAXPLEVEL;r++){
      const cls = r===rank ? 'cur' : (r>cap ? 'locked' : '');
      html += `<td class="${cls}">${arr[Math.min(r,arr.length)-1]}</td>`;
    }
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  return `<div class="detail-table-wrap">${html}</div>`;
}
function buildSpellDetailHTML(name, sp, idx, dlvl, rank){
  const cap = spellCap(name, idx, dlvl);
  let html = '';
  html += `<div class="sd-badges">`;
  if(sp.type) html += `<div class="sd-type">${TYPE_LABEL[sp.type] || sp.type}</div>`;
  (sp.attrTags||[]).forEach(tag=>{
    const isPrimary = tag === '+'+CLASS.primaryAttribute;
    html += `<div class="sd-attr${isPrimary?' sd-attr-primary':''}">Atributo ${tag}</div>`;
  });
  html += `</div>`;
  if((sp.funciones||[]).length) html += `<div class="sd-funcs">${sp.funciones.map(f=>`<span class="sd-func">${f}</span>`).join('')}</div>`;
  if(sp.commonRank) html += `<div class="sd-community">La comunidad suele dejarla en rango ${sp.commonRank}/5</div>`;
  const fixed = [];
  if(sp.cast != null && !Array.isArray(sp.cast)) fixed.push(`<span>Lanz. <b>${sp.cast}s</b></span>`);
  if(sp.cooldown != null && !Array.isArray(sp.cooldown)) fixed.push(`<span>Reutil. <b>${sp.cooldown}s</b></span>`);
  if(sp.range) fixed.push(`<span>Alcance <b>${sp.range}m</b></span>`);
  if(sp.area) fixed.push(`<span>Área <b>${sp.area}m</b></span>`);
  if(fixed.length) html += `<div class="sd-fixed">${fixed.join('')}</div>`;
  const table = buildDetailTable(sp, rank, cap);
  if(table) html += table;
  else html += `<div class="sd-fixed">Efecto pasivo sin valores numéricos publicados por el juego.</div>`;
  return html;
}
function toggleSpellDetail(rowEl){
  rowEl.classList.toggle('expanded');
}
function expandAllInPane(btn){
  const frame = btn.closest('.tabframe');
  const pane = frame.querySelector('.tab-pane.active');
  if(pane) pane.querySelectorAll('.spell-row').forEach(r=> r.classList.add('expanded'));
}
function collapseAllInPane(btn){
  const frame = btn.closest('.tabframe');
  const pane = frame.querySelector('.tab-pane.active');
  if(pane) pane.querySelectorAll('.spell-row').forEach(r=> r.classList.remove('expanded'));
}

let tabUid = 0;
function renderTabbedDiscs(build){
  tabUid++;
  const uid = tabUid;
  let rail = `<div class="tab-rail">`;
  let panes = `<div class="tab-panes">
    <div class="pane-toolbar">
      <button class="mini-btn" onclick="expandAllInPane(this)">Desplegar todo</button>
      <button class="mini-btn" onclick="collapseAllInPane(this)">Ocultar todo</button>
    </div>`;
  DISC_NAMES.forEach((name, i)=>{
    const d = CLASS.disciplines[name];
    const lvl = build.dlvl[name];
    const pct = Math.round(lvl/MAXDLEVEL*100);
    const isLocked = build.locked.has(name);
    rail += `<button class="rail-btn${i===0?' active':''}${isLocked?' locked':''}" onclick="selectDiscTab(this, ${uid}, ${i})">
      <div class="ricon" style="${iconStyle(d.icon,0,30)}"></div>
      <div class="rinfo">
        <div class="rname">${d.es}${isLocked?' <span style=\"color:var(--ink-faint)\">· no usada</span>':''}</div>
        <div class="rlvl">Disciplina ${lvl}/${MAXDLEVEL}</div>
        <div class="rbar"><i style="width:${pct}%"></i></div>
      </div>
    </button>`;
    panes += `<div class="tab-pane${i===0?' active':''}" data-uid="${uid}" data-idx="${i}">`;
    d.spells.forEach((sp, idx)=>{
      const rank = build.ranks[name+'|'+idx] || 0;
      const cap = spellCap(name, idx, lvl);
      let pips = '';
      for(let p=1;p<=MAXPLEVEL;p++){
        if(p<=rank) pips += '<div class="pip filled"></div>';
        else if(p<=cap) pips += '<div class="pip"></div>';
        else pips += '<div class="pip locked"></div>';
      }
      panes += `<div class="spell-row" onclick="toggleSpellDetail(this)">
        <div class="sicon${rank===0?' dim':''}" style="${iconStyle(d.icon, idx+1, 38)}"></div>
        <div class="rank-pips">${pips}</div>
        <div class="spell-info">
          <div class="spell-name">${sp.name} <span class="rk">Nv.${rank}/${MAXPLEVEL}</span> <span class="tag ${sp.cat}">${tagLabel(sp.cat)}</span>${flagChips(sp)}</div>
          <div class="spell-desc">${sp.desc}</div>
        </div>
        <button class="spell-expand" onclick="event.stopPropagation();toggleSpellDetail(this.closest('.spell-row'))">▸</button>
        <div class="spell-detail">${buildSpellDetailHTML(name, sp, idx, lvl, rank)}</div>
      </div>`;
    });
    panes += `</div>`;
  });
  rail += `</div>`;
  panes += `</div>`;
  return `<div class="tabframe">${rail}${panes}</div>`;
}
function flagChips(sp){
  let out = '';
  if(sp.aoe) out += `<span class="flagchip">Área</span>`;
  if(sp.group) out += `<span class="flagchip">Grupo</span>`;
  if(sp.rvr) out += `<span class="flagchip">RvR</span>`;
  return out ? `<div class="flagchips">${out}</div>` : '';
}
function selectDiscTab(btn, uid, idx){
  const frame = btn.closest('.tabframe');
  frame.querySelectorAll('.rail-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  frame.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
  frame.querySelector(`.tab-pane[data-uid="${uid}"][data-idx="${idx}"]`).classList.add('active');
}
function renderFullBuild(build){
  let html = `<div class="summary-grid">
    <div class="stat-card"><div class="label">Nivel</div><div class="value">${build.level}</div></div>
    <div class="stat-card"><div class="label">Puntos disciplina</div><div class="value">${build.dpBudget-build.dpLeft}<span style="color:var(--ink-faint);font-size:13px"> / ${build.dpBudget}</span></div></div>
    <div class="stat-card"><div class="label">Puntos poder</div><div class="value">${build.ppBudget-build.ppLeft}<span style="color:var(--ink-faint);font-size:13px"> / ${build.ppBudget}</span></div></div>
  </div>`;
  html += renderTabbedDiscs(build);
  return html;
}

function renderDiff(items){
  if(items.length === 0) return `<p class="empty-note">Sin cambios relevantes en este tramo — ya tienes lo esencial cubierto.</p>`;
  const discItems = items.filter(i=>i.kind==='disc');
  const spellItems = items.filter(i=>i.kind==='spell');
  let html = `<div class="diff-list">`;
  discItems.forEach(it=>{
    const d = CLASS.disciplines[it.name];
    html += `<div class="diff-item disc-up">
      <div class="picon" style="${iconStyle(d.icon,0,34)}"></div>
      <div class="txt"><div class="h">Sube <b>${d.es}</b> de disciplina ${it.before} → ${it.after}</div><div class="s">Desbloquea más rango en sus poderes.</div></div>
    </div>`;
  });
  spellItems.forEach(it=>{
    const d = CLASS.disciplines[it.name];
    html += `<div class="diff-item${it.isNew?' new':''}">
      <div class="picon" style="${iconStyle(d.icon, it.idx+1, 34)}"></div>
      <div class="txt">
        <div class="h">${it.isNew?'Agrega':'Sube'} <b>${it.sp.name}</b> ${it.isNew?`(nuevo, rango ${it.after})`:`rango ${it.before} → ${it.after}`} <span style="color:var(--ink-faint);font-size:12px;font-style:normal">· ${d.es}</span></div>
        <div class="s">${it.sp.desc}</div>
      </div>
      <span class="tag ${it.sp.cat}">${tagLabel(it.sp.cat)}</span>
    </div>`;
  });
  html += `</div>`;
  return html;
}

function renderCompactDiff(items){
  if(items.length===0) return '';
  return items.map(it=>{
    if(it.kind==='disc') return `<b>${CLASS.disciplines[it.name].es}</b> disciplina ${it.before}→${it.after}`;
    const rankTxt = it.isNew ? `nuevo, rango ${it.after}` : `rango ${it.before}→${it.after}`;
    return `<b>${it.sp.name}</b> <span style="color:var(--ink-faint)">(${CLASS.disciplines[it.name].es})</span> ${rankTxt}`;
  }).join(' · ');
}

function renderLevelByLevel(startLevel, endLevel, sequence){
  let html = '';
  let prevBuild = sequence[startLevel];
  for(let lvl = startLevel+1; lvl <= endLevel; lvl++){
    const build = sequence[lvl];
    const items = diffBuilds(prevBuild, build);
    const changes = items.length > 0
      ? renderCompactDiff(items)
      : `<span class="lvl-nochange">Sin cambios — seguí como estabas.</span>`;
    html += `<div class="lvl-row"><span class="lvl-badge">Nv.${lvl}</span><div class="lvl-changes">${changes}</div></div>`;
    prevBuild = build;
  }
  return html || `<p class="empty-note">No hay ranuras nuevas de disciplina o poder en este tramo — ya tenías todo lo disponible reservado.</p>`;
}

// Builds the shared export-card HTML from any {dlvl, ranks} build-like object
function buildExportCardFromBuild(buildLike, level, titleSub){
  const dpBudget = totalDP(level);
  const ppBudget = totalPP(level);
  let dpSpent = 0, ppSpent = 0;
  DISC_NAMES.forEach(n=>{ dpSpent += costForDlvl(buildLike.dlvl[n]||0); });
  DISC_NAMES.forEach(n=> CLASS.disciplines[n].spells.forEach((sp,idx)=>{ ppSpent += buildLike.ranks[n+'|'+idx]||0; }));
  let html = `<div class="export-card">
    <div class="export-header">
      <div class="export-title">${CLASS.label}</div>
      <div class="export-sub">${titleSub}</div>
    </div>
    <div class="summary-grid">
      <div class="stat-card"><div class="label">Nivel</div><div class="value">${level}</div></div>
      <div class="stat-card"><div class="label">Disciplina</div><div class="value">${dpSpent}<span style="color:var(--ink-faint);font-size:13px"> / ${dpBudget}</span></div></div>
      <div class="stat-card"><div class="label">Poder</div><div class="value">${ppSpent}<span style="color:var(--ink-faint);font-size:13px"> / ${ppBudget}</span></div></div>
    </div>
    <div class="export-disciplines">`;
  const invested = DISC_NAMES.filter(n=> (buildLike.dlvl[n]||0) > 0);
  if(invested.length === 0){
    html += `<p class="empty-note">Todavía no hay puntos de disciplina asignados.</p>`;
  }
  invested.forEach(name=>{
    const d = CLASS.disciplines[name];
    const lvl = buildLike.dlvl[name];
    const spentSpells = d.spells.map((sp,idx)=>({sp, idx, rank: buildLike.ranks[name+'|'+idx]||0})).filter(e=>e.rank>0);
    html += `<div class="export-disc">
      <div class="export-disc-head">
        <div class="export-disc-icon" style="${iconStyle(d.icon,0,30)}"></div>
        <div class="export-disc-name">${d.es}</div>
        <div class="export-disc-lvl">Disciplina ${lvl}/${MAXDLEVEL}</div>
      </div>
      <div class="export-spells">`;
    if(spentSpells.length === 0){
      html += `<div class="export-empty">Sin puntos de poder asignados todavía</div>`;
    }
    spentSpells.forEach(({sp, idx, rank})=>{
      html += `<div class="export-spell">
        <div class="export-spell-icon" style="${iconStyle(d.icon, idx+1, 24)}"></div>
        <div class="export-spell-name">${sp.name}</div>
        <div class="export-spell-rank">Nv.${rank}/5</div>
      </div>`;
    });
    html += `</div></div>`;
  });
  html += `</div></div>`;
  return html;
}