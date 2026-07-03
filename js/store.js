// store.js - Manejo del Estado Global (Single Source of Truth)

export const state = {
  // 1. Datos Principales (Main Excel)
  rawData: [],        // JSON crudo del Excel principal
  colMap: {},         // Relación de columnas { calle: 'Nombre_Calle', ... }
  records: [],        // Arreglo de registros normalizados (1 a 1 con rawData)
  clusters: {},       // Objeto con direcciones agrupadas por clave única
  origFileName: '',   // Nombre del archivo Excel principal sin extensión

  // 2. Datos de Localidades (Rural Excel)
  localidades: [],    // Arreglo final de localidades listas para usar
  rawLocRows: [],     // JSON crudo del Excel de localidades
  locColMap: {},      // Mapeo de columnas detectado/asignado
  origLocData: [],    // Respaldo de los datos originales para no perder info al exportar
  locMapped: false,   // Flag para saber si ya se confirmó el mapeo
  locFileName: '',    // Nombre del archivo Excel de localidades

  // 3. Capas GIS
  referenceGeoJSON: null,   // Objeto parseado del GeoJSON de fondo (polígonos)
  recintosPointsData: null  // Objeto parseado del GeoJSON de puntos (recintos)
};
