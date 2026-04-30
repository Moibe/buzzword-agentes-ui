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
    'construccion':         { emoji: '🛠️', iconify: 'ph:wrench-fill' },
    'chatbot':              { emoji: '💬', iconify: 'ph:chat-circle-fill' },
    'admin':                { emoji: '⚙️', iconify: 'ph:gear-fill' },
    'proyecto':             { emoji: '📁', iconify: 'ph:folders-fill' },
    'agente':               { emoji: '🧠', iconify: 'ph:brain-fill' },
    'base-conocimiento':    { emoji: '📚', iconify: 'ph:books-fill' },
    'documentos':           { emoji: '📄', iconify: 'ph:file-text-fill' },
    'lightbot':             { emoji: '🤖', iconify: 'ph:robot-fill' },
    'lightbot-embedder':    { emoji: '💬', iconify: 'ph:chats-circle-fill' },
    'contextlight':         { emoji: '🪶', iconify: 'ph:feather-fill' },
    'contextlight-embedder':{ emoji: '📦', iconify: 'ph:package-fill' },

    // Acciones
    'crear':                { emoji: '➕', iconify: 'ph:plus-circle-fill' },
    'editar':               { emoji: '✏️', iconify: 'ph:pencil-simple-fill' },
    'borrar':               { emoji: '🗑️', iconify: 'ph:trash-fill' },
    'recargar':             { emoji: '↻',  iconify: 'ph:arrows-clockwise-bold' },
    'enviar':               { emoji: '📤', iconify: 'ph:paper-plane-tilt-fill' },
    'check':                { emoji: '✓',  iconify: 'ph:check-bold' },
    'limpiar':              { emoji: '🗑',  iconify: 'ph:broom-fill' },
    'reset':                { emoji: '🔄', iconify: 'ph:arrow-counter-clockwise-bold' },

    // Estado / feedback
    'success':              { emoji: '✅', iconify: 'ph:check-circle-fill' },
    'error':                { emoji: '❌', iconify: 'ph:x-circle-fill' },
    'warning':              { emoji: '⚠️', iconify: 'ph:warning-fill' },
    'cargando':             { emoji: '⏳', iconify: 'ph:hourglass-fill' },
    'spinner':              { emoji: '⟳',  iconify: 'ph:circle-notch-bold' },
    'info':                 { emoji: 'ℹ️', iconify: 'ph:info-fill' },

    // Metadatos / chips
    'modelo':               { emoji: '🤖', iconify: 'ph:robot-fill' },
    'historial':            { emoji: '🔁', iconify: 'ph:clock-counter-clockwise-fill' },
    'sin-rag':              { emoji: '🧠', iconify: 'ph:brain-fill' },
    'estrella':             { emoji: '⭐', iconify: 'ph:star-fill' },
    'detalles':             { emoji: '📋', iconify: 'ph:clipboard-text-fill' },
    'sparkle':              { emoji: '✨', iconify: 'ph:magic-wand-fill' },
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
