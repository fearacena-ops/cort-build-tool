/* =========================================================================
   engine.js — motor de cálculo puro (sin DOM)
   Recomendador de build — Champions of Regnum

   Este archivo no toca el documento en ningún momento: solo recibe datos
   y devuelve datos. Todo lo que arma HTML o escucha eventos vive en
   render.js / main.js. Las variables ROOT/REQUIRED/CLASS/DISC_NAMES/WM_NAME
   se declaran acá (una sola vez) y las llenan data-loader.js / main.js —
   como son scripts clásicos (sin type="module"), todos comparten el mismo
   scope de nivel superior.
   ========================================================================= */

let ROOT = null;
let REQUIRED = null;
const VALID_CLASS_KEYS = ['hunter','marksman','conjurer','warlock','barbarian','knight'];
let currentClass = 'warlock';
if(typeof localStorage !== 'undefined'){
  const saved = localStorage.getItem('cort-last-class');
  if(saved && VALID_CLASS_KEYS.includes(saved)) currentClass = saved;
}
let CLASS = null;
let DISC_NAMES = [];
let WM_NAME = null;

const MAXPLEVEL = 5;
const MAXDLEVEL = 19;
const MAXCHARLEVEL = 60;

function costForDlvl(dlvl){ return dlvl<=0 ? 0 : REQUIRED.points[dlvl-1]; }
function charLevelReq(dlvl){ return REQUIRED.level[dlvl-1]; }
function maxRankForDlvl(dlvl){ return dlvl<=0 ? 0 : REQUIRED.power[dlvl-1]; }
function totalDP(level){ return CLASS.totalDP[level-1]; }
function totalPP(level){ return CLASS.totalPP[level-1]; }
function skillsUnlocked(dlvl){ return dlvl<=0 ? 0 : REQUIRED.available[dlvl-1]; }
// Maestría en Guerra funciona muy distinto al resto de las disciplinas: cada
// una de sus 5 habilidades se desbloquea COMPLETA (rango 5) de una sola vez,
// al llegar a un nivel de disciplina específico — nunca gradualmente, y
// nunca consumiendo puntos de poder. Los umbrales son siempre los mismos,
// cada 4 niveles: 3, 7, 11, 15, 19 para la 1ª a la 5ª habilidad.
const WM_RANK5_THRESHOLDS = [3,7,11,15,19];
function wmEffectiveRank(dlvl, idx){
  return (dlvl >= (WM_RANK5_THRESHOLDS[idx]||99)) ? MAXPLEVEL : 0;
}
function spellCap(name, idx, dlvl){
  if(name === WM_NAME) return wmEffectiveRank(dlvl, idx);
  if(idx >= skillsUnlocked(dlvl)) return 0; // this skill slot isn't unlocked yet at this discipline level
  let cap = maxRankForDlvl(dlvl);
  if(idx===0 && dlvl===1) cap += 1;
  return Math.min(cap, MAXPLEVEL);
}

/* =================== weapon-group helpers (generic) =================== */
function lockedByWeapon(weaponChoice){
  const locked = new Set();
  (CLASS.weaponGroups||[]).forEach(group=>{
    const raw = weaponChoice && weaponChoice[group.label];
    const chosenKeys = Array.isArray(raw) ? raw : [raw || group.options[0].key];
    group.options.forEach(opt=>{
      if(!chosenKeys.includes(opt.key)) locked.add(opt.discipline);
    });
  });
  return locked;
}

/* =================== SCORING ENGINE (Tabs A & B) =================== */
// Whether a spell fits a selectable role — interpreta las reglas de
// VOCAB.reglasRolSeleccionable (ver vocabulario.js). Agregar o ajustar un
// rol es cuestión de editar esas reglas, no esta función.
function roleMatches(sp, role){
  if(!role) return false;
  const rules = VOCAB.reglasRolSeleccionable[role];
  if(!rules) return false;
  const cat = sp.cat || [];
  const funcs = sp.funciones || [];
  return rules.some(rule=>{
    if(!rule.cat.some(c=> cat.includes(c))) return false;
    if(rule.funciones) return funcs.some(f=> rule.funciones.includes(f));
    return true;
  });
}
function spellScore(name, sp, ctx){
  let s = ctx.base(sp);
  if(sp.aoe) s += ctx.aoeBonus||0;
  if(sp.group) s += ctx.groupBonus||0;
  if(sp.rvr) s += ctx.rvrBonus||0;
  if(ctx.soloSustainBonus && sp.soloSustain) s += ctx.soloSustainBonus;
  if(ctx.soloPersonalBonus && sp.soloPersonal) s += ctx.soloPersonalBonus;
  if(ctx.soloDefenseBonus && sp.cat && sp.cat.includes('tank')) s += ctx.soloDefenseBonus;
  if(ctx.auraBonus && sp.type === 'Aura') s += ctx.auraBonus;
  // A modest, context-independent bump for spells that buff the class's own
  // primary attribute (Destreza for Archer, Fuerza for Barbarian, etc.) —
  // that stat compounds into everything the character does, so it's worth
  // a little extra regardless of playstyle.
  if(CLASS.primaryAttribute && sp.attrTags && sp.attrTags.includes('+'+CLASS.primaryAttribute)){
    s += WEIGHTS.atributoPrincipal;
  }
  // A skill that costs you something to use it (self-debuff trade-off, like
  // "Instancia ofensiva" trading protection for damage) is objectively less
  // free than an equivalent skill without that cost — a flat, always-on
  // penalty, since the trade-off exists regardless of context.
  if(sp.selfDebuff) s += WEIGHTS.costoPropio;

  // The chosen role scales the spell's intrinsic quality computed so far —
  // clearly fitting spells become much more attractive, everything else
  // takes a soft discount rather than being written off. Applied surgically:
  // this happens BEFORE the priority-discipline bonus below, so choosing a
  // discipline to focus on stays an independent, unamplified nudge instead
  // of being multiplied along with the role match.
  if(ctx.role){
    s *= roleMatches(sp, ctx.role) ? (ctx.roleMultiplier||WEIGHTS.rolElegido.multiplicadorCoincide) : (ctx.rolePenalty||WEIGHTS.rolElegido.multiplicadorNoCoincide);
  }
  if(ctx.priorityDiscipline && name === ctx.priorityDiscipline) s += ctx.priorityBonus||WEIGHTS.disciplinaPrioritaria;
  return Math.max(0, s);
}
function discScoreOf(name, ctx){
  return CLASS.disciplines[name].spells.reduce((sum,sp)=> sum + spellScore(name, sp, ctx), 0);
}
function computeBuild(level, ctx, prevBuild, useNaturalDepth){
  if(useNaturalDepth === undefined) useNaturalDepth = true;
  const dpBudget = totalDP(level);
  const ppBudget = totalPP(level);
  const wmUnlocked = level >= MAXCHARLEVEL && !ctx.excludeWM;
  // The non-chosen weapon's discipline normally stays fully locked — you
  // picked a weapon, that tree gets nothing. Build a medida can opt out of
  // that (softWeaponLock) so a secondary weapon competes like any other
  // discipline instead of leaving its share of the budget going somewhere
  // that doesn't even fit the chosen content (like Pets in a pure-PvP build).
  const locked = ctx.softWeaponLock ? new Set() : lockedByWeapon(ctx.weaponChoice);
  if(!wmUnlocked) locked.add(WM_NAME);

  const discScore = {};
  DISC_NAMES.forEach(n=> discScore[n] = discScoreOf(n, ctx));
  const dlvl = {};
  DISC_NAMES.forEach(n=> dlvl[n] = prevBuild ? (prevBuild.dlvl[n]||0) : 0);
  let dpSpent = 0;
  DISC_NAMES.forEach(n=> dpSpent += costForDlvl(dlvl[n]));
  let dpLeft = dpBudget - dpSpent;
  function runGreedy(lockedSet){
    while(true){
      let best=null, bestRatio=-1;
      for(const name of DISC_NAMES){
        if(lockedSet.has(name)) continue;
        const cur = dlvl[name];
        if(cur >= MAXDLEVEL) continue;
        const next = cur+1;
        if(charLevelReq(next) > level) continue;
        const delta = costForDlvl(next) - costForDlvl(cur);
        if(delta > dpLeft) continue;
        const ratio = delta<=0 ? 999 : discScore[name]/delta;
        if(ratio > bestRatio){ bestRatio = ratio; best = {name, delta}; }
      }
      if(!best) break;
      dlvl[best.name]++;
      dpLeft -= best.delta;
      discPurchaseOrder.push(best.name);
    }
  }
  const discPurchaseOrder = [];
  // Concentrate investment: only disciplines genuinely competitive with the
  // current best option fight for points first. Weak trees only get whatever
  // is left over once the strong ones can't usefully absorb more (maxed out,
  // or nothing left worth their marginal cost) — instead of spreading thin
  // across everything just because early levels in any tree are cheap.
  const openScores = DISC_NAMES.filter(n=>!locked.has(n)).map(n=>discScore[n]);
  const maxScore = openScores.length ? Math.max(...openScores) : 0;
  const PRUNE_RATIO = WEIGHTS.seleccionDisciplinas.ratioPoda;
  const MIN_INDIVIDUAL_SCORE = WEIGHTS.seleccionDisciplinas.puntajeMinimoIndividual;
  const pruned = new Set(locked);
  DISC_NAMES.forEach(n=>{
    if(locked.has(n)) return;
    if(ctx.priorityDiscipline === n) return; // never prune an explicitly prioritized discipline
    const hasHighValueSpell = CLASS.disciplines[n].spells.some(sp=> spellScore(n, sp, ctx) >= MIN_INDIVIDUAL_SCORE);
    if(hasHighValueSpell) return;
    if(discScore[n] < maxScore*PRUNE_RATIO) pruned.add(n);
  });
  runGreedy(pruned);
  const dlvlAfterConcentrated = {...dlvl};
  if(dpLeft > 0) runGreedy(locked);

  const spellPool = [];
  DISC_NAMES.forEach(name=>{
    if(name === WM_NAME) return; // WM nunca compite por puntos de poder — se resuelve aparte, por dlvl
    CLASS.disciplines[name].spells.forEach((sp, idx)=>{
      const cap = spellCap(name, idx, dlvl[name]);
      const startRank = 0;
      spellPool.push({disc:name, idx, sp, cap, rank:startRank, score: spellScore(name, sp, ctx)});
    });
  });
  spellPool.sort((a,b)=> b.score - a.score);
  let ppSpent = 0;
  spellPool.forEach(e=> ppSpent += e.rank);
  let ppLeft = ppBudget - ppSpent;

  // Coverage pass: a discipline that earned its own investment in the main,
  // concentrated round (i.e. it was genuinely competitive, not just a
  // leftover mop-up pick) gets at least 1 point into its best available
  // spell before we max out other trees — otherwise you can end up having
  // "unlocked" a worthwhile tree for nothing. Mop-up-only disciplines don't
  // get this guarantee: their spells only get points if they win the normal
  // score competition below, so genuinely low-value trees stay untouched
  // instead of getting a token point scattered in just because some spare
  // discipline points spilled into them.
  const powerPurchaseOrder = [];
  const coverageOrder = DISC_NAMES.filter(n=> dlvlAfterConcentrated[n]>0 && !locked.has(n))
    .sort((a,b)=> discScore[b]-discScore[a]);
  coverageOrder.forEach(discName=>{
    if(ppLeft<=0) return;
    const candidates = spellPool.filter(e=> e.disc===discName && e.cap>0 && e.rank===0);
    if(candidates.length===0) return;
    candidates.sort((a,b)=> b.score-a.score);
    candidates[0].rank = 1;
    ppLeft -= 1;
    powerPurchaseOrder.push({key: candidates[0].disc+'|'+candidates[0].idx, amount: 1});
  });

  // Natural-depth pass: real players rarely dump every point into the single
  // top-scoring spell before touching the next one — most skills have a
  // "typical" investment depth the community converges on (commonRank, from
  // real level-60 setups). Bring each spell up to that depth first, in score
  // order, before pushing anything further toward its hard cap.
  if(useNaturalDepth){
    for(const entry of spellPool){
      if(ppLeft<=0) break;
      const target = Math.min(entry.cap, entry.sp.commonRank || entry.cap);
      if(entry.rank >= target) continue;
      const fill = Math.min(target - entry.rank, ppLeft);
      entry.rank += fill;
      ppLeft -= fill;
      powerPurchaseOrder.push({key: entry.disc+'|'+entry.idx, amount: fill});
    }
  }

  // Surplus pass: any leftover points (more budget than the "typical" build
  // needs) go toward maxing out the best spells further, up to their real cap.
  for(const entry of spellPool){
    if(ppLeft<=0) break;
    if(entry.rank >= entry.cap) continue;
    const fill = Math.min(entry.cap - entry.rank, ppLeft);
    entry.rank += fill;
    ppLeft -= fill;
    powerPurchaseOrder.push({key: entry.disc+'|'+entry.idx, amount: fill});
  }
  const ranks = {};
  spellPool.forEach(e=>{ ranks[e.disc+'|'+e.idx] = e.rank; });
  if(WM_NAME){
    CLASS.disciplines[WM_NAME].spells.forEach((sp, idx)=>{
      ranks[WM_NAME+'|'+idx] = wmEffectiveRank(dlvl[WM_NAME], idx);
    });
  }
  const spellOrder = spellPool.map(e=> e.disc+'|'+e.idx);
  let result = {level, dpBudget, ppBudget, dpLeft, ppLeft, dlvl, ranks, spellOrder, discPurchaseOrder, powerPurchaseOrder, discScore, wmUnlocked, locked, ctx};
  result = ensureFoundationalStep(result, result);
  result = ensureSynergyStep(result, result);
  return result;
}

// Modest bonus layered on top of the hand-calibrated sp.lvl/sp.pvp heuristic
// when a spell is explicitly tagged (via the community catalog) as fitting
// the exact situation being scored for. Kept small on purpose: sp.lvl/sp.pvp
// already reflect real usage-stat calibration, this just nudges ties and
// covers gaps that a 0-3 scale is too coarse to capture on its own.
function contenidoBonus(sp, wantedTags){
  if(!wantedTags || !wantedTags.length) return 0;
  if((sp.contenidoPrincipal||[]).some(t=> wantedTags.includes(t))) return WEIGHTS.contenido.principal;
  if((sp.contenidoSecundario||[]).some(t=> wantedTags.includes(t))) return WEIGHTS.contenido.secundario;
  return 0;
}
function ctxCustom(opts){
  const baseMap = {
    group_pve: sp=>sp.lvl*WEIGHTS.pesoPopularidad, solo_pve: sp=>sp.lvl*WEIGHTS.pesoPopularidad,
    group_pvp: sp=>sp.pvp*WEIGHTS.pesoPopularidad, solo_pvp: sp=>sp.pvp*WEIGHTS.pesoPopularidad, rvr: sp=>sp.pvp*WEIGHTS.pesoPopularidad
  };
  const contentMap = {
    group_pve: ['Grupo PvE'], solo_pve: ['PvE'],
    group_pvp: ['Grupo PvP'], solo_pvp: ['PvP'], rvr: ['RvR'],
  };
  const bm = WEIGHTS.buildAMedida;
  const bonusMap = {
    group_pve: {aoeBonus:bm.grupo_pve.area, groupBonus:bm.grupo_pve.grupo, rvrBonus:bm.grupo_pve.rvr},
    solo_pve: {aoeBonus:bm.solo_pve.area, groupBonus:bm.solo_pve.grupo, rvrBonus:bm.solo_pve.rvr},
    group_pvp: {aoeBonus:bm.grupo_pvp.area, groupBonus:bm.grupo_pvp.grupo, rvrBonus:bm.grupo_pvp.rvr},
    solo_pvp: {aoeBonus:bm.solo_pvp.area, groupBonus:bm.solo_pvp.grupo, rvrBonus:bm.solo_pvp.rvr},
    rvr: {aoeBonus:bm.rvr.area, groupBonus:bm.rvr.grupo, rvrBonus:bm.rvr.rvr},
  };
  const wantedContent = contentMap[opts.context];
  return {
    base: sp=> baseMap[opts.context](sp) + contenidoBonus(sp, wantedContent),
    ...bonusMap[opts.context],
    role: opts.role || null,
    roleMultiplier: WEIGHTS.rolElegido.multiplicadorCoincide,
    rolePenalty: WEIGHTS.rolElegido.multiplicadorNoCoincide,
    priorityDiscipline: opts.priorityDiscipline || null,
    priorityBonus: WEIGHTS.disciplinaPrioritaria,
    weaponChoice: opts.weaponChoice,
    excludeWM: !!opts.excludeWM,
    softWeaponLock: true,
  };
}
// How many points can safely be trimmed from `key` without leaving its
// discipline with zero invested spells — used by the foundational/synergy
// passes below, which can need to trim more than 1 point at once.
function trimmableAmount(key, ranks, wanted){
  const cur = ranks[key] || 0;
  if(cur <= 0) return 0;
  const [dname] = key.split('|');
  const isSoleCoverage = !CLASS.disciplines[dname].spells.some((sp,idx)=>{
    const k = dname+'|'+idx;
    return k !== key && (ranks[k]||0) > 0;
  });
  const floor = isSoleCoverage ? 1 : 0;
  return Math.max(0, Math.min(wanted, cur - floor));
}
// Grupos de sinergia: dos o más habilidades que "van juntas" según el
// criterio del jugador, marcadas con el mismo sp.synergyGroup en los datos
// (columna "Sinergia" en el catálogo). Si el motor ya invirtió puntos reales
// en CUALQUIERA del grupo, las demás del mismo grupo se empujan a SU PROPIO
// nivel típico de comunidad — no al mismo rango de la que las activó, y sin
// encadenar: si eso hace que una habilidad de OTRO grupo distinto reciba
// puntos por primera vez, ese segundo grupo no se vuelve a evaluar en esta
// misma pasada.
function ensureSynergyStep(build, finalBuild){
  const ranks = {...build.ranks};
  const grupos = {};
  DISC_NAMES.forEach(name=>{
    CLASS.disciplines[name].spells.forEach((sp,idx)=>{
      if(sp.synergyGroup){
        (grupos[sp.synergyGroup] = grupos[sp.synergyGroup] || []).push({disc:name, idx, sp});
      }
    });
  });

  const additions = [];
  Object.values(grupos).forEach(miembros=>{
    const activado = miembros.some(m=> (ranks[m.disc+'|'+m.idx]||0) > 0);
    if(!activado) return;
    miembros.forEach(m=>{
      const key = m.disc+'|'+m.idx;
      const cap = spellCap(m.disc, m.idx, build.dlvl[m.disc]);
      if(cap<=0) return;
      const target = Math.min(cap, m.sp.commonRank || cap);
      const cur = ranks[key] || 0;
      if(cur >= target) return;
      ranks[key] = target;
      additions.push({key, added: target-cur});
    });
  });
  if(additions.length === 0) return build;

  let toTrim = additions.reduce((sum,a)=> sum+a.added, 0);
  const addedKeys = additions.map(a=>a.key);
  for(let i = finalBuild.spellOrder.length - 1; i >= 0 && toTrim > 0; i--){
    const key = finalBuild.spellOrder[i];
    if(addedKeys.includes(key)) continue;
    const take = trimmableAmount(key, ranks, toTrim);
    if(take <= 0) continue;
    ranks[key] = (ranks[key]||0) - take;
    toTrim -= take;
  }
  let ppSpent = 0;
  Object.values(ranks).forEach(r=> ppSpent += r);
  return {...build, ranks, ppLeft: Math.max(0, build.ppBudget - ppSpent)};
}
// Some disciplines have one spell that everything else in the tree depends
// on to matter at all — taming a pet before pet-care spells have anyone to
// help, for example. If real points are going into that discipline's other
// spells, its foundational spell (marked per-discipline in the data, not
// hardcoded per class) gets bumped to its usual community depth too, paid
// for by trimming the lowest-priority spells elsewhere. Skipped entirely
// for disciplines with no foundationalSpell set — most have none.
function ensureFoundationalStep(build, finalBuild){
  const ranks = {...build.ranks};
  const additions = [];
  DISC_NAMES.forEach(name=>{
    const disc = CLASS.disciplines[name];
    const foundational = disc.foundationalSpell;
    if(!foundational) return;
    const idx = disc.spells.findIndex(sp=> sp.name === foundational);
    if(idx < 0) return;
    const key = name+'|'+idx;
    const hasOtherInvestment = disc.spells.some((sp,i)=> i!==idx && (ranks[name+'|'+i]||0) > 0);
    if(!hasOtherInvestment) return;
    const cap = spellCap(name, idx, build.dlvl[name]);
    if(cap<=0) return;
    const sp = disc.spells[idx];
    const target = Math.min(cap, sp.commonRank || cap);
    const cur = ranks[key] || 0;
    if(cur >= target) return;
    ranks[key] = target;
    additions.push({key, added: target - cur});
  });
  if(additions.length === 0) return build;

  let toTrim = additions.reduce((sum,a)=> sum+a.added, 0);
  const addedKeys = additions.map(a=>a.key);
  for(let i = finalBuild.spellOrder.length - 1; i >= 0 && toTrim > 0; i--){
    const key = finalBuild.spellOrder[i];
    if(addedKeys.includes(key)) continue;
    const take = trimmableAmount(key, ranks, toTrim);
    if(take <= 0) continue;
    ranks[key] = (ranks[key]||0) - take;
    toTrim -= take;
  }
  let ppSpent = 0;
  Object.values(ranks).forEach(r=> ppSpent += r);
  return {...build, ranks, ppLeft: Math.max(0, build.ppBudget - ppSpent)};
}
