#!/usr/bin/env python3
"""
build_sii_index.py — Preprocesador SII para Geocodificador Asistido v4.0
========================================================================
Lee uno o varios CSV del SII (por comuna/región), extrae solo las columnas
relevantes para geocodificación, normaliza las claves de búsqueda y genera
un archivo JSON comprimido (.json.gz) listo para cargar en el browser.

Uso:
    python build_sii_index.py <archivo_o_carpeta> [--output <salida.json.gz>]

Ejemplos:
    python build_sii_index.py araucania/
    python build_sii_index.py temuco.csv --output temuco_geo.json.gz
    python build_sii_index.py araucania/ --output araucania_geo.json.gz
"""

import csv
import gzip
import json
import os
import re
import sys
import argparse
import unicodedata
from pathlib import Path
from collections import defaultdict

# ═══════════════════════════════════════════════════════════════
# CONFIGURACIÓN
# ═══════════════════════════════════════════════════════════════

# Columnas mínimas necesarias del CSV SII
COL_DIR    = 'direccion_sii'   # "LOS COPIHUES 0412 "
COL_LAT    = 'lat'
COL_LON    = 'lon'
COL_COMUNA = 'nombreComuna'    # "ANGOL"
COL_CUT    = 'v'               # "9101" (código CUT de comuna, primera parte)
COL_DEST   = 'txt_cod_destino' # "H", "C", etc.
COL_ROL    = 'rol'             # identificador del predio (no datos sensibles)

# Prefijos de calle a normalizar
PREFIXES = [
    ('AVENIDA ', 'AV '), ('AVDA ', 'AV '), ('PASAJE ', 'PJ '),
    ('PSJE ', 'PJ '),    ('CAMINO ', 'CM '), ('CALLE ', ''),
    ('VILLA ', 'V '),    ('POBLACION ', 'POB '), ('POBL ', 'POB '),
]

# ═══════════════════════════════════════════════════════════════
# FUNCIONES DE NORMALIZACIÓN
# ═══════════════════════════════════════════════════════════════

def remove_accents(text: str) -> str:
    """Elimina tildes y diacríticos, conserva ñ→n."""
    nfkd = unicodedata.normalize('NFD', text)
    result = ''.join(c for c in nfkd if not unicodedata.combining(c))
    return result.replace('Ñ', 'N').replace('ñ', 'n')

def normalize_text(text: str) -> str:
    """Normalización canónica: mayúsculas, sin tildes, sin puntuación extra."""
    if not text:
        return ''
    t = remove_accents(text.strip().upper())
    t = re.sub(r'[°#.,;:\-]', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def expand_prefix(calle: str) -> str:
    """Expande/contrae prefijos para forma canónica."""
    for long_form, short_form in PREFIXES:
        if calle.startswith(long_form):
            return short_form + calle[len(long_form):]
    return calle

def split_direccion(direccion_raw: str):
    """
    Separa 'LOS COPIHUES 0412' en ('LOS COPIHUES', '412').
    Maneja casos como 'PJ 3 ORIENTE' (sin número final claro).
    Retorna (calle_norm, numero_norm, clave_busqueda).
    """
    d = normalize_text(direccion_raw)
    if not d:
        return None, None, None

    # Intentar separar: todo texto antes del último bloque numérico final
    # Ejemplos: "LOS COPIHUES 0412" → ("LOS COPIHUES", "412")
    #           "AV ALEMANIA 01234" → ("AV ALEMANIA", "1234")  
    #           "PJ 3 ORIENTE"      → ("PJ 3 ORIENTE", "")  ← sin número de dirección
    match = re.match(r'^(.*?)\s+0*(\d+)\s*$', d)
    if match:
        calle_raw = match.group(1).strip()
        numero    = match.group(2).lstrip('0') or '0'
    else:
        calle_raw = d
        numero    = ''

    calle = expand_prefix(calle_raw)
    
    # Clave de búsqueda: calle + número (sin espacios internos extra)
    clave = f"{calle} {numero}".strip() if numero else calle
    
    return calle, numero, clave

def make_search_key(calle: str, numero: str, comuna: str) -> str:
    """Clave compuesta para búsqueda exacta: 'CALLE|NUMERO|COMUNA'."""
    return f"{normalize_text(calle)}|{numero.lstrip('0') if numero else ''}|{normalize_text(comuna)}"

# ═══════════════════════════════════════════════════════════════
# PROCESAMIENTO DE ARCHIVOS
# ═══════════════════════════════════════════════════════════════

def process_csv(filepath: str, index: dict, stats: dict):
    """
    Lee un CSV del SII y agrega entradas al índice.
    El índice tiene estructura:
    {
      "clave_busqueda": {
        "lat": float, "lon": float,
        "dir": "CALLE NUMERO",    ← para mostrar al usuario
        "comuna": "NOMBRE",
        "cut": "9101",
        "dest": "H",              ← tipo destino
        "n": int                  ← cantidad de predios con esa dirección
      },
      ...
    }
    Para direcciones con múltiples predios (edificios/condominios),
    guardamos el centroide promedio.
    """
    print(f"  Procesando: {filepath}")
    
    # Acumulador para promediar coords de direcciones con múltiples predios
    accumulator = defaultdict(lambda: {'lats': [], 'lons': [], 'meta': None})
    
    rows_read = 0
    rows_ok   = 0
    rows_skip = 0

    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            reader = csv.DictReader(f)
            
            for row in reader:
                rows_read += 1
                
                try:
                    lat = float(row.get(COL_LAT, '') or 0)
                    lon = float(row.get(COL_LON, '') or 0)
                except ValueError:
                    rows_skip += 1
                    continue
                
                # Coordenada inválida o en el mar
                if not (-90 < lat < -17) or not (-75 < lon < -66):
                    rows_skip += 1
                    continue
                
                dir_raw = row.get(COL_DIR, '').strip()
                if not dir_raw:
                    rows_skip += 1
                    continue
                
                comuna  = normalize_text(row.get(COL_COMUNA, ''))
                cut     = str(row.get(COL_CUT, '')).split('|')[0].strip()[:4]  # "9101" → primeros 4 dígitos = código provincia/región
                dest    = str(row.get(COL_DEST, '')).strip().upper()
                
                calle, numero, clave_dir = split_direccion(dir_raw)
                if not clave_dir:
                    rows_skip += 1
                    continue
                
                full_key = make_search_key(calle, numero, comuna)
                
                acc = accumulator[full_key]
                acc['lats'].append(lat)
                acc['lons'].append(lon)
                if acc['meta'] is None:
                    acc['meta'] = {
                        'dir': clave_dir,
                        'comuna': comuna,
                        'cut': cut,
                        'dest': dest,
                    }
                rows_ok += 1

    except Exception as e:
        print(f"    ⚠ Error leyendo {filepath}: {e}")
        stats['errors'] += 1
        return

    # Volcar acumulador al índice principal (centroide si hay múltiples predios)
    for full_key, acc in accumulator.items():
        if not acc['lats']:
            continue
        
        n = len(acc['lats'])
        lat_c = round(sum(acc['lats']) / n, 7)
        lon_c = round(sum(acc['lons']) / n, 7)
        
        # Si ya existe la clave (de otro CSV de la misma región), promediar
        if full_key in index:
            existing = index[full_key]
            total = existing['n'] + n
            index[full_key]['lat'] = round((existing['lat'] * existing['n'] + lat_c * n) / total, 7)
            index[full_key]['lon'] = round((existing['lon'] * existing['n'] + lon_c * n) / total, 7)
            index[full_key]['n']   = total
        else:
            index[full_key] = {
                'lat':    lat_c,
                'lon':    lon_c,
                'dir':    acc['meta']['dir'],
                'comuna': acc['meta']['comuna'],
                'cut':    acc['meta']['cut'],
                'dest':   acc['meta']['dest'],
                'n':      n
            }

    stats['rows_read']  += rows_read
    stats['rows_ok']    += rows_ok
    stats['rows_skip']  += rows_skip
    print(f"    → {rows_ok:,} predios válidos / {rows_skip:,} descartados")

# ═══════════════════════════════════════════════════════════════
# ÍNDICE SECUNDARIO: POR CALLE (para búsqueda fuzzy)
# ═══════════════════════════════════════════════════════════════

def build_street_index(index: dict) -> dict:
    """
    Construye índice secundario: { "CALLE|COMUNA": [numeros...] }
    Permite al geocoder JS hacer búsqueda por calle cuando el número
    exacto no matchea (interpolación o número aproximado).
    """
    street_idx = defaultdict(list)
    for full_key in index.keys():
        parts = full_key.split('|')
        if len(parts) == 3:
            calle, numero, comuna = parts
            if numero:  # Solo calles con número tienen sentido para interpolar
                street_key = f"{calle}|{comuna}"
                try:
                    street_idx[street_key].append(int(numero))
                except ValueError:
                    pass
    
    # Ordenar números para interpolación eficiente
    return {k: sorted(set(v)) for k, v in street_idx.items()}

# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Preprocesador SII → JSON.GZ para Geocodificador')
    parser.add_argument('input',  help='Archivo CSV o carpeta con CSVs del SII')
    parser.add_argument('--output', '-o', default=None, help='Archivo de salida (.json.gz)')
    args = parser.parse_args()

    input_path = Path(args.input)
    
    # Determinar archivos a procesar
    if input_path.is_dir():
        csv_files = sorted(input_path.glob('*.csv'))
        if not csv_files:
            print(f"❌ No se encontraron archivos .csv en {input_path}")
            sys.exit(1)
        output_name = args.output or f"{input_path.name}_geo.json.gz"
    elif input_path.is_file():
        csv_files = [input_path]
        output_name = args.output or input_path.stem + '_geo.json.gz'
    else:
        print(f"❌ No existe: {input_path}")
        sys.exit(1)

    print(f"\n🔨 Geocodificador SII — Preprocesador v4.0")
    print(f"   Archivos a procesar: {len(csv_files)}")
    print(f"   Salida: {output_name}\n")

    index = {}
    stats = {'rows_read': 0, 'rows_ok': 0, 'rows_skip': 0, 'errors': 0}

    for csv_file in csv_files:
        process_csv(str(csv_file), index, stats)

    print(f"\n📊 Construyendo índice secundario de calles...")
    street_index = build_street_index(index)

    # Estructura final del JSON
    output = {
        'version':      '4.0',
        'generated':    __import__('datetime').datetime.now().isoformat(),
        'total_keys':   len(index),
        'total_streets': len(street_index),
        'index':        index,       # clave exacta → coords
        'streets':      street_index # calle+comuna → [números]
    }

    print(f"   Claves exactas:  {len(index):,}")
    print(f"   Calles indexadas: {len(street_index):,}")
    print(f"\n💾 Comprimiendo y guardando en {output_name}...")

    with gzip.open(output_name, 'wt', encoding='utf-8', compresslevel=9) as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

    file_size_mb = os.path.getsize(output_name) / 1_048_576
    print(f"   Tamaño final: {file_size_mb:.1f} MB")
    print(f"\n✅ Listo.")
    print(f"   Total leídos:    {stats['rows_read']:,}")
    print(f"   Total válidos:   {stats['rows_ok']:,}")
    print(f"   Descartados:     {stats['rows_skip']:,}")
    if stats['errors']:
        print(f"   Archivos con error: {stats['errors']}")

if __name__ == '__main__':
    main()
