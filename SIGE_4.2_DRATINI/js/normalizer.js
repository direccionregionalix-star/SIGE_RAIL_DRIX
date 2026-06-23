// normalizer.js - Lógica de limpieza, estandarización y cruces inteligentes
import { nd, getSimilarity } from './utils.js';

const PREFIXES = ['avenida','avda','av','calle','cl','pasaje','psje','pje','camino','ruta','km','diagonal','diag','prolongacion','prol'];
const RURAL_KEYWORDS = ['km', 'fundo', 'parcela', 'hijuela', 'lote', 'camino', 'ruta', 'caserio', 'aldea', 'sector'];

function cleanText(str) {
  if (!str) return '';
  return nd(str).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function getSemanticKey(calleStr) {
  let cleaned = cleanText(calleStr);
  const stopWords = [' de ', ' la ', ' el ', ' los ', ' las ', ' y ', ' en ', ' del ', ' al '];
  stopWords.forEach(sw => { cleaned = cleaned.split(sw).join(' '); });

  const descriptoresUrbanos = ['poblacion ', 'pobl ', 'villa ', 'conjunto ', 'calle ', 'pasaje ', 'pje ', 'avenida ', 'avda ', 'av ', 'camino ', 'parcela ', 'hijuela ', 'loteo ', 'condominio '];
  descriptoresUrbanos.forEach(desc => { if (cleaned.startsWith(desc)) cleaned = cleaned.replace(desc, ''); });

  cleaned = cleaned.replace(/\bblock\s*/g, 'b').replace(/\bbl\s*/g, 'b').replace(/\bdepto\s*/g, 'd').replace(/\bdepartamento\s*/g, 'd').replace(/\bdp\s*/g, 'd');
  return cleaned.replace(/\s+/g, ' ').trim();
}

export function normDir(calle, num) {
  let s = nd(String(calle || '').toLowerCase().trim());
  s = s.replace(/[°#.,;:]/g, '').replace(new RegExp('^(' + PREFIXES.join('|') + ')[.\\s]+', 'i'), '').trim().replace(/\s+/g, ' ');

  let n = String(num || '').trim().replace(/[^0-9A-Za-z]/g, '').replace(/^0+(\d)/, '$1');

  // 🔥 REGEX INTELIGENTE: Solo extrae números si están al final (respeta "1 poniente")
  const numRegex = /\s+(?:n[°º]?|#|nro|numero|num)?\s*(\d+[a-z]?)\s*$/i;
  const match = s.match(numRegex);

  if (match) {
    if (!n) n = match[1]; // Si la columna número venía vacía, usamos el extraído
    s = s.replace(numRegex, '').trim(); // Le quitamos el número a la calle
  }

  // Matamos la "basura" común en los números
  if (n.toLowerCase() === 'sn' || n === '0' || n === 's n') n = '';

  const semanticCalle = getSemanticKey(s);
  const semanticNum = getSemanticKey(n).replace(/^0+(\d)/, '$1');

  let clave = [semanticCalle, semanticNum].filter(Boolean).join(' ');
  if (!clave) clave = 'sin direccion';

  return { callNorm: s, numNorm: n, clave: clave };
}

export function preClassifyCluster(cluster) {
  const sample = cluster.rows[0];
  const calleLower = String(sample.calle || '').toLowerCase();

  const isRural = RURAL_KEYWORDS.some(kw => calleLower.includes(kw));

  if (isRural) {
    cluster.tipoPropuesto = 'RURAL';
    cluster.accionPropuesta = 'Cruzar con localidades';
  } else if (sample.callNorm && sample.numNorm) {
    cluster.tipoPropuesto = 'URBANO';
    cluster.accionPropuesta = 'Enviar a Nominatim';
  } else {
    cluster.tipoPropuesto = 'PENDIENTE';
  }
  return cluster;
}

export function suggestMerges(clustersObject) {
  const clusterKeys = Object.keys(clustersObject);
  const suggestions = [];
  const processed = new Set();

  for (let i = 0; i < clusterKeys.length; i++) {
    const keyA = clusterKeys[i];
    if (processed.has(keyA)) continue;

    for (let j = i + 1; j < clusterKeys.length; j++) {
      const keyB = clusterKeys[j];
      if (Math.abs(keyA.length - keyB.length) > 6) continue;

      const sim = getSimilarity(keyA, keyB);
      if (sim >= 80) {
        suggestions.push({
          source: keyA, target: keyB, score: Math.round(sim),
          rowsA: clustersObject[keyA].rows.length, rowsB: clustersObject[keyB].rows.length
        });
        processed.add(keyA);
        processed.add(keyB);
      }
    }
  }
  return suggestions.sort((a, b) => b.score - a.score);
}