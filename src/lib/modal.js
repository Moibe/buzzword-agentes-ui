// Comportamiento común de los diálogos modales del panel, como acción de Svelte:
//
//   <div class="modal-overlay" onclick={...} role="presentation">
//     <div class="modal-content" use:modal>…</div>
//   </div>
//
// Qué hace por cada modal que se monta:
//  - lo marca como diálogo modal (role, aria-modal) y lo nombra con su primer título (h1–h3)
//  - al abrir mueve el foco adentro (el campo con autofocus o el primer control) y al cerrar
//    lo devuelve a lo que lo abrió
//  - atrapa Tab / Shift+Tab para que el foco no se escape a la página de atrás
//  - Esc lo cierra. Si el overlay cierra con clic (role="presentation") Esc hace ese mismo clic, así
//    se respetan las guardas de cada modal (p. ej. "no cerrar mientras guarda"). Para los que no
//    cierran con clic se pasa la función: use:modal={{ cerrar: () => ... }}
//  - el clic en el fondo sólo cuenta si se presionó Y se soltó sobre el fondo: arrastrar desde
//    adentro (p. ej. al seleccionar texto) y soltar afuera ya no cierra el modal
//
// Con varios modales abiertos a la vez (p. ej. una confirmación sobre otro modal) sólo responde el de arriba.

const CONTROLES = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const pila = [];
let contador = 0;

const visible = (el) => el.getClientRects().length > 0;

export function modal(nodo, opciones = {}) {
  let cerrar = opciones?.cerrar ?? null;
  const previo = document.activeElement;
  const overlay = nodo.parentElement;

  nodo.setAttribute('role', 'dialog');
  nodo.setAttribute('aria-modal', 'true');
  if (!nodo.hasAttribute('tabindex')) nodo.setAttribute('tabindex', '-1');

  // El título puede cambiar mientras el modal sigue abierto (algunos alternan entre variantes):
  // si el que nombraba al diálogo ya no existe, se busca el nuevo.
  const nombrar = () => {
    if (nodo.hasAttribute('aria-label')) return;
    const actual = nodo.getAttribute('aria-labelledby');
    if (actual && nodo.querySelector(`[id="${actual}"]`)) return;
    const titulo = nodo.querySelector('h1, h2, h3');
    if (!titulo) return;
    if (!titulo.id) titulo.id = `modal-titulo-${++contador}`;
    nodo.setAttribute('aria-labelledby', titulo.id);
  };
  nombrar();
  const observador = new MutationObserver(nombrar);
  observador.observe(nodo, { childList: true, subtree: true });

  const controles = () => [...nodo.querySelectorAll(CONTROLES)].filter(visible);

  const alTeclear = (e) => {
    if (pila[pila.length - 1] !== nodo) return;

    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      const accion = cerrar ?? (overlay?.getAttribute('role') === 'presentation' ? () => overlay.click() : null);
      if (accion) {
        e.preventDefault();
        accion();
      }
      return;
    }

    if (e.key !== 'Tab') return;
    const lista = controles();
    if (lista.length === 0) {
      e.preventDefault();
      nodo.focus();
      return;
    }
    const primero = lista[0];
    const ultimo = lista[lista.length - 1];
    const activo = document.activeElement;
    if (!nodo.contains(activo)) {
      e.preventDefault();
      (e.shiftKey ? ultimo : primero).focus();
    } else if (e.shiftKey && (activo === primero || activo === nodo)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && activo === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  };

  // Clic en el fondo. Si se presiona dentro del modal y se suelta sobre el fondo, el navegador
  // manda el click al ancestro común de los dos puntos, que es el fondo, y el modal se cerraba sin
  // querer. Se intercepta en window y en captura, antes que los listeners delegados de Svelte (que
  // están en el contenedor y en document, en burbuja). Los clics sintéticos, como el overlay.click()
  // del Esc, no son isTrusted y pasan sin tocarse.
  let bajoEnFondo = false;
  let subioEnFondo = false;
  const alBajar = (e) => { bajoEnFondo = e.target === overlay; };
  const alSubir = (e) => { subioEnFondo = e.target === overlay; };
  const alClic = (e) => {
    if (!overlay || !e.isTrusted || e.target !== overlay) return;
    const valido = bajoEnFondo && subioEnFondo;
    bajoEnFondo = false;
    subioEnFondo = false;
    if (!valido) e.stopPropagation();
  };

  pila.push(nodo);
  document.addEventListener('keydown', alTeclear, true);
  window.addEventListener('pointerdown', alBajar, true);
  window.addEventListener('pointerup', alSubir, true);
  window.addEventListener('click', alClic, true);

  // Foco inicial: el campo marcado con autofocus, si no el primer control, si no el diálogo mismo.
  const inicial = nodo.querySelector('[autofocus]') || controles()[0] || nodo;
  inicial.focus();

  return {
    update(nuevas) {
      cerrar = nuevas?.cerrar ?? null;
    },
    destroy() {
      document.removeEventListener('keydown', alTeclear, true);
      window.removeEventListener('pointerdown', alBajar, true);
      window.removeEventListener('pointerup', alSubir, true);
      window.removeEventListener('click', alClic, true);
      observador.disconnect();
      const i = pila.indexOf(nodo);
      if (i >= 0) pila.splice(i, 1);
      if (previo && previo.isConnected && typeof previo.focus === 'function') previo.focus();
    },
  };
}
