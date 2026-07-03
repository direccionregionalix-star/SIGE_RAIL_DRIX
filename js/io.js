// io.js - Módulo de Input/Output (Exportaciones)
import { DOMINIOS, ESRI_FIELDS } from './constants.js';
import { resolveFinalCoords } from './coords.js';

export function buildMainExport(rawData, origFileName) {
  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.json_to_sheet(rawData);
  const cols = Object.keys(rawData[0] || {});
  ws['!cols'] = cols.map(() => ({ wch: 20 }));
  window.XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  window.XLSX.writeFile(wb, (origFileName || 'geocodificado') + '_estado.xlsx');
}

// Encuentra el RUT/RUN sin importar mayúsculas o nombre exacto de columna
function extractRun(rawRow) {
  if (!rawRow) return null;
  const keys = Object.keys(rawRow);
  const rutKey = keys.find(k => ['run', 'rut'].some(alias => k.toLowerCase().includes(alias)));
  if (rutKey && rawRow[rutKey]) {
    const match = String(rawRow[rutKey]).match(/\d+/);
    return match ? Number(match[0]) : null;
  }
  return null;
}

// Lee un campo de dirección tolerando mayúsculas (calle/CALLE)
function field(rawRow, name) {
  if (!rawRow) return null;
  const v = rawRow[name] ?? rawRow[name.toUpperCase()] ?? rawRow[name.charAt(0).toUpperCase() + name.slice(1)];
  const s = String(v ?? '').trim();
  return s || null;
}

// Llena el cuadro de RUNs en la interfaz
function updateRunListUI(runList) {
  const area = document.getElementById('run-list-area');
  if (area) {
    area.value = runList.length > 0
      ? runList.join(', ')
      : "⚠️ Archivo generado, pero no se detectaron columnas con el nombre 'RUN' o 'RUT'.";
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTACIÓN DE RESPALDO (GUARDAR PARTIDA CON PROGRESO)
// ═══════════════════════════════════════════════════════════════
export function buildBackupExport(clusters, rawData, localidades, origFileName) {
  setTimeout(() => {
    let exportData = JSON.parse(JSON.stringify(rawData));
    const rawById = new Map(rawData.map((row, i) => [i, row]));

    Object.values(clusters).forEach(c => {
      c.rows.forEach(r => {
        const fila = exportData[r.id];
        const rawRow = rawById.get(r.id) || {};
        if (fila) {
          const { lat, lon, tipo } = resolveFinalCoords(r, c, rawRow);
          fila.tipo_geo = tipo;
          fila.latitud = lat;
          fila.longitud = lon;
          if (r.metodo || c.metodo) fila.metodo = r.metodo || c.metodo;
        }
      });
    });

    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.json_to_sheet(exportData);
    window.XLSX.utils.book_append_sheet(wb, ws, 'Progreso_Actualizado');

    if (localidades && localidades.length) {
      const locsNuevas = localidades.filter(l => !l.codComuna || l.origen === 'manual' || l.isNew);
      if (locsNuevas.length > 0) {
        const wsl = window.XLSX.utils.json_to_sheet(locsNuevas.map(l => ({
          nombre: l.nombre, comuna: l.comuna, latitud: l.lat, longitud: l.lon, origen: l.origen || 'Agregada Manual'
        })));
        window.XLSX.utils.book_append_sheet(wb, wsl, 'Nuevas_Localidades');
      }
    }

    const baseName = origFileName ? origFileName.split('.')[0] : 'Proyecto';
    window.XLSX.writeFile(wb, `${baseName}_RESPALDO.xlsx`);
  }, 150);
}

// ═══════════════════════════════════════════════════════════════
// EXPORTACIÓN DE MAESTRO DE LOCALIDADES
// ═══════════════════════════════════════════════════════════════
export function buildLocsExport(localidades, origFileName) {
  if (!localidades || localidades.length === 0) {
    alert("No hay localidades en memoria para exportar.");
    return;
  }
  const exportData = localidades.map(l => {
    let fila = { ...l };
    fila['Nombre'] = l.nombre; fila['Comuna'] = l.comuna;
    if (l.codComuna) fila['CUT'] = l.codComuna;
    fila['Latitud'] = l.lat; fila['Longitud'] = l.lon; fila['Origen'] = l.origen || 'oficial';
    delete fila.nombre; delete fila.comuna; delete fila.lat; delete fila.lon;
    delete fila.origen; delete fila.codComuna; delete fila.isNew;
    return fila;
  });
  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.json_to_sheet(exportData);
  ws['!cols'] = [{wch: 25}, {wch: 20}, {wch: 10}, {wch: 15}, {wch: 15}, {wch: 15}];
  window.XLSX.utils.book_append_sheet(wb, ws, "Maestro_Localidades");
  const baseName = origFileName ? origFileName.split('.')[0] : 'Proyecto';
  window.XLSX.writeFile(wb, `${baseName}_Localidades_Actualizado.xlsx`);
}

// ═══════════════════════════════════════════════════════════════
// EXPORTACIÓN A ESRI JSON (incluye campos de dirección para QA)
// ═══════════════════════════════════════════════════════════════
export function buildGeoJSONExport(clusters, rawData, origFileName) {
  setTimeout(() => {
    let features = [];
    let runList = [];

    Object.values(clusters).forEach(c => {
      c.rows.forEach(r => {
        const rawRow = rawData[r.id] || r;
        const { lat, lon, tipo } = resolveFinalCoords(r, c, rawRow);

        const runValue = extractRun(rawRow);
        if (runValue) runList.push(runValue);

        let feature = {
          attributes: {
            run:         runValue,
            tipo_geo_id: DOMINIOS[tipo] || null,
            latitud:     lat,
            longitud:    lon,
            calle:       field(rawRow, 'calle'),
            numero:      field(rawRow, 'numero'),
            localidad:   field(rawRow, 'localidad'),
            resto:       field(rawRow, 'resto'),
          }
        };

        if (lon !== null && !isNaN(lon) && lat !== null && !isNaN(lat)) {
          feature.geometry = { x: lon, y: lat };
        }
        features.push(feature);
      });
    });

    const baseName = origFileName ? origFileName.split('.')[0] : 'Export';
    const esriJson = {
      geometryType: "esriGeometryPoint",
      spatialReference: { wkid: 4326 },
      fields: ESRI_FIELDS,
      features: features
    };

    const blob = new Blob([JSON.stringify(esriJson)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}_Esri.json`;
    a.click();
    URL.revokeObjectURL(url);

    updateRunListUI(runList);
  }, 150);
}

// ═══════════════════════════════════════════════════════════════
// EXPORTADOR MINIMALISTA PARA APPEND
// ═══════════════════════════════════════════════════════════════
export function buildAppendExport(clusters, rawData, origFileName) {
  setTimeout(() => {
    let exportData = [];
    let runList = [];

    Object.values(clusters).forEach(c => {
      c.rows.forEach(r => {
        const rawRow = rawData[r.id] || r;
        const { lat, lon, tipo } = resolveFinalCoords(r, c, rawRow);

        const runValue = extractRun(rawRow);
        if (runValue) runList.push(runValue);

        exportData.push({
          run:         runValue,
          tipo_geo_id: DOMINIOS[tipo] || null,
          latitud:     lat,
          longitud:    lon
        });
      });
    });

    if (exportData.length === 0) {
      alert("No hay registros para exportar en el Excel.");
      return;
    }

    const baseName = origFileName ? origFileName.split('.')[0] : 'Export';
    const ws = window.XLSX.utils.json_to_sheet(exportData);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Append_Data");
    window.XLSX.writeFile(wb, `${baseName}_APPEND.xlsx`);

    updateRunListUI(runList);
  }, 150);
}

// ═══════════════════════════════════════════════════════════════
// EXPORTACIÓN DE ENTREGA PARA QA (SIGEA) — v4.2
// ═══════════════════════════════════════════════════════════════
// Genera DOS archivos en un clic:
//   1. {recinto}_ENTREGA.geojson → GeoJSON estándar (FeatureCollection de
//      puntos WGS84). ArcGIS Pro lo abre DIRECTO como capa, sin toolbox ni
//      creación manual de XY. Solo incluye features con coordenada válida.
//   2. {recinto}_ENTREGA.xlsx → tabla plana que SIGEA consume por run.
//      Incluye TODAS las filas (también las sin coordenada, para trazar
//      pendientes).
// Llave de match: run. Respeta la regla NO GEO vía resolveFinalCoords.
export function buildEntregaQA(clusters, rawData, origFileName) {
  setTimeout(() => {
    let exportData = [];      // para el Excel (todas las filas)
    let features   = [];      // para el GeoJSON (solo con coordenada válida)
    let sinRun = 0, sinCoord = 0;

    Object.values(clusters).forEach(c => {
      c.rows.forEach(r => {
        const rawRow = rawData[r.id] || r;
        const { lat, lon, tipo } = resolveFinalCoords(r, c, rawRow);
        const runValue = extractRun(rawRow);
        if (!runValue) sinRun++;

        const props = {
          run:         runValue,
          calle:       field(rawRow, 'calle'),
          numero:      field(rawRow, 'numero'),
          localidad:   field(rawRow, 'localidad'),
          resto:       field(rawRow, 'resto'),
          tipo_geo_id: DOMINIOS[tipo] || null,
          tipo_geo:    tipo || null,
          latitud:     lat,
          longitud:    lon,
          metodo:      r.metodo || c.metodo || null
        };
        exportData.push(props);

        // GeoJSON: solo puntos con coordenada válida (ArcGIS rechaza geom nula)
        const validLat = lat !== null && !isNaN(lat) && lat >= -90 && lat <= 90;
        const validLon = lon !== null && !isNaN(lon) && lon >= -180 && lon <= 180;
        if (validLat && validLon) {
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] }, // GeoJSON = [lon, lat]
            properties: props
          });
        } else {
          sinCoord++;
        }
      });
    });

    if (exportData.length === 0) {
      alert("No hay registros para exportar.");
      return;
    }

    const baseName = origFileName ? origFileName.split('.')[0] : 'Entrega';

    // ── Archivo 1: GeoJSON estándar (WGS84 / EPSG:4326) ──────────
    const geojson = {
      type: 'FeatureCollection',
      name: `${baseName}_ENTREGA`,
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: features
    };
    const gjBlob = new Blob([JSON.stringify(geojson)], { type: 'application/geo+json' });
    const gjUrl  = URL.createObjectURL(gjBlob);
    const gjA    = document.createElement('a');
    gjA.href = gjUrl; gjA.download = `${baseName}_ENTREGA.geojson`; gjA.click();
    URL.revokeObjectURL(gjUrl);

    // ── Archivo 2: Excel plano para SIGEA (todas las filas) ──────
    exportData.sort((a, b) => (a.run || 0) - (b.run || 0));
    const ws = window.XLSX.utils.json_to_sheet(exportData);
    ws['!cols'] = [
      { wch: 12 }, { wch: 28 }, { wch: 10 }, { wch: 20 },
      { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 26 }
    ];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Entrega_QA");
    // Pequeño delay para que las dos descargas no colisionen en el navegador
    setTimeout(() => window.XLSX.writeFile(wb, `${baseName}_ENTREGA.xlsx`), 400);

    // ── Resumen al usuario ───────────────────────────────────────
    const usuario = (typeof localStorage !== 'undefined' && localStorage.getItem('sige_reporter_user')) || '{usuario}';
    let msg = `✅ Entrega generada:\n\n` +
              `📍 ${baseName}_ENTREGA.geojson — ${features.length} puntos (ArcGIS Pro directo)\n` +
              `📊 ${baseName}_ENTREGA.xlsx — ${exportData.length} filas (SIGEA)\n` +
              `\n📁 GUÁRDALOS EN:\ndev_007\\funcionarios\\${usuario}\\\n(tu carpeta de OneDrive — el supervisor los busca ahí)\n`;
    if (sinCoord > 0) msg += `\n⚠️ ${sinCoord} registro(s) sin coordenada quedaron fuera del GeoJSON (sí están en el Excel como pendientes).`;
    if (sinRun > 0)   msg += `\n⚠️ ${sinRun} registro(s) sin RUN detectable — SIGEA no podrá emparejarlos.`;
    alert(msg);
  }, 150);
}
