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
let currentClass = 'hunter';
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
function spellCap(name, idx, dlvl){
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
// Whether a spell fits a selectable role — mostly a direct check against
// its own cat, plus a couple of broader "assists the main tank/healer" nets
// for Off-Tank/Off-Healer that also catch support/control spells whose
// primary tag is something else, as long as their actual effect (mitigation,
// cleanse, crowd control) protects or backs up teammates.
function roleMatches(sp, role){
  if(!role) return false;
  const cat = sp.cat || [];
  const funcs = sp.funciones || [];
  switch(role){
    case 'dps': return cat.includes('dps');
    case 'tank': return cat.includes('tank');
    case 'healer': return cat.includes('healer_self') || cat.includes('healer_ally') || cat.includes('healer_pet');
    case 'support': return cat.includes('support');
    case 'cc': return cat.includes('cc');
    case 'offtank': return cat.includes('cc') ||
      (cat.includes('support') && funcs.some(f=> ['Mitigación / absorción','Anti-control','Amenaza / agro'].includes(f)));
    case 'offhealer': return cat.includes('healer_ally') ||
      (cat.includes('support') && funcs.includes('Disipación / limpieza'));
    default: return false;
  }
}
function spellScore(name, sp, ctx){
  let s = ctx.base(sp);
  if(sp.aoe) s += ctx.aoeBonus||0;
  if(sp.group) s += ctx.groupBonus||0;
  if(sp.rvr) s += ctx.rvrBonus||0;
  const sig = CLASS.signatureSoloSpell;
  if(ctx.petBoost && sig && name === sig.discipline && sp.name === sig.spellName) s += ctx.petBoost;
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
  const wmUnlocked = level >= MAXCHARLEVEL;
  const locked = lockedByWeapon(ctx.weaponChoice);
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
  // One deliberate exception: the class's signature solo spell (e.g. Dominio
  // natural for Hunter) targets its real cap here instead of commonRank —
  // it's the one skill worth maxing ahead of "typical" community depth, not
  // an excuse to max out everything else in its discipline at the expense
  // of the rest (that's what broke Cólera bestial's usual modest investment
  // the last time this got tuned too bluntly).
  if(useNaturalDepth){
    const sig = ctx.petBoost && CLASS.signatureSoloSpell;
    for(const entry of spellPool){
      if(ppLeft<=0) break;
      const isSignature = sig && entry.disc===sig.discipline && entry.sp.name===sig.spellName;
      const target = isSignature ? entry.cap : Math.min(entry.cap, entry.sp.commonRank || entry.cap);
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
  const spellOrder = spellPool.map(e=> e.disc+'|'+e.idx);
  return {level, dpBudget, ppBudget, dpLeft, ppLeft, dlvl, ranks, spellOrder, discPurchaseOrder, powerPurchaseOrder, discScore, wmUnlocked, locked, ctx};
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
function ctxLeveling(mode, weaponChoice){
  const solo = mode==='solo';
  const wantedContent = solo ? ['Leveo PvE'] : ['Leveo grupo PvE', 'Leveo PvE'];
  const w = WEIGHTS.leveo;
  return {
    base: sp=> sp.lvl + contenidoBonus(sp, wantedContent),
    aoeBonus: mode==='group' ? w.aoeEnGrupo : 0,
    groupBonus: mode==='group' ? w.utilidadGrupal : 0,
    rvrBonus: 0,
    petBoost: (solo && CLASS.signatureSoloSpell) ? CLASS.signatureSoloSpell.boost : 0,
    soloSustainBonus: solo ? w.sostenSolo : 0,
    soloPersonalBonus: solo ? w.personalSolo : 0,
    soloDefenseBonus: solo ? w.defensaSolo : 0,
    // Auras keep granting passive assist-XP just by fighting near an ally,
    // even solo — but they shine more once there's an actual group around
    // to stand in them, which is exactly the setup War Zone quests (from
    // level 40 on) reward. Worth a real push in group, a smaller one solo.
    auraBonus: w.aura,
    weaponChoice
  };
}
function ctxCustom(opts){
  const baseMap = {
    group_pve: sp=>sp.lvl, solo_pve: sp=>sp.lvl,
    group_pvp: sp=>sp.pvp, solo_pvp: sp=>sp.pvp, rvr: sp=>sp.pvp
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
  };
}
function getCheckpoints(current, goal){
  if(current >= goal) return [goal];
  let checkpoints = [];
  let next = Math.ceil((current+1)/10)*10;
  while(next < goal){ checkpoints.push(next); next += 10; }
  checkpoints.push(goal);
  return checkpoints;
}

function diffBuilds(prevBuild, nextBuild){
  const items = [];
  DISC_NAMES.forEach(name=>{
    const before = prevBuild ? prevBuild.dlvl[name] : 0;
    const after = nextBuild.dlvl[name];
    if(after > before) items.push({kind:'disc', name, before, after});
  });
  DISC_NAMES.forEach(name=>{
    const d = CLASS.disciplines[name];
    d.spells.forEach((sp, idx)=>{
      const key = name+'|'+idx;
      const before = prevBuild ? (prevBuild.ranks[key]||0) : 0;
      const after = nextBuild.ranks[key] || 0;
      if(after > before) items.push({kind:'spell', name, sp, idx, before, after, isNew: before===0});
    });
  });
  return items;
}

function replayDiscOrder(discPurchaseOrder, level, dpBudget, lockedForReplay){
  const dlvl = {}; DISC_NAMES.forEach(n=> dlvl[n]=0);
  let dpLeft = dpBudget;
  for(const name of discPurchaseOrder){
    if(lockedForReplay.has(name)) continue; // e.g. Warmaster tree, only usable at level 60
    const next = dlvl[name] + 1;
    if(charLevelReq(next) > level) continue; // not unlocked yet at this character level
    const cost = costForDlvl(next) - costForDlvl(dlvl[name]);
    if(cost > dpLeft) continue; // can't afford yet, but keep checking later (cheaper) entries
    dlvl[name] = next;
    dpLeft -= cost;
  }
  return {dlvl, dpLeft};
}
function replayPowerOrder(powerPurchaseOrder, ppBudget, dlvl){
  const ranks = {};
  let ppLeft = ppBudget;
  for(const {key, amount} of powerPurchaseOrder){
    if(ppLeft<=0) break;
    const [name, idxStr] = key.split('|');
    const idx = parseInt(idxStr);
    const cap = spellCap(name, idx, dlvl[name]);
    const cur = ranks[key] || 0;
    const fill = Math.min(amount, cap - cur, ppLeft);
    if(fill > 0){ ranks[key] = cur + fill; ppLeft -= fill; }
  }
  return {ranks, ppLeft};
}
// Safety net: the replay above is monotonic in spirit (fixed shopping list,
// growing budget) but character-level *eligibility* gating can occasionally
// let a lower checkpoint buy something a higher one skipped past while
// waiting on a prerequisite level, which can — rarely — dip below the
// previous checkpoint. This clamps anything that slipped, paying for the
// fix by trimming the lowest-priority items that still have room to give.
function clampSequenceStep(build, prev, finalBuild){
  if(!prev) return build;

  const dlvl = {...build.dlvl};
  let dpDeficitLevels = []; // disciplines pushed up, in case we need to trim elsewhere
  DISC_NAMES.forEach(name=>{
    if((prev.dlvl[name]||0) > dlvl[name]){ dlvl[name] = prev.dlvl[name]; dpDeficitLevels.push(name); }
  });
  // If forcing that floor overspends this level's discipline-point budget,
  // trim from whichever discipline currently has the least priority and
  // still has room to give (never below ITS OWN previous floor).
  let dpSpent = 0; DISC_NAMES.forEach(n=> dpSpent += costForDlvl(dlvl[n]));
  if(dpSpent > build.dpBudget){
    const trimOrder = [...DISC_NAMES].sort((a,b)=> (build.discScore[a]||0)-(build.discScore[b]||0));
    for(const name of trimOrder){
      if(dpSpent <= build.dpBudget) break;
      const floor = prev.dlvl[name] || 0;
      while(dlvl[name] > floor && dpSpent > build.dpBudget){
        dpSpent -= costForDlvl(dlvl[name]) - costForDlvl(dlvl[name]-1);
        dlvl[name]--;
      }
    }
  }

  const ranks = {...build.ranks};
  DISC_NAMES.forEach(name=>{
    CLASS.disciplines[name].spells.forEach((sp, idx)=>{
      const key = name+'|'+idx;
      const cap = spellCap(name, idx, dlvl[name]);
      if((ranks[key]||0) > cap) ranks[key] = cap; // dlvl can only have grown, so this is rare
    });
  });
  let deficit = 0;
  Object.keys(prev.ranks).forEach(key=>{
    const before = prev.ranks[key] || 0;
    const cur = ranks[key] || 0;
    if(before > cur){ deficit += before - cur; ranks[key] = before; }
  });
  if(deficit > 0 && finalBuild.spellOrder){
    for(let i = finalBuild.spellOrder.length - 1; i >= 0 && deficit > 0; i--){
      const key = finalBuild.spellOrder[i];
      const floor = prev.ranks[key] || 0;
      const cur = ranks[key] || 0;
      const give = Math.max(0, Math.min(cur - floor, deficit));
      if(give > 0){ ranks[key] = cur - give; deficit -= give; }
    }
  }
  dpSpent = 0; DISC_NAMES.forEach(n=> dpSpent += costForDlvl(dlvl[n]));
  let ppSpent = 0; Object.values(ranks).forEach(r=> ppSpent += r);
  return {...build, dlvl, ranks, dpLeft: Math.max(0, build.dpBudget-dpSpent), ppLeft: Math.max(0, build.ppBudget-ppSpent)};
}
// The replay above can leave a discipline sitting at dlvl>0 with zero power
// points spent — not because the algorithm forgot it, but because its "give
// this tree at least 1 point" turn was scheduled late in the FINAL build's
// priority order, and this intermediate level's budget hasn't reached that
// point in the sequence yet, even though the discipline itself already
// leveled up via its own separate purchase order. Fix it locally: any
// invested discipline with zero ranks gets 1 point in its best available
// spell, paid for by trimming the lowest-priority spell elsewhere that has
// more than the bare minimum to spare.
function ensureCoverageStep(build, finalBuild){
  const ranks = {...build.ranks};
  const needsCoverage = DISC_NAMES.filter(name=>{
    if((build.dlvl[name]||0) <= 0) return false;
    return !CLASS.disciplines[name].spells.some((sp,idx)=> (ranks[name+'|'+idx]||0) > 0);
  });
  if(needsCoverage.length === 0) return build;

  const additions = [];
  needsCoverage.forEach(name=>{
    let bestKey = null, bestScore = -1;
    CLASS.disciplines[name].spells.forEach((sp,idx)=>{
      const cap = spellCap(name, idx, build.dlvl[name]);
      if(cap<=0) return;
      const sc = spellScore(name, sp, build.ctx);
      if(sc > bestScore){ bestScore = sc; bestKey = name+'|'+idx; }
    });
    if(bestKey){ ranks[bestKey] = (ranks[bestKey]||0) + 1; additions.push(bestKey); }
  });
  if(additions.length === 0) return build;

  // Pay for it: trim from the lowest-priority spells that currently hold
  // more than 1 point, so we never empty out some OTHER discipline's own
  // coverage while fixing this one.
  let toTrim = additions.length;
  for(let i = finalBuild.spellOrder.length - 1; i >= 0 && toTrim > 0; i--){
    const key = finalBuild.spellOrder[i];
    if(additions.includes(key)) continue;
    const cur = ranks[key] || 0;
    if(cur > 1){ ranks[key] = cur - 1; toTrim--; }
  }
  // Last resort: if every spell holding points is down to exactly 1 (rare,
  // very budget-starved levels), trim single-point ones too — but never one
  // that's the sole coverage for its own discipline.
  if(toTrim > 0){
    for(let i = finalBuild.spellOrder.length - 1; i >= 0 && toTrim > 0; i--){
      const key = finalBuild.spellOrder[i];
      if(additions.includes(key)) continue;
      const cur = ranks[key] || 0;
      if(cur !== 1) continue;
      const [dname] = key.split('|');
      const siblingsHavePoints = CLASS.disciplines[dname].spells.some((sp,idx)=>{
        const k = dname+'|'+idx;
        return k !== key && (ranks[k]||0) > 0;
      });
      if(siblingsHavePoints){ ranks[key] = 0; toTrim--; }
    }
  }

  let ppSpent = 0;
  Object.values(ranks).forEach(r=> ppSpent += r);
  return {...build, ranks, ppLeft: Math.max(0, build.ppBudget - ppSpent)};
}
function buildLevelSequence(current, goal, ctxFn){
  // Compute the destination build exactly once, the same way Build a medida
  // does — then every level in between is just "how far into that same
  // shopping list can this level's budget reach", so the whole progression
  // ends up matching the level-60-quality result by construction.
  const finalBuild = computeBuild(goal, ctxFn);
  const weaponLocked = new Set(finalBuild.locked);
  weaponLocked.delete(WM_NAME); // handled explicitly below, independent of the goal level
  const seq = {};
  let prev = null;
  for(let lvl = current; lvl <= goal; lvl++){
    const dpBudget = totalDP(lvl);
    const ppBudget = totalPP(lvl);
    const lockedNow = new Set(weaponLocked);
    // Progreso de leveo never touches Warmaster, even once level 60 is
    // reached — it's a deliberately separate track from "how do I get to
    // 60", not something to fold into the leveling path. Build a medida and
    // los arquetipos still consider it normally; this only affects this
    // sequence.
    lockedNow.add(WM_NAME);
    const {dlvl, dpLeft} = replayDiscOrder(finalBuild.discPurchaseOrder, lvl, dpBudget, lockedNow);
    const {ranks, ppLeft} = replayPowerOrder(finalBuild.powerPurchaseOrder, ppBudget, dlvl);
    let build = {
      level: lvl, dpBudget, ppBudget, dpLeft, ppLeft, dlvl, ranks,
      discScore: finalBuild.discScore, wmUnlocked: false,
      locked: lockedNow, ctx: ctxFn
    };
    build = ensureCoverageStep(build, finalBuild);
    build = clampSequenceStep(build, prev, finalBuild);
    seq[lvl] = build;
    prev = build;
  }
  return seq;
}