// io.js - Módulo de Input/Output (Exportaciones)

export function buildMainExport(rawData, origFileName) {
  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.json_to_sheet(rawData);
  const cols = Object.keys(rawData[0] || {});
  ws['!cols'] = cols.map(() => ({ wch: 20 }));
  window.XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  window.XLSX.writeFile(wb, (origFileName || 'geocodificado') + '_estado.xlsx');
}

// Función auxiliar inteligente para encontrar el RUT/RUN sin importar mayúsculas o nombre exacto
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

// Función compartida para llenar el cuadro de texto en la interfaz
function updateRunListUI(runList) {
  const area = document.getElementById('run-list-area');
  if (area) {
    if (runList.length > 0) {
      area.value = runList.join(', ');
    } else {
      area.value = "⚠️ Archivo generado, pero no se detectaron columnas con el nombre 'RUN' o 'RUT'.";
    }
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
          const tipoFinal = r.tipo || c.tipo;
          fila.tipo_geo = tipoFinal;
          const origLat = parseFloat(rawRow.latitud || rawRow.geo_lat) || null;
          const origLon = parseFloat(rawRow.longitud || rawRow.geo_lon) || null;

          if (tipoFinal === 'NO GEO') {
            fila.latitud = origLat; fila.longitud = origLon;
          } else {
            fila.latitud = r.latFinal ? parseFloat(r.latFinal) : origLat;
            fila.longitud = r.lonFinal ? parseFloat(r.lonFinal) : origLon;
          }
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
// EXPORTACIÓN A ESRI JSON (AHORA POBLA EL DEFINITION QUERY)
// ═══════════════════════════════════════════════════════════════
export function buildGeoJSONExport(clusters, rawData, origFileName) {
  setTimeout(() => {
    let features = [];
    let runList = []; // 🔥 Recolector de RUNs
    const dominios = { 'LOCALIDAD': 1, 'RURAL': 1, 'EXACTO': 2, 'CALLE': 3, 'NO GEO': 4 };

    Object.values(clusters).forEach(c => {
      c.rows.forEach(r => {
        const rawRow = rawData[r.id] || r; 
        const tipoFinal = r.tipo || c.tipo; 
        let finalLat, finalLon;

        if (tipoFinal === 'NO GEO') {
          finalLat = parseFloat(rawRow.latitud || rawRow.geo_lat) || null;
          finalLon = parseFloat(rawRow.longitud || rawRow.geo_lon) || null;
        } else {
          finalLat = r.latFinal ? parseFloat(r.latFinal) : (parseFloat(rawRow.latitud || rawRow.geo_lat) || null);
          finalLon = r.lonFinal ? parseFloat(r.lonFinal) : (parseFloat(rawRow.longitud || rawRow.geo_lon) || null);
        }

        const runValue = extractRun(rawRow);
        if (runValue) runList.push(runValue); // Agregamos a la lista global

        let feature = {
          attributes: {
            run:         runValue,
            tipo_geo_id: dominios[tipoFinal] || null,
            latitud:     finalLat,
            longitud:    finalLon,
            // Campos de dirección para QA por el supervisor
            calle:       String(rawRow.calle    || rawRow.CALLE    || '').trim() || null,
            numero:      String(rawRow.numero   || rawRow.NUMERO   || '').trim() || null,
            localidad:   String(rawRow.localidad|| rawRow.LOCALIDAD|| '').trim() || null,
            resto:       String(rawRow.resto    || rawRow.RESTO    || '').trim() || null,
          }
        };

        if (finalLon !== null && !isNaN(finalLon) && finalLat !== null && !isNaN(finalLat)) {
          feature.geometry = { x: finalLon, y: finalLat };
        }
        features.push(feature);
      });
    });

    const baseName = origFileName ? origFileName.split('.')[0] : 'Export';
    const esriJson = {
      geometryType: "esriGeometryPoint",
      spatialReference: { wkid: 4326 },
      fields: [
        { name: "run",         type: "esriFieldTypeInteger", alias: "run" },
        { name: "tipo_geo_id", type: "esriFieldTypeInteger", alias: "tipo_geo_id" },
        { name: "latitud",     type: "esriFieldTypeDouble",  alias: "latitud" },
        { name: "longitud",    type: "esriFieldTypeDouble",  alias: "longitud" },
        { name: "calle",       type: "esriFieldTypeString",  alias: "calle",     length: 150 },
        { name: "numero",      type: "esriFieldTypeString",  alias: "numero",    length: 20  },
        { name: "localidad",   type: "esriFieldTypeString",  alias: "localidad", length: 100 },
        { name: "resto",       type: "esriFieldTypeString",  alias: "resto",     length: 150 }
      ],
      features: features
    };

    const blob = new Blob([JSON.stringify(esriJson)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}_Esri.json`; 
    a.click();
    URL.revokeObjectURL(url);

    updateRunListUI(runList); // 🔥 Actualizamos la cajita en pantalla
  }, 150); 
}

// ═══════════════════════════════════════════════════════════════
// EXPORTADOR MINIMALISTA PARA APPEND (MANTIENE LA FUNCIÓN)
// ═══════════════════════════════════════════════════════════════
export function buildAppendExport(clusters, rawData, origFileName) {
  setTimeout(() => {
    let exportData = [];
    let runList = []; 
    const dominios = { 'LOCALIDAD': 1, 'RURAL': 1, 'EXACTO': 2, 'CALLE': 3, 'NO GEO': 4 };

    Object.values(clusters).forEach(c => {
      c.rows.forEach(r => {
        const rawRow = rawData[r.id] || r;
        const tipoFinal = r.tipo || c.tipo;
        let finalLat, finalLon;
        const origLat = parseFloat(rawRow.latitud || rawRow.geo_lat) || null;
        const origLon = parseFloat(rawRow.longitud || rawRow.geo_lon) || null;

        if (tipoFinal === 'NO GEO') {
          finalLat = origLat; finalLon = origLon;
        } else {
          finalLat = r.latFinal ? parseFloat(r.latFinal) : origLat;
          finalLon = r.lonFinal ? parseFloat(r.lonFinal) : origLon;
        }

        const runValue = extractRun(rawRow);
        if (runValue) runList.push(runValue);

        exportData.push({
          run: runValue,
          tipo_geo_id: dominios[tipoFinal] || null,
          latitud: finalLat,
          longitud: finalLon
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

    updateRunListUI(runList); // 🔥 Actualizamos la cajita en pantalla
  }, 150);
}