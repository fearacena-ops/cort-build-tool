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

function tagLabel(role){ return VOCAB.rolGrande[role] || role; }
function roleTags(sp){
  return (sp.cat||[]).map(r=> `<span class="tag ${r}">${tagLabel(r)}</span>`).join('');
}

const TYPE_LABEL = {Passive:"Pasivo", Constant:"Constante", Direct:"Directo", Activable:"Activable", Aura:"Aura"};
const GCD_LABEL = {"Very Short":"Muy corto", "Short":"Corto", "Normal":"Normal", "Long":"Largo", "Very Long":"Muy largo"};
function buildDetailTable(sp, rank, cap){
  const rows = [];
  if(sp.mana != null) rows.push({label:'Maná', value:sp.mana, kind:'neutral'});
  if(sp.duration != null) rows.push({label:'Duración (s)', value:sp.duration, kind:'neutral'});
  (sp.damage||[]).forEach(e=> rows.push({label:e.label, value:e.value, kind:'damage'}));
  (sp.debuffs||[]).forEach(e=> rows.push({label:e.label, value:e.value, kind:'debuff'}));
  (sp.buffs||[]).forEach(e=> rows.push({label:e.label, value:e.value, kind:'buff'}));
  const tabular = rows.filter(r=> r.value !== null && r.value !== undefined);
  if(tabular.length===0) return '';
  let html = `<table class="detail-table"><thead><tr><th style="width:34%"></th>`;
  for(let r=1;r<=MAXPLEVEL;r++){
    const cls = r===rank ? 'cur' : (r>cap ? 'locked' : '');
    html += `<th class="${cls}">${r}</th>`;
  }
  html += `</tr></thead><tbody>`;
  tabular.forEach(row=>{
    const arr = Array.isArray(row.value) ? row.value : [row.value,row.value,row.value,row.value,row.value];
    html += `<tr class="row-${row.kind}"><th class="rowlabel">${row.label}</th>`;
    for(let r=1;r<=MAXPLEVEL;r++){
      const cls = r===rank ? 'cur' : (r>cap ? 'locked' : '');
      const val = arr[Math.min(r,arr.length)-1];
      html += `<td class="${cls}">${val === true ? 'Sí' : val}</td>`;
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
  const notes = [];
  if(sp.weaponInterval) notes.push('Afectado por intervalo de arma');
  if(sp.blockable100) notes.push('Sólo bloqueable al 100%');
  if(sp.resistible100) notes.push('Sólo resistible al 100%');
  if(notes.length) html += `<div class="sd-notes">${notes.map(n=>`<div>${n}</div>`).join('')}</div>`;
  if(sp.commonRank) html += `<div class="sd-community">La comunidad suele dejarla en rango ${sp.commonRank}/5</div>`;
  const fixed = [];
  if(sp.cast != null && !Array.isArray(sp.cast)) fixed.push(`<span>Lanz. <b>${sp.cast}s</b></span>`);
  if(sp.gcd) fixed.push(`<span>GCD <b>${GCD_LABEL[sp.gcd] || sp.gcd}</b></span>`);
  if(sp.cooldown != null && !Array.isArray(sp.cooldown)) fixed.push(`<span>Reutil. <b>${sp.cooldown}s</b></span>`);
  if(sp.range) fixed.push(`<span>Alcance <b>${sp.range}m</b></span>`);
  if(sp.area) fixed.push(`<span>Área <b>${sp.area}m</b></span>`);
  if(fixed.length) html += `<div class="sd-fixed">${fixed.join('')}</div>`;
  const table = buildDetailTable(sp, rank, cap);
  if(table) html += table;
  else html += `<div class="sd-fixed">Efecto pasivo sin valores numéricos publicados por el juego.</div>`;
  return html;
}
function flagChips(sp){
  const cont = sp.contenidoPrincipal || [];
  if(!cont.length) return '';
  const out = cont.map(c=> `<span class="flagchip" title="${c}">${VOCAB.contenidoAbreviaturas[c] || c}</span>`).join('');
  return `<div class="flagchips">${out}</div>`;
}

// Builds the shared export-card HTML from any {dlvl, ranks} build-like object
function buildExportCardFromBuild(buildLike, level, titleSub, customName, archetypeLabel){
  const dpBudget = totalDP(level);
  const ppBudget = totalPP(level);
  let dpSpent = 0, ppSpent = 0;
  DISC_NAMES.forEach(n=>{ dpSpent += costForDlvl(buildLike.dlvl[n]||0); });
  DISC_NAMES.forEach(n=>{
    if(n === WM_NAME) return; // Maestría en Guerra nunca consume puntos de poder
    CLASS.disciplines[n].spells.forEach((sp,idx)=>{ ppSpent += buildLike.ranks[n+'|'+idx]||0; });
  });
  const title = customName ? customName : (archetypeLabel ? `${CLASS.label} – ${archetypeLabel}` : CLASS.label);
  const sub = customName ? CLASS.label : '';
  const realmKey = document.documentElement.getAttribute('data-realm') || 'syrtis';
  let html = `<div class="export-card">
    <div class="export-header">
      <img class="export-class-icon" src="${ICONS_BASE_PATH}/class-${currentClass}.webp" alt="${CLASS.label}">
      <div class="export-header-text">
        <div class="export-title">${title}</div>
        ${sub ? `<div class="export-sub">${sub}</div>` : ''}
      </div>
      <img class="export-realm-shield" src="${ICONS_BASE_PATH}/shield-${realmKey}.webp" alt="">
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
    if(spentSpells.length === 0){
      html += `<div class="export-disc is-empty">
        <div class="export-disc-head">
          <div class="export-disc-icon" style="${iconStyle(d.icon,0,30)}"></div>
          <div class="export-disc-name">${d.es}</div>
          <div class="export-disc-lvl">Disciplina ${lvl}/${MAXDLEVEL}</div>
        </div>
        <div class="export-empty">Sin puntos de poder asignados</div>
      </div>`;
      return;
    }
    html += `<div class="export-disc">
      <div class="export-disc-head">
        <div class="export-disc-icon" style="${iconStyle(d.icon,0,30)}"></div>
        <div class="export-disc-name">${d.es}</div>
        <div class="export-disc-lvl">Disciplina ${lvl}/${MAXDLEVEL}</div>
      </div>
      <div class="export-spells">`;
    spentSpells.forEach(({sp, idx, rank})=>{
      const isPassive = sp.type === 'Passive';
      const isWM = name === WM_NAME;
      let manaTag = '';
      if(!isPassive && sp.mana != null){
        const manaArr = Array.isArray(sp.mana) ? sp.mana : [sp.mana];
        const manaVal = manaArr[Math.min(rank, manaArr.length) - 1];
        manaTag = `<div class="export-spell-mana">${manaVal} maná</div>`;
      }
      const rankText = isWM ? (isPassive ? 'Pasiva' : '') : (isPassive ? `Pasiva · Nv.${rank}/5` : `Nv.${rank}/5`);
      html += `<div class="export-spell${isPassive ? ' is-passive' : ''}">
        <div class="export-spell-icon" style="${iconStyle(d.icon, sp.spriteIdx, 24)}"></div>
        <div class="export-spell-name">${sp.name}</div>
        ${rankText ? `<div class="export-spell-rank">${rankText}</div>` : ''}
        ${manaTag}
      </div>`;
    });
    html += `</div></div>`;
  });
  html += `</div></div>`;
  return html;
}