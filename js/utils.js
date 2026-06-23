// utils.js - Funciones de ayuda y algoritmos genéricos

// Escapar HTML para evitar inyección (XSS) al renderizar en el DOM
export const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Escapar comillas y backslashes para inyectar strings en eventos (ej: onclick="abrir('O\'Higgins')")
export const ej = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// Generar un ID seguro para el DOM a partir de un string (reemplazando caracteres no alfanuméricos)
export const sid = (s) => String(s ?? '').replace(/[^a-zA-Z0-9]/g, c => '_' + c.charCodeAt(0) + '_');

// Normalizar texto: quitar tildes, diacríticos y reemplazar la ñ por n
export const nd = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n').replace(/Ñ/g, 'N');

// Algoritmo de distancia de Levenshtein (Fuzzy Matching)
export function levenshtein(a, b) {
  const matrix = [];
  let i, j;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  for (i = 0; i <= b.length; i++) { matrix[i] = [i]; }
  for (j = 0; j <= a.length; j++) { matrix[0][j] = j; }

  for (i = 1; i <= b.length; i++) {
    for (j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // sustitución
          matrix[i][j - 1] + 1,     // inserción
          matrix[i - 1][j] + 1      // borrado
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// Calcula el % de similitud basado en la longitud de las cadenas
export function getSimilarity(a, b) {
  const distance = levenshtein(a, b);
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 100; // Ambos strings están vacíos
  return ((longest - distance) / longest) * 100;
}