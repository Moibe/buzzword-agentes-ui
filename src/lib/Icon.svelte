<script>
  // Componente unificado de íconos con catálogo dual: emoji + Iconify.
  // Para revertir TODOS los íconos a emojis, cambia USE_ICONIFY a false abajo.
  // Para probar otro set de Iconify (ej. lucide, ph, heroicons), edita los
  // valores de "iconify" del catálogo. Explorador: https://icon-sets.iconify.design

  let { name, size = 16, color = 'currentColor', label = null } = $props();

  // ── Toggle global ──────────────────────────────────────
  // true  → usa Iconify (los emojis quedan como fallback si no hay match).
  // false → usa emojis (vuelta al estado anterior con cero deps).
  const USE_ICONIFY = true;

  // ── Catálogo: nombre semántico → { emoji, iconify } ────
  const ICONS = {
    // Subtabs y áreas principales
    'construccion':         { emoji: '🛠️', iconify: 'ph:wrench' },
    'chatbot':              { emoji: '💬', iconify: 'ph:chat-circle' },
    'admin':                { emoji: '⚙️', iconify: 'ph:gear' },
    'proyecto':             { emoji: '📁', iconify: 'ph:folders' },
    'asistente':            { emoji: '🎧', iconify: 'ph:headset' },
    'usuario':              { emoji: '🙋', iconify: 'ph:identification-card' },
    'base-conocimiento':    { emoji: '📚', iconify: 'ph:books' },
    'documentos':           { emoji: '📄', iconify: 'ph:file-text' },
    'lightbot':             { emoji: '🤖', iconify: 'ph:robot' },
    'lightbot-embedder':    { emoji: '💬', iconify: 'ph:chats-circle' },
    'sandbox':              { emoji: '🖥️', iconify: 'ph:monitor' },
    'miniadmin':            { emoji: '🗂️', iconify: 'ph:notebook' },
    'look-and-feel':        { emoji: '🎨', iconify: 'ph:palette' },
    'link':                 { emoji: '🔗', iconify: 'ph:link' },
    'activar':              { emoji: '⚡', iconify: 'ph:lightning' },
    'contextlight':         { emoji: '🪶', iconify: 'ph:feather' },
    'contextlight-embedder':{ emoji: '📦', iconify: 'ph:package' },

    // Acciones
    'crear':                { emoji: '➕', iconify: 'ph:plus-circle' },
    'editar':               { emoji: '✏️', iconify: 'ph:pencil-simple' },
    'borrar':               { emoji: '🗑️', iconify: 'ph:trash' },
    'recargar':             { emoji: '↻',  iconify: 'ph:arrows-clockwise' },
    'enviar':               { emoji: '📤', iconify: 'ph:paper-plane-tilt' },
    'check':                { emoji: '✓',  iconify: 'ph:check' },
    'limpiar':              { emoji: '🗑',  iconify: 'ph:broom' },
    'reset':                { emoji: '🔄', iconify: 'ph:arrow-counter-clockwise' },

    // Estado / feedback
    'success':              { emoji: '✅', iconify: 'ph:check-circle' },
    'error':                { emoji: '❌', iconify: 'ph:x-circle' },
    'warning':              { emoji: '⚠️', iconify: 'ph:warning' },
    'cargando':             { emoji: '⏳', iconify: 'ph:hourglass' },
    'spinner':              { emoji: '⟳',  iconify: 'ph:circle-notch' },
    'info':                 { emoji: 'ℹ️', iconify: 'ph:info' },

    // Metadatos / chips
    'modelo':               { emoji: '🤖', iconify: 'ph:robot' },
    'historial':            { emoji: '🔁', iconify: 'ph:clock-counter-clockwise' },
    'sin-rag':              { emoji: '🧠', iconify: 'ph:brain' },
    'estrella':             { emoji: '⭐', iconify: 'ph:star' },
    'detalles':             { emoji: '📋', iconify: 'ph:clipboard-text' },
    'sparkle':              { emoji: '✨', iconify: 'ph:magic-wand' },
    // Subtabs de Administración (antes eran emojis sueltos)
    'modelos':              { emoji: '🤖', iconify: 'ph:cpu' },
    'api-keys':             { emoji: '🔐', iconify: 'ph:key' },
    'operadores':           { emoji: '👥', iconify: 'ph:users' },
    'bitacora':             { emoji: '📜', iconify: 'ph:scroll' },
    'alias':                { emoji: '🏷️', iconify: 'ph:tag' },
    'consumo':              { emoji: '📊', iconify: 'ph:chart-bar' },
    'accesos':              { emoji: '🔑', iconify: 'ph:lock-key' },
    'registros':            { emoji: '📝', iconify: 'ph:list-bullets' },
    'archivo':              { emoji: '🗂️', iconify: 'ph:archive' },
    'cerrar-sesion':        { emoji: '🔒', iconify: 'ph:sign-out' },
    'cuenta':               { emoji: '👤', iconify: 'ph:user-circle' },
    'hito':                 { emoji: '🏁', iconify: 'ph:flag-pennant' },
    'desactivar':           { emoji: '🚫', iconify: 'ph:prohibit' },
    'reactivar':            { emoji: '✅', iconify: 'ph:check-circle' },
  };

  let entry = $derived(ICONS[name]);
</script>

{#if entry}
  {#if USE_ICONIFY}
    <iconify-icon
      icon={entry.iconify}
      width={size}
      height={size}
      style={`color: ${color}; vertical-align: -0.15em;`}
      aria-label={label}
      role={label ? 'img' : 'presentation'}
    ></iconify-icon>
  {:else}
    <span
      style={`font-size: ${size}px; line-height: 1; vertical-align: middle;`}
      aria-label={label}
      role={label ? 'img' : 'presentation'}
    >{entry.emoji}</span>
  {/if}
{:else}
  <!-- Si no encuentra el nombre en el catálogo, no rompe — devuelve nada
       y un warning en consola para que el dev sepa que falta agregar. -->
  {#if typeof console !== 'undefined'}
    {(console.warn(`<Icon> desconocido: "${name}". Agrégalo al catálogo en src/lib/Icon.svelte.`), '')}
  {/if}
{/if}
