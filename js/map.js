// map.js - Módulo de Mapa (Leaflet)
import { h } from './utils.js';
import { state } from './store.js';

// ═══════════════════════════════════════════════════════════════
// VARIABLES GLOBALES
// ═══════════════════════════════════════════════════════════════
let map = null;
let baseGrp = null;
let tentMark = null;
let confMark = null;

// Variables para manejar las capas del SERVEL
let refLayer = null;          
let recintoDotsLayer = null;  
let activeRecintoMark = null; 

let nombresRecintos = {}; 

export let lastTentLat = null;
export let lastTentLon = null;
let onCoordChange = null;

export function initMap(containerId, geojsonData, recintosPointsData = null, coordChangeCallback) {
  onCoordChange = coordChangeCallback;

  if (map) {
    map.invalidateSize();
    return;
  }

  // Aumentamos el zoom máximo de la vista a 22
  map = L.map(containerId, { zoomControl: true, maxZoom: 22 }).setView([-38.7, -72.6], 10);
  
  // 🔥 TRUCO MAGISTRAL: maxNativeZoom le dice que las imágenes de OSM solo llegan al 19, 
  // pero maxZoom: 22 le permite estirarlas como lupa hasta acercarse al pavimento.
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
    attribution: '© OSM',
    maxNativeZoom: 19,
    maxZoom: 22
  }).addTo(map);
  
  baseGrp = L.layerGroup().addTo(map);

  map.on('click', e => {
    placeTentative(e.latlng.lat, e.latlng.lng);
  });

  if (geojsonData) renderRefLayer(geojsonData, recintosPointsData);
  
  setTimeout(() => map.invalidateSize(), 200);
}

// ═══════════════════════════════════════════════════════════════
// RENDERIZAR CAPAS Y ARMAR DICCIONARIO
// ═══════════════════════════════════════════════════════════════
export function renderRefLayer(geojsonData, recintosPointsData = null) {
  if (!map) return; 

  if (recintosPointsData) {
    nombresRecintos = {};
    recintosPointsData.features.forEach(f => {
      if (f.properties) {
        const keys = Object.keys(f.properties);
        const codKey = keys.find(k => k.toLowerCase().includes('cod'));
        const nomKey = keys.find(k => k.toLowerCase().includes('recinto') || k.toLowerCase().includes('nom') || k.toLowerCase().includes('glosa'));
        
        if (codKey && nomKey && f.properties[codKey]) {
          const rawCod = String(f.properties[codKey]).match(/\d+/);
          if (rawCod) {
            const codStr = rawCod[0].padStart(5, '0');
            nombresRecintos[codStr] = f.properties[nomKey];
          }
        }
      }
    });
  }

  const activeCuts = new Set();
  state.records.forEach(r => {
    let val = r.codComuna || r.comuna;
    if (val) {
      let numeros = String(val).match(/\d+/); 
      if (numeros) activeCuts.add(numeros[0].padStart(5, '0'));
    }
  });

  if (refLayer) map.removeLayer(refLayer);
  if (recintoDotsLayer) map.removeLayer(recintoDotsLayer); 

  let activeBounds = L.latLngBounds();

  refLayer = L.geoJSON(geojsonData, {
    style: function(feature) {
      let featureCut = null;
      if (feature.properties) {
        const keys = Object.keys(feature.properties);
        const cutKey = keys.find(k => ['iso_comuna', 'cod_comuna', 'cut_comuna', 'cut'].some(a => k.toLowerCase().includes(a)));
        if (cutKey && feature.properties[cutKey]) {
          let numerosGeo = String(feature.properties[cutKey]).match(/\d+/);
          if (numerosGeo) featureCut = numerosGeo[0].padStart(5, '0');
        }
      }
      const isActive = featureCut && activeCuts.has(featureCut);
      return {
        color: isActive ? "#16a34a" : "#94a3b8", 
        weight: isActive ? 2 : 1,
        fillColor: isActive ? "#22c55e" : "transparent",
        fillOpacity: isActive ? 0.12 : 0,
        dashArray: isActive ? "" : "4 4"
      };
    },
    onEachFeature: function(feature, layer) {
      if (feature.properties) {
        const keys = Object.keys(feature.properties);
        
        const cutKey = keys.find(k => ['iso_comuna', 'cod_comuna', 'cut'].some(a => k.toLowerCase().includes(a)));
        if (cutKey && feature.properties[cutKey]) {
          const codComuna = String(feature.properties[cutKey]).match(/\d+/)?.[0].padStart(5, '0');
          if (codComuna && activeCuts.has(codComuna) && layer.getBounds) {
            activeBounds.extend(layer.getBounds());
          }
        }

        const codeKey = keys.find(k => k.toLowerCase().includes('cod') && k.toLowerCase().includes('recint'));
        const nameKey = keys.find(k => k.toLowerCase() === 'recinto' || k.toLowerCase() === 'nombre');
        
        const rawCod = codeKey && feature.properties[codeKey] ? String(feature.properties[codeKey]).match(/\d+/) : null;
        const codeVal = rawCod ? rawCod[0].padStart(5, '0') : null;
        const nameVal = nameKey ? feature.properties[nameKey] : null;

        const nombreReal = nameVal || (codeVal ? nombresRecintos[codeVal] : null) || "Recinto Electoral";

        const tooltipText = `
          <div style="text-align:center; padding:2px;">
            <strong style="text-transform:uppercase; color:#185FA5; font-size:13px;">${nombreReal}</strong>
            <div style="font-size:11px; color:#666; margin-top:3px;">Cod: ${codeVal || '---'}</div>
          </div>`;

        layer.bindTooltip(tooltipText, { sticky: true, opacity: 0.95 });
      }
    }
  }).addTo(map);

  if (recintosPointsData) {
    recintoDotsLayer = L.geoJSON(recintosPointsData);
  }

  if (activeBounds.isValid()) {
    map.fitBounds(activeBounds, { padding: [20, 20] });
  } else if (refLayer.getBounds().isValid()) {
    map.fitBounds(refLayer.getBounds());
  }
}

// ═══════════════════════════════════════════════════════════════
// INVOCAR EL ÚNICO RECINTO RELEVANTE
// ═══════════════════════════════════════════════════════════════
export function highlightRecinto(codRecint) {
  if (!recintoDotsLayer || !codRecint) {
    if (activeRecintoMark) { map.removeLayer(activeRecintoMark); activeRecintoMark = null; }
    return;
  }

  if (activeRecintoMark) map.removeLayer(activeRecintoMark);

  const targetCodRaw = String(codRecint).match(/\d+/);
  if (!targetCodRaw) return;
  const targetCod = targetCodRaw[0].padStart(5, '0');
  
  recintoDotsLayer.eachLayer(layer => {
    if (layer.feature && layer.feature.properties) {
      const keys = Object.keys(layer.feature.properties);
      const recintKey = keys.find(k => k.toLowerCase().includes('cod'));
      
      if (recintKey) {
        const layerCodRaw = String(layer.feature.properties[recintKey]).match(/\d+/);
        if (layerCodRaw && layerCodRaw[0].padStart(5, '0') === targetCod) {
          
          const nombreReal = nombresRecintos[targetCod] || 'Recinto ' + targetCod;

          activeRecintoMark = L.marker(layer.getLatLng(), {
            icon: L.divIcon({
              html: `<div class="pulse-marker"></div>`,
              className: ''
            })
          }).addTo(map);

          activeRecintoMark.bindTooltip(`<b>${nombreReal}</b><br><small>Código: ${targetCod}</small>`, {
            direction: 'top', offset: [0, -10]
          });
        }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// FUNCIONES BASE DEL MAPA
// ═══════════════════════════════════════════════════════════════
export function placeTentative(lat, lon, moveView = false) {
  if (tentMark) map.removeLayer(tentMark);
  lastTentLat = lat;
  lastTentLon = lon;
  
  tentMark = L.marker([lat, lon], {
    draggable: true,
    icon: L.divIcon({ html: '<div style="width:14px;height:14px;background:#185FA5;border:2.5px solid #fff;border-radius:50%;box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>', className: '' })
  }).addTo(map);

  tentMark.on('dragend', e => {
    const p = e.target.getLatLng();
    lastTentLat = p.lat;
    lastTentLon = p.lng;
    if (onCoordChange) onCoordChange(p.lat, p.lng);
  });

  const btnConf = document.getElementById('btn-conf');
  const btnClr = document.getElementById('btn-clr');
  const cstat = document.getElementById('cstat');
  
  if (btnConf) btnConf.disabled = false;
  if (btnClr) btnClr.disabled = false;
  if (cstat) cstat.innerHTML = `<span style="color:#16a34a;font-weight:bold;">📍 Coordenada lista para confirmar</span>`;

  if (onCoordChange) onCoordChange(lat, lon);
  if (moveView) map.setView([lat, lon], 17); // Aumenté el zoom inicial un poco para que caiga más cerca
}

export function loadClusterMap(latFinal, lonFinal, metodo, rows) {
  if (!map) return;
  baseGrp.clearLayers();
  
  if (tentMark) { map.removeLayer(tentMark); tentMark = null; }
  if (confMark) { map.removeLayer(confMark); confMark = null; }
  
  const bounds = [];

  if (activeRecintoMark) { map.removeLayer(activeRecintoMark); activeRecintoMark = null; }

  if (latFinal) {
    confMark = L.marker([latFinal, lonFinal], {
      icon: L.divIcon({ html: '<div style="width:16px;height:16px;background:#3B6D11;border:2.5px solid #fff;border-radius:50%;box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>', className: '' })
    }).addTo(map).bindTooltip(metodo || 'Confirmado');
    bounds.push([latFinal, lonFinal]);
  }

  rows.filter(r => r.latBase && r.lonBase).forEach(r => {
    L.circleMarker([r.latBase, r.lonBase], { 
      radius: 5, color: '#64748b', fillColor: '#64748b', fillOpacity: .5, weight: 1.5 
    }).addTo(baseGrp).bindPopup(`<b>${h(r.original)}</b><br><small>${h(r.localidad)} · ${h(r.comuna)}</small>`);
    bounds.push([r.latBase, r.lonBase]);
  });
  
  if (bounds.length) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 18 });
  setTimeout(() => map.invalidateSize(), 80);
}

export function getTentativeCoords() {
  return tentMark ? tentMark.getLatLng() : null;
}

export function resizeMap() {
  if (map) map.invalidateSize();
}

export function updateStreetView(lat, lon, apiKey) {
  const wrap = document.getElementById('sv-wrap');
  const mapWrap = document.querySelector('.map-wrap'); // Contenedor del mapa principal
  if (!wrap) return;
  
  // Si no hay API Key, destruimos el panel visualmente y el mapa toma el 100%
  if (!apiKey || apiKey.trim() === '') {
    wrap.style.display = 'none';
    if (mapWrap) mapWrap.style.flex = '1';
    resizeMap(); // Forzamos a Leaflet a re-dibujar
    return;
  }

  // Si hay API Key, lo mostramos
  wrap.style.display = 'flex';
  if (mapWrap) mapWrap.style.flex = '1';

  if (!lat || !lon) {
    wrap.innerHTML = `<div style="font-size:24px; opacity:0.4; margin-bottom:8px;">📍</div><span style="font-size:12px; color:var(--tx3)">Sin coordenadas para mostrar.<br>Pon un pin en el mapa superior.</span>`;
    return;
  }

  wrap.innerHTML = `<iframe width="100%" height="100%" frameborder="0" style="border:0" src="https://www.google.com/maps/embed/v1/streetview?key=${apiKey}&location=${lat},${lon}&heading=0&pitch=0&fov=90" allowfullscreen></iframe>`;
}