// ui.js - Manejo del DOM, Experiencia de Usuario (UX) y Animaciones

// ═══════════════════════════════════════════════════════════════
// 1. NAVEGACIÓN Y PESTAÑAS (TABS)
// ═══════════════════════════════════════════════════════════════
export function stab(event, targetId) {
    const tabContainer = event.currentTarget.parentElement;
    const allTabs = tabContainer.querySelectorAll('.tab');
    allTabs.forEach(t => t.classList.remove('on'));
  
    const stepContainer = tabContainer.parentElement;
    const allContents = stepContainer.querySelectorAll('.tc');
    allContents.forEach(c => c.classList.remove('on'));
  
    event.currentTarget.classList.add('on');
    const targetContent = document.getElementById(targetId);
    if (targetContent) {
        targetContent.classList.add('on');
    }
}

// ═══════════════════════════════════════════════════════════════
// 2. SIDEBAR Y MODALES
// ═══════════════════════════════════════════════════════════════
export const hideSB = () => document.getElementById('gsb').style.display = 'none';
export const showSB = () => document.getElementById('gsb').style.display = '';

export const openAPIs = () => {
    document.getElementById('api-modal').classList.add('on');
    if (window.updateSupermenteStats) window.updateSupermenteStats();
};
export const closeAPIs = () => document.getElementById('api-modal').classList.remove('on');
export const closeMM = () => document.getElementById('mm').classList.remove('on');
export const closeLM = () => document.getElementById('lm').classList.remove('on');

// ═══════════════════════════════════════════════════════════════
// 3. SPLITTER (PANEL REDIMENSIONABLE PARA EL MAPA)
// ═══════════════════════════════════════════════════════════════
export function initSplitter() {
    // 1. SPLITTER IZQUIERDO (Lista de Clusters)
    const leftPanel = document.querySelector('.fu-left');
    if (leftPanel && !document.getElementById('fu-resizer-left')) {
        const resizerL = document.createElement('div');
        resizerL.id = 'fu-resizer-left';
        resizerL.style.width = '6px';
        resizerL.style.cursor = 'col-resize';
        resizerL.style.backgroundColor = 'transparent';
        resizerL.style.borderRight = '1px solid var(--bd2)';
        resizerL.style.transition = 'background 0.2s';
        resizerL.style.zIndex = '10';
        
        resizerL.addEventListener('mouseenter', () => resizerL.style.backgroundColor = 'var(--da)');
        resizerL.addEventListener('mouseleave', () => resizerL.style.backgroundColor = 'transparent');
        leftPanel.parentNode.insertBefore(resizerL, leftPanel.nextSibling);

        let isResizingL = false;
        resizerL.addEventListener('mousedown', (e) => { isResizingL = true; document.body.style.cursor = 'col-resize'; e.preventDefault(); });
        document.addEventListener('mousemove', (e) => {
            if (!isResizingL) return;
            const newWidth = e.clientX - leftPanel.parentNode.getBoundingClientRect().left;
            if (newWidth > 200 && newWidth < 600) { leftPanel.style.width = newWidth + 'px'; leftPanel.style.flex = 'none'; }
        });
        document.addEventListener('mouseup', () => {
            if (isResizingL) { isResizingL = false; document.body.style.cursor = 'default'; resizerL.style.backgroundColor = 'transparent'; if (window.resizeMap) window.resizeMap(); }
        });
    }

    // 2. SPLITTER DERECHO (Mapa)
    const rightPanel = document.querySelector('.fu-right');
    if (rightPanel && !document.getElementById('fu-resizer-right')) {
        const resizerR = document.createElement('div');
        resizerR.id = 'fu-resizer-right';
        resizerR.style.width = '6px';
        resizerR.style.cursor = 'col-resize';
        resizerR.style.backgroundColor = 'transparent';
        resizerR.style.borderLeft = '1px solid var(--bd2)';
        resizerR.style.transition = 'background 0.2s';
        resizerR.style.zIndex = '10';
        
        resizerR.addEventListener('mouseenter', () => resizerR.style.backgroundColor = 'var(--da)');
        resizerR.addEventListener('mouseleave', () => resizerR.style.backgroundColor = 'transparent');
        // Lo insertamos justo antes del panel derecho
        rightPanel.parentNode.insertBefore(resizerR, rightPanel);

        let isResizingR = false;
        resizerR.addEventListener('mousedown', (e) => { isResizingR = true; document.body.style.cursor = 'col-resize'; e.preventDefault(); });
        document.addEventListener('mousemove', (e) => {
            if (!isResizingR) return;
            const containerRect = rightPanel.parentNode.getBoundingClientRect();
            // Calculamos el ancho desde la derecha de la pantalla hacia la izquierda
            const newWidth = containerRect.right - e.clientX;
            if (newWidth > 300 && newWidth < 900) { rightPanel.style.width = newWidth + 'px'; rightPanel.style.flex = 'none'; }
        });
        document.addEventListener('mouseup', () => {
            if (isResizingR) { isResizingR = false; document.body.style.cursor = 'default'; resizerR.style.backgroundColor = 'transparent'; if (window.resizeMap) window.resizeMap(); }
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// 4. GUÍA VISUAL (BOTONES PARPADEANTES)
// ═══════════════════════════════════════════════════════════════
export function clearPulses() {
    document.querySelectorAll('.pulse-btn').forEach(el => el.classList.remove('pulse-btn'));
}

export function pulseButton(selector) {
    clearPulses();
    const btn = document.querySelector(selector);
    if (btn) btn.classList.add('pulse-btn');
}

export function guideUserFlow(step, detail = null) {
    if (step === 'dominio') {
        // Animamos toda la fila de tipos para que elija uno
        document.querySelectorAll('.tipo-btn').forEach(b => b.classList.add('pulse-btn'));
    } 
    else if (step === 'herramienta') {
        clearPulses();
        if (detail === 'EXACTO' || detail === 'CALLE') pulseButton('button[onclick*="geoNominatim"]');
        if (detail === 'LOCALIDAD') pulseButton('button[onclick*="openLM"]');
    }
    else if (step === 'confirmar') {
        pulseButton('#btn-conf');
    }
    else if (step === 'siguiente') {
        pulseButton('button[onclick*="nextPend"]');
    }
}