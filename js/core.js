// core.js - Lógica principal de negocio, Supermente y cruces de datos
import { state } from './store.js';

export function resolveComunaName(row) {
    if (!row) return '';
    
    let nombreComuna = String(row.comuna || '').trim();
    let codComuna = String(row.codComuna || '').trim();

    // 1. Filtro Anti-Nulls (por si acaso ArcGIS ataca de nuevo)
    if (/^(<null>|null|undefined|na|n\/a)$/i.test(nombreComuna)) nombreComuna = '';

    // 2. Detector Inteligente de CUT: ¿El usuario mapeó un número en lugar de un texto?
    const isNumeric = /^\d+$/.test(nombreComuna);

    if (isNumeric) {
        codComuna = nombreComuna; // Movemos el número a donde pertenece (al CUT)
        nombreComuna = '';        // Vaciamos el nombre para obligar al sistema a buscarlo
    }

    // 3. Si es un nombre de texto real (Ej: "TEMUCO"), ganamos, lo devolvemos
    if (nombreComuna) return nombreComuna;

    // 4. Si solo tenemos el número (CUT), vamos a buscar el nombre real a la Supermente/Localidades
    if (codComuna && state.localidades && state.localidades.length > 0) {
        const loc = state.localidades.find(l => String(l.codComuna).trim() === codComuna);
        if (loc && loc.comuna) return String(loc.comuna).trim();
    }

    // 5. Último recurso: si el usuario no cargó el maestro de localidades, 
    // devolvemos lo que tengamos para no romper la app.
    return isNumeric ? codComuna : '';
}

// ═══════════════════════════════════════════════════════════════
// LA SUPERMENTE (Memoria Histórica Local)
// ═══════════════════════════════════════════════════════════════
export function autoMatchHistorical() {
    let matchCount = 0;
    Object.values(state.clusters).forEach(c => {
        if (c.tipo || c.needsReview) return;
        const hist = localStorage.getItem('GEO_DICT_' + c.key);
        if (hist) {
            try {
                const data = JSON.parse(hist);
                c.tipo = data.tipo;
                c.latFinal = data.latFinal;
                c.lonFinal = data.lonFinal;
                c.metodo = 'Memoria Histórica';
                c.confianza = data.confianza || 'Alta';
                c.autoVal = true;
                c.needsReview = false;
                c.rows.forEach(r => {
                    r.tipo = c.tipo;
                    r.latFinal = c.latFinal;
                    r.lonFinal = c.lonFinal;
                    r.metodo = c.metodo;
                    r.needsReview = false;
                });
                matchCount++;
            } catch(e) {}
        }
    });
    if (matchCount > 0) console.log(`Supermente autocompletó ${matchCount} clusters.`);
}

// Función auxiliar para crear Códigos Únicos (UUID)
function generateUUID() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function saveToHistory(c) {
    if (!c.latFinal || !c.lonFinal || !c.tipo) return;
    if (c.tipo !== 'EXACTO' && c.tipo !== 'CALLE') return;
    
    let nomComuna = 'DESCONOCIDA';
    let nomRegion = 'DESCONOCIDA';
    let cutComuna = 'DESCONOCIDO'; // 🧬 NUEVO: Espacio para el CUT

    // Intersección Turf.js
    if (state.referenceGeoJSON && window.turf) {
        try {
            const pt = turf.point([c.lonFinal, c.latFinal]);
            let found = false;
            turf.featureEach(state.referenceGeoJSON, function (currentFeature) {
                if (found) return;
                if (turf.booleanPointInPolygon(pt, currentFeature)) {
                    const props = currentFeature.properties;
                    if (props.glosa_comu) nomComuna = String(props.glosa_comu).trim().toUpperCase();
                    if (props.glosa_regi) nomRegion = String(props.glosa_regi).trim().toUpperCase();
                    
                    // 🧠 CAZAR EL CUT DINÁMICAMENTE
                    const kCut = Object.keys(props).find(k => ['iso_comuna','cod_comuna','cut'].some(a => k.toLowerCase().includes(a)));
                    if (kCut && props[kCut]) cutComuna = String(props[kCut]).trim();
                    
                    found = true;
                }
            });
        } catch (err) {}
    }

    if (nomComuna === 'DESCONOCIDA' && c.rows && c.rows.length > 0) {
        nomComuna = resolveComunaName(c.rows[0]) || String(c.rows[0]?.comuna || '').trim().toUpperCase();
        cutComuna = String(c.rows[0]?.codComuna || c.rows[0]?.comuna || 'DESCONOCIDO').trim(); // Fallback al Excel
    }
    
    const newAlias = c.key;
    let existingId = null;
    let existingData = null;

  

    // 🧠 BÚSQUEDA RELACIONAL: ¿Ya conocemos este alias?
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('GEO_DICT_')) {
            const d = JSON.parse(localStorage.getItem(k));
            if (d.aliases && d.aliases.includes(newAlias)) {
                existingId = k;
                existingData = d;
                break;
            }
        }
    }

    if (existingId) {
        // 🧬 FUSIÓN: Actualizamos las coordenadas a las más recientes
        existingData.latFinal = c.latFinal;
        existingData.lonFinal = c.lonFinal;
        existingData.fecha = new Date().toISOString();
        localStorage.setItem(existingId, JSON.stringify(existingData));
    } else {
        // 🧬 NUEVO ORGANISMO: Nace con un UUID
        const newId = 'GEO_DICT_' + generateUUID();
        const data = { 
            id: newId,
            aliases: [newAlias], // Ahora es una lista
            tipo: c.tipo, 
            latFinal: c.latFinal, 
            lonFinal: c.lonFinal, 
            comuna: nomComuna, 
			cutComuna: cutComuna,
            region: nomRegion,
            confianza: 'Alta', 
            fecha: new Date().toISOString() 
        };
        localStorage.setItem(newId, JSON.stringify(data));
    }
}


export function getSupermenteStats() {
    let count = 0;
    for (let i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i).startsWith('GEO_DICT_')) count++;
    }
    return count;
}

// ═══════════════════════════════════════════════════════════════
// AUTO-LOCALIDADES (Cruce Inteligente con el Excel Maestro)
// ═══════════════════════════════════════════════════════════════
export function autoMatchRural() {
    if (!state.locMapped || !state.localidades || !state.localidades.length) return;
    let cCount = 0;
    
    Object.values(state.clusters).forEach(c => {
        if (c.tipo || c.needsReview) return;
        
        // 🔥 ESCUDO URBANO BLINDADO 🔥
        // 1. Si la IA sugirió que es Urbano (ignorando mayúsculas por si acaso)
        if (c.tipoPropuesto && String(c.tipoPropuesto).toUpperCase().includes('URBANO')) return;
        
        // 2. LA REGLA DE ORO: Si algún registro de este cluster TIENE NÚMERO DE CALLE, 
        // es una dirección específica. ¡PROHIBIDO mandarlo al centro de una localidad!
        if (c.rows.some(r => r.numNorm)) return;
        
        const cutActivo = String(c.rows[0]?.comuna || c.rows[0]?.codComuna || '').trim();
        const nomComuna = resolveComunaName(c.rows[0]);
        
        const locsComuna = state.localidades.filter(l => 
            String(l.codComuna).trim() === cutActivo || l.comuna === nomComuna
        );
        
        const locName = String(c.rows[0]?.localidad || '').trim().toLowerCase();
        const restoName = String(c.rows[0]?.resto || '').trim().toLowerCase();
        
        // Solo buscamos si el texto no está vacío
        let match = null;
        if (locName) match = locsComuna.find(l => l.nombre.toLowerCase() === locName);
        if (!match && restoName) match = locsComuna.find(l => l.nombre.toLowerCase() === restoName);
        
        if (match) {
            c.tipo      = 'LOCALIDAD';
            c.latFinal  = match.lat;
            c.lonFinal  = match.lon;
            c.metodo    = 'Auto-Localidad: ' + match.nombre;
            c.confianza = 'sugerencia';
            c.autoVal   = false;        // NO marcar como auto-validado — requiere revisión humana
            c.needsReview = true;       // SIEMPRE por revisar — el analista debe confirmar
            c.rows.forEach(r => {
                r.tipo = c.tipo; r.latFinal = c.latFinal; r.lonFinal = c.lonFinal;
                r.metodo = c.metodo; r.needsReview = true;
            });
            cCount++;
        }
    });
    
    if(cCount > 0) console.log(`Autocompletadas ${cCount} localidades (respetando urbanos estrictamente).`);
}

// ═══════════════════════════════════════════════════════════════
// SEPARACIÓN Y MULTI-FUSIÓN DE CLUSTERS
// ═══════════════════════════════════════════════════════════════
export function processSplit(key) {
    const c = state.clusters[key]; 
    if(!c || !c.flagged || !c.flagged.size) return null;
    
    const ids = [...c.flagged];
    const rows = ids.map(id => c.rows.find(x => x.id === id)).filter(Boolean);
    
    c.rows = c.rows.filter(x => !c.flagged.has(x.id)); 
    c.flagged.clear();
    
    let nk = c.key + ' [sep]', sfx = 1;
    while(state.clusters[nk]) nk = c.key + ` [sep${++sfx}]`;
    
    rows.forEach(r => { r.clave = nk; r.tipo = null; });
    state.clusters[nk] = { 
        key: nk, rows, flagged: new Set(), tipo: null, 
        latFinal: null, lonFinal: null, metodo: null, confianza: null, 
        autoVal: rows.length < 3 
    };
    
    if(c.rows.length === 0) { 
        delete state.clusters[key]; 
        return nk; 
    }
    return key; 
}

export function processMultiMerge(keysToMerge, finalKey) {
    if (!keysToMerge || keysToMerge.length < 2 || !finalKey) return false;

    let allRows = [];
    let bestTipo = null;
    let bestLat = null, bestLon = null;
    let bestMetodo = null, bestConfianza = null;

    // 1. Recopilamos a todos los reclutas
    keysToMerge.forEach(k => {
        const c = state.clusters[k];
        if (c) {
            allRows.push(...c.rows);
            if (!bestTipo && c.tipo) bestTipo = c.tipo;
            if (!bestLat && c.latFinal) {
                bestLat = c.latFinal;
                bestLon = c.lonFinal;
                bestMetodo = c.metodo;
                bestConfianza = c.confianza;
            }
        }
    });

    if (allRows.length === 0) return false;

    // 2. Uniformamos a los reclutas
    allRows.forEach(r => {
        r.clave = finalKey;
        if (bestTipo) r.tipo = bestTipo;
    });

    // 3. Creamos el Mega-Cluster
    state.clusters[finalKey] = {
        key: finalKey,
        rows: allRows,
        flagged: new Set(),
        tipo: bestTipo,
        latFinal: bestLat,
        lonFinal: bestLon,
        metodo: bestMetodo,
        confianza: bestConfianza,
        autoVal: false
    };

    // 4. Eliminamos los clusters originales
    keysToMerge.forEach(k => {
        if (k !== finalKey) delete state.clusters[k];
    });

    return true;
}

export function processRename(oldKey, newKey) {
    const c = state.clusters[oldKey]; 
    if(!c || !newKey || newKey === oldKey) return null;
    const cleanKey = newKey.trim().toLowerCase(); 
    if(state.clusters[cleanKey]) return 'exists'; 
    
    state.clusters[cleanKey] = c;
    state.clusters[cleanKey].key = cleanKey;
    state.clusters[cleanKey].rows.forEach(r => r.clave = cleanKey);
    delete state.clusters[oldKey];
    
    return cleanKey;
}

// ============================================================================
// 🧠 MOTOR DE INTELIGENCIA DE LA SUPERMENTE (CORPHISH)
// ============================================================================

// 1. Normalización Agresiva (El Molino)
export function normalizeForAI(text) {
    if (!text) return '';
    // Quitar tildes y pasar a minúsculas
    let s = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    // Dejar solo letras y números
    s = s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Homologación Semántica (El diccionario Zerg)
    s = s.replace(/\b(psje|pje|pj|pas|pasaje)\b/g, 'pasaje');
    s = s.replace(/\b(avda|av|avenida)\b/g, 'avenida');
    s = s.replace(/\b(pob|pobl|poblacion)\b/g, 'poblacion');
    s = s.replace(/\b(vll|villa)\b/g, 'villa');
    
    // Quitar ceros a la izquierda en numeraciones (ej. 00432 -> 432)
    s = s.replace(/\b0+(\d+)\b/g, '$1');
    
    return s;
}

// 2. Algoritmo de Similitud de Levenshtein (Fuzzy Match)
export function getSimilarity(s1, s2) {
    if (s1 === s2) return 1.0;
    let longer = s1, shorter = s2;
    if (s1.length < s2.length) { longer = s2; shorter = s1; }
    if (longer.length === 0) return 1.0;
    
    let costs = new Array();
    for (let i = 0; i <= longer.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= shorter.length; j++) {
            if (i == 0) costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (longer.charAt(i - 1) != shorter.charAt(j - 1))
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[shorter.length] = lastValue;
    }
    return (longer.length - costs[shorter.length]) / parseFloat(longer.length);
}

// 3. El Cazador de Alias (Lee todos los arrays de la Supermente)
export function findInSupermente(calleOriginal, comunaOriginal) {
    const searchCalle = normalizeForAI(calleOriginal);
    const searchCom = normalizeForAI(comunaOriginal);
    
    let bestMatch = null;
    let highestScore = 0;

    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('GEO_DICT_')) {
            const data = JSON.parse(localStorage.getItem(k));
            const memCom = normalizeForAI(data.comuna);
            
            // Filtro Territorial: Si las comunas son totalmente distintas, ignorar.
            if (searchCom && memCom && getSimilarity(searchCom, memCom) < 0.7) continue;

            // 🧬 EL NÚCLEO: Revisar la calle contra TODOS los alias de este clúster
            if (data.aliases && Array.isArray(data.aliases)) {
                for (let alias of data.aliases) {
                    const memCalle = normalizeForAI(alias);
                    const score = getSimilarity(searchCalle, memCalle);
                    
                    if (score > highestScore) {
                        highestScore = score;
                        bestMatch = { 
                            id: k, 
                            data: data, 
                            matchedAlias: alias, // El alias específico con el que hizo match
                            score: score 
                        };
                    }
                }
            }
        }
    }
    
    // UMBRAL DE CONFIANZA: 80% (Para cazar "Mari Kine" vs "Mariquine")
    if (highestScore >= 0.80) {
        return bestMatch;
    }
    return null;
}