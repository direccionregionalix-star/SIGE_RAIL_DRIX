// app.js - Director de Orquesta (Controlador Principal) — v4.3 Dratini
import { state } from './store.js';
import { h, ej, sid, nd, getSimilarity } from './utils.js';
import { normDir, preClassifyCluster, suggestMerges } from './normalizer.js';
import * as mapMod from './map.js';
import * as io from './io.js';
import { saveSession, loadSession, clearSession } from './db.js';
import * as ui from './ui.js';
import * as core from './core.js';
import * as reporter from './reporter.js';
import * as sigec from './sigec-client.js';
import { comunaSeed, REGION_CONFIG } from './region-config.js';

/* CONSTANTES Y UI */
const SFIELDS = ['calle','numero','resto','localidad','comuna','referencia','latitud','longitud'];
const SLABELS = {calle:'Calle',numero:'Número',resto:'Resto/Depto',localidad:'Localidad',comuna:'Comuna',referencia:'Referencia',latitud:'Lat base',longitud:'Lon base'};
const SCOLS = ['geo_cluster','geo_tipo','geo_lat','geo_lon','geo_metodo','geo_confianza'];
const LC = { cod:['cod_comuna','cut_comuna','cut','codigo_comuna','cod','codigo','code'], com:['nombre_comuna','nom_comuna','comuna','community','nombre_com'], nom:['nombre_localidad','nom_localidad','localidad','nombre','name','nom'], lat:['latitud','lat','latitude','y'], lon:['longitud','lon','longitude','lng','x'] };
const LC_LABELS = {cod:'Código comuna (CUT)',com:'Nombre comuna',nom:'Nombre localidad',lat:'Latitud',lon:'Longitud'};

// VARIABLES GLOBALES ACTUALIZADAS PARA MULTI-FUSIÓN
export let fufilt='all', fusq='', curC='', mmFrom='', mmKey='', lmKey=''; 
export let mmSelected = []; 

window.stab = ui.stab;
window.openAPIs = ui.openAPIs;
window.closeAPIs = ui.closeAPIs;
window.closeMM = ui.closeMM;
window.closeLM = () => {
  const lmEl = document.getElementById('lm');
  if (lmEl) lmEl.classList.remove('draggable');
  const title = document.getElementById('lm-title');
  if (title) title.textContent = 'Localidades';
  const details = document.querySelector('#lm details');
  if (details) details.style.display = '';
  ui.closeLM();
};
window.resizeMap = mapMod.resizeMap; 

window.autoSave = async function() {
  try {
    await saveSession(state);
    const ind = document.getElementById('save-ind');
    if (ind) {
      ind.classList.add('vis');
      setTimeout(() => ind.classList.remove('vis'), 2500);
    }
  } catch(e) { console.warn("Autoguardado falló", e); }
};

// 🛡️ BOTÓN DE PÁNICO (Ctrl+S / Ctrl+G): guardado manual con confirmación
// EXPLÍCITA. A diferencia de autoSave (parpadeo sutil), este avisa al usuario
// que su trabajo quedó a salvo — la regla de jmedina: nunca perder trabajo en
// silencio. Reutiliza la misma persistencia en IndexedDB.
window.manualSave = async function() {
  const btnState = document.getElementById('save-ind');
  try {
    await saveSession(state);
    if (btnState) {
      btnState.classList.add('vis');
      setTimeout(() => btnState.classList.remove('vis'), 2500);
    }
    // Confirmación clara y no intrusiva (se desvanece sola si existe el toast)
    const toast = document.getElementById('save-toast');
    if (toast) {
      toast.textContent = '💾 Progreso guardado';
      toast.classList.add('on');
      setTimeout(() => toast.classList.remove('on'), 2000);
    } else {
      console.info('💾 Progreso guardado manualmente');
    }
  } catch (e) {
    // Un guardado de emergencia que falla DEBE ser ruidoso, nunca silencioso
    console.error('Guardado manual falló:', e);
    alert('⚠️ No se pudo guardar el progreso. Exporta un respaldo (.json o Excel) antes de cerrar, para no perder tu trabajo.');
  }
};

/* INICIALIZACIÓN */
// Aplica la configuración regional a la UI (título + etiquetado del geocoder).
// Es idempotente y NO desactiva SIGEC: solo lo condiciona por región. Cuando la
// región no usa SIGEC como motor primario, lo marca "opcional" (sigue disponible
// como consulta cruzada de predios SII).
function applyRegionConfigUI() {
  const rc = REGION_CONFIG;
  if (!rc) return;

  if (rc.instance) {
    document.title = rc.instance;
  } else if (rc.regionName) {
    document.title = `SIGE (${rc.regionCode || ''}) ${rc.regionName} — Sistema de Información Geográfica Electoral`;
  }

  const primary = rc.geocoder ? rc.geocoder.primary : null;
  if (primary !== 'sigec') {
    const st = document.getElementById('sigec-status');
    if (st) { st.textContent = 'opcional'; st.className = 'api-status api-empty'; }
    const head = document.getElementById('sigec-headline');
    if (head) {
      const fb = (rc.geocoder && rc.geocoder.fallback) || 'nominatim';
      head.textContent = `🌍 ${rc.regionName || 'Región'} — geocoder primario: ${fb} · SIGEC opcional`;
    }
  }
}

async function initApp() {
  applyRegionConfigUI();
  setupDrop('dz-main', 'fi-main', loadMain);
  setupDrop('dz-loc', 'fi-loc', loadLoc);
  setupDrop('dz-geojson', 'fi-geojson', loadGeoJSON);
  setupDrop('dz-recintos', 'file-recintos', loadRecintos);

  const repCfg = reporter.getConfig();
  const repUserEl  = document.getElementById('reporter-user');
  const repTokenEl = document.getElementById('reporter-token');
  if (repUserEl)  repUserEl.value  = repCfg.user;
  if (repTokenEl) repTokenEl.value = repCfg.token;
  const repStatusEl = document.getElementById('reporter-status');
  if (repStatusEl && reporter.isConfigured()) { repStatusEl.className = 'api-status api-ok'; repStatusEl.textContent = 'configurado'; }
  reporter.init();

  const sgCfg = sigec.getConfig();
  const sgUrlEl = document.getElementById('sigec-url');
  const sgKeyEl = document.getElementById('sigec-key');
  if (sgUrlEl && localStorage.getItem('sige_sigec_url')) sgUrlEl.value = sgCfg.url;
  if (sgKeyEl && localStorage.getItem('sige_sigec_key')) sgKeyEl.value = sgCfg.key;

  if (window.updateSupermenteStats) window.updateSupermenteStats();

  try {
    const savedState = await loadSession();
    if (savedState && savedState.rawData && savedState.rawData.length > 0) {
      document.getElementById('resume-modal').classList.add('on');
      window._tempSavedSession = savedState; 
    }
  } catch (e) { console.warn("No DB", e); }
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initApp); } else { initApp(); }

window.restoreSession = function() {
  if (!window._tempSavedSession) return;
  Object.assign(state, window._tempSavedSession);
  document.getElementById('resume-modal').classList.remove('on');
  Object.values(state.clusters).forEach(c => { if (!c.flagged || !(c.flagged instanceof Set)) c.flagged = new Set(); });
  window.enterFU(); 
};

window.discardSession = async function() {
  await clearSession(); window._tempSavedSession = null; document.getElementById('resume-modal').classList.remove('on');
};

window.clearSession = async function() {
  if (confirm('⚠️ ¿Estás seguro de que deseas borrar todo y empezar una nueva sesión? Perderás cualquier progreso que no hayas exportado.')) {
    await clearSession(); 
    window.location.reload(); 
  }
};

function setupDrop(dzId, fiId, handler){
  const dz = document.getElementById(dzId), fi = document.getElementById(fiId);
  if(!dz || !fi) return;
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); handler(e.dataTransfer.files[0]); });
  fi.addEventListener('change', e => handler(e.target.files[0]));
}

function loadMain(f){
  if(!f) return; state.origFileName = f.name.replace(/\.[^.]+$/,'');
  readXLSX(f, data => { state.rawData = data; document.getElementById('fn-main').textContent = f.name; document.getElementById('btn-continue').disabled = false; });
}

function loadLoc(f){
  if(!f) return; state.locFileName = f.name.replace(/\.[^.]+$/,'');
  readXLSX(f, data => { state.origLocData = data; state.rawLocRows = data; state.locMapped = false; autoDetectLocCols(data); document.getElementById('fn-loc').textContent = f.name + ' — mapeo pendiente ⚙'; openLocMapModal(); });
}

function loadGeoJSON(f) {
  if (!f) return; const reader = new FileReader();
  reader.onload = e => { try { state.referenceGeoJSON = JSON.parse(e.target.result); document.getElementById('fn-geojson').textContent = f.name + ' ✓'; document.getElementById('dz-geojson').style.borderColor = '#16a34a'; } catch (err) { alert('GeoJSON inválido.'); } };
  reader.readAsText(f);
}

function loadRecintos(f) {
  if (!f) return; const reader = new FileReader();
  reader.onload = e => { try { state.recintosPointsData = JSON.parse(e.target.result); document.getElementById('fn-recintos').textContent = f.name + ' ✓'; document.getElementById('dz-recintos').style.borderColor = '#16a34a'; } catch (err) { alert('GeoJSON inválido.'); } };
  reader.readAsText(f);
}

function readXLSX(f, cb){
  const r = new FileReader();
  r.onload = e => { const wb = window.XLSX.read(e.target.result, {type:'array'}); cb(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''})); };
  r.readAsArrayBuffer(f);
}

/* MAPEO Y NORMALIZACIÓN */
function autoDetectLocCols(data){
  if(!data.length)return;
  const cols = Object.keys(data[0]).map(c=>nd(c.toLowerCase()).replace(/\s+/g,'_'));
  const detect = (aliases) => {
    for(const a of aliases){ const i = cols.findIndex(c => c === a); if(i >= 0) return Object.keys(data[0])[i]; }
    for(const a of aliases){ const i = cols.findIndex(c => c.includes(a)); if(i >= 0) return Object.keys(data[0])[i]; }
    return null;
  };
  state.locColMap = { cod: detect(LC.cod), com: detect(LC.com), nom: detect(LC.nom), lat: detect(LC.lat), lon: detect(LC.lon) };
}

function openLocMapModal(){
  if(!state.rawLocRows.length)return;
  const origCols = Object.keys(state.rawLocRows[0]);
  document.getElementById('lc-map-body').innerHTML=`
    <p style="font-size:12px;color:var(--tx2);margin-bottom:8px">Columnas detectadas automáticamente.</p>
    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px 10px;align-items:center">
      ${Object.entries(LC_LABELS).map(([k,lbl])=>`
        <div class="flbl">${lbl}</div><div class="arr">←</div>
        <select id="lcm_${k}" style="padding:4px 7px;border:.5px solid var(--bd2);border-radius:var(--r);font-size:12px;background:var(--surface)">
          <option value="">— no mapear —</option>
          ${origCols.map(c=>`<option value="${h(c)}"${state.locColMap[k]===c?' selected':''}>${h(c)}</option>`).join('')}
        </select>`).join('')}
    </div>`;
  document.getElementById('lc-map-modal').classList.add('on');
}

window.applyLocMap = function(){
  ['cod','com','nom','lat','lon'].forEach(k=>{ state.locColMap[k]=document.getElementById('lcm_'+k)?.value||null; });
  state.localidades = state.rawLocRows.map(row => {
    const g = k => state.locColMap[k] ? String(row[state.locColMap[k]]||'') : '';
    const lat = parseFloat(g('lat')), lon = parseFloat(g('lon'));
    if(!lat || !lon) return null;
    return {nombre:g('nom').trim(), comuna:g('com').trim(), codComuna:g('cod').trim(), lat, lon, origen:'cargado'};
  }).filter(Boolean).filter(l=>l.nombre);
  state.locMapped = true; document.getElementById('lc-map-modal').classList.remove('on');
  document.getElementById('fn-loc').textContent = state.locFileName + '.xlsx ('+state.localidades.length+' locs)';
};

window.startProcess = function(){
  if(!state.rawData.length) return alert('Carga el archivo de direcciones primero.');
  const cols = Object.keys(state.rawData[0]);
  SFIELDS.forEach(f=>{ const k = f.replace(/[^a-z]/g,''); state.colMap[f] = cols.find(c=>nd(c.toLowerCase()).replace(/[^a-z]/g,'')===k) || ''; });
  const grid=document.getElementById('cmgrid'); grid.innerHTML='';
  SFIELDS.forEach(f=>{
    grid.innerHTML += `<div class="flbl">${SLABELS[f]}</div><div class="arr">←</div>
      <select id="m_${f}" style="padding:4px 7px;border:.5px solid var(--bd2);border-radius:var(--r);font-size:12px;background:var(--surface)">
        <option value="">— no mapear —</option>
        ${cols.map(c=>`<option value="${h(c)}"${state.colMap[f]===c?' selected':''}>${h(c)}</option>`).join('')}
      </select>`;
  });
  window.gs(2);
};

window.applyMap = function(){ SFIELDS.forEach(f=>{ state.colMap[f]=document.getElementById('m_'+f)?.value||''; }); normalizeData(); };

function normalizeData(){
  // Semilla region_config: traduce CUT→comuna aun sin GeoJSON cargado. Si además
  // se carga un GeoJSON de referencia, sus comunas enriquecen/actualizan el dict.
  const dictComunas = { ...comunaSeed() };
  if (state.referenceGeoJSON && state.referenceGeoJSON.features) {
      state.referenceGeoJSON.features.forEach(f => {
          const p = f.properties;
          if (p) {
              const kCut = Object.keys(p).find(k => ['iso_comuna','cod_comuna','cut'].some(a => k.toLowerCase().includes(a)));
              const kNom = Object.keys(p).find(k => ['glosa_comu','nom_comuna','comuna'].some(a => k.toLowerCase() === a || k.toLowerCase().includes(a)));
              
              if (kCut && kNom && p[kCut] && p[kNom]) {
                  const cutVal = String(p[kCut]).trim();
                  const nomVal = String(p[kNom]).trim().toUpperCase();
                  dictComunas[cutVal] = nomVal;
                  dictComunas[parseInt(cutVal, 10).toString()] = nomVal;
              }
          }
      });
  }

  const cutCol = state.rawData.length ? Object.keys(state.rawData[0]).find(c=>{ const n = nd(c.toLowerCase()).replace(/[^a-z_]/g,''); return ['cod_comuna','cut_comuna','cut','codigo_comuna'].some(a=>n===a||n.includes(a)); }) : null;

  state.records = state.rawData.map((row, i) => {
    const g = f => state.colMap[f] ? String(row[state.colMap[f]] ?? '') : '';
    const calle=g('calle'), numero=g('numero'), resto=g('resto');
    const { callNorm, numNorm, clave } = normDir(calle, numero); 
    
    let rawComuna = g('comuna').trim().toUpperCase();
    let comunaTraducida = rawComuna;
    
    if (dictComunas[rawComuna]) {
        comunaTraducida = dictComunas[rawComuna];
    } else {
        const rawNum = parseInt(rawComuna, 10).toString();
        if (dictComunas[rawNum]) comunaTraducida = dictComunas[rawNum];
    }

    return {
      id: i, original: [calle,numero,resto].filter(Boolean).join(' '),
      calle, numero, resto, localidad: g('localidad'), 
      comuna: comunaTraducida,
      ref: g('referencia'),
      codComuna: cutCol ? String(row[cutCol]||'').trim() : rawComuna,
      callNorm, numNorm, clave: String(row[SCOLS[0]]||clave).trim(),
      latBase: parseFloat(g('latitud'))||null, lonBase: parseFloat(g('longitud'))||null,
      tipo: String(row[SCOLS[1]]||'').trim()||null, latFinal: parseFloat(row[SCOLS[2]])||null, lonFinal: parseFloat(row[SCOLS[3]])||null,
      metodo: String(row[SCOLS[4]]||'')||null, confianza: String(row[SCOLS[5]]||'')||null
    };
  });

  state.clusters = {};
  state.records.forEach(r => {
    if(!state.clusters[r.clave]) state.clusters[r.clave] = { key:r.clave, rows:[], flagged:new Set(), tipo:null, latFinal:null, lonFinal:null, metodo:null, confianza:null, autoVal:false };
    const c = state.clusters[r.clave]; c.rows.push(r);
    if(r.tipo && !c.tipo) c.tipo = r.tipo;
    if(r.latFinal && !c.latFinal) { c.latFinal=r.latFinal; c.lonFinal=r.lonFinal; c.metodo=r.metodo; c.confianza=r.confianza; }
  });

  Object.values(state.clusters).forEach(c => {
      preClassifyCluster(c);
      
      if (!c.latFinal && !c.autoVal) {
          const comunaRef = core.resolveComunaName(c.rows[0]) || String(c.rows[0]?.comuna || '').trim().toUpperCase();
          const match = core.findInSupermente(c.key, comunaRef); 
          
          if (match) {
              c.smMatch = match;
              c.latPropuesta = match.data.latFinal;
              c.lonPropuesta = match.data.lonFinal;
              c.tipoPropuesto = match.data.tipo;
              c.needsReview = true;
              c.smMessage = `🧠 Asimilar con: ${match.matchedAlias.toUpperCase()} (${Math.round(match.score*100)}%)`;
          }
      }
  });

  const mergesGenerados = suggestMerges(state.clusters);

  renderStats(); window.fRec(); renderClPrev(); document.getElementById('sbb').innerHTML = `<div style="padding:11px;"><button class="btn btn-sm" style="width:100%" onclick="window.gs(4)">Exportar →</button></div>`; renderSuggestions(mergesGenerados); 
  
  window.autoSave(); 
}

function renderSuggestions(suggestions) {
  const cnt = document.getElementById('sug-cnt'), list = document.getElementById('sug-list');
  if (!suggestions || !suggestions.length) { cnt.textContent = '0 sugerencias'; list.innerHTML = '<div class="empty"><p>No se encontraron duplicados obvios.</p></div>'; return; }
  cnt.textContent = `${suggestions.length} sugerencias`;
  list.innerHTML = suggestions.map(s => `
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; border-left: 4px solid var(--wa);">
      <div><div style="font-family:'DM Mono', monospace; font-size:13px;"><span style="color:var(--da)">${h(s.source)}</span> vs <span style="color:var(--ok)">${h(s.target)}</span></div>
      <div style="font-size:11px; color:var(--tx3); margin-top:4px;">Similitud: <strong style="color:var(--wa)">${s.score}%</strong></div></div>
      <div><button class="btn btn-sm btn-p" onclick="window.applyLevenshteinMerge('${ej(s.source)}', '${ej(s.target)}')">Fusionar</button></div>
    </div>`).join('');
}

window.applyLevenshteinMerge = function(sourceKey, targetKey) { if (core.processMultiMerge([sourceKey, targetKey], targetKey)) { renderSuggestions(suggestMerges(state.clusters)); renderStats(); window.fRec(); window.autoSave(); }};

function renderStats(){ document.getElementById('stats').innerHTML=`<div class="stat"><div class="lbl">Registros</div><div class="val">${state.records.length}</div></div><div class="stat"><div class="lbl">Clusters</div><div class="val">${Object.keys(state.clusters).length}</div></div>`; }

window.fRec = function(){ const q = (document.getElementById('rec-q')?.value||'').toLowerCase(); const vis = q ? state.records.filter(r=>r.original.toLowerCase().includes(q)||r.clave.includes(q)) : state.records; document.getElementById('rec-cnt').textContent = vis.length + ' regs'; document.getElementById('rec-body').innerHTML = vis.slice(0,100).map(r=>`<tr><td title="${h(r.original)}">${h(r.original)}</td><td><span class="b b-mono">${h([r.callNorm,r.numNorm].filter(Boolean).join(' '))}</span></td><td><span class="b b-blue">${h(r.clave)}</span></td><td style="font-size:11px;color:var(--tx2)">${h(r.localidad)}</td><td style="font-size:11px;color:var(--tx2)">${h(r.comuna)}</td></tr>`).join(''); };

function renderClPrev(){ const s = Object.values(state.clusters).sort((a,b)=>b.rows.length-a.rows.length).slice(0,50); document.getElementById('clprev').innerHTML=`<div class="twrap"><div style="overflow:auto;max-height:calc(100vh - 340px)"><table><thead><tr><th>Clave</th><th>Reg.</th><th>IA</th></tr></thead><tbody>${s.map(c=>`<tr><td><span class="b b-mono">${h(c.key)||'—'}</span></td><td>${c.rows.length}</td><td style="font-size:11px;color:var(--tx3)">${c.tipoPropuesto || '—'}</td></tr>`).join('')}</tbody></table></div></div>`; }

/* FASE UNIFICADA */
window.enterFU = function(){
  core.autoMatchHistorical(); 
  core.autoMatchRural(); 
  ui.hideSB(); window.gs(3); renderFUList(); updateProg(); 
  
  mapMod.initMap('map', state.referenceGeoJSON, state.recintosPointsData, window.onCoordChange);
  ui.initSplitter(); 
  
  mapMod.updateStreetView(null, null, document.getElementById('key-gmaps')?.value.trim());
};

window.reenterFU = function(){ ui.hideSB(); window.gs(3); setTimeout(()=> window.dispatchEvent(new Event('resize')), 100); };

window.onCoordChange = function(lat, lon) {
  const cin = document.getElementById('cin');
  if (cin) cin.value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  
  const btnConf = document.getElementById('btn-conf');
  const btnClr = document.getElementById('btn-clr');
  if (btnConf) {
    btnConf.disabled = false;
    btnConf.classList.add('pulse-btn'); 
  }
  if (btnClr) btnClr.disabled = false;
  
  const hint = document.getElementById('mhint');
  if (hint) hint.textContent = 'Arrastra el marcador o confirma el punto';
  
  let distMsg = '';
  if (curC && state.clusters[curC] && window.turf) {
      const c = state.clusters[curC];
      let origLat = c.latFinal || (c.rows.length > 0 ? c.rows[0].latBase : null);
      let origLon = c.lonFinal || (c.rows.length > 0 ? c.rows[0].lonBase : null);
      
      if (origLat && origLon) {
          const dist = turf.distance([origLon, origLat], [lon, lat], {units: 'meters'});
          if (dist > 2) {
              const color = dist > 1000 ? '#ef4444' : (dist > 100 ? '#eab308' : '#a855f7');
              distMsg = `<span style="margin-left: 10px; font-size: 11px; color: ${color}; font-weight: bold; background: ${color}1a; padding: 2px 6px; border-radius: 4px;">📏 Desplazamiento: ${dist > 1000 ? (dist/1000).toFixed(2) + ' km' : Math.round(dist) + ' m'}</span>`;
          }
      }
  }

  const cstat = document.getElementById('cstat');
  if (cstat) cstat.innerHTML = `<span style="color:#16a34a;font-weight:bold;">✅ Coordenada lista para confirmar</span>${distMsg}`;

  if (window.triggerRecintoHighlight) window.triggerRecintoHighlight(lat, lon);

  const apiKey = document.getElementById('key-gmaps')?.value.trim();
  mapMod.updateStreetView(lat, lon, apiKey);
};

function renderFUList(){
  let l = Object.values(state.clusters);
  if(fufilt==='pend') l=l.filter(c=>!c.tipo||c.needsReview); 
  if(fufilt==='E') l=l.filter(c=>c.tipo==='EXACTO' && !c.needsReview); 
  if(fufilt==='C') l=l.filter(c=>c.tipo==='CALLE' && !c.needsReview); 
  if(fufilt==='L') l=l.filter(c=>(c.tipo==='LOCALIDAD'||c.tipo==='RURAL') && !c.needsReview); 
  if(fufilt==='N') l=l.filter(c=>c.tipo==='NO GEO');
  if(fusq) l=l.filter(c=>c.key.includes(fusq));
  
  l.sort((a,b)=>{ const ap=a.tipo?1:0, bp=b.tipo?1:0; return ap!==bp ? ap-bp : b.rows.length-a.rows.length; });

  document.getElementById('fuclist').innerHTML = l.map(c=>`
    <div class="citem t-${c.tipo?c.tipo[0]:'_'} ${c.key===curC?'on':''}" id="ci_${sid(c.key)}" onclick="window.openC('${ej(c.key)}')">
      <div class="ck">${h(c.key)||'(sin clave)'}</div>
      <div class="cm" style="flex-wrap: wrap;">
        <span>${c.rows.length} reg.</span>
        ${c.needsReview && !c.smMessage ? `<span class="gstat gs-run" style="font-size:9px">Por revisar</span>` : ''}
        ${c.tipo && !c.needsReview ? `<span class="b b-${c.tipo==='URBANO'?'urban':c.tipo==='RURAL'?'rural':'nogeo'}">${c.tipo}</span>`:''}
        ${c.latFinal && !c.needsReview ? '<span style="color:var(--ok)">✓</span>':''}
        ${c.smMessage ? `<div style="width:100%; font-size: 9px; color: #9333ea; font-weight: bold; margin-top: 4px; background: #faf5ff; padding: 2px 4px; border-radius: 4px; border: 1px solid #e9d5ff;">${c.smMessage}</div>` : ''}
      </div>
    </div>`).join('')||'<div style="padding:16px;text-align:center">Sin resultados</div>';
}

window.openC = function(key){ 
  curC = key; renderFUList(); renderPanel(key); 
  const c = state.clusters[key];
  if(c) {
    mapMod.loadClusterMap(c.latFinal, c.lonFinal, c.metodo, c.rows); 
    
    let lat = c.latFinal, lon = c.lonFinal;
    if (!lat && c.rows && c.rows.length > 0) { 
        const r = c.rows.find(x => x.latBase && x.lonBase); 
        if(r) { lat = r.latBase; lon = r.lonBase; } 
    }
    
    window.triggerRecintoHighlight(lat, lon);
    
    const apiKey = document.getElementById('key-gmaps')?.value.trim();
    if (lat && lon) {
        mapMod.updateStreetView(lat, lon, apiKey);
    } else {
        mapMod.updateStreetView(null, null, apiKey);
    }
    
    if (c.needsReview) ui.guideUserFlow('confirmar');
    else if (!c.tipo) ui.guideUserFlow('dominio'); 
    else ui.guideUserFlow('herramienta', c.tipo);
  }
};

function renderPanel(key){
  const c = state.clusters[key]; if(!c)return;
  const sug = c.tipoPropuesto && !c.smMessage ? `<span style="font-size:10px; color:var(--tx3); margin-left:8px;">✨ Sugerencia: ${c.tipoPropuesto}</span>` : '';
  const fc = c.flagged ? c.flagged.size : 0;
  const fusInfo = c.autoMerged ? `<span style="font-size:10px; background:#fef3c7; padding: 2px 8px; margin-left:8px;">⚠️ AUTO-FUSIÓN</span>` : '';
  
  const ref = c.rows[0];
  const comunaName = core.resolveComunaName(ref);
  
  let localidadName = String(ref.localidad || '').trim();
  if (/^(<null>|null|undefined|na|n\/a)$/i.test(localidadName)) localidadName = '';

  let restoName = String(ref.resto || '').trim();
  if (/^(<null>|null|undefined|na|n\/a)$/i.test(restoName)) restoName = '';

  let queryParts = [ref.callNorm]; 
  
  if (c.tipo !== 'CALLE' && ref.numNorm) {
      queryParts.push(ref.numNorm);
  }
  
  if (localidadName) queryParts.push(localidadName);
  if (restoName && restoName !== localidadName) queryParts.push(restoName);
  
  if (comunaName) queryParts.push(comunaName);
  queryParts.push('Chile');

  let queryVisual = queryParts.filter(Boolean).join(', ');

  document.getElementById('fumid').innerHTML=`
    <div class="fu-mh"><div style="display:flex; align-items:center; gap:10px;"><h2 style="margin:0;">${h(c.key)}</h2><button class="btn btn-sm" onclick="window.renameCluster('${ej(key)}')">✏️ Editar</button></div>
    <div class="sub" style="display:flex; align-items:center; gap:4px; margin-top:4px;">${c.rows.length} reg. ${sug} ${fusInfo}</div></div>
    
    <div class="tipo-row"><span class="lbl">Tipo:</span>
      <button class="btn btn-urban tipo-btn ${c.tipo==='EXACTO'?'sel':''}" onclick="window.setTipo('${ej(key)}','EXACTO')">EXACTO (E)</button>
      <button class="btn btn-urban tipo-btn ${c.tipo==='CALLE'?'sel':''}" onclick="window.setTipo('${ej(key)}','CALLE')">CALLE (C)</button>
      <button class="btn btn-rural tipo-btn ${c.tipo==='LOCALIDAD'?'sel':''}" onclick="window.setTipo('${ej(key)}','LOCALIDAD')">LOCALIDAD (L)</button>
      <button class="btn btn-nogeo tipo-btn ${c.tipo==='NO GEO'?'sel':''}" onclick="window.setTipo('${ej(key)}','NO GEO')">NO GEO (N)</button>
    </div>
    
    <div class="geo-row" style="flex-direction:column;align-items:stretch;gap:7px">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        ${(c.tipo==='EXACTO' || c.tipo==='CALLE') ? `<button class="btn btn-sm btn-p" onclick="window.geoNominatim('${ej(key)}')">📍 Nominatim</button>
          <button class="btn btn-sm" style="background:#0891b2;color:#fff" onclick="window.geoSIGEC('${ej(key)}')">🔍 SIGEC</button>
          ${document.getElementById('key-gmaps')?.value.trim() ? `<button class="btn btn-sm" onclick="window.geoGoogle('${ej(key)}')">📍 Google</button>` : ''}` : ''}
        ${c.tipo==='LOCALIDAD' ? `<button class="btn btn-sm btn-rural" onclick="window.openLM('${ej(key)}')">🏘️ Seleccionar localidad</button>
          <button class="btn btn-sm" style="background:#0891b2;color:#fff" onclick="window.geoSIGEC('${ej(key)}')">🔍 SIGEC</button>` : ''}
        <span class="gstat ${c.latFinal?'gs-ok':''}" id="gstat">${c.latFinal ? (c.needsReview ? '⌛ Propuesta pendiente' : '✓ Confirmado') : 'Sin coordenada'}</span>
      </div>
      
      ${(c.tipo==='EXACTO' || c.tipo==='CALLE') ? `<div style="display:flex;gap:5px;align-items:center">
        <label style="font-size:11px;">Query:</label>
        <input id="geo-query" style="flex:1;padding:3px;font-size:12px;" value="${h(queryVisual)}"></div>` : ''}
    </div>

    ${c.smMatch ? `<div style="background:rgba(168,85,247,0.1); border:1px solid #a855f7; padding:12px; border-radius:8px; margin-bottom:15px; text-align:center; box-shadow: 0 0 10px rgba(168,85,247,0.2);">
      <div style="font-size:13px; color:#6b21a8; font-weight:bold; margin-bottom:8px;">${c.smMessage}</div>
      <button class="btn btn-p" style="background:#a855f7; border-color:#a855f7; width:100%; font-size:14px;" onclick="window.acceptSM('${ej(key)}')">🧬 Aceptar Asimilación y Fusionar</button>
    </div>` : ''}
    
    ${c.needsReview && !c.smMatch ? `<div class="notice nw on" style="background:var(--abg); color:var(--at); border-color:var(--ac);"><strong>Propuesta automática lista.</strong> Por favor verifica el punto en el mapa y haz clic en Confirmar.</div>` : ''}

    <div class="cl-acts"><button class="btn btn-sm" onclick="window.openMM('${ej(key)}')">⇔ Fusionar</button><button class="btn btn-sm" onclick="window.clearFlags('${ej(key)}')" ${fc===0?'disabled':''}>Limpiar</button><button class="btn btn-sm btn-d" onclick="window.splitFlagged('${ej(key)}')" ${fc===0?'disabled':''}>Separar (${fc})</button></div>

    <div class="fu-tbody"><table><thead><tr><th style="width:26px"></th><th>Original</th><th>Núm.</th><th>Loc.</th><th>Comuna</th></tr></thead>
    <tbody>${c.rows.map(r=>`<tr class="${c.flagged && c.flagged.has(r.id) ? 'flagged' : ''}" id="r_${r.id}">
      <td style="text-align:center"><input type="checkbox" style="cursor:pointer" ${c.flagged && c.flagged.has(r.id) ? 'checked' : ''} onchange="window.toggleFlag('${ej(key)}',${r.id},this.checked)"></td>
      <td>${h(r.original)}</td><td>${h(r.numero)}</td><td>${h(r.localidad)}</td><td>${h(r.comuna)}</td></tr>`).join('')}</tbody></table></div>
    
    <div class="fu-foot"><button class="btn btn-sm btn-p" onclick="window.nextPend()">Siguiente (Q) →</button></div>`;
  updateProg();
}

window.acceptSM = function(key) {
    const c = state.clusters[key];
    if (!c || !c.smMatch) return;

    const matchData = c.smMatch.data;
    c.latFinal = matchData.latFinal;
    c.lonFinal = matchData.lonFinal;
    c.tipo = matchData.tipo;
    c.metodo = 'Supermente · ' + c.smMatch.matchedAlias;
    c.needsReview = false;

    c.rows.forEach(r => {
        r.latFinal = c.latFinal;
        r.lonFinal = c.lonFinal;
        r.tipo = c.tipo;
        r.metodo = c.metodo;
        r.needsReview = false;
    });

    const uuid = c.smMatch.id;
    let existingData = JSON.parse(localStorage.getItem(uuid));
    if (existingData && Array.isArray(existingData.aliases)) {
        if (!existingData.aliases.includes(key)) {
            existingData.aliases.push(key);
            existingData.fecha = new Date().toISOString();
            localStorage.setItem(uuid, JSON.stringify(existingData));
            window.updateSupermenteStats();
        }
    }

    c.smMatch = null;
    c.smMessage = null;

    mapMod.loadClusterMap(c.latFinal, c.lonFinal, c.metodo, c.rows);
    renderFUList();
    updateProg();
    renderPanel(key);
    window.autoSave();
    
    setTimeout(() => window.nextPend(), 350);
};

window.setTipo = function(key,tipo){
  state.clusters[key].tipo = tipo; 
  state.clusters[key].autoVal=false;
  state.clusters[key].needsReview=false; 
  state.clusters[key].rows.forEach(r=>{ r.tipo=tipo; r.needsReview=false; });
  renderPanel(key); renderFUList(); updateProg(); 
  ui.guideUserFlow('herramienta', tipo); 
  window.autoSave(); 
};

window.nextPend = function(){
  ui.clearPulses();
  const l = Object.values(state.clusters).filter(c=>(!c.tipo||c.needsReview)&&!c.autoVal).sort((a,b)=>b.rows.length-a.rows.length);
  if(!l.length) return alert('¡Todos revisados o clasificados!');
  
  setTimeout(() => window.openC(l[0].key), 50);
};

function updateProg(){
  const all = Object.values(state.clusters);
  const done = all.filter(c=>c.tipo && !c.needsReview).length; 
  document.getElementById('fupfill').style.width = (all.length ? Math.round(done/all.length*100) : 0)+'%';
  document.getElementById('fuptxt').textContent = done+'/'+all.length;
}

window.confirmCoord = function(){
  if(!curC) return; const coords = mapMod.getTentativeCoords(); if(!coords) return;
  const c = state.clusters[curC];
  c.latFinal = coords.lat; c.lonFinal = coords.lng; 
  c.metodo = c.metodo || 'manual';
  c.needsReview = false; 
  c.rows.forEach(r => { 
    r.latFinal=coords.lat; r.lonFinal=coords.lng; r.metodo=c.metodo; 
    r.needsReview = false;
  });
  renderPanel(curC); mapMod.loadClusterMap(c.latFinal, c.lonFinal, c.metodo, c.rows); renderFUList(); 
  core.saveToHistory(c); 
  document.getElementById('btn-conf')?.classList.remove('pulse-btn'); 
  ui.guideUserFlow('siguiente'); 
  window.autoSave(); 
};

window.clearCoord = function(){
  const c = state.clusters[curC]; 
  c.latFinal=null; c.lonFinal=null; c.metodo=null; c.needsReview=false;
  c.rows.forEach(r=>{r.latFinal=null;r.lonFinal=null;r.metodo=null;r.needsReview=false;});
  renderPanel(curC); mapMod.loadClusterMap(null, null, null, c.rows); renderFUList(); ui.clearPulses();
  document.getElementById('btn-conf')?.classList.remove('pulse-btn'); 
  window.autoSave(); 
};

window.goManual = function(){
  const parts = document.getElementById('cin').value.trim().replace(/[°'"]/g,'').split(/[\s,;]+/).filter(Boolean).map(Number).filter(n=>!isNaN(n));
  if(parts.length<2) return; let [lat, lon] = parts; if(Math.abs(lat)>80 && Math.abs(lon)<80) [lat, lon] = [lon, lat];
  mapMod.placeTentative(lat, lon, true);
};

window.onCI = function(){
  const raw = document.getElementById('cin').value.trim().replace(/[°'"]/g,'');
  const parts = raw.split(/[\s,;]+/).filter(Boolean).map(Number).filter(n=>!isNaN(n));
  const irBtn = document.querySelector('.coord-row .btn');
  if(irBtn) irBtn.disabled = parts.length < 2;
};

/* GESTIÓN DE CLUSTERS Y MULTI-FUSIÓN */
window.toggleFlag = function(key, id, checked){
  const c = state.clusters[key]; if(!c) return;
  if(!c.flagged) c.flagged = new Set();
  checked ? c.flagged.add(id) : c.flagged.delete(id);
  document.getElementById('r_'+id)?.setAttribute('class', checked ? 'flagged' : '');
  const fc = c.flagged.size;
  const n = document.getElementById('funotice'); if(n){ n.className = 'notice nw' + (fc>0 ? ' on' : ''); n.innerHTML = `<strong>${fc} marcadas</strong>`; }
  document.querySelectorAll('.cl-acts .btn').forEach(b => { if(b.textContent.startsWith('Limpiar')) b.disabled = (fc === 0); if(b.textContent.startsWith('Separar')) { b.disabled = (fc === 0); b.textContent = `Separar (${fc})`; } });
};

window.clearFlags = function(key){ if(state.clusters[key]?.flagged) state.clusters[key].flagged.clear(); renderPanel(key); renderFUList(); };

window.splitFlagged = function(key){
  const newKey = core.processSplit(key);
  if(newKey) { curC = newKey; renderFUList(); updateProg(); if(state.clusters[curC]) renderPanel(curC); window.autoSave(); }
};

// ⇔ VENTANA DE MULTI-FUSIÓN
window.openMM = function(key){
  mmFrom = key; 
  mmSelected = []; 
  mmKey = ''; 
  document.getElementById('mm-src').textContent = '"'+key+'"'; 
  document.getElementById('mmq').value = '';
  document.getElementById('mm-kc').style.display = 'none'; 
  document.getElementById('mm-ok').disabled = true;
  window.filterMM(); 
  document.getElementById('mm').classList.add('on');
};

window.filterMM = function(){
  const q = document.getElementById('mmq').value.toLowerCase();
  document.getElementById('mmlist').innerHTML = Object.values(state.clusters)
    .filter(c => c.key !== mmFrom && (!q || c.key.includes(q)))
    .slice(0, 80).map(c => `
    <div class="mitem mitem-mono" style="display:flex; align-items:center; gap:8px;" onclick="window.toggleMM('${ej(c.key)}')">
      <input type="checkbox" style="pointer-events:none;" ${mmSelected.includes(c.key) ? 'checked' : ''}>
      <span style="${mmSelected.includes(c.key) ? 'font-weight:bold; color:var(--p);' : ''}">${h(c.key)} <small style="color:var(--tx3)">(${c.rows.length})</small></span>
    </div>`).join('') || '<div style="padding:10px;text-align:center;color:var(--tx3);">Sin resultados</div>';
};

window.toggleMM = function(key){
  const idx = mmSelected.indexOf(key);
  if (idx > -1) mmSelected.splice(idx, 1); 
  else mmSelected.push(key); 
  
  window.filterMM(); 
  
  if (mmSelected.length > 0) {
    document.getElementById('mm-kc').style.display = 'block';
    
    const opciones = [mmFrom, ...mmSelected];
    document.getElementById('mm-kcopts').innerHTML = opciones.map(k => `
      <div class="ko ${k === mmKey ? 'sel' : ''}" id="ko_${sid(k)}" onclick="window.selMK('${ej(k)}')">${h(k)}</div>
    `).join('');
    
    if (!opciones.includes(mmKey)) {
      mmKey = '';
      document.getElementById('mm-ok').disabled = true;
    }
  } else {
    document.getElementById('mm-kc').style.display = 'none';
    mmKey = '';
    document.getElementById('mm-ok').disabled = true;
  }
};

window.selMK = function(k){
  mmKey = k; 
  document.querySelectorAll('.ko').forEach(e => e.classList.remove('sel')); 
  const element = document.getElementById('ko_'+sid(k));
  if(element) element.classList.add('sel');
  document.getElementById('mm-ok').disabled = false; 
};

window.confirmMerge = function(){
  if (mmSelected.length === 0 || !mmKey) return;
  const keysToMerge = [mmFrom, ...mmSelected];
  
  if (core.processMultiMerge(keysToMerge, mmKey)) {
    curC = mmKey; 
    ui.closeMM(); 
    renderFUList(); 
    updateProg(); 
    renderPanel(mmKey); 
    const cl = state.clusters[mmKey]; 
    mapMod.loadClusterMap(cl.latFinal, cl.lonFinal, cl.metodo, cl.rows);
    window.autoSave(); 
  }
};

window.renameCluster = function(oldKey){
  const newKey = prompt("Nombre correcto:", oldKey);
  const result = core.processRename(oldKey, newKey);
  if(result === 'exists') return alert("Ya existe.");
  if(result) { curC = result; renderFUList(); renderPanel(result); window.autoSave(); }
};

/* APIs */
function setGeoStatus(type, msg){ const el = document.getElementById('gstat'); if(el) { el.className = 'gstat gs-' + type; el.textContent = msg; } }

window.updateApiStatus = function() {
  ['gmaps','here'].forEach(id => {
    const val = document.getElementById('key-'+id)?.value.trim();
    const st = document.getElementById('st-'+id);
    if(st) { st.className = 'api-status ' + (val ? 'api-ok' : 'api-empty'); st.textContent = val ? 'activo' : '—'; }
  });

  const apiKey = document.getElementById('key-gmaps')?.value.trim();
  const coords = mapMod.getTentativeCoords();
  if (coords) mapMod.updateStreetView(coords.lat, coords.lng, apiKey);
  else if (curC && state.clusters[curC] && state.clusters[curC].latFinal) {
    mapMod.updateStreetView(state.clusters[curC].latFinal, state.clusters[curC].lonFinal, apiKey);
  } else {
    mapMod.updateStreetView(null, null, apiKey);
  }
};

window.geoNominatim = async function(key){
  const q = document.getElementById('geo-query')?.value.trim(); if(!q) return;

  setGeoStatus('run', '⏳ Buscando...');
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=cl`);
    const data = await res.json();
    if(data.length){ mapMod.placeTentative(parseFloat(data[0].lat), parseFloat(data[0].lon), true); setGeoStatus('ok', '✅ Nominatim'); } 
    else { setGeoStatus('err', '❌ No encontrado'); }
  } catch(e) { setGeoStatus('err', 'Error de red'); }
};

window.geoGoogle = async function(key){
  const q = document.getElementById('geo-query')?.value.trim(); 
  const apiKey = document.getElementById('key-gmaps')?.value.trim();
  
  if(!q) return;
  if(!apiKey) return alert("Por favor, ingresa tu API Key de Google Maps en ⚙ APIs");

  setGeoStatus('run', '⏳ Buscando en Google...');
  
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${apiKey}&components=country:CL`;
    const res = await fetch(url);
    const data = await res.json();
    
    if(data.status === 'OK' && data.results && data.results.length > 0){ 
      const loc = data.results[0].geometry.location;
      mapMod.placeTentative(parseFloat(loc.lat), parseFloat(loc.lng), true); 
      setGeoStatus('ok', '✅ Google OK'); 
    } 
    else { 
      setGeoStatus('err', '❌ No encontrado por Google'); 
    }
  } catch(e) { 
    setGeoStatus('err', '❌ Error de red'); 
  }
};

let _sigecQuery = '';
let _sigecComuna = '';

window.geoSIGEC = async function(key){
  const c = state.clusters[key]; if(!c) return;
  const row = c.rows[0];

  const normCut = v => { const m = String(v ?? '').match(/\d+/); return m ? m[0].replace(/^0+/, '') : ''; };
  const cut = normCut(row.codComuna) || normCut(row.comuna);
  if (!cut) { alert('Este cluster no tiene código de comuna (CUT) para consultar SIGEC.'); return; }

  let query = document.getElementById('geo-query')?.value.trim();
  if (!query) {
    query = [row.callNorm || row.calle, row.numNorm || row.numero].filter(Boolean).join(' ').trim();
    if (!query) query = String(row.localidad || row.calle || '').trim();
  }
  if (!query) { alert('No hay texto de dirección para buscar en SIGEC.'); return; }

  _sigecQuery = query;
  _sigecComuna = cut;
  openSIGECPanel(key);
  setSIGECBody('<div style="padding:18px;text-align:center;color:var(--tx3)">⏳ Buscando en SIGEC…</div>');

  try {
    const resultados = await sigec.buscar(cut, query, { limite: 25 });
    if (!resultados.length) {
      setSIGECBody(`<div style="padding:14px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;">
        Sin coincidencias en SIGEC para <b>${h(query)}</b> (comuna ${h(cut)}).<br>Prueba con menos texto o revisa la ortografía.</div>`);
      return;
    }
    renderSIGECResults(resultados);
  } catch (e) {
    setSIGECBody(`<div style="padding:14px;color:#dc2626;font-size:12px;">❌ Error al consultar SIGEC:<br>${h(e.message)}</div>`);
  }
};

function openSIGECPanel(key){
  lmKey = key;
  document.getElementById('lm-title').textContent = '🔍 SIGEC — predios SII';
  const c = state.clusters[key];
  const picker = document.getElementById('lm-picker');
  if (picker) picker.innerHTML = '';
  const details = document.querySelector('#lm details');
  if (details) details.style.display = (c && c.tipo === 'LOCALIDAD') ? '' : 'none';

  const lmEl = document.getElementById('lm');
  lmEl.classList.add('draggable');
  lmEl.classList.add('on');
  if (window.initLMDrag) window.initLMDrag();
}

function setSIGECBody(html){
  const picker = document.getElementById('lm-picker');
  if (picker) picker.innerHTML = html;
}

function renderSIGECResults(resultados){
  window._sigecResults = resultados;
  const filtro = `<input class="sinput" id="sigec-q" placeholder="Filtrar resultados…" oninput="window.filterSIGEC()" style="width:100%;margin-bottom:6px;">`;
  const info = `<div style="font-size:11px;color:var(--tx3);margin-bottom:6px;">${resultados.length} predios — clic para usar su centroide</div>`;
  setSIGECBody(filtro + info + `<div class="loc-list" id="sigec-list">${sigecItems(resultados)}</div>`);
}

function sigecItems(list){
  if (!list || !list.length) return '<div style="padding:14px;text-align:center;color:var(--tx3);font-size:12px;">— sin resultados —</div>';
  return list.map((r, i) => {
    const score = Math.round((r.score || 0) * 100);
    const dest = r.destino ? ` · ${h(r.destino)}` : '';
    return `<div class="loc-item" onclick="window.applySIGEC(${i})" style="display:flex;justify-content:space-between;gap:8px;align-items:center">
      <span><b>${h(r.direccion || '(sin dirección)')}</b><br><span style="font-size:10px;color:var(--tx3)">rol ${h(r.rol || '—')}${dest} · ${r.matchMethod || ''}</span></span>
      <span style="font-size:10px;color:#0891b2;font-weight:600;flex-shrink:0">${score}%</span>
    </div>`;
  }).join('');
}

window.filterSIGEC = function(){
  const q = nd((document.getElementById('sigec-q')?.value || '').toLowerCase());
  const all = window._sigecResults || [];
  const filtered = q ? all.filter(r => nd(String(r.direccion || '').toLowerCase()).includes(q)) : all;
  const el = document.getElementById('sigec-list');
  if (el) el.innerHTML = sigecItems(filtered);
};

window.applySIGEC = function(idx){
  const r = (window._sigecResults || [])[idx];
  if (!r || r.lat == null || r.lon == null) return;

  window.closeLM();
  mapMod.placeTentative(parseFloat(r.lat), parseFloat(r.lon), true);
  setGeoStatus('ok', `🔍 SIGEC: ${r.direccion || r.rol || ''}`.trim());

  sigec.registrarSeleccion(_sigecQuery, _sigecComuna, r.rol);
};

window.openLM = function(key){
  lmKey = key; const c = state.clusters[key]; if(!c)return;

  const normCut = v => {
    if (v === null || v === undefined) return '';
    const m = String(v).match(/\d+/);
    return m ? m[0].replace(/^0+/, '') : '';
  };

  const row = c.rows[0] || {};
  const cutActivo = normCut(row.codComuna) || normCut(row.comuna);
  const nomComuna = core.resolveComunaName(row);

  document.getElementById('lm-comuna').value = nomComuna;
  document.getElementById('lm-coords').value = mapMod.lastTentLat ? `${mapMod.lastTentLat.toFixed(6)}, ${mapMod.lastTentLon.toFixed(6)}` : '';

  const nomActivoNorm = nd(String(nomComuna || '').toLowerCase().trim());
  const locsFiltradas = state.localidades.filter(l => {
    const locCut = normCut(l.codComuna);
    if (cutActivo && locCut && locCut === cutActivo) return true;
    const locNom = nd(String(l.comuna || '').toLowerCase().trim());
    if (nomActivoNorm && locNom && locNom === nomActivoNorm) return true;
    return false;
  });

  window._currentFilteredLocs = locsFiltradas;

  const headerInfo = locsFiltradas.length > 0
    ? `<div style="font-size:11px;color:var(--tx3);margin-bottom:6px;">${locsFiltradas.length} localidades en <strong>${h(nomComuna || 'esta comuna')}</strong></div>`
    : `<div style="font-size:11px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;padding:6px 8px;border-radius:6px;margin-bottom:6px;">
         No se encontraron localidades para <strong>${h(nomComuna || cutActivo || '(comuna desconocida)')}</strong>.
         Revisa que el Maestro de Localidades incluya esta comuna, o usa <strong>+ Crear nueva localidad manual</strong> abajo.
       </div>`;

  document.getElementById('lm-picker').innerHTML =
    headerInfo +
    `<input class="sinput" id="lm-q" placeholder="Filtrar..." oninput="window.filterLocPicker()" style="width:100%;">
     <div class="loc-list" id="loc-list">${renderLocItems(locsFiltradas.slice(0, 100))}</div>`;

  const lmEl = document.getElementById('lm');
  lmEl.classList.add('draggable');
  lmEl.classList.add('on');
  window.initLMDrag();
};

// ── Modal de localidades arrastrable ────────────────────────────
window.initLMDrag = function initLMDrag() {
  const modal = document.querySelector('#lm .modal');
  const handle = document.querySelector('#lm .mh');
  if (!modal || !handle || handle._dragInit) return;
  handle._dragInit = true;

  if (window._lmPos) {
    modal.style.left = window._lmPos.left + 'px';
    modal.style.top  = window._lmPos.top  + 'px';
  } else {
    const r = modal.getBoundingClientRect();
    modal.style.left = Math.max(20, (window.innerWidth  - r.width)  / 2) + 'px';
    modal.style.top  = Math.max(20, (window.innerHeight - r.height) / 3) + 'px';
  }

  let dragging = false, offX = 0, offY = 0;

  const onDown = (e) => {
    if (e.target.closest('.mclose')) return;
    dragging = true;
    const r = modal.getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    offX = pt.clientX - r.left;
    offY = pt.clientY - r.top;
    document.body.style.userSelect = 'none';
  };

  const onMove = (e) => {
    if (!dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    const maxX = window.innerWidth  - modal.offsetWidth;
    const maxY = window.innerHeight - modal.offsetHeight;
    const left = Math.min(Math.max(0, pt.clientX - offX), Math.max(0, maxX));
    const top  = Math.min(Math.max(0, pt.clientY - offY), Math.max(0, maxY));
    modal.style.left = left + 'px';
    modal.style.top  = top  + 'px';
    window._lmPos = { left, top };
  };

  const onUp = () => { dragging = false; document.body.style.userSelect = ''; };

  handle.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  handle.addEventListener('touchstart', onDown, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: true });
  document.addEventListener('touchend', onUp);
}

window.filterLocPicker = function() { const q = nd((document.getElementById('lm-q')?.value || '').toLowerCase()); const filtered = q ? window._currentFilteredLocs.filter(l => nd(l.nombre.toLowerCase()).includes(q)) : window._currentFilteredLocs.slice(0, 100); document.getElementById('loc-list').innerHTML = renderLocItems(filtered.slice(0, 100)); };

function renderLocItems(list) {
  if (!list || list.length === 0) {
    return '<div style="padding:14px;text-align:center;color:var(--tx3);font-size:12px;">— sin resultados —</div>';
  }
  return list.map(l => `<div class="loc-item" onclick="window.applyLoc(${l.lat},${l.lon},'${ej(l.nombre)}')"><span>${h(l.nombre)}</span></div>`).join('');
}

window.applyLoc = function(lat, lon, nombre){
  const c = state.clusters[lmKey]; if(!c)return;
  c.latFinal=lat; c.lonFinal=lon; c.metodo='localidad · '+nombre; c.needsReview=false; 
  c.rows.forEach(r=>{r.latFinal=lat; r.lonFinal=lon; r.metodo=c.metodo; r.needsReview=false;});
  ui.closeLM(); if(curC===lmKey){ renderPanel(lmKey); mapMod.loadClusterMap(lat, lon, c.metodo, c.rows); }
  window.autoSave(); 
};

window.saveNewLoc = function() {
  const nombre = document.getElementById('lm-name').value.trim();
  let comuna   = document.getElementById('lm-coords').value.trim() ? document.getElementById('lm-comuna').value.trim() : '';
  const parts  = document.getElementById('lm-coords').value.trim().split(/[\s,;]+/).filter(Boolean).map(Number);

  if (!nombre)           return alert('⚠️ Ingresa un nombre para la nueva localidad.');
  if (parts.length < 2 || parts.some(isNaN)) return alert('⚠️ Coordenadas inválidas. Formato: lat, lon (ej: -38.5, -72.6)');

  let [lat, lon] = parts;
  if (Math.abs(lat) > 80 && Math.abs(lon) < 80) [lat, lon] = [lon, lat];

  const normCut = v => {
    if (v === null || v === undefined) return '';
    const m = String(v).match(/\d+/);
    return m ? m[0].replace(/^0+/, '') : '';
  };
  const cutSource = state.clusters[curC]?.rows[0];
  const codComunaNorm = normCut(cutSource?.codComuna) || normCut(cutSource?.comuna);
  const comunaName = comuna || core.resolveComunaName(cutSource || {});

  state.localidades.push({
    nombre:    nombre.toUpperCase(),
    comuna:    (comunaName || '').toUpperCase(),
    codComuna: codComunaNorm,
    lat, lon,
    origen:    'manual',
    isNew:     true
  });

  window.applyLoc(lat, lon, nombre.toUpperCase());
  ui.closeLM();
};

/* FLUJOS FINALES */
window.sf = function(v,btn){fufilt=v;document.querySelectorAll('.fu-left .fb').forEach(b=>b.classList.remove('on'));btn.classList.add('on');renderFUList();};
window.fuSearch = function(){fusq=document.getElementById('fusq').value.toLowerCase();renderFUList();};

window.gs = function(n, force = false){
  document.querySelectorAll('.step').forEach((s,i)=>s.classList.toggle('on',i+1===n));
  document.querySelectorAll('.pill').forEach((p,i)=>{ p.classList.remove('active','done'); if(i+1<n)p.classList.add('done'); if(i+1===n)p.classList.add('active'); });
  if(n===3){ ui.hideSB(); setTimeout(()=> window.dispatchEvent(new Event('resize')), 150); } else { ui.showSB(); }
};

window.exportGeoJSON = () => { io.buildGeoJSONExport(state.clusters, state.rawData, state.origFileName); reporter.pushReport('export', true); };
window.exportLocs = () => { io.buildLocsExport(state.localidades, state.origFileName); };
window.exportAppend = () => { io.buildAppendExport(state.clusters, state.rawData, state.origFileName); reporter.pushReport('export', true); };
window.exportEntregaQA = () => { io.buildEntregaQA(state.clusters, state.rawData, state.origFileName); reporter.pushReport('export', true); };

window.saveSigecConfig = function() {
  const url = document.getElementById('sigec-url')?.value || '';
  const key = document.getElementById('sigec-key')?.value || '';
  sigec.saveConfig(url, key);
};

window.saveReporterConfig = function() {
  const user  = document.getElementById('reporter-user')?.value || '';
  const token = document.getElementById('reporter-token')?.value || '';
  reporter.saveConfig(user, token);
  const el = document.getElementById('reporter-status');
  if (el) {
    el.className = 'api-status ' + (reporter.isConfigured() ? 'api-ok' : 'api-empty');
    el.textContent = reporter.isConfigured() ? 'configurado' : '—';
  }
};

window.reportNow = async function() {
  const el = document.getElementById('reporter-status');
  if (el) { el.className = 'api-status'; el.textContent = '⏳ enviando...'; }
  await reporter.pushReport('manual', true);
};
window.exportBackup = () => { io.buildBackupExport(state.clusters, state.rawData, state.localidades, state.origFileName); };

window.exportSupermente = function() {
  const dict = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('GEO_DICT_')) dict[k] = JSON.parse(localStorage.getItem(k)); }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(dict, null, 2)], { type: 'application/json' })); a.download = `supermente.json`; a.click();
};

window.importSupermente = function(input) {
  const file = input.files[0]; if (!file) return; const reader = new FileReader();
  reader.onload = function(e) {
      const data = JSON.parse(e.target.result); 
      for (const key in data) localStorage.setItem(key, JSON.stringify(data[key]));
      alert('Asimilación completada'); window.updateSupermenteStats();
  }; reader.readAsText(file);
};

window.updateSupermenteStats = () => {
  const count = core.getSupermenteStats();
  const el = document.getElementById('sm-stats');
  if (el) el.textContent = `Conocimiento asimilado: ${count} ubicaciones exactas.`;
};

window.exportBackupExcel = function() {
  if (!state.records.length) return alert("No hay datos para exportar.");
  
  const dataToExport = state.rawData.map((row, i) => {
    const record = state.records[i];
    const cluster = state.clusters[record.clave];
    
    return {
      ...row,
      [SCOLS[0]]: record.clave,
      [SCOLS[1]]: cluster.tipo || '—',
      [SCOLS[2]]: cluster.latFinal || '',
      [SCOLS[3]]: cluster.lonFinal || '',
      [SCOLS[4]]: cluster.metodo || '—',
      [SCOLS[5]]: cluster.confianza || '—'
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(dataToExport);
  XLSX.utils.book_append_sheet(wb, ws, "Respaldo SIGE");
  XLSX.writeFile(wb, `Respaldo_${state.origFileName}_${new Date().toISOString().slice(0,10)}.xlsx`);
};

window.exportSessionFile = function() {
    const serializableClusters = {};
    Object.entries(state.clusters).forEach(([k, c]) => {
        serializableClusters[k] = { ...c, flagged: Array.from(c.flagged || []) };
    });

    const sessionData = {
        version: "3.0-CORPHISH",
        timestamp: new Date().toISOString(),
        state: {
            ...state,
            clusters: serializableClusters,
            referenceGeoJSON: state.referenceGeoJSON,
            recintosPointsData: state.recintosPointsData
        }
    };

    const blob = new Blob([JSON.stringify(sessionData)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `SESION_SIGE_${state.origFileName}.json`;
    a.click();
};

window.importSessionFile = function(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const session = JSON.parse(e.target.result);
            if (!session.state) throw new Error("Archivo de sesión inválido");

            const esPlantilla = confirm("¿Deseas usar esta cápsula como PLANTILLA DE ENTORNO para un archivo nuevo?\n\n✅ [Aceptar]: Carga los Polígonos, Recintos, Maestro de Localidades y la Supermente, dejando el espacio libre para subir un Excel nuevo.\n\n❌ [Cancelar]: Restaura la sesión exactamente donde la dejaste para continuar el trabajo anterior.");

            if (esPlantilla) {
                state.referenceGeoJSON = session.state.referenceGeoJSON || null;
                state.recintosPointsData = session.state.recintosPointsData || null;
                state.localidades = session.state.localidades || [];

                if (state.referenceGeoJSON) {
                    document.getElementById('fn-geojson').textContent = 'Áreas cargadas desde cápsula ✓';
                    document.getElementById('dz-geojson').style.borderColor = '#16a34a';
                }
                if (state.recintosPointsData) {
                    document.getElementById('fn-recintos').textContent = 'Recintos cargados desde cápsula ✓';
                    document.getElementById('dz-recintos').style.borderColor = '#16a34a';
                }
                if (state.localidades.length > 0) {
                    document.getElementById('fn-loc').textContent = `Maestro cargado (${state.localidades.length} locs) ✓`;
                    document.getElementById('dz-loc').style.borderColor = '#16a34a';
                    state.locMapped = true; 
                }

                let inyectados = 0;
                if (session.state.clusters) {
                    Object.values(session.state.clusters).forEach(c => {
                        if (c.latFinal && c.lonFinal && (c.tipo === 'EXACTO' || c.tipo === 'CALLE')) {
                            core.saveToHistory(c);
                            inyectados++;
                        }
                    });
                    if (window.loadSMData) window.loadSMData();
                }

                alert(`♻️ Entorno de Trabajo Preparado:\n\n- Polígonos y Recintos listos.\n- ${state.localidades.length} localidades cargadas.\n- ${inyectados} ubicaciones asimiladas en la Supermente.\n\n👉 Ahora sube tu nuevo 'Excel de direcciones' en el recuadro gris y continúa al Paso 2.`);

            } else {
                Object.values(session.state.clusters).forEach(c => {
                    c.flagged = new Set(c.flagged || []);
                });
                Object.assign(state, session.state);
                window.enterFU();
                if (state.curC && state.clusters[state.curC]) {
                    setTimeout(() => {
                        window.openC(state.curC);
                        const activeEl = document.getElementById(`ci_${sid(state.curC)}`);
                        if (activeEl) activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    }, 300);
                }
                alert(`✅ Sesión restaurada: Continuas en "${state.curC || 'el inicio'}" con ${state.records.length} registros.`);
            }
        } catch (err) {
            alert("Error al restaurar: " + err.message);
        }
        input.value = '';
    };
    reader.readAsText(file);
};

window.copyRunList = function(event) {
  const area = document.getElementById('run-list-area');
  if (!area || !area.value) return;
  
  navigator.clipboard.writeText(area.value).then(() => {
    const btn = event.currentTarget;
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = '¡Copiado! ✓';
      btn.style.backgroundColor = 'var(--ok)';
      btn.style.borderColor = 'var(--ok)';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.backgroundColor = '';
        btn.style.borderColor = '';
      }, 2000);
    }
  }).catch(err => {
    console.error('Error al copiar:', err);
    alert('Tu navegador bloqueó el copiado automático. Por favor, selecciona el texto y presiona Ctrl+C.');
  });
};

window.addEventListener('beforeunload', function (e) { if (state && state.rawData && state.rawData.length > 0) { e.preventDefault(); e.returnValue = ''; } });

document.addEventListener('keydown', function(e) {
  const key = e.key.toLowerCase();

  if ((e.ctrlKey || e.metaKey) && (key === 's' || key === 'g')) {
      e.preventDefault(); 
      if (state && state.rawData && state.rawData.length > 0) {
          window.manualSave();
      }
      return;
  }

  const step3 = document.getElementById('s3');
  if (!step3 || !step3.classList.contains('on') || !curC) return;

  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (key === 'o') { 
      e.preventDefault(); 
      window.geoNominatim(curC); 
      return; 
  }
  if (key === 'g') { 
      e.preventDefault(); 
      window.geoGoogle(curC); 
      return; 
  }
  if (key === 's') { 
      e.preventDefault(); 
      const c = state.clusters[curC];
      if (c && c.flagged && c.flagged.size > 0) {
          window.splitFlagged(curC); 
      }
      return; 
  }
  if (key === 'f') { 
      e.preventDefault(); 
      window.openMM(curC);
      setTimeout(() => {
          const mmq = document.getElementById('mmq');
          if (mmq) mmq.focus();
      }, 50);
      return; 
  }

  if (key === 'e') { e.preventDefault(); window.setTipo(curC, 'EXACTO'); return; }
  if (key === 'c') { e.preventDefault(); window.setTipo(curC, 'CALLE'); return; }
  if (key === 'l') { e.preventDefault(); window.setTipo(curC, 'LOCALIDAD'); return; }
  if (key === 'n') { e.preventDefault(); window.setTipo(curC, 'NO GEO'); return; }

  if (key === ' ') { 
    e.preventDefault(); 
    const btnConf = document.getElementById('btn-conf');
    if (btnConf && !btnConf.disabled) {
      window.confirmCoord(); 
    }
    return;
  }
  
	  if (key === 'q') {
	    e.preventDefault();
	    window.nextPend();
	    return;
	  }
});

window.triggerRecintoHighlight = function(lat, lon) {
  if (!lat || !lon || !state.referenceGeoJSON) return;
  try {
    const pt = window.turf ? turf.point([lon, lat]) : null;
    if (!pt) return;
    let foundCod = null;
    turf.featureEach(state.referenceGeoJSON, function (currentFeature) {
      if (foundCod) return; 
      if (turf.booleanPointInPolygon(pt, currentFeature)) {
        const props = currentFeature.properties;
        const keys = Object.keys(props);
        const recintKey = keys.find(k => ['cod_recint', 'codigo_recinto', 'id_recinto'].some(a => k.toLowerCase().includes(a)));
        if (recintKey && props[recintKey]) {
          foundCod = props[recintKey];
        }
      }
    });
    if (foundCod) {
      mapMod.highlightRecinto(foundCod); 
    }
  } catch (err) {
    console.warn("Error silencioso en el análisis espacial de Turf.js:", err);
  }
};

// ═══════════════════════════════════════════════════════════════
// MOTOR AUTO-URBANOS v4.3 — SIGEC exclusivo (sin fallback a Nominatim)
// ═══════════════════════════════════════════════════════════════
window.startBatchUrban = async function() {
  const btn = document.getElementById('btn-batch');
  if (!btn) return;

  if (!sigec.isAvailable()) {
    return alert('⚠️ SIGEC no está disponible. El Auto-Urbanos requiere SIGEC — revisa la configuración en ⚙ APIs.');
  }

  const maxRowsStr = prompt("¿Cuál es la cantidad máxima de registros por cluster que deseas procesar en automático?", "1");
  if (maxRowsStr === null) return;
  const maxRows = parseInt(maxRowsStr) || 1;

  const candidatos = Object.values(state.clusters).filter(c =>
    !c.tipo &&
    !c.autoVal &&
    c.rows.length <= maxRows &&
    c.tipoPropuesto === 'URBANO'
  );

  if (candidatos.length === 0) {
    return alert(`No hay clusters urbanos pendientes de hasta ${maxRows} registro(s) para procesar.`);
  }

  if (!confirm(`Se encontraron ${candidatos.length} candidatos (de hasta ${maxRows} registros).\n\n🔍 Se consultará SOLO contra SIGEC (predios SII de Araucanía).\nLos que no tengan match quedan sin tocar, para revisión manual.\n\nTodos los resultados con match quedan "por revisar" para tu confirmación.\n\n¿Iniciar?`)) return;

  btn.disabled = true;
  let exitosos = 0, sinMatch = 0;

  const normCut = v => { const m = String(v ?? '').match(/\d+/); return m ? m[0].replace(/^0+/, '') : ''; };

  for (let i = 0; i < candidatos.length; i++) {
    const c = candidatos[i];
    const row = c.rows[0];
    const cut = normCut(row.codComuna) || normCut(row.comuna);
    const query = [row.callNorm || row.calle, row.numNorm || row.numero].filter(Boolean).join(' ').trim();

    btn.innerHTML = `⏳ SIGEC ${i + 1}/${candidatos.length}...`;

    if (!cut || !query) { sinMatch++; continue; }

    try {
      const resultados = await sigec.buscar(cut, query, { limite: 1 });
      if (resultados && resultados.length > 0 && resultados[0].lat != null) {
        const best = resultados[0];
        c.tipo      = row.numNorm ? 'EXACTO' : 'CALLE';
        c.latFinal  = parseFloat(best.lat);
        c.lonFinal  = parseFloat(best.lon);
        c.metodo    = `Auto-SIGEC · ${best.direccion || best.rol || ''}`.trim();
        c.confianza = 'sigec';
        c.needsReview = true;
        c.rows.forEach(r => {
          r.tipo = c.tipo; r.latFinal = c.latFinal; r.lonFinal = c.lonFinal;
          r.metodo = c.metodo; r.needsReview = true;
        });
        exitosos++;
      } else {
        sinMatch++;
      }
    } catch (e) {
      console.warn('SIGEC batch falló para:', query, e.message);
      sinMatch++;
    }
  }

  btn.disabled = false;
  btn.innerHTML = '🚀 Auto-Urbanos';
  renderFUList(); updateProg();
  if (curC && state.clusters[curC]) renderPanel(curC);
  window.autoSave();

  alert(
    `✅ Proceso completado.\n\n` +
    `🔍 SIGEC (por revisar): ${exitosos}\n` +
    `❓ Sin match — quedan pendientes para revisión manual: ${sinMatch}\n\n` +
    `⚠️ Los registros con match quedan "Por revisar" y necesitan tu confirmación manual.`
  );
};

// ═══════════════════════════════════════════════════════════════
// 🧬 CÁMARA DE EVOLUCIÓN (EDITOR INMERSIVO ZERG)
// ═══════════════════════════════════════════════════════════════
let smMap = null;
let smLayerGroup = null;
let smActiveMarker = null;
let smBaseCoords = null;

window.openSMEditor = function() {
    window.closeAPIs();
    document.getElementById('sm-editor-modal').classList.add('on');
    
    if (!smMap) {
        smMap = L.map('sm-map', { maxZoom: 22 }).setView([-38.73965, -72.59842], 13);
        
        const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap | © CARTO',
            maxZoom: 22,
            maxNativeZoom: 19
        });

        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 22,
            maxNativeZoom: 19
        });

        darkLayer.addTo(smMap);

        const baseMaps = {
            "Radar Zerg (Oscuro)": darkLayer,
            "OSM (Numeración)": osmLayer
        };
        L.control.layers(baseMaps, null, { position: 'topright' }).addTo(smMap);

        smLayerGroup = L.featureGroup().addTo(smMap);
    }
    
    setTimeout(() => {
        smMap.invalidateSize();
        window.loadSMData();
    }, 200);
};

window.closeSMEditor = function() {
    document.getElementById('sm-editor-modal').classList.remove('on');
    window.cancelSMMutation();
};

window.smNodesData = []; 
let smMapClickHandler = null;

window.loadSMData = function() {
    if (!smLayerGroup) return;
    smLayerGroup.clearLayers();
    window.smNodesData = [];
    
    let comunasSet = new Set();
    let regionesSet = new Set();

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('GEO_DICT_')) {
            try {
                let data = JSON.parse(localStorage.getItem(key));
                if (typeof data === 'string') data = JSON.parse(data);

                const lat = parseFloat(data?.latFinal || data?.lat || data?.latitud);
                const lon = parseFloat(data?.lonFinal || data?.lon || data?.longitud);
                const comuna = data?.comuna || 'DESCONOCIDA';
                const region = data?.region || 'DESCONOCIDA';

                if (!isNaN(lat) && !isNaN(lon)) {
                    data.latFinal = lat;
                    data.lonFinal = lon;
                    data.comuna = comuna;
                    data.region = region;
                    data.tipo = data.tipo || 'DESCONOCIDO';

                    if (comuna !== 'DESCONOCIDA' && comuna !== '') comunasSet.add(comuna);
                    if (region !== 'DESCONOCIDA' && region !== '') regionesSet.add(region);

                    window.smNodesData.push({ 
					    key: key, 
					    name: (data.aliases && data.aliases.length > 0) ? data.aliases[0] : key.replace('GEO_DICT_', ''), 
					    data: data 
					});
                }
            } catch(e) {}
        }
    }

    const regSelect = document.getElementById('sm-f-reg');
    if (regSelect) {
        const currentVal = regSelect.value;
        regSelect.innerHTML = '<option value="">Todas</option>' + 
            Array.from(regionesSet).sort().map(r => `<option value="${r}">${r}</option>`).join('');
        regSelect.value = currentVal;
    }

    const comSelect = document.getElementById('sm-f-com');
    if (comSelect) {
        const currentVal = comSelect.value;
        comSelect.innerHTML = '<option value="">Todas</option>' + 
            Array.from(comunasSet).sort().map(c => `<option value="${c}">${c}</option>`).join('');
        comSelect.value = currentVal;
    }

    window.applySMFilters();
};

window.applySMFilters = function() {
    if (!smLayerGroup) return;
    smLayerGroup.clearLayers();
    const fReg = document.getElementById('sm-f-reg')?.value.toLowerCase() || '';
    const fCom = document.getElementById('sm-f-com')?.value.toLowerCase() || '';
    const fCalle = document.getElementById('sm-f-calle')?.value.toLowerCase().trim() || '';

    const zergIcon = L.divIcon({
        className: 'zerg-icon',
        html: `<div style="width:14px;height:14px;background:var(--sm-p);border-radius:50%;border:2px solid #fff;box-shadow:0 0 12px var(--sm-p);"></div>`,
        iconSize: [14, 14], iconAnchor: [7, 7]
    });

    let count = 0;

    window.smNodesData.forEach(node => {
        const matchReg = !fReg || (node.data.region && node.data.region.toLowerCase() === fReg);
        const matchCom = !fCom || (node.data.comuna && node.data.comuna.toLowerCase() === fCom);
        
        let matchCalle = true;
        if (fCalle !== '') {
            let allNames = node.name.toLowerCase();
            if (node.data.aliases && Array.isArray(node.data.aliases)) {
                allNames += " " + node.data.aliases.join(' ').toLowerCase();
            }
            matchCalle = allNames.includes(fCalle);
        }

        if (matchReg && matchCom && matchCalle) {
            const marker = L.marker([node.data.latFinal, node.data.lonFinal], { icon: zergIcon }).addTo(smLayerGroup);
            marker.smKey = node.key;
            marker.smName = node.name;
            marker.smData = node.data;
            marker.on('click', () => window.selectSMMarker(marker));
            count++;
        }
    });

    if (count > 0) {
        smMap.fitBounds(smLayerGroup.getBounds().pad(0.1), { maxZoom: 18, animate: true });
    }

    const previewEl = document.getElementById('sm-list-preview');
    if (previewEl) {
        previewEl.innerHTML = `<p style="color:var(--ok);font-family:monospace;text-align:center;font-size:13px;margin-top:20px;">▶ ${count} nodos filtrados.</p>`;
    }
};

window.selectSMMarker = function(marker) {
    if (smActiveMarker && smActiveMarker.dragging) smActiveMarker.dragging.disable();
    smActiveMarker = marker;
    
    const inspector = document.getElementById('sm-inspector-panel');
    
    const aliasesHTML = marker.smData.aliases ? marker.smData.aliases.map(a => 
        `<span style="background: rgba(168, 85, 247, 0.2); border: 1px solid var(--sm-p); color: var(--sm-tx); padding: 4px 8px; border-radius: 12px; font-size: 11px; display: inline-block; margin: 0 4px 4px 0;">${a}</span>`
    ).join('') : `<span style="color:var(--sm-tx2); font-size:12px;">${marker.smName}</span>`;

    inspector.innerHTML = `
        <h4 style="color:var(--sm-tx); margin-bottom: 5px;">🧬 ADN Espacial</h4>
        
        <div style="margin-bottom:15px; max-height: 100px; overflow-y: auto;">
            <div style="font-size:10px; color:var(--sm-tx3); margin-bottom:4px; text-transform:uppercase;">Alias Conocidos:</div>
            ${aliasesHTML}
        </div>
        
        <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:6px; border:1px solid var(--sm-bd); margin-bottom:15px;">
            <div style="font-size:10px; color:var(--sm-tx3); text-transform:uppercase;">Identificador Único:</div>
            <div style="color:var(--sm-tx2); font-size:10px; margin-top:2px; margin-bottom:8px; font-family:monospace; word-break:break-all;">${marker.smKey}</div>
            
            <div style="font-size:11px; color:var(--sm-tx2);">Coordenadas actuales:</div>
            <div style="color:var(--sm-tx); font-size:13px; margin-top:2px;">${marker.smData.latFinal.toFixed(5)}, ${marker.smData.lonFinal.toFixed(5)}</div>
            <div style="font-size:11px; color:var(--sm-tx2); margin-top:8px;">Tipo registrado:</div>
            <div style="color:var(--sm-tx); font-size:13px; margin-top:2px;">${marker.smData.tipo}</div>
            <div style="font-size:11px; color:var(--sm-tx2); margin-top:8px;">Territorio:</div>
            <div style="color:var(--sm-tx); font-size:13px; margin-top:2px;">${marker.smData.comuna} (${marker.smData.region})</div>
        </div>

        <button class="btn btn-p" style="width:100%; background:var(--sm-p); border-color:var(--sm-p); color:#fff; margin-bottom:10px;" onclick="window.enableSMMutation()">
            📍 Mutar Posición (Mover)
        </button>
        <button class="btn btn-d" style="width:100%;" onclick="window.deleteSMMemory('${ej(marker.smKey)}')">
            🗑️ Eliminar Recuerdo
        </button>
    `;
};

function updateSMOdometer() {
    if (!smActiveMarker || !smBaseCoords) return;
    const currentPos = smActiveMarker.getLatLng();
    const dist = turf.distance(smBaseCoords, [currentPos.lng, currentPos.lat], {units: 'meters'});
    document.getElementById('sm-hud-dist').innerHTML = `Desplazamiento: <strong style="color:var(--wa)">${Math.round(dist)}m</strong>`;
}

window.enableSMMutation = function() {
    if (!smActiveMarker) return;
    
    const pos = smActiveMarker.getLatLng();
    smBaseCoords = [pos.lng, pos.lat]; 
    
    smActiveMarker.dragging.enable();
    smMap.flyTo(pos, 18, { animate: true, duration: 0.5 });
    
    document.getElementById('sm-hud').style.display = 'flex';
    document.getElementById('sm-hud-dist').textContent = "Desplazamiento: 0m";
    
    smActiveMarker.on('drag', updateSMOdometer);
    
    smMapClickHandler = function(e) {
        smActiveMarker.setLatLng(e.latlng);
        updateSMOdometer(); 
    };
    smMap.on('click', smMapClickHandler);
};

window.cancelSMMutation = function() {
    if (smActiveMarker) {
        smActiveMarker.dragging.disable();
        smActiveMarker.off('drag');
        if (smBaseCoords) smActiveMarker.setLatLng([smBaseCoords[1], smBaseCoords[0]]);
    }
    if (smMapClickHandler) {
        smMap.off('click', smMapClickHandler);
        smMapClickHandler = null;
    }
    document.getElementById('sm-hud').style.display = 'none';
};

document.addEventListener('DOMContentLoaded', () => {
    const hud = document.getElementById('sm-hud');
    if (hud) {
        const btns = hud.querySelectorAll('button');
        if (btns.length === 2) {
            btns[0].onclick = window.saveSMMutation;
            btns[1].onclick = window.cancelSMMutation;
        }
    }
});

window.saveSMMutation = function() {
    if (!smActiveMarker) return;
    
    const newPos = smActiveMarker.getLatLng();
    const data = smActiveMarker.smData;
    
    data.latFinal = newPos.lat;
    data.lonFinal = newPos.lng;
    data.fecha = new Date().toISOString();
    
    localStorage.setItem(smActiveMarker.smKey, JSON.stringify(data));
    
    smActiveMarker.dragging.disable();
    smActiveMarker.off('drag');
    if (smMapClickHandler) {
        smMap.off('click', smMapClickHandler);
        smMapClickHandler = null;
    }
    
    document.getElementById('sm-hud').style.display = 'none';
    window.selectSMMarker(smActiveMarker); 
    window.updateSupermenteStats(); 
    
    alert('🧬 ¡Mutación guardada exitosamente!');
};

window.deleteSMMemory = function(key) {
    if (confirm('¿Extirpar este recuerdo de la Colmena definitivamente?')) {
        localStorage.removeItem(key);
        window.loadSMData();
        const inspector = document.getElementById('sm-inspector-panel');
        if(inspector) inspector.innerHTML = `<div class="empty" id="sm-empty-inspector" style="margin-top: 50px;"><div class="ico" style="font-size: 30px; opacity: 0.5;">🦠</div><p style="color: var(--sm-tx2);">Selecciona un organismo en el mapa</p></div>`;
        window.updateSupermenteStats();
    }
};
