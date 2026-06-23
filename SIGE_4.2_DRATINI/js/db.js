// db.js - Escudo Anti-Desastres (Autoguardado con IndexedDB)

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('GeoAsistidoDB', 1);
    
    // Si es la primera vez que se abre, creamos el "almacén"
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('sesion');
    };
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSession(stateData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sesion', 'readwrite');
    // Guardamos todo el objeto state bajo la llave 'current'
    tx.objectStore('sesion').put(stateData, 'current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadSession() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sesion', 'readonly');
    const req = tx.objectStore('sesion').get('current');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearSession() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sesion', 'readwrite');
    tx.objectStore('sesion').delete('current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}