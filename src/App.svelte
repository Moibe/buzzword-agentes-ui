<script>
  import { tick, onMount, untrack } from 'svelte';
  import Icon from './lib/Icon.svelte';

  // ─── Sesión & Logs ───────────────────────────────────────────────
  function generateSessionId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    // getRandomValues suele seguir disponible aun sin secure context.
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  const SESSION_ID = generateSessionId();
  let logs = $state([]);

  async function registrarLog({ pregunta, historial, respuesta, ms, error, contexto, modelo }) {
    const entry = {
      fecha: new Date().toISOString(),
      sesion: SESSION_ID,
      host: location.hostname,
      modelo: modelo ?? '',
      contexto: contexto ?? '',
      pregunta,
      historial: JSON.stringify(historial),
      respuesta: respuesta ?? '',
      ms: ms ?? 0,
      error: error ?? '',
    };
    logs = [...logs, entry];
    console.groupCollapsed(
      `%c📋 Log #${logs.length}  ·  ${entry.host}  ·  ${entry.ms || '—'}ms`,
      'color:#7c3aed;font-weight:bold;font-size:12px'
    );
    console.table({ ...entry, historial: `(${historial.length} msgs)` });
    console.log('Historial completo:', historial);
    console.groupEnd();

    // Guardar en SQLite vía API
    try {
      const res = await fetch(`${apiUrl.base}/registrarLog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (res.ok) {
        console.log('%c💾 Log guardado en BD', 'color:#16a34a;font-weight:bold');
      } else {
        console.warn('%c⚠️ Error al guardar log en BD:', 'color:orange;font-weight:bold', res.status);
      }
    } catch (err) {
      console.warn('%c⚠️ No se pudo guardar log en BD:', 'color:orange;font-weight:bold', err.message);
    }

    return entry;
  }

  // Subir esta versión manualmente con cada despliegue para llevar control
  // visual de qué build está corriendo. Se muestra debajo del título del header.
  const APP_VERSION = '0.1.0';

  // Sin concepto de "ambiente". Las URLs se derivan del host donde corre la
  // app: el API siempre vive en el mismo host en :8077 y el host-asistentes
  // (embeds públicos) en :4176. Esto hace que local y server sean idénticos
  // sin build-mode flags ni .env files.
  const HOST_ASISTENTES_PORT = 4176;
  const API_PORT = 8077;

  const apiUrl = (() => {
    const url = `${location.protocol}//${location.hostname}:${API_PORT}`;
    return { real: url, base: url };
  })();
  const hostAsistentesBase = `${location.protocol}//${location.hostname}:${HOST_ASISTENTES_PORT}`;

  // Exponer helpers de log en consola para depuración
  if (typeof window !== 'undefined') {
    window.__mideLogs = () => logs;
    window.__mideSession = SESSION_ID;
  }

  $effect(() => {
    console.groupCollapsed('%c🌐 MIDE Chat — Configuración', 'color:#c8102e;font-weight:bold;font-size:13px');
    console.log('Sesión     :', SESSION_ID);
    console.log('Host       :', location.hostname);
    console.log('API URL    :', apiUrl.real);
    console.log('Endpoint   :', `${apiUrl.real}/chatbot`);
    console.groupEnd();
    // Carga inicial de proyectos y contextos al montar.
    // Proyectos primero porque el resto filtra por proyecto activo.
    cargarProyectos();
    cargarContextos();
  });

  // Cuando cambia el proyecto activo, recargar listas filtradas.
  $effect(() => {
    proyectoActivoId; // dependencia explícita (no operación, solo tracking)
    untrack(() => {
      cargarContextos();
      cargarAsistentes();
      if (activeTab === 'vectorizacion') {
        cargarContextosVectorizacion();
      }
    });
  });

  // Carga contextos en vectorización cuando cambia el tab
  $effect(() => {
    if (activeTab === 'vectorizacion') {
      untrack(() => {
        cargarContextosVectorizacion();
      });
    }
  });

  let messages = $state([
    {
      id: 1,
      role: 'bot',
      text: '¡Hola! Soy el asistente. ¿En qué puedo ayudarte hoy?',
      time: formatTime(new Date()),
    },
  ]);

  const MODELOS = ['mistral', 'llama3.1'];
  const MODELOS_OPENAI = ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4o', 'gpt-4o-mini'];

  // Plantillas de instrucciones sugeridas por modelo. Modelos pequeños/locales
  // necesitan más explicitud; modelos grandes (OpenAI) responden bien a prosa.
  const _PROMPT_OPENAI_BASIC = `[regla critica]

Eres un asistente experto en [tu dominio]. Responde de forma concisa y profesional. Si la consulta sale de tu dominio, indica amablemente que no es tu especialidad.`;
  const _PROMPT_OPENAI_PREMIUM = `[regla critica]

Eres un asistente experto en [tu dominio]. Responde con precisión, adaptando el tono a la situación del usuario. Si la consulta sale de tu dominio, redirígela educadamente sugiriendo dónde podría obtener ayuda.`;
  const PLACEHOLDER_INSTRUCCIONES = {
    mistral: `[regla critica]

Eres un asistente experto en [tu dominio]. Solo respondes sobre temas relacionados a [tu dominio]. Si te preguntan otra cosa, di brevemente que no es tu especialidad.`,
    'llama3.1': `[regla critica]

Eres un asistente experto en [tu dominio]. Solo respondes sobre temas relacionados a [tu dominio]. Si la pregunta sale del tema, dilo y no inventes información.`,
    'gpt-5.5': _PROMPT_OPENAI_PREMIUM,
    'gpt-5.5-pro': _PROMPT_OPENAI_PREMIUM,
    'gpt-5': _PROMPT_OPENAI_PREMIUM,
    'gpt-5-mini': _PROMPT_OPENAI_BASIC,
    'gpt-5-nano': _PROMPT_OPENAI_BASIC,
    'gpt-4o': _PROMPT_OPENAI_PREMIUM,
    'gpt-4o-mini': _PROMPT_OPENAI_BASIC,
  };
  const PLACEHOLDER_INSTRUCCIONES_FALLBACK = 'Eres un asistente experto en [tu dominio]...';

  // Metadatos por variable. Las variables que no aparezcan aquí son requeridas
  // (vacías dejan [xxx] literal en el prompt). Las marcadas como opcional, si
  // se dejan vacías, se quitan del prompt limpiamente.
  const PLACEHOLDER_VARIABLES_META = {
    'regla critica': {
      optional: true,
      defaultValue: '*** REGLA CRÍTICA: Responde en máximo 2 oraciones. ***',
      wrap: '***',
    },
    'tu dominio': {
      description: 'el área de especialización del asistente (ej. ventas, soporte técnico, recursos humanos)',
      placeholder: 'experto en ventas bancarias',
    },
  };

  // Envuelve el valor con el delimitador (ej. '***') si el usuario no lo
  // incluyó. Idempotente: si ya empieza/termina con el delimitador, no se duplica.
  function aplicarWrap(valor, wrap) {
    if (!wrap) return valor;
    let v = valor.trim();
    if (!v.startsWith(wrap)) v = `${wrap} ${v}`;
    if (!v.endsWith(wrap)) v = `${v} ${wrap}`;
    return v;
  }

  let contextos = $state([]);
  let cargandoContextos = $state(false);
  let inputText = $state('');
  let isLoading = $state(false);
  let chatContainer = $state(null);
  let activeTab = $state('vectorizacion');
  let vectorizacionTab = $state('proyectos');
  let adminTab = $state('modelos');
  let defaultContextGuardado = $state(
    typeof localStorage !== 'undefined' ? (localStorage.getItem('mide_default_context') || '') : ''
  );
  let defaultContext = $state(defaultContextGuardado);
  let defaultContextGuardadoFlash = $state(false);
  let defaultContextFlashTimer = null;

  function guardarDefaultContext() {
    localStorage.setItem('mide_default_context', defaultContext);
    defaultContextGuardado = defaultContext;
    defaultContextGuardadoFlash = true;
    if (defaultContextFlashTimer) clearTimeout(defaultContextFlashTimer);
    defaultContextFlashTimer = setTimeout(() => { defaultContextGuardadoFlash = false; }, 2500);
  }

  // Lightbot/ContextLight: slug de asistente seleccionado para los embeds.
  // Persisten en localStorage para que al volver a abrir la admin haya un
  // asistente seleccionado por defecto.
  let lightbotAsistenteSlug = $state(
    typeof localStorage !== 'undefined' ? localStorage.getItem('bzz_lightbot_agente') || '' : ''
  );
  let contextlightAsistenteSlug = $state(
    typeof localStorage !== 'undefined' ? localStorage.getItem('bzz_contextlight_agente') || '' : ''
  );

  $effect(() => {
    if (vectorizacionTab !== 'proyectos') vinoDeCambiarProyecto = false;
  });

  // Persistir slugs seleccionados en localStorage. Si se vacía la selección,
  // se borra la entrada para que la siguiente sesión arranque limpia.
  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    if (lightbotAsistenteSlug) localStorage.setItem('bzz_lightbot_agente', lightbotAsistenteSlug);
    else localStorage.removeItem('bzz_lightbot_agente');
  });
  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    if (contextlightAsistenteSlug) localStorage.setItem('bzz_contextlight_agente', contextlightAsistenteSlug);
    else localStorage.removeItem('bzz_contextlight_agente');
  });

  // ─── Proyectos (CRUD) ─────────────────────────────────────────
  // Persistido en backend vía /proyectos. El proyecto activo se mantiene en
  // localStorage para que el usuario lo recupere al volver a abrir la admin.
  const PROYECTO_SLUG_REGEX = /^[a-z][a-z0-9-]{1,63}$/;

  let proyectos = $state([]);
  let cargandoProyectos = $state(false);
  let errorCargarProyectos = $state('');
  let proyectoFormAbierto = $state(false);
  let proyectoEditandoId = $state(null);
  let proyectoFormSlug = $state('');
  let proyectoFormNombre = $state('');
  let proyectoFormDescripcion = $state('');
  let cargandoGuardarProyecto = $state(false);
  let mensajeProyecto = $state('');
  let proyectoABorrar = $state(null);
  let mostrarConfirmacionBorrarProyecto = $state(false);
  let cargandoBorrarProyecto = $state(false);

  // Proyecto activo (filtra todo lo de abajo). Persiste cross-sesión.
  let proyectoActivoId = $state(
    typeof localStorage !== 'undefined' ? localStorage.getItem('bzz_proyecto_activo') || '' : ''
  );
  const proyectoActivo = $derived(proyectos.find((p) => p.id === proyectoActivoId) ?? null);

  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    if (proyectoActivoId) localStorage.setItem('bzz_proyecto_activo', proyectoActivoId);
    else localStorage.removeItem('bzz_proyecto_activo');
  });

  function resetProyectoForm() {
    proyectoEditandoId = null;
    proyectoFormSlug = '';
    proyectoFormNombre = '';
    proyectoFormDescripcion = '';
    mensajeProyecto = '';
  }
  function abrirFormCrearProyecto() {
    resetProyectoForm();
    proyectoFormAbierto = true;
  }
  function abrirFormEditarProyecto(p) {
    proyectoEditandoId = p.id;
    proyectoFormSlug = p.slug;
    proyectoFormNombre = p.nombre;
    proyectoFormDescripcion = p.descripcion ?? '';
    mensajeProyecto = '';
    proyectoFormAbierto = true;
  }
  function cerrarFormProyecto() {
    proyectoFormAbierto = false;
    resetProyectoForm();
  }

  async function cargarProyectos() {
    cargandoProyectos = true;
    errorCargarProyectos = '';
    try {
      const res = await fetch(`${apiUrl.base}/proyectos`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      proyectos = await res.json();
      // Si el proyecto activo ya no existe en este ambiente, limpiar.
      if (proyectoActivoId && !proyectos.some((p) => p.id === proyectoActivoId)) {
        proyectoActivoId = '';
      }
      // Si no hay proyecto activo y existe al menos uno, auto-seleccionar el primero.
      if (!proyectoActivoId && proyectos.length > 0) {
        proyectoActivoId = proyectos[0].id;
      }
    } catch (err) {
      errorCargarProyectos = `No se pudieron cargar los proyectos: ${err.message}`;
      proyectos = [];
    } finally {
      cargandoProyectos = false;
    }
  }

  async function guardarProyecto() {
    const slug = proyectoFormSlug.trim();
    const nombre = proyectoFormNombre.trim();
    const descripcion = proyectoFormDescripcion.trim();

    if (!proyectoEditandoId && !PROYECTO_SLUG_REGEX.test(slug)) {
      mensajeProyecto = '❌ Slug inválido. Usa minúsculas, dígitos y guiones (2-64 chars, empieza con letra).';
      return;
    }
    if (!nombre || nombre.length > 80) {
      mensajeProyecto = '❌ Nombre requerido, máximo 80 caracteres.';
      return;
    }
    if (descripcion.length > 500) {
      mensajeProyecto = '❌ Descripción demasiado larga (máximo 500 caracteres).';
      return;
    }

    cargandoGuardarProyecto = true;
    mensajeProyecto = '';

    try {
      const editando = !!proyectoEditandoId;
      const url = editando
        ? `${apiUrl.base}/proyectos/${encodeURIComponent(proyectoEditandoId)}`
        : `${apiUrl.base}/proyectos`;
      const body = editando
        ? { nombre, descripcion }
        : { slug, nombre, descripcion };

      const res = await fetch(url, {
        method: editando ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        let msg = txt;
        try {
          const j = JSON.parse(txt);
          msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
        } catch {}
        if (res.status === 409) throw new Error('Ya existe un proyecto con ese slug.');
        throw new Error(`HTTP ${res.status}: ${msg}`);
      }

      const proyectoCreado = await res.json();
      mensajeProyecto = editando ? '✅ Proyecto actualizado' : '✅ Proyecto creado';
      await cargarProyectos();
      // Si fue creación, auto-activarlo y marcar el flujo "vino de crear proyecto"
      // para que aparezca la flechita guiando hacia Base de Conocimiento.
      if (!editando && proyectoCreado?.id) {
        proyectoActivoId = proyectoCreado.id;
        vinoDeCrearProyecto = true;
      }
      setTimeout(() => cerrarFormProyecto(), 800);
    } catch (err) {
      mensajeProyecto = `❌ ${err.message}`;
    } finally {
      cargandoGuardarProyecto = false;
    }
  }

  function pedirConfirmacionBorrarProyecto(p) {
    proyectoABorrar = p;
    mostrarConfirmacionBorrarProyecto = true;
  }

  async function borrarProyectoConfirmado() {
    if (!proyectoABorrar) return;
    cargandoBorrarProyecto = true;
    try {
      const res = await fetch(`${apiUrl.base}/proyectos/${encodeURIComponent(proyectoABorrar.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        if (res.status === 409) {
          const txt = await res.text().catch(() => '');
          let detalle = 'el proyecto tiene asistentes o bases de conocimiento asociados';
          try {
            const j = JSON.parse(txt);
            if (typeof j.detail === 'string') detalle = j.detail;
          } catch {}
          throw new Error(`No se puede borrar: ${detalle}`);
        }
        throw new Error(`HTTP ${res.status}`);
      }
      // Si era el proyecto activo, limpiar la selección activa.
      if (proyectoActivoId === proyectoABorrar.id) proyectoActivoId = '';
      await cargarProyectos();
      mostrarConfirmacionBorrarProyecto = false;
      proyectoABorrar = null;
    } catch (err) {
      mensajeProyecto = `❌ ${err.message}`;
    } finally {
      cargandoBorrarProyecto = false;
    }
  }

  let vectorizacionContextos = $state([]);
  let cargandoVectorizacionContextos = $state(false);
  
  // Modelos de Embedding
  let modelosEmbedding = $state([]);
  let cargandoModelosEmbedding = $state(false);

  let errorVectorizacionContextos = $state('');
  const DEFAULT_EMBEDDING_MODEL = 'mxbai';
  const MODELOS_EMBEDDING_OPENAI = ['text-embedding-3-small', 'text-embedding-3-large'];

  // Mapeo manual de alias para modelos de embedding cuyo "primer fragmento"
  // colisionaría con otro (p. ej. snowflake-arctic-embed vs snowflake-arctic-embed2,
  // o text-embedding-3-small vs text-embedding-3-large).
  // Clave: nombre completo del modelo. Valor: alias corto a usar en el nombre del contexto.
  // Si un modelo no aparece aquí, se usa la regla por defecto (primera palabra antes de -/_/:/espacio).
  const MODELO_ALIAS_DEFAULT = {
    'text-embedding-3-small': 'openai3small',
    'text-embedding-3-large': 'openai3large',
    'snowflake-arctic-embed': 'snowflake',
    'snowflake-arctic-embed2': 'snowflake2',
    'snowflake-arctic-embed:latest': 'snowflake',
    'snowflake-arctic-embed2:latest': 'snowflake2',
  };

  const ALIAS_STORAGE_KEY = 'mide.modeloAlias';

  function cargarAliasGuardados() {
    try {
      const raw = localStorage.getItem(ALIAS_STORAGE_KEY);
      if (!raw) return { ...MODELO_ALIAS_DEFAULT };
      const parsed = JSON.parse(raw);
      return { ...MODELO_ALIAS_DEFAULT, ...parsed };
    } catch {
      return { ...MODELO_ALIAS_DEFAULT };
    }
  }

  let MODELO_ALIAS = $state(cargarAliasGuardados());

  function guardarAlias() {
    try {
      localStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(MODELO_ALIAS));
    } catch {}
  }

  // Devuelve el alias corto para un modelo dado.
  function aliasModeloEmbedding(modelo) {
    if (!modelo) return '';
    const limpio = modelo.trim();
    const manual = MODELO_ALIAS[limpio];
    if (manual && manual.trim()) return manual.trim();
    // Fallback: primera palabra antes de -/_/:/espacio
    return limpio.split(/[-:_\s]/)[0].toLowerCase();
  }

  let nuevoContextoEmbedding = $state('');
  let nuevoContextoChunkSize = $state('1500');

  // Nombre auto-generado: <proyecto-slug>-<N>, donde N es el menor entero
  // positivo libre dentro del proyecto activo. Si se borra una BC, su número
  // queda disponible y el siguiente alta lo reusa (rellena huecos).
  const nombreContextoGenerado = $derived.by(() => {
    if (!proyectoActivo?.slug) return '';
    const slug = proyectoActivo.slug;
    // Recolecta los números usados por BCs existentes que matcheen <slug>-<N>.
    const usados = new Set();
    const re = new RegExp(`^${slug.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}-(\\d+)$`);
    for (const bc of vectorizacionContextos) {
      const m = bc?.nombre?.match(re);
      if (m) usados.add(parseInt(m[1], 10));
    }
    // El menor entero >= 1 que no esté usado.
    let n = 1;
    while (usados.has(n)) n++;
    return `${slug}-${n}`;
  });
  let cargandoCrearContexto = $state(false);
  let mensajeCrearContexto = $state('');
  let contextoABorrar = $state('');
  let mostrarConfirmacionBorrar = $state(false);
  let cargandoBorrarContexto = $state(false);
  let mensajeBorrarContexto = $state('');
  let vectorizacionDocumentos = $state([]);
  let cargandoVectorizacionDocumentos = $state(false);
  let documentoSeleccionadoParaBorrar = $state('');
  let contextoSeleccionadoParaDocumentos = $state('');
  let vinoDeEditarContexto = $state(false);
  let vinoDeCrearProyecto = $state(false);
  let vinoDeCambiarProyecto = $state(false);
  let crearContextoAbierto = $state(false);
  let archivoParaIntegrar = $state(null);
  let cargandoIntegrarDocumento = $state(false);
  let progresoIntegrar = $state(0);
  let mensajeIntegrarDocumento = $state('');
  let cargandoBorrarDocumento = $state(false);
  let mensajeBorrarDocumento = $state('');
  let mostrarConfirmacionBorrarDocumento = $state(false);
  let integracionEnCurso = $state(null);
  let modelosDisponibles = $state([]);
  let cargandoModelos = $state(false);
  let errorModelos = $state('');
  let modeloSeleccionado = $state(null);
  let infoModeloSeleccionado = $state(null);
  let cargandoInfoModelo = $state(false);

  // ─── Asistentes (CRUD) ───────────────────────────────────────────
  const SLUG_REGEX = /^[a-z][a-z0-9-]{1,63}$/;
  let asistentes = $state([]);
  let cargandoAsistentes = $state(false);
  let errorCargarAsistentes = $state('');
  let asistenteFormAbierto = $state(false);
  let asistenteEditandoId = $state(null);
  let asistenteFormSlug = $state('');
  let asistenteFormNombre = $state('');
  let asistenteFormInstrucciones = $state('');
  let asistenteFormContexto = $state('');
  let asistenteFormModelo = $state('mistral');
  let asistenteFormHistorialMax = $state(3);
  let asistenteFormMensajeInicial = $state('');
  const placeholderInstrucciones = $derived(
    PLACEHOLDER_INSTRUCCIONES[asistenteFormModelo] ?? PLACEHOLDER_INSTRUCCIONES_FALLBACK
  );

  // Extrae nombres únicos de variables tipo [xxx] de un template.
  function extraerVariables(template) {
    if (!template) return [];
    const seen = new Set();
    for (const m of template.matchAll(/\[([^\]]+)\]/g)) seen.add(m[1].trim());
    return [...seen];
  }
  const placeholderVariables = $derived(extraerVariables(placeholderInstrucciones));
  let asistenteFormVariables = $state({});

  // Sincroniza el mapa de variables cuando cambia el modelo: conserva valores
  // de variables que mantengan el mismo nombre, e inicializa las nuevas en ''.
  function sincronizarVariablesAsistente() {
    const nombres = extraerVariables(
      PLACEHOLDER_INSTRUCCIONES[asistenteFormModelo] ?? PLACEHOLDER_INSTRUCCIONES_FALLBACK
    );
    const prev = asistenteFormVariables;
    const next = {};
    for (const n of nombres) {
      // Si la variable ya tiene valor previo (incluyendo string vacío si el
      // usuario lo limpió a propósito), respetarlo. Si no existe en el mapa
      // previo, pre-llenar con el placeholder de la metadata para que el
      // usuario vea la sugerencia inicial y pueda dejarla tal cual.
      if (n in prev) {
        next[n] = prev[n];
      } else {
        next[n] = PLACEHOLDER_VARIABLES_META[n]?.defaultValue ?? '';
      }
    }
    asistenteFormVariables = next;
  }

  // Construye el texto plano de instrucciones a partir de la plantilla.
  // Variables llenas → sustituye con el valor.
  // Variables opcionales vacías → quita el placeholder.
  // Variables requeridas vacías → deja [xxx] literal como cue de "te falta llenar esto".
  function construirInstruccionesPlain() {
    let texto = placeholderInstrucciones;
    for (const [nombre, valor] of Object.entries(asistenteFormVariables)) {
      const meta = PLACEHOLDER_VARIABLES_META[nombre];
      const valorTrim = (valor ?? '').trim();
      if (valorTrim) {
        const valorFinal = aplicarWrap(valorTrim, meta?.wrap);
        texto = texto.split(`[${nombre}]`).join(valorFinal);
      } else if (meta?.optional) {
        texto = texto.split(`[${nombre}]`).join('');
      }
    }
    // Limpia leading whitespace y colapsa más de 2 newlines consecutivos a 2.
    return texto.replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n');
  }

  // Auto-sincroniza el textarea con la plantilla + variables en modo creación.
  // En modo edición no toca nada — el usuario maneja libremente las instrucciones
  // existentes del asistente.
  $effect(() => {
    if (!asistenteFormAbierto || asistenteEditandoId) return;
    asistenteFormInstrucciones = construirInstruccionesPlain();
  });

  let cargandoGuardarAsistente = $state(false);
  let mensajeAsistente = $state('');
  let asistenteABorrar = $state(null);
  let mostrarConfirmacionBorrarAsistente = $state(false);
  let cargandoBorrarAsistente = $state(false);
  let lookAndFeelAsistente = $state(null);
  // Defaults coinciden con los valores hardcodeados de Embed.svelte/ContextLightEmbed.svelte.
  const TEMA_DEFAULT = {
    color_primario: '#5b6abf',
    color_burbuja_bot: '#d4e4f7',
    color_fondo_chat: '#f0f2f5',
    color_header: '#ffffff',
  };
  let lookAndFeelForm = $state({ ...TEMA_DEFAULT });
  let cargandoGuardarTema = $state(false);
  let mensajeTema = $state('');
  let urlCopiada = $state('');

  async function copiarUrl(url) {
    let ok = false;
    // 1. Modern API: solo funciona en HTTPS o localhost.
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch (_) { /* fall through al fallback */ }
    }
    // 2. Fallback: textarea + execCommand. Funciona en HTTP plano y navegadores viejos.
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch (_) { ok = false; }
      document.body.removeChild(ta);
    }
    if (ok) {
      urlCopiada = url;
      setTimeout(() => { if (urlCopiada === url) urlCopiada = ''; }, 1500);
    }
  }

  function abrirLookAndFeel(asistente) {
    lookAndFeelAsistente = asistente;
    lookAndFeelForm = {
      color_primario: asistente.color_primario ?? TEMA_DEFAULT.color_primario,
      color_burbuja_bot: asistente.color_burbuja_bot ?? TEMA_DEFAULT.color_burbuja_bot,
      color_fondo_chat: asistente.color_fondo_chat ?? TEMA_DEFAULT.color_fondo_chat,
      color_header: asistente.color_header ?? TEMA_DEFAULT.color_header,
    };
    mensajeTema = '';
  }

  function cerrarLookAndFeel() {
    lookAndFeelAsistente = null;
    mensajeTema = '';
  }

  function resetearTema() {
    lookAndFeelForm = { ...TEMA_DEFAULT };
  }

  async function guardarTema() {
    if (!lookAndFeelAsistente) return;
    cargandoGuardarTema = true;
    mensajeTema = '';
    try {
      const res = await fetch(`${apiUrl.base}/agentes/${encodeURIComponent(lookAndFeelAsistente.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lookAndFeelForm),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${txt}`);
      }
      await cargarAsistentes();
      cerrarLookAndFeel();
    } catch (err) {
      mensajeTema = `❌ ${err.message}`;
    } finally {
      cargandoGuardarTema = false;
    }
  }

  function resetAsistenteForm() {
    asistenteEditandoId = null;
    asistenteFormSlug = '';
    asistenteFormNombre = '';
    asistenteFormInstrucciones = '';
    asistenteFormContexto = '';
    asistenteFormModelo = 'mistral';
    asistenteFormHistorialMax = 3;
    asistenteFormMensajeInicial = '';
    // Limpia el mapa de variables para que sincronizar arranque con los
    // defaults de la plantilla (regla critica pre-llena, etc.) en cada nueva creación.
    asistenteFormVariables = {};
    mensajeAsistente = '';
    sincronizarVariablesAsistente();
  }

  function abrirFormCrearAsistente() {
    resetAsistenteForm();
    asistenteFormAbierto = true;
  }

  function abrirFormEditarAsistente(asistente) {
    asistenteEditandoId = asistente.id;
    asistenteFormSlug = asistente.slug;
    asistenteFormNombre = asistente.nombre;
    asistenteFormInstrucciones = asistente.instrucciones;
    asistenteFormContexto = asistente.contexto;
    asistenteFormModelo = asistente.modelo_llm;
    asistenteFormHistorialMax = asistente.historial_max;
    asistenteFormMensajeInicial = asistente.mensaje_inicial ?? '';
    mensajeAsistente = '';
    sincronizarVariablesAsistente();
    asistenteFormAbierto = true;
  }

  function cerrarFormAsistente() {
    asistenteFormAbierto = false;
    resetAsistenteForm();
  }

  async function cargarAsistentes() {
    cargandoAsistentes = true;
    errorCargarAsistentes = '';
    try {
      const url = proyectoActivoId
        ? `${apiUrl.base}/agentes?proyecto_id=${encodeURIComponent(proyectoActivoId)}`
        : `${apiUrl.base}/agentes`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      asistentes = await res.json();
    } catch (err) {
      errorCargarAsistentes = `No se pudieron cargar los asistentes: ${err.message}`;
      asistentes = [];
    } finally {
      cargandoAsistentes = false;
    }
  }

  async function guardarAsistente() {
    const slug = asistenteFormSlug.trim();
    const nombre = asistenteFormNombre.trim();
    const instrucciones = asistenteFormInstrucciones.trim();
    const contexto = asistenteFormContexto.trim();
    const modelo_llm = asistenteFormModelo.trim();
    const historial_max = parseInt(asistenteFormHistorialMax, 10);
    const mensaje_inicial = asistenteFormMensajeInicial.trim();

    if (!asistenteEditandoId && !SLUG_REGEX.test(slug)) {
      mensajeAsistente = '❌ Slug inválido. Usa minúsculas, dígitos y guiones (2-64 chars, empieza con letra).';
      return;
    }
    if (!nombre || nombre.length > 80) {
      mensajeAsistente = '❌ Nombre requerido, máximo 80 caracteres.';
      return;
    }
    if (!instrucciones) {
      mensajeAsistente = '❌ Instrucciones no pueden estar vacías.';
      return;
    }
    // contexto es opcional: vacío = asistente sin RAG (chat puro, solo instrucciones + LLM).
    if (!modelo_llm) {
      mensajeAsistente = '❌ Selecciona un modelo LLM.';
      return;
    }
    if (isNaN(historial_max) || historial_max < 0 || historial_max > 50) {
      mensajeAsistente = '❌ Historial max debe ser entero entre 0 y 50.';
      return;
    }
    if (!proyectoActivoId) {
      mensajeAsistente = '❌ No hay proyecto activo. Selecciona uno en el header o crea uno en la subtab Proyectos.';
      return;
    }

    cargandoGuardarAsistente = true;
    mensajeAsistente = '';

    try {
      const editando = !!asistenteEditandoId;
      const url = editando
        ? `${apiUrl.base}/agentes/${encodeURIComponent(asistenteEditandoId)}`
        : `${apiUrl.base}/agentes`;
      // Contexto vacío = "Sin base de conocimiento". Lo mandamos como null
      // (no como "") para que el backend lo interprete como "limpiar campo"
      // y no como string vacío sospechoso.
      const contextoPayload = contexto === '' ? null : contexto;
      // Mensaje inicial vacío = usar default del frontend.
      const mensajeInicialPayload = mensaje_inicial === '' ? null : mensaje_inicial;
      const body = editando
        ? { nombre, instrucciones, contexto: contextoPayload, modelo_llm, historial_max, mensaje_inicial: mensajeInicialPayload }
        : { slug, nombre, instrucciones, contexto: contextoPayload, modelo_llm, historial_max, mensaje_inicial: mensajeInicialPayload, proyecto_id: proyectoActivoId };

      const res = await fetch(url, {
        method: editando ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        let msg = txt;
        try {
          const j = JSON.parse(txt);
          msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
        } catch {}
        if (res.status === 409) throw new Error(`Ya existe un asistente con ese slug.`);
        throw new Error(`HTTP ${res.status}: ${msg}`);
      }

      mensajeAsistente = editando ? '✅ Asistente actualizado' : '✅ Asistente creado';
      await cargarAsistentes();
      setTimeout(() => {
        cerrarFormAsistente();
      }, 800);
    } catch (err) {
      mensajeAsistente = `❌ ${err.message}`;
    } finally {
      cargandoGuardarAsistente = false;
    }
  }

  function pedirConfirmacionBorrarAsistente(asistente) {
    asistenteABorrar = asistente;
    mostrarConfirmacionBorrarAsistente = true;
  }

  async function borrarAsistenteConfirmado() {
    if (!asistenteABorrar) return;
    cargandoBorrarAsistente = true;
    try {
      const res = await fetch(`${apiUrl.base}/agentes/${encodeURIComponent(asistenteABorrar.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      await cargarAsistentes();
      mostrarConfirmacionBorrarAsistente = false;
      asistenteABorrar = null;
    } catch (err) {
      mensajeAsistente = `❌ Error al borrar: ${err.message}`;
    } finally {
      cargandoBorrarAsistente = false;
    }
  }
  // Cache por ambiente para modelos de embedding
  let cacheModelosEmbedding = {};
  let chunkSugeridoPorModelo = {
    // Defaults estáticos para modelos de OpenAI (max tokens del modelo)
    'text-embedding-3-small': '8191',
    'text-embedding-3-large': '8191',
  };
  let estadoSalud = $state('checking'); // 'online', 'offline', 'checking'
  let ultimaVerificacion = $state(null);
  let timerVerificacion = null;
  let debounceInputHealth = null;

  function verificarSaludDesdeInput() {
    clearTimeout(debounceInputHealth);
    debounceInputHealth = setTimeout(verificarSalud, 500);
  }

  function reprogramarTimer() {
    clearInterval(timerVerificacion);
    const intervalo = estadoSalud === 'online' ? 60000 : 180000; // 1 min online, 3 min offline
    timerVerificacion = setInterval(verificarSalud, intervalo);
  }

  async function verificarSalud() {
    // No interferir con peticiones de chat activas
    if (isLoading) return;
    const estadoPrevio = estadoSalud;
    estadoSalud = 'checking';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${apiUrl.base}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      estadoSalud = data.status === 'ok' ? 'online' : 'offline';
      if (estadoSalud === 'online') {
        errorVectorizacionContextos = '';
        if (estadoPrevio === 'offline') {
          console.log('%c🔄 API regresó online — recargando contextos', 'color:#16a34a;font-weight:bold');
          cargarContextos();
        } else if (estadoPrevio === 'checking' && import.meta.env.PROD) {
          console.log(`%c✅ API online → ${apiUrl.real}`, 'color:#16a34a;font-weight:bold');
        }
      } else {
        console.warn(`%c⚠️ API respondió pero status != ok → ${apiUrl.real}`, 'color:#d97706;font-weight:bold', data);
      }
      ultimaVerificacion = new Date();
    } catch (err) {
      const wasOnline = estadoPrevio === 'online';
      estadoSalud = 'offline';
      ultimaVerificacion = new Date();
      const label = err.name === 'AbortError' ? 'Timeout (>5s)' : err.message;
      if (wasOnline) {
        console.error(
          `%c🔴 API caída → ${apiUrl.real}\n   Motivo: ${label}\n   Hora: ${new Date().toLocaleTimeString()}`,
          'color:#dc2626;font-weight:bold'
        );
      } else if (estadoPrevio === 'checking') {
        console.warn(
          `%c⚠️ API no disponible → ${apiUrl.real}\n   Motivo: ${label}`,
          'color:#d97706;font-weight:bold'
        );
      }
    }
    reprogramarTimer();
  }

  onMount(() => {
    verificarSalud(); // incluye reprogramarTimer() al terminar
    return () => clearInterval(timerVerificacion);
  });

  async function cargarModelos() {
    cargandoModelos = true;
    modelosDisponibles = [];
    errorModelos = '';
    modeloSeleccionado = null;
    infoModeloSeleccionado = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${apiUrl.base}/listarModelos`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Maneja array directo o {modelos: [...]}
      if (Array.isArray(data)) {
        modelosDisponibles = data;
      } else if (data.modelos && Array.isArray(data.modelos)) {
        modelosDisponibles = data.modelos;
      } else {
        modelosDisponibles = [];
      }
      console.log('%c🤖 Modelos cargados:', 'color:#0077ff;font-weight:bold', modelosDisponibles);
    } catch (err) {
      if (err.name === 'AbortError') {
        errorModelos = '⏳ La API no respondió (tiempo de espera agotado). Intenta recargar en unos momentos.';
        console.warn('%c⏳ Timeout al cargar modelos', 'color:orange;font-weight:bold');
      } else {
        errorModelos = 'API offline';
        console.error('%c❌ Error al cargar modelos', 'color:red;font-weight:bold', err);
      }
    } finally {
      cargandoModelos = false;
    }
  }

  function seleccionarModeloDefault(lista) {
    const match = lista.find(m => m.toLowerCase().includes(DEFAULT_EMBEDDING_MODEL.toLowerCase()));
    return match || lista[0];
  }

  function aplicarChunkSugerido(modelo) {
    if (modelo && chunkSugeridoPorModelo[modelo]) {
      nuevoContextoChunkSize = chunkSugeridoPorModelo[modelo];
    }
  }

  async function cargarInfoModelo(modelo) {
    cargandoInfoModelo = true;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${apiUrl.base}/infoModelo/${encodeURIComponent(modelo)}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      infoModeloSeleccionado = data;
      console.log('%c📋 Info modelo cargada:', 'color:#0077ff;font-weight:bold', data);
    } catch (err) {
      console.error('%c❌ Error al cargar info del modelo', 'color:red;font-weight:bold', err);
      infoModeloSeleccionado = null;
    } finally {
      cargandoInfoModelo = false;
    }
  }

  async function cargarContextos() {
    cargandoContextos = true;
    contextos = [];
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const filtro = proyectoActivoId ? `?proyecto_id=${encodeURIComponent(proyectoActivoId)}` : '';
      const res = await fetch(`${apiUrl.base}/listarContextos${filtro}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log('%c📂 Respuesta /listarContextos:', 'color:#c8102e;font-weight:bold', data);

      // Soportar múltiples formatos de respuesta
      let mapa = {};
      if (data['Contextos existentes para este chatbot']) {
        mapa = data['Contextos existentes para este chatbot'];
      } else if (Array.isArray(data)) {
        contextos = data;
        console.log('%c📂 Contextos cargados:', 'color:#c8102e;font-weight:bold', contextos);
        return;
      } else if (data.contextos && typeof data.contextos === 'object') {
        mapa = data.contextos;
      } else {
        const firstObjKey = Object.keys(data).find(k => typeof data[k] === 'object' && data[k] !== null);
        if (firstObjKey) mapa = data[firstObjKey];
      }

      contextos = Array.isArray(mapa) ? mapa : Object.keys(mapa);
      console.log('%c📂 Contextos cargados:', 'color:#c8102e;font-weight:bold', contextos);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn('%c⏳ Timeout al cargar contextos — la API puede estar ocupada', 'color:orange;font-weight:bold');
      } else {
        console.error('%c❌ Error al cargar contextos', 'color:red;font-weight:bold', err);
      }
    } finally {
      cargandoContextos = false;
    }
  }

  async function cargarModelosEmbedding() {
    cargandoModelosEmbedding = true;
    modelosEmbedding = [];
    try {
      // Reuse cache for current environment if available
      if (cacheModelosEmbedding[location.hostname]?.length) {
        modelosEmbedding = cacheModelosEmbedding[location.hostname];
        if (modelosEmbedding.length > 0 && !nuevoContextoEmbedding) {
          const preferido = seleccionarModeloDefault(modelosEmbedding);
          nuevoContextoEmbedding = preferido;
          aplicarChunkSugerido(preferido);
        }
        return;
      }

      // 1. Listar todos los modelos
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${apiUrl.base}/listarModelos`, { signal: controller.signal });
      clearTimeout(timeout);
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      // Parse response based on format
      let listaModelos = [];
      if (Array.isArray(data)) listaModelos = data;
      else if (data.modelos && Array.isArray(data.modelos)) listaModelos = data.modelos;

      // 2. Verificar cada modelo para ver si es de embedding
      const modelosConfirmados = [];

      // Validar cada modelo
      for (const modelo of listaModelos) {
        try {
          const c2 = new AbortController();
          const t2 = setTimeout(() => c2.abort(), 5000); // 5s por modelo
          const r2 = await fetch(`${apiUrl.base}/infoModelo/${encodeURIComponent(modelo)}`, { signal: c2.signal });
          clearTimeout(t2);
          
          if (r2.ok) {
            const info = await r2.json();

            // Preferir la bandera que ya entrega la API
            // Guardar chunk_size_sugerido si viene en la respuesta
            if (info.chunk_size_sugerido) {
              chunkSugeridoPorModelo[modelo] = String(info.chunk_size_sugerido);
            }

            const tipo = (info.tipo || '').toString().toLowerCase();
            if (tipo === 'embedding') {
              modelosConfirmados.push(modelo);
              continue;
            }

            // Fallback heurístico si la API no trae tipo
            let familiesStr = "";
            const details = info.details || {};
            if (Array.isArray(details.families)) familiesStr = details.families.join(" ").toLowerCase();
            else if (typeof details.family === "string") familiesStr = details.family.toLowerCase();
            
            const nombre = modelo.toLowerCase();

            if (nombre.includes('embed') || familiesStr.includes('bert')) {
              modelosConfirmados.push(modelo);
            }
          }
        } catch (e) {
          console.warn(`Error al verificar modelo ${modelo} para embeddings:`, e);
        }
      }
      // Combinar modelos de Ollama con los de OpenAI (evitando duplicados)
      const todosLosModelos = [
        ...modelosConfirmados,
        ...MODELOS_EMBEDDING_OPENAI.filter(m => !modelosConfirmados.includes(m))
      ];
      modelosEmbedding = todosLosModelos;
      cacheModelosEmbedding[location.hostname] = modelosEmbedding;
      // Seleccionar por defecto uno si hay y no hay seleccion
      if (modelosEmbedding.length > 0 && !nuevoContextoEmbedding) {
        const preferido = seleccionarModeloDefault(modelosEmbedding);
        nuevoContextoEmbedding = preferido;
        aplicarChunkSugerido(preferido);
      }

      console.log('%c🧬 Modelos Embeddings detectados:', 'color:#d0f;font-weight:bold', modelosEmbedding);

    } catch (err) {
      console.error('Error al cargar modelos de embedding:', err);
      // Aunque falle la API, mostrar siempre los modelos de OpenAI
      if (modelosEmbedding.length === 0) {
        modelosEmbedding = [...MODELOS_EMBEDDING_OPENAI];
        if (!nuevoContextoEmbedding) {
          const preferido = seleccionarModeloDefault(modelosEmbedding);
          nuevoContextoEmbedding = preferido;
          aplicarChunkSugerido(preferido);
        }
      }
    } finally {
      cargandoModelosEmbedding = false;
    }
  }

  async function cargarContextosVectorizacion() {
    cargandoVectorizacionContextos = true;
    // Solo carga modelos si no están en caché
    if (modelosEmbedding.length === 0) {
      cargarModelosEmbedding();
    }
    vectorizacionContextos = [];
    errorVectorizacionContextos = '';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const filtro = proyectoActivoId ? `?proyecto_id=${encodeURIComponent(proyectoActivoId)}` : '';
      const res = await fetch(`${apiUrl.base}/listarContextos${filtro}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const mapa = data['Contextos existentes para este chatbot'] ?? {};
      vectorizacionContextos = Object.entries(mapa).map(([nombre, info]) => ({
        nombre,
        info: typeof info === 'object' ? info : {},
        timestamp: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
      }));
      console.log('%c📂 Contextos Admin cargados:', 'color:#0077ff;font-weight:bold', $state.snapshot(vectorizacionContextos));
    } catch (err) {
      if (err.name === 'AbortError') {
        errorVectorizacionContextos = '⏳ La API no respondió (tiempo de espera agotado). Puede estar ocupada procesando un documento. Intenta recargar en unos momentos.';
        console.warn('%c⏳ Timeout al cargar contextos admin — la API puede estar ocupada', 'color:orange;font-weight:bold');
      } else {
        errorVectorizacionContextos = 'API offline';
        console.error('%c❌ Error al cargar contextos admin', 'color:red;font-weight:bold', err);
      }
    } finally {
      cargandoVectorizacionContextos = false;
    }
  }

  async function crearContexto() {
    if (!nombreContextoGenerado || !nuevoContextoEmbedding.trim()) {
      mensajeCrearContexto = '❌ Selecciona un modelo de embedding';
      return;
    }

    const chunkSizeNum = parseInt(nuevoContextoChunkSize, 10);
    if (isNaN(chunkSizeNum) || chunkSizeNum < 1) {
      mensajeCrearContexto = '❌ Chunk size debe ser un número válido mayor a 0';
      return;
    }

    if (!proyectoActivoId) {
      mensajeCrearContexto = '❌ No hay proyecto activo. Selecciona uno en el header o crea uno en la subtab Proyectos.';
      return;
    }

    cargandoCrearContexto = true;
    mensajeCrearContexto = '';

    // Captura el nombre generado antes de que el form se resetee post-creación.
    const nombreCreado = nombreContextoGenerado;

    try {
      const nombre = encodeURIComponent(nombreCreado);
      const modelo = encodeURIComponent(nuevoContextoEmbedding.trim());
      const chunk = encodeURIComponent(chunkSizeNum);
      const proyId = encodeURIComponent(proyectoActivoId);
      const url = `${apiUrl.base}/crearContexto?nombre_contexto=${nombre}&embedding_model=${modelo}&chunk_size=${chunk}&proyecto_id=${proyId}`;

      console.groupCollapsed(`%c📤 POST /crearContexto`, 'color:#0077ff;font-weight:bold;font-size:12px');
      console.log('URL enviada :', `${apiUrl.real}/crearContexto`);
      console.log('Query params:', { nombre_contexto: nombre, embedding_model: modelo, chunk_size: chunk, proyecto_id: proyectoActivoId });
      console.groupEnd();

      const res = await fetch(url, {
        method: 'POST'
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '(sin detalles)');
        let friendlyMessage = errorText;
        try {
           const jsonError = JSON.parse(errorText);
           // Handle FastAPI detail format (string or array/object)
           if (jsonError.detail) {
             friendlyMessage = typeof jsonError.detail === 'string' 
               ? jsonError.detail 
               : JSON.stringify(jsonError.detail);
           } else {
             friendlyMessage = jsonError.message || jsonError.error || friendlyMessage;
           }
        } catch (e) {}

        if (res.status === 400) {
             throw new Error(friendlyMessage); 
        }
        throw new Error(`HTTP ${res.status}: ${friendlyMessage}`);
      }

      const data = await res.json();

      console.groupCollapsed(`%c📥 Respuesta /crearContexto`, 'color:#16a34a;font-weight:bold;font-size:12px');
      console.log('Status      :', res.status);
      console.log('Respuesta   :', data);
      console.groupEnd();

      mensajeCrearContexto = `✅ ${data.Mensaje ?? `Base de conocimiento "${nombreCreado}" creada exitosamente`}`;
      nuevoContextoEmbedding = '';
      nuevoContextoChunkSize = '1500';

      // Recarga la lista en el background para que el usuario la vea actualizada al regresar.
      setTimeout(() => {
        cargarContextosVectorizacion();
      }, 1000);

      // Auto-navega a Documentos con el flujo de edición activo (»).
      contextoSeleccionadoParaDocumentos = nombreCreado;
      vinoDeEditarContexto = true;
      vectorizacionTab = 'documentos';
      cargarDocumentosVectorizacion(nombreCreado);

    } catch (err) {
      console.error('%c❌ Error al crear contexto', 'color:red;font-weight:bold', err);
      mensajeCrearContexto = `❌ Error: ${err.message}`;
    } finally {
      cargandoCrearContexto = false;
    }
  }

  // Cuando la API devuelve 409 (BC en uso), guardamos el mensaje aquí para
  // mostrar el segundo modal de confirmación que permite forzar el borrado.
  let advertenciaBorrar = $state('');

  async function borrarContextoConfirmado(force = false) {
    if (!contextoABorrar.trim()) {
      mensajeBorrarContexto = '❌ Selecciona una base de conocimiento para borrar';
      return;
    }

    cargandoBorrarContexto = true;
    mensajeBorrarContexto = '';

    try {
      const nombreContexto = contextoABorrar.trim();
      const url = `${apiUrl.base}/borrarContexto?contexto=${encodeURIComponent(nombreContexto)}${force ? '&force=true' : ''}`;
      console.groupCollapsed(`%c📤 DELETE /borrarContexto${force ? ' (force)' : ''}`, 'color:#ff6b35;font-weight:bold;font-size:12px');
      console.log('URL enviada :', url);
      console.log('Force       :', force);
      console.groupEnd();

      const res = await fetch(url, { method: 'DELETE' });

      // 409: BC en uso por algún asistente. Capturamos el detail y mostramos el
      // segundo modal de "Borrar de todas formas" en vez de fallar duro.
      if (res.status === 409 && !force) {
        const body = await res.json().catch(() => ({}));
        advertenciaBorrar = body?.detail ?? 'Esta base de conocimiento está en uso por uno o más asistentes.';
        return;
      }

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '(sin detalles)');
        throw new Error(`HTTP ${res.status}: ${errorBody}`);
      }

      const data = await res.json();

      console.groupCollapsed(`%c📥 Respuesta /borrarContexto`, 'color:#16a34a;font-weight:bold;font-size:12px');
      console.log('Status      :', res.status);
      console.log('Respuesta   :', data);
      console.groupEnd();

      mensajeBorrarContexto = `✅ ${data.Mensaje ?? `Base de conocimiento "${contextoABorrar}" borrada exitosamente`}`;
      contextoABorrar = '';
      mostrarConfirmacionBorrar = false;
      advertenciaBorrar = '';

      // Recarga la lista después de 1 segundo
      setTimeout(() => {
        cargarContextosVectorizacion();
        // También recarga asistentes para reflejar que algunos quedaron sin BC
        cargarAsistentes();
      }, 1000);

    } catch (err) {
      console.error('%c❌ Error al borrar contexto', 'color:red;font-weight:bold', err);
      mensajeBorrarContexto = `❌ Error: ${err.message}`;
    } finally {
      cargandoBorrarContexto = false;
    }
  }

  function cancelarBorradoBC() {
    mostrarConfirmacionBorrar = false;
    advertenciaBorrar = '';
    contextoABorrar = '';
  }

  async function cargarDocumentosVectorizacion(contexto) {
    if (!contexto.trim()) {
      mensajeIntegrarDocumento = '❌ Selecciona una base de conocimiento primero';
      return;
    }

    cargandoVectorizacionDocumentos = true;
    vectorizacionDocumentos = [];

    try {
      const res = await fetch(`${apiUrl.base}/listarDocumentos?contexto=${encodeURIComponent(contexto)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // La API devuelve { contexto, documentos: [...], conteo }
      vectorizacionDocumentos = Array.isArray(data.documentos) ? data.documentos : [];
      console.log('%c📄 Documentos cargados:', 'color:#0077ff;font-weight:bold', vectorizacionDocumentos);
    } catch (err) {
      console.error('%c❌ Error al cargar documentos', 'color:red;font-weight:bold', err);
    } finally {
      cargandoVectorizacionDocumentos = false;
    }
  }

  async function integrarDocumento() {
    if (!contextoSeleccionadoParaDocumentos.trim()) {
      mensajeIntegrarDocumento = '❌ Selecciona una base de conocimiento';
      return;
    }
    if (!archivoParaIntegrar) {
      mensajeIntegrarDocumento = '❌ Selecciona un archivo';
      return;
    }

    cargandoIntegrarDocumento = true;
    progresoIntegrar = 0;
    mensajeIntegrarDocumento = '';

    // Guardar en localStorage que hay una integración en curso
    const infoIntegracion = {
      archivo: archivoParaIntegrar.name,
      contexto: contextoSeleccionadoParaDocumentos,
      inicio: new Date().toISOString()
    };
    localStorage.setItem('mide_integracion_pendiente', JSON.stringify(infoIntegracion));
    integracionEnCurso = infoIntegracion;

    try {
      const formData = new FormData();
      formData.append('documento', archivoParaIntegrar);

      const fetchUrl = `${apiUrl.base}/integrarDocumento?contexto=${encodeURIComponent(contextoSeleccionadoParaDocumentos)}`;

      console.groupCollapsed(`%c📤 POST /integrarDocumento`, 'color:#0077ff;font-weight:bold;font-size:12px');
      console.log('URL enviada :', `${apiUrl.real}/integrarDocumento`);
      console.log('Contexto   :', contextoSeleccionadoParaDocumentos);
      console.log('Archivo    :', archivoParaIntegrar.name);
      console.groupEnd();

      const nombreArchivo = archivoParaIntegrar.name;

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', fetchUrl);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            progresoIntegrar = Math.round((e.loaded / e.total) * 100);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            progresoIntegrar = 100;
            try {
              const data = JSON.parse(xhr.responseText);
              console.groupCollapsed(`%c📥 Respuesta /integrarDocumento`, 'color:#16a34a;font-weight:bold;font-size:12px');
              console.log('Status      :', xhr.status);
              console.log('Respuesta   :', data);
              console.groupEnd();
            } catch (_) {}
            resolve();
          } else {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText || '(sin detalles)'}`))
          }
        };

        xhr.onerror = () => reject(new Error('Error de red al enviar el archivo'));
        xhr.send(formData);
      });

      mensajeIntegrarDocumento = `✅ Documento "${nombreArchivo}" integrado exitosamente`;
      archivoParaIntegrar = null;
      localStorage.removeItem('mide_integracion_pendiente');
      integracionEnCurso = null;

      // Recarga la lista después de 1 segundo
      setTimeout(() => {
        cargarDocumentosVectorizacion(contextoSeleccionadoParaDocumentos);
      }, 1000);

    } catch (err) {
      console.error('%c❌ Error al integrar documento', 'color:red;font-weight:bold', err);
      mensajeIntegrarDocumento = `❌ Error: ${err.message}`;
    } finally {
      cargandoIntegrarDocumento = false;
      localStorage.removeItem('mide_integracion_pendiente');
      integracionEnCurso = null;
    }
  }

  async function borrarDocumentoConfirmado() {
    if (!documentoSeleccionadoParaBorrar.trim()) {
      mensajeBorrarDocumento = '❌ Selecciona un documento para borrar';
      return;
    }

    cargandoBorrarDocumento = true;
    mensajeBorrarDocumento = '';

    try {
      const payload = {
        filename: documentoSeleccionadoParaBorrar.trim(),
        contexto: contextoSeleccionadoParaDocumentos.trim()
      };

      console.groupCollapsed(`%c📤 DELETE /quitarDocumento`, 'color:#ff6b35;font-weight:bold;font-size:12px');
      console.log('URL enviada :', `${apiUrl.real}/quitarDocumento`);
      console.log('Payload     :', payload);
      console.groupEnd();

      const res = await fetch(`${apiUrl.base}/quitarDocumento`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '(sin detalles)');
        throw new Error(`HTTP ${res.status}: ${errorBody}`);
      }

      const data = await res.json();

      console.groupCollapsed(`%c📥 Respuesta /quitarDocumento`, 'color:#16a34a;font-weight:bold;font-size:12px');
      console.log('Status      :', res.status);
      console.log('Respuesta   :', data);
      console.groupEnd();

      mensajeBorrarDocumento = `✅ Documento "${documentoSeleccionadoParaBorrar}" borrado exitosamente`;
      documentoSeleccionadoParaBorrar = '';
      mostrarConfirmacionBorrarDocumento = false;

      // Recarga la lista después de 1 segundo
      setTimeout(() => {
        cargarDocumentosVectorizacion(contextoSeleccionadoParaDocumentos);
      }, 1000);

    } catch (err) {
      console.error('%c❌ Error al borrar documento', 'color:red;font-weight:bold', err);
      mensajeBorrarDocumento = `❌ Error: ${err.message}`;
    } finally {
      cargandoBorrarDocumento = false;
    }
  }

  // Asistente seleccionado en el Chatbot tab. Persiste en localStorage.
  let asistenteSeleccionadoId = $state(
    typeof localStorage !== 'undefined' ? localStorage.getItem('mide_agente_id') || '' : ''
  );
  const asistenteSeleccionado = $derived(
    asistentes.find((a) => a.id === asistenteSeleccionadoId) ?? null
  );
  const maxTurnos = $derived(asistenteSeleccionado?.historial_max ?? 5);

  $effect(() => {
    if (typeof localStorage !== 'undefined' && asistenteSeleccionadoId) {
      localStorage.setItem('mide_agente_id', asistenteSeleccionadoId);
    }
  });

  // Construye el historial en formato role/content (últimos N turnos)
  function buildHistorial() {
    if (maxTurnos === 0) return [];
    const historial = [];
    const convo = messages.filter((m) => m.role === 'user' || m.role === 'bot');
    let i = 0;
    while (i < convo.length) {
      if (convo[i]?.role === 'user' && convo[i + 1]?.role === 'bot') {
        historial.push({ role: 'user', content: convo[i].text });
        historial.push({ role: 'assistant', content: convo[i + 1].text });
        i += 2;
      } else {
        i += 1;
      }
    }
    // Cada turno = 2 entradas (user + assistant), conservar últimos N turnos
    return historial.slice(-maxTurnos * 2);
  }

  function formatTime(date) {
    return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  async function scrollToBottom() {
    await tick();
    if (chatContainer) {
      chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    }
  }

  const MENSAJE_INICIAL = {
    id: 1,
    role: 'bot',
    text: '¡Hola! Soy el asistente. ¿En qué puedo ayudarte hoy?',
    time: formatTime(new Date()),
  };

  function resetChat() {
    messages = [{ ...MENSAJE_INICIAL, time: formatTime(new Date()) }];
    inputText = '';
  }

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || isLoading) return;

    if (!asistenteSeleccionado) {
      messages = [
        ...messages,
        {
          id: Date.now() + 1,
          role: 'bot',
          text: '⚠️ Selecciona un asistente primero (o créalo en Construcción → Asistente).',
          time: formatTime(new Date()),
          isError: true,
        },
      ];
      return;
    }

    inputText = '';

    messages = [
      ...messages,
      { id: Date.now(), role: 'user', text, time: formatTime(new Date()) },
    ];
    await scrollToBottom();

    isLoading = true;

    try {
      const payload = {
        agente_id: asistenteSeleccionado.id,
        pregunta: text,
        historial: buildHistorial(),
      };

      console.groupCollapsed(`%c📤 POST /chatbot`, 'color:#c8102e;font-weight:bold;font-size:12px');
      console.log('URL enviada :', `${apiUrl.real}/chatbot`);
      console.log('Host        :', location.hostname);
      console.log('Payload     :', JSON.parse(JSON.stringify(payload)));
      console.log('Body JSON   :', JSON.stringify(payload, null, 2));
      console.groupEnd();

      const t0 = performance.now();

      const response = await fetch(`${apiUrl.base}/chatbot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '(sin body)');
        console.error(`%c❌ HTTP ${response.status}`, 'color:#red;font-weight:bold');
        console.error('Response body:', errorBody);
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }

      const data = await response.json();

      const elapsed = Math.round(performance.now() - t0);

      console.groupCollapsed(`%c📥 Respuesta /chatbot (${elapsed}ms)`, 'color:#16a34a;font-weight:bold;font-size:12px');
      console.log('Status      :', response.status);
      console.log('Tiempo      :', `${elapsed}ms`);
      console.log('JSON        :', data);
      console.log('Keys        :', Object.keys(data));
      console.groupEnd();

      // Extraer texto: recorre claves conocidas; si el valor es objeto, lo serializa.
      // Para modelos GPT-5/GPT-5.5 que vienen vía Responses API, el `content` es
      // un array de items {type, text, ...}. Aplanamos extrayendo solo los de tipo text.
      let candidato =
        data.Mensaje ?? data.respuesta ?? data.answer ?? data.response ?? data.message ?? data.content ?? data;
      if (Array.isArray(candidato)) {
        const textItems = candidato
          .filter((it) => it && typeof it === 'object' && it.type === 'text' && typeof it.text === 'string')
          .map((it) => it.text);
        if (textItems.length > 0) candidato = textItems.join('\n').trim();
      }
      const botText = typeof candidato === 'string'
        ? candidato
        : JSON.stringify(candidato, null, 2);

      registrarLog({
        pregunta: text,
        historial: payload.historial,
        respuesta: botText,
        ms: elapsed,
        contexto: asistenteSeleccionado.contexto,
        modelo: asistenteSeleccionado.modelo_llm,
      });

      messages = [
        ...messages,
        {
          id: Date.now() + 1,
          role: 'bot',
          text: botText,
          time: `${formatTime(new Date())} · ${elapsed}ms`,
        },
      ];
    } catch (err) {
      console.error('%c❌ Error al llamar /chatbot', 'color:red;font-weight:bold', err);

      registrarLog({
        pregunta: text,
        historial: payload?.historial ?? [],
        respuesta: null,
        ms: null,
        error: err.message,
        contexto: asistenteSeleccionado?.contexto,
        modelo: asistenteSeleccionado?.modelo_llm,
      });

      messages = [
        ...messages,
        {
          id: Date.now() + 1,
          role: 'bot',
          text: 'Lo siento, ocurrió un error al procesar tu mensaje. Por favor intenta de nuevo.',
          time: formatTime(new Date()),
          isError: true,
        },
      ];
    } finally {
      isLoading = false;
      await scrollToBottom();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
</script>

<div class="app" class:vectorizacion={activeTab === 'vectorizacion'} class:admin={activeTab === 'admin'}>
  <!-- Header -->
  <header class="header">
    <div class="header-left">
      <div class="avatar">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM8 17.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM9.5 8c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5S9.5 9.38 9.5 8zm6.5 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="white"/>
        </svg>
      </div>
      <div class="header-info">
        <h1 class="header-title">Constructor de Asistentes Buzzword</h1>
        <span class="header-version">versión {APP_VERSION}</span>
        <span class="header-status" onclick={verificarSalud} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && verificarSalud()} title="Click para verificar conexión" role="button" tabindex="0">
          <span class="status-dot" class:online={estadoSalud === 'online'} class:offline={estadoSalud === 'offline'} class:checking={estadoSalud === 'checking'}></span>
          {#if estadoSalud === 'online'}
            API en línea
          {:else if estadoSalud === 'offline'}
            Sin conexion
          {:else}
            Verificando...
          {/if}
        </span>
      </div>
      <div class="ambiente-indicador" title={`Sirviendo desde: ${location.host}`}>
        <span class="ambiente-indicador-label">Host</span>
        <span class="ambiente-indicador-valor">{location.hostname}</span>
      </div>
    </div>

    <div class="tabs-toggle">
      <button
        class="tab-btn"
        class:active={activeTab === 'vectorizacion'}
        onclick={() => { activeTab = 'vectorizacion'; verificarSalud(); }}
        aria-pressed={activeTab === 'vectorizacion'}
      ><Icon name="construccion" size={16} /> Construcción</button>
      <button
        class="tab-btn"
        class:active={activeTab === 'chat'}
        onclick={() => { activeTab = 'chat'; cargarAsistentes(); verificarSalud(); }}
        aria-pressed={activeTab === 'chat'}
      ><Icon name="chatbot" size={16} /> Chatbot</button>
      <button
        class="tab-btn admin-gear-btn"
        class:active={activeTab === 'admin'}
        onclick={() => { activeTab = 'admin'; cargarModelos(); cargarModelosEmbedding(); }}
        aria-pressed={activeTab === 'admin'}
        title="Administración"
      ><Icon name="admin" size={18} label="Administración" /></button>
    </div>
  </header>

  <!-- Sub-nav de chatbot -->
  {#if activeTab === 'chat'}
  <nav class="chat-subnav">
    <div class="context-select-wrap">
      <label for="asistente-chat-select">Asistente</label>
      {#if cargandoAsistentes}
        <span class="ctx-loading">cargando...</span>
      {:else if asistentes.length === 0}
        <span class="ctx-loading">sin asistentes — créalo en Construcción</span>
      {:else}
        <select id="asistente-chat-select" bind:value={asistenteSeleccionadoId}>
          <option value="">-- Selecciona Asistente --</option>
          {#each asistentes as a (a.id)}
            <option value={a.id}>{a.nombre}</option>
          {/each}
        </select>
      {/if}
    </div>
    {#if asistenteSeleccionado}
      <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; font-size: 0.78rem; color: rgba(255,255,255,0.7);">
        {#if asistenteSeleccionado.contexto}
          <span title="Base de Conocimiento"><Icon name="base-conocimiento" size={14} /> {asistenteSeleccionado.contexto}</span>
        {:else}
          <span title="Sin base de conocimiento — asistente conversacional puro" style="opacity:0.7;"><Icon name="sin-rag" size={14} /> sin RAG</span>
        {/if}
        <span title="Modelo LLM"><Icon name="modelo" size={14} /> {asistenteSeleccionado.modelo_llm}</span>
        <span title="Historial"><Icon name="historial" size={14} /> {asistenteSeleccionado.historial_max} turnos</span>
      </div>
    {/if}
    <div class="context-select-wrap" style="margin-left: auto;">
      <button
        class="clear-chat-btn"
        onclick={resetChat}
        disabled={messages.length <= 1}
        title="Limpiar conversación"
        aria-label="Limpiar conversación"
      >&#x1F5D1;</button>
    </div>
  </nav>
  {/if}

  <!-- Chat body -->
  {#if activeTab === 'chat'}
    <main class="chat-body" bind:this={chatContainer}>
      <div class="messages">
      {#each messages as msg (msg.id)}
        <div class="message-row {msg.role}" class:error={msg.isError}>
          {#if msg.role === 'bot'}
            <div class="bot-avatar">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM8 17.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM9.5 8c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5S9.5 9.38 9.5 8zm6.5 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/>
              </svg>
            </div>
          {/if}
          <div class="bubble-wrap">
            <div class="bubble">{msg.text}</div>
            <span class="time">{msg.time}</span>
          </div>
        </div>
      {/each}

      {#if isLoading}
        <div class="message-row bot">
          <div class="bot-avatar">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM8 17.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM9.5 8c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5S9.5 9.38 9.5 8zm6.5 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/>
            </svg>
          </div>
          <div class="bubble-wrap">
            <div class="bubble typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>
      {/if}
      </div>
    </main>
  {/if}

  <!-- Input area -->
  {#if activeTab === 'chat'}
  <footer class="input-area">
    <div class="input-container">
      <button
        onclick={resetChat}
        disabled={isLoading || messages.length === 0}
        aria-label="Limpiar chat"
        class="reset-btn"
        title="Limpiar conversación"
      >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor"/>
        </svg>
      </button>
      <textarea
        bind:value={inputText}
        onkeydown={handleKeydown}
        placeholder={asistenteSeleccionado ? "Escribe tu mensaje..." : "Selecciona un asistente primero"}
        rows="1"
        disabled={isLoading || !asistenteSeleccionado}
      ></textarea>
      <button
        onclick={sendMessage}
        disabled={!inputText.trim() || isLoading || !asistenteSeleccionado}
        aria-label="Enviar mensaje"
      >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/>
        </svg>
      </button>
    </div>
    <p class="disclaimer">Constructor de Asistentes</p>
  </footer>
  {/if}

  <!-- Vectorización section -->
  {#if activeTab === 'vectorizacion'}
    <main class="vectorizacion-body">
      <div class="vectorizacion-container">

        <!-- Banner de integración en curso -->
        {#if integracionEnCurso && !cargandoIntegrarDocumento}
          <div class="banner-integracion">
            <div class="banner-integracion-icon"><Icon name="cargando" size={28} /></div>
            <div class="banner-integracion-text">
              <strong>Integración en curso</strong>
              <p>El documento <strong>"{integracionEnCurso.archivo}"</strong> se está procesando en la base de conocimiento <strong>"{integracionEnCurso.contexto}"</strong>. La API puede tardar en responder a otras peticiones.</p>
              <button class="banner-dismiss-btn" onclick={() => { localStorage.removeItem('mide_integracion_pendiente'); integracionEnCurso = null; }}>✕ Descartar</button>
            </div>
          </div>
        {/if}

        <!-- Mensaje de Error Global -->
        {#if errorVectorizacionContextos && estadoSalud !== 'online'}
          <div style="margin-bottom: 1.5rem; padding: 1rem; background: rgba(200,40,40,0.9); border-radius: 8px;">
            <p style="color: #fff; font-size: 0.95rem; line-height: 1.5; margin: 0; font-weight: 500;">❌ {errorVectorizacionContextos}</p>
          </div>
        {/if}

        <!-- Sub-tab bar -->
        <div class="vectorizacion-subtabs">
          {#if vinoDeCambiarProyecto}
            <span class="subtab-arrow-indicator" aria-hidden="true">»</span>
          {/if}
          <button
            class="vectorizacion-subtab-btn"
            class:active={vectorizacionTab === 'proyectos'}
            onclick={() => { vectorizacionTab = 'proyectos'; vinoDeCrearProyecto = false; vinoDeCambiarProyecto = false; cargarProyectos(); }}
          >
            <Icon name="proyecto" size={16} /> Proyectos
          </button>
          {#if vinoDeCrearProyecto && vectorizacionContextos.length === 0}
            <span class="subtab-arrow-indicator" aria-hidden="true">»</span>
          {/if}
          <button
            class="vectorizacion-subtab-btn"
            class:active={vectorizacionTab === 'contextos' || vectorizacionTab === 'documentos'}
            onclick={() => { vectorizacionTab = 'contextos'; vinoDeEditarContexto = false; }}
          >
            <Icon name="base-conocimiento" size={16} /> Bases de Conocimiento
          </button>
          <button
            class="vectorizacion-subtab-btn"
            class:active={vectorizacionTab === 'asistente'}
            onclick={() => { vectorizacionTab = 'asistente'; cargarAsistentes(); cargarContextos(); }}
          >
            <Icon name="asistente" size={16} /> Asistentes
          </button>
          <button
            class="vectorizacion-subtab-btn"
            class:active={vectorizacionTab === 'sandbox'}
            onclick={() => { vectorizacionTab = 'sandbox'; cargarAsistentes(); }}
          >
            <Icon name="sandbox" size={16} /> Sandbox
          </button>
          <button
            class="vectorizacion-subtab-btn"
            class:active={vectorizacionTab === 'miniadmin'}
            onclick={() => { vectorizacionTab = 'miniadmin'; cargarAsistentes(); }}
          >
            <Icon name="miniadmin" size={16} /> MiniAdmin
          </button>
        </div>

        <!-- Dashboard -->
        <!-- Proyectos -->
        {#if vectorizacionTab === 'proyectos'}
          {#if proyectoActivo}
            <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.85rem; background: rgba(0,0,0,0.18); border-radius: 8px; margin-bottom: 1rem; font-size: 0.85rem; color: rgba(255,255,255,0.85);">
              <Icon name="proyecto" size={14} />
              <span>Trabajando en proyecto: <strong>{proyectoActivo.nombre}</strong></span>
              <code style="background: rgba(0,0,0,0.3); padding: 1px 6px; border-radius: 4px; font-size: 0.75rem; color: rgba(255,255,255,0.7);">{proyectoActivo.slug}</code>
              <button
                onclick={() => { vectorizacionTab = 'proyectos'; vinoDeCambiarProyecto = true; cargarProyectos(); }}
                style="margin-left: auto; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); color: rgba(255,255,255,0.9); cursor: pointer; font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 5px; transition: background 0.15s;"
                onmouseover={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
                onmouseout={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                title="Ir a Proyectos para cambiar el proyecto activo"
              >Cambiar de proyecto</button>
            </div>
          {/if}
          <div class="crear-contexto-wrap" class:abierto={proyectoFormAbierto}>
            <button class="crear-contexto-toggle" onclick={() => proyectoFormAbierto ? cerrarFormProyecto() : abrirFormCrearProyecto()}>
              <h3>
                {#if proyectoEditandoId}
                  <Icon name="editar" size={18} /> Editar Proyecto
                {:else}
                  <Icon name="crear" size={18} /> Crear Nuevo Proyecto
                {/if}
              </h3>
            </button>
            {#if proyectoFormAbierto}
              <div class="crear-contexto-form" style="flex-direction: column; align-items: stretch; max-width: 720px;">
                <div class="form-field">
                  <label for="proyecto-slug">Slug {proyectoEditandoId ? '(no modificable)' : ''}</label>
                  <input
                    id="proyecto-slug"
                    type="text"
                    placeholder="ej: banfondesa"
                    bind:value={proyectoFormSlug}
                    disabled={cargandoGuardarProyecto || !!proyectoEditandoId}
                    class="contexto-input"
                  />
                  <small style="font-size: 0.75rem; color: rgba(0,0,0,0.6); line-height: 1.3; display: block; margin-top: 0.25rem;">
                    Identidad estable cross-ambiente. Lowercase, dígitos y guiones, 2-64 chars.
                  </small>
                </div>
                <div class="form-field">
                  <label for="proyecto-nombre">Nombre</label>
                  <input
                    id="proyecto-nombre"
                    type="text"
                    placeholder="ej: Banfondesa"
                    bind:value={proyectoFormNombre}
                    disabled={cargandoGuardarProyecto}
                    maxlength="80"
                    class="contexto-input"
                  />
                </div>
                <div class="form-field">
                  <label for="proyecto-descripcion">Descripción (opcional)</label>
                  <textarea
                    id="proyecto-descripcion"
                    bind:value={proyectoFormDescripcion}
                    disabled={cargandoGuardarProyecto}
                    rows="3"
                    maxlength="500"
                    class="contexto-input"
                    style="font-family: inherit; resize: vertical;"
                    placeholder="Para qué sirve este proyecto, qué agrupa..."
                  ></textarea>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                  <button
                    onclick={guardarProyecto}
                    disabled={cargandoGuardarProyecto}
                    class="crear-contexto-btn"
                  >
                    {cargandoGuardarProyecto ? '⟳ Guardando...' : (proyectoEditandoId ? '✓ Actualizar' : '✓ Crear')}
                  </button>
                  <button
                    onclick={cerrarFormProyecto}
                    disabled={cargandoGuardarProyecto}
                    class="crear-contexto-btn"
                    style="background: rgba(0,0,0,0.45); color: rgba(255,255,255,0.95);"
                  >
                    Cancelar
                  </button>
                </div>
                {#if mensajeProyecto}
                  <p class="mensaje-contexto" class:success={mensajeProyecto.includes('✅')}>
                    {mensajeProyecto}
                  </p>
                {/if}
              </div>
            {/if}
          </div>

          <div class="contextos-table-wrap">
            <div class="seccion-header">
              <h3><Icon name="proyecto" size={18} /> Proyectos Existentes</h3>
              <button onclick={cargarProyectos} class="vectorizacion-action-btn contextos-recargar-btn" disabled={cargandoProyectos} aria-label="Recargar proyectos" title="Recargar proyectos">
                <Icon name="recargar" size={16} />
              </button>
            </div>
            {#if errorCargarProyectos}
              <p class="mensaje-contexto" style="margin-top: 0.5rem;">❌ {errorCargarProyectos}</p>
            {/if}
            {#if cargandoProyectos}
              <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 1rem 0;">⟳ Cargando proyectos...</p>
            {:else if proyectos.length === 0}
              <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 1rem 0;">No hay proyectos creados todavía.</p>
            {:else}
              <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.5rem;">
                {#each proyectos as p (p.id)}
                  {@const esActivo = p.id === proyectoActivoId}
                  <div style="background: {esActivo ? 'rgba(34,197,94,0.18)' : 'rgba(0,0,0,0.2)'}; border: {esActivo ? '1px solid rgba(34,197,94,0.5)' : '1px solid transparent'}; border-radius: 8px; padding: 1rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;">
                    <div style="flex: 1; min-width: 0;">
                      <div style="display: flex; align-items: baseline; gap: 0.75rem; flex-wrap: wrap;">
                        {#if esActivo}
                          <span style="color: #4ade80; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;">
                            <Icon name="check" size={14} /> ACTIVO
                          </span>
                        {/if}
                        <strong style="color: #fff; font-size: 1rem;">{p.nombre}</strong>
                        <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 0.8rem; color: rgba(255,255,255,0.75);">{p.slug}</code>
                      </div>
                      {#if p.descripcion}
                        <p style="color: rgba(255,255,255,0.7); font-size: 0.85rem; margin: 0.5rem 0 0 0; line-height: 1.4;">
                          {p.descripcion}
                        </p>
                      {/if}
                    </div>
                    <div style="display: flex; gap: 0.4rem; flex-shrink: 0; align-items: center;">
                      {#if !esActivo}
                        <button onclick={() => { proyectoActivoId = p.id; vinoDeCambiarProyecto = false; }} class="vectorizacion-action-btn" title="Activar este proyecto" style="background: rgba(34,197,94,0.25); border-color: rgba(34,197,94,0.5);">
                          Activar
                        </button>
                      {/if}
                      <button
                        onclick={() => { proyectoActivoId = p.id; vinoDeCambiarProyecto = false; vectorizacionTab = 'contextos'; }}
                        class="vectorizacion-action-btn"
                        title="Ir a Bases de Conocimiento de este proyecto"
                      >
                        <Icon name="base-conocimiento" size={16} label="Bases de Conocimiento" />
                      </button>
                      <button onclick={() => abrirFormEditarProyecto(p)} class="vectorizacion-action-btn" title="Editar proyecto"><Icon name="editar" size={16} label="Editar" /></button>
                      <button onclick={() => pedirConfirmacionBorrarProyecto(p)} class="vectorizacion-action-btn" title="Borrar proyecto"><Icon name="borrar" size={16} label="Borrar" /></button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          {#if mostrarConfirmacionBorrarProyecto && proyectoABorrar}
            <div class="confirmacion-borrar">
              <h3><Icon name="warning" size={18} /> Confirmar Borrado de Proyecto</h3>
              <p style="color: rgba(255,255,255,0.85);">
                ¿Estás seguro de borrar el proyecto <strong>{proyectoABorrar.nombre}</strong> (<code>{proyectoABorrar.slug}</code>)?
              </p>
              <p style="color: rgba(0,0,0,0.55); font-size: 0.85rem;">
                Cuando esté el backend, esto fallará si el proyecto tiene bases de conocimiento o asistentes asociados.
              </p>
              <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                <button onclick={borrarProyectoConfirmado} disabled={cargandoBorrarProyecto} class="crear-contexto-btn" style="background: #c8102e;">
                  {cargandoBorrarProyecto ? '⟳ Borrando...' : '🗑️ Sí, borrar'}
                </button>
                <button onclick={() => { mostrarConfirmacionBorrarProyecto = false; proyectoABorrar = null; }} disabled={cargandoBorrarProyecto} class="crear-contexto-btn" style="background: rgba(0,0,0,0.45); color: rgba(255,255,255,0.95);">
                  Cancelar
                </button>
              </div>
            </div>
          {/if}
        {/if}

        <!-- Asistente -->
        {#if vectorizacionTab === 'asistente'}
          {#if proyectoActivo}
            <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.85rem; background: rgba(0,0,0,0.18); border-radius: 8px; margin-bottom: 1rem; font-size: 0.85rem; color: rgba(255,255,255,0.85);">
              <Icon name="proyecto" size={14} />
              <span>Trabajando en proyecto: <strong>{proyectoActivo.nombre}</strong></span>
              <code style="background: rgba(0,0,0,0.3); padding: 1px 6px; border-radius: 4px; font-size: 0.75rem; color: rgba(255,255,255,0.7);">{proyectoActivo.slug}</code>
              <button
                onclick={() => { vectorizacionTab = 'proyectos'; vinoDeCambiarProyecto = true; cargarProyectos(); }}
                style="margin-left: auto; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); color: rgba(255,255,255,0.9); cursor: pointer; font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 5px; transition: background 0.15s;"
                onmouseover={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
                onmouseout={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                title="Ir a Proyectos para cambiar el proyecto activo"
              >Cambiar de proyecto</button>
            </div>
          {:else}
            <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; background: rgba(200,40,40,0.85); border-radius: 8px; margin-bottom: 1rem; color: #fff; font-size: 0.9rem;">
              <Icon name="warning" size={16} />
              <span>No hay proyecto activo. Crea o selecciona uno en <strong>📁 Proyectos</strong> antes de crear asistentes.</span>
            </div>
          {/if}
          <div class="crear-contexto-wrap" class:abierto={asistenteFormAbierto}>
            <button class="crear-contexto-toggle" onclick={() => asistenteFormAbierto ? cerrarFormAsistente() : abrirFormCrearAsistente()}>
              <h3>
                {#if asistenteEditandoId}
                  <Icon name="editar" size={18} /> Editar Asistente
                {:else}
                  <Icon name="crear" size={18} /> Crear Nuevo Asistente
                {/if}
              </h3>
            </button>
            {#if asistenteFormAbierto}
              <div class="crear-contexto-form" style="flex-direction: column; align-items: stretch; max-width: 720px;">
                <div class="form-field">
                  <label for="asistente-slug" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    Slug {asistenteEditandoId ? '(no modificable)' : ''}
                    <span
                      title="Identidad estable cross-ambiente. Lowercase, dígitos y guiones, 2-64 chars."
                      style="display: inline-flex; cursor: help; opacity: 0.65;"
                      aria-label="Información sobre el slug"
                    >
                      <Icon name="info" size={14} />
                    </span>
                  </label>
                  <input
                    id="asistente-slug"
                    type="text"
                    placeholder="ej: soporte-ventas"
                    bind:value={asistenteFormSlug}
                    disabled={cargandoGuardarAsistente || !!asistenteEditandoId}
                    class="contexto-input"
                  />
                </div>
                <div class="form-field">
                  <label for="asistente-nombre">Nombre</label>
                  <input
                    id="asistente-nombre"
                    type="text"
                    placeholder="ej: Soporte Ventas"
                    bind:value={asistenteFormNombre}
                    disabled={cargandoGuardarAsistente}
                    maxlength="80"
                    class="contexto-input"
                  />
                </div>
                <div class="form-field">
                  <label for="asistente-mensaje-inicial" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    Mensaje inicial
                    <span
                      title="Saludo que el chatbot muestra al abrirse, antes de que el usuario escriba. Si lo dejas vacío se usa el default."
                      style="display: inline-flex; cursor: help; opacity: 0.65;"
                      aria-label="Información sobre el mensaje inicial"
                    >
                      <Icon name="info" size={14} />
                    </span>
                  </label>
                  <textarea
                    id="asistente-mensaje-inicial"
                    bind:value={asistenteFormMensajeInicial}
                    disabled={cargandoGuardarAsistente}
                    rows="3"
                    maxlength="500"
                    class="contexto-input"
                    style="font-family: inherit; resize: vertical; padding: 0.75rem 1rem; background: rgba(0,0,0,0.4); border: 1px dashed rgba(255,255,255,0.25); border-radius: 8px; color: rgba(255,255,255,0.9); font-size: 0.85rem; line-height: 1.5;"
                    placeholder="¡Hola! ¿En qué puedo ayudarte hoy?"
                  ></textarea>
                </div>
                <div class="form-field">
                  <label for="asistente-contexto" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    Base de Conocimiento
                    <span
                      title="Base de Conocimiento previamente creada, que contiene el conocimiento que requiere el Asistente para operar."
                      style="display: inline-flex; cursor: help; opacity: 0.65;"
                      aria-label="Información sobre la Base de Conocimiento"
                    >
                      <Icon name="info" size={14} />
                    </span>
                  </label>
                  <select
                    id="asistente-contexto"
                    bind:value={asistenteFormContexto}
                    disabled={cargandoGuardarAsistente}
                    class="contexto-input"
                    style="display: block; width: 100%;"
                  >
                    <option value="">— Sin base de conocimiento —</option>
                    {#each contextos as ctx (ctx)}
                      <option value={ctx}>{ctx}</option>
                    {/each}
                  </select>
                </div>
                <div class="form-field">
                  <label for="asistente-modelo" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    Modelo LLM
                    <span
                      title="Modelo de lenguaje que interpretará la información de la base de conocimiento e interactuará con el cliente."
                      style="display: inline-flex; cursor: help; opacity: 0.65;"
                      aria-label="Información sobre el modelo LLM"
                    >
                      <Icon name="info" size={14} />
                    </span>
                  </label>
                  <select
                    id="asistente-modelo"
                    bind:value={asistenteFormModelo}
                    onchange={sincronizarVariablesAsistente}
                    disabled={cargandoGuardarAsistente}
                    class="contexto-input"
                    style="display: block; width: 100%;"
                  >
                    {#each MODELOS as m (m)}
                      <option value={m}>{m}</option>
                    {/each}
                    {#each MODELOS_OPENAI as m (m)}
                      <option value={m}>{m}</option>
                    {/each}
                  </select>
                </div>

                {#if placeholderVariables.length > 0}
                  <div class="form-field">
                    <label style="display: inline-flex; align-items: center; gap: 0.35rem;">
                      Variables de la plantilla
                      <span
                        title="Llena las variables y las instrucciones se generan automáticamente abajo. Las variables marcadas como opcional se pueden vaciar para omitirlas del prompt. Puedes editar el textarea manualmente como ajuste final."
                        style="display: inline-flex; cursor: help; opacity: 0.65;"
                        aria-label="Información sobre las variables de la plantilla"
                      >
                        <Icon name="info" size={14} />
                      </span>
                    </label>
                    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                      {#each placeholderVariables as varName (varName)}
                        {@const meta = PLACEHOLDER_VARIABLES_META[varName]}
                        <div>
                          <div style="font-size: 0.7rem; color: rgba(0,0,0,0.7); margin-bottom: 0.25rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.35rem;">
                            <code style="background: rgba(0,0,0,0.08); padding: 1px 5px; border-radius: 3px;">[{varName}]</code>
                            {#if meta?.optional}
                              <span
                                title={`Opcional, déjalo vacío para omitir${meta.wrap ? `; los ${meta.wrap} se añaden automáticamente` : ''}`}
                                style="display: inline-flex; cursor: help; opacity: 0.65;"
                                aria-label={`Información sobre [${varName}]`}
                              >
                                <Icon name="info" size={12} />
                              </span>
                            {:else if meta?.description}
                              <span
                                title={meta.description}
                                style="display: inline-flex; cursor: help; opacity: 0.65;"
                                aria-label={`Información sobre [${varName}]`}
                              >
                                <Icon name="info" size={12} />
                              </span>
                            {/if}
                          </div>
                          <input
                            type="text"
                            placeholder={meta?.placeholder ?? varName}
                            bind:value={asistenteFormVariables[varName]}
                            disabled={cargandoGuardarAsistente}
                            class="contexto-input"
                            style="width: 100%; box-sizing: border-box;{meta?.optional ? ' border-style: dashed;' : ''}"
                            aria-label={`Valor para [${varName}]`}
                          />
                        </div>
                      {/each}
                    </div>
                  </div>

                {/if}

                <div class="form-field">
                  <label for="asistente-instrucciones">Instrucciones (system prompt)</label>
                  <textarea
                    id="asistente-instrucciones"
                    bind:value={asistenteFormInstrucciones}
                    disabled={cargandoGuardarAsistente}
                    rows="8"
                    class="contexto-input"
                    style="font-family: inherit; resize: vertical; padding: 0.75rem 1rem; background: rgba(0,0,0,0.4); border: 1px dashed rgba(255,255,255,0.25); border-radius: 8px; color: rgba(255,255,255,0.9); font-size: 0.85rem; line-height: 1.5;"
                    placeholder={placeholderInstrucciones}
                  ></textarea>
                </div>
                <div class="form-field">
                  <label for="asistente-historial" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    Historial Max (turnos)
                    <span
                      title="La cantidad de turnos que el usuario pregunta y el asistente responde, que quieres guardar como contexto de la conversación."
                      style="display: inline-flex; cursor: help; opacity: 0.65;"
                      aria-label="Información sobre el historial máximo"
                    >
                      <Icon name="info" size={14} />
                    </span>
                  </label>
                  <select
                    id="asistente-historial"
                    bind:value={asistenteFormHistorialMax}
                    disabled={cargandoGuardarAsistente}
                    class="contexto-input"
                    style="display: block; width: 100%;"
                  >
                    <option value={0}>Sin Contexto</option>
                    <option value={1}>1 turno</option>
                    <option value={3}>3 turnos</option>
                    <option value={5}>5 turnos</option>
                    <option value={10}>10 turnos</option>
                  </select>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                  <button
                    onclick={guardarAsistente}
                    disabled={cargandoGuardarAsistente}
                    class="crear-contexto-btn"
                  >
                    {cargandoGuardarAsistente ? '⟳ Guardando...' : (asistenteEditandoId ? '✓ Actualizar' : '✓ Crear')}
                  </button>
                  <button
                    onclick={cerrarFormAsistente}
                    disabled={cargandoGuardarAsistente}
                    class="crear-contexto-btn"
                    style="background: rgba(0,0,0,0.45); color: rgba(255,255,255,0.95);"
                  >
                    Cancelar
                  </button>
                </div>
                {#if mensajeAsistente}
                  <p class="mensaje-contexto" class:success={mensajeAsistente.includes('✅')}>
                    {mensajeAsistente}
                  </p>
                {/if}
              </div>
            {/if}
          </div>

          <div class="contextos-table-wrap">
            <div class="seccion-header">
              <h3><Icon name="asistente" size={18} /> Asistentes Existentes</h3>
              <button onclick={cargarAsistentes} class="vectorizacion-action-btn contextos-recargar-btn" disabled={cargandoAsistentes} aria-label="Recargar asistentes" title="Recargar asistentes">
                <Icon name="recargar" size={16} />
              </button>
            </div>
            {#if errorCargarAsistentes}
              <p class="mensaje-contexto" style="margin-top: 0.5rem;">❌ {errorCargarAsistentes}</p>
            {/if}
            {#if cargandoAsistentes}
              <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 1rem 0;">⟳ Cargando asistentes...</p>
            {:else if asistentes.length === 0}
              <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 1rem 0;">No hay asistentes creados todavía.</p>
            {:else}
              <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.5rem;">
                {#each asistentes as asistente (asistente.id)}
                  {@const asistenteEmbedUrl = `${hostAsistentesBase}/embed/chat/${encodeURIComponent(asistente.slug)}`}
                  <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 1rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;">
                    <div style="flex: 1; min-width: 0;">
                      <div style="display: flex; align-items: baseline; gap: 0.75rem; flex-wrap: wrap;">
                        {#if asistente.slug === lightbotAsistenteSlug}
                          <span title="Default del Lightbot" style="color: #fbbf24; display: inline-flex; align-items: center;">
                            <Icon name="estrella" size={16} label="Default" />
                          </span>
                        {/if}
                        <strong style="color: #fff; font-size: 1rem;">{asistente.nombre}</strong>
                        <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 0.8rem; color: rgba(255,255,255,0.75);">{asistente.slug}</code>
                      </div>
                      <p style="color: rgba(255,255,255,0.7); font-size: 0.85rem; margin: 0.5rem 0 0 0; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
                        {asistente.instrucciones}
                      </p>
                      <div style="display: flex; gap: 1.1rem; margin-top: 0.6rem; font-size: 0.9rem; color: rgba(255,255,255,0.7); align-items: center; flex-wrap: wrap;">
                        {#if asistente.contexto}
                          <span style="display: inline-flex; align-items: center; gap: 0.3rem;"><Icon name="base-conocimiento" size={16} /> {asistente.contexto}</span>
                        {:else}
                          <span style="opacity:0.7; display: inline-flex; align-items: center; gap: 0.3rem;"><Icon name="sin-rag" size={16} /> sin RAG</span>
                        {/if}
                        <span style="display: inline-flex; align-items: center; gap: 0.3rem;"><Icon name="modelo" size={16} /> {asistente.modelo_llm}</span>
                        <span style="display: inline-flex; align-items: center; gap: 0.3rem;"><Icon name="historial" size={16} /> {asistente.historial_max} turnos</span>
                        <button
                          type="button"
                          onclick={() => copiarUrl(asistenteEmbedUrl)}
                          title="Copiar URL del widget de chat"
                          class="asistente-link-chip"
                        >
                          <Icon name="link" size={16} />
                          {urlCopiada === asistenteEmbedUrl ? '✓ copiado' : 'link'}
                        </button>
                      </div>
                    </div>
                    <div style="display: flex; gap: 0.4rem; flex-shrink: 0;">
                      <button onclick={() => abrirLookAndFeel(asistente)} class="vectorizacion-action-btn" title="Look and Feel"><Icon name="look-and-feel" size={16} label="Look and Feel" /></button>
                      <button onclick={() => abrirFormEditarAsistente(asistente)} class="vectorizacion-action-btn" title="Editar asistente"><Icon name="editar" size={16} label="Editar" /></button>
                      <button onclick={() => pedirConfirmacionBorrarAsistente(asistente)} class="vectorizacion-action-btn" title="Borrar asistente"><Icon name="borrar" size={16} label="Borrar" /></button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          {#if mostrarConfirmacionBorrarAsistente && asistenteABorrar}
            <div class="confirmacion-borrar">
              <h3><Icon name="warning" size={18} /> Confirmar Borrado de Asistente</h3>
              <p style="color: rgba(255,255,255,0.85);">
                ¿Estás seguro de borrar el asistente <strong>{asistenteABorrar.nombre}</strong> (<code>{asistenteABorrar.slug}</code>)? Esta acción no se puede deshacer.
              </p>
              <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                <button onclick={borrarAsistenteConfirmado} disabled={cargandoBorrarAsistente} class="crear-contexto-btn" style="background: #c8102e;">
                  {cargandoBorrarAsistente ? '⟳ Borrando...' : '🗑️ Sí, borrar'}
                </button>
                <button onclick={() => { mostrarConfirmacionBorrarAsistente = false; asistenteABorrar = null; }} disabled={cargandoBorrarAsistente} class="crear-contexto-btn" style="background: rgba(0,0,0,0.45); color: rgba(255,255,255,0.95);">
                  Cancelar
                </button>
              </div>
            </div>
          {/if}

          {#if lookAndFeelAsistente}
            <div class="modal-overlay" onclick={cerrarLookAndFeel} role="presentation">
              <div class="modal-content" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" style="max-width: 720px; width: 92%;">
                <h3 style="margin: 0 0 0.25rem;"><Icon name="look-and-feel" size={18} /> Look and Feel — {lookAndFeelAsistente.nombre}</h3>
                <p style="color: rgba(255,255,255,0.7); font-size: 0.85rem; margin: 0 0 1rem;">
                  Personaliza los colores del widget para <code>{lookAndFeelAsistente.slug}</code>. Aplica al chatbot y al MiniAdmin.
                </p>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.85rem; margin-bottom: 1rem;">
                  <label style="display: flex; flex-direction: column; gap: 0.35rem; color: rgba(255,255,255,0.9); font-size: 0.85rem;">
                    Color primario (avatar, botón enviar, dots)
                    <span style="display: flex; align-items: center; gap: 0.5rem;">
                      <input type="color" bind:value={lookAndFeelForm.color_primario} style="width: 44px; height: 36px; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; background: transparent; cursor: pointer;" />
                      <input type="text" bind:value={lookAndFeelForm.color_primario} placeholder="#5b6abf" maxlength="7" class="contexto-input" style="flex: 1; font-family: monospace; text-transform: lowercase;" />
                    </span>
                  </label>

                  <label style="display: flex; flex-direction: column; gap: 0.35rem; color: rgba(255,255,255,0.9); font-size: 0.85rem;">
                    Burbuja del bot
                    <span style="display: flex; align-items: center; gap: 0.5rem;">
                      <input type="color" bind:value={lookAndFeelForm.color_burbuja_bot} style="width: 44px; height: 36px; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; background: transparent; cursor: pointer;" />
                      <input type="text" bind:value={lookAndFeelForm.color_burbuja_bot} placeholder="#d4e4f7" maxlength="7" class="contexto-input" style="flex: 1; font-family: monospace; text-transform: lowercase;" />
                    </span>
                  </label>

                  <label style="display: flex; flex-direction: column; gap: 0.35rem; color: rgba(255,255,255,0.9); font-size: 0.85rem;">
                    Fondo del chat
                    <span style="display: flex; align-items: center; gap: 0.5rem;">
                      <input type="color" bind:value={lookAndFeelForm.color_fondo_chat} style="width: 44px; height: 36px; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; background: transparent; cursor: pointer;" />
                      <input type="text" bind:value={lookAndFeelForm.color_fondo_chat} placeholder="#f0f2f5" maxlength="7" class="contexto-input" style="flex: 1; font-family: monospace; text-transform: lowercase;" />
                    </span>
                  </label>

                  <label style="display: flex; flex-direction: column; gap: 0.35rem; color: rgba(255,255,255,0.9); font-size: 0.85rem;">
                    Header
                    <span style="display: flex; align-items: center; gap: 0.5rem;">
                      <input type="color" bind:value={lookAndFeelForm.color_header} style="width: 44px; height: 36px; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; background: transparent; cursor: pointer;" />
                      <input type="text" bind:value={lookAndFeelForm.color_header} placeholder="#ffffff" maxlength="7" class="contexto-input" style="flex: 1; font-family: monospace; text-transform: lowercase;" />
                    </span>
                  </label>
                </div>

                <!-- Vista previa rápida -->
                <div style="border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; overflow: hidden; margin-bottom: 1rem; background: {lookAndFeelForm.color_fondo_chat};">
                  <div style="background: {lookAndFeelForm.color_header}; padding: 0.6rem 0.85rem; display: flex; align-items: center; gap: 0.6rem; border-bottom: 1px solid rgba(0,0,0,0.08);">
                    <span style="display: inline-block; width: 28px; height: 28px; border-radius: 50%; background: {lookAndFeelForm.color_primario};"></span>
                    <strong style="color: #1a1a2e; font-size: 0.85rem;">{lookAndFeelAsistente.nombre}</strong>
                  </div>
                  <div style="padding: 0.85rem;">
                    <div style="display: inline-block; background: {lookAndFeelForm.color_burbuja_bot}; color: #1a1a2e; padding: 0.5rem 0.75rem; border-radius: 14px; font-size: 0.8rem;">
                      Vista previa de mensaje del bot
                    </div>
                  </div>
                </div>

                {#if mensajeTema}
                  <p style="font-size: 0.85rem; color: rgba(255,255,255,0.85); margin-bottom: 0.75rem;">{mensajeTema}</p>
                {/if}

                <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                  <button onclick={resetearTema} disabled={cargandoGuardarTema} class="crear-contexto-btn" style="background: rgba(0,0,0,0.45); color: rgba(255,255,255,0.95);">
                    Reset a defaults
                  </button>
                  <button onclick={cerrarLookAndFeel} disabled={cargandoGuardarTema} class="crear-contexto-btn" style="background: rgba(0,0,0,0.45); color: rgba(255,255,255,0.95);">
                    Cancelar
                  </button>
                  <button onclick={guardarTema} disabled={cargandoGuardarTema} class="crear-contexto-btn">
                    {cargandoGuardarTema ? '⟳ Guardando...' : '✓ Guardar'}
                  </button>
                </div>
              </div>
            </div>
          {/if}
        {/if}

        <!-- Contextos -->
        {#if vectorizacionTab === 'contextos'}
          {#if proyectoActivo}
            <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.85rem; background: rgba(0,0,0,0.18); border-radius: 8px; margin-bottom: 1rem; font-size: 0.85rem; color: rgba(255,255,255,0.85);">
              <Icon name="proyecto" size={14} />
              <span>Trabajando en proyecto: <strong>{proyectoActivo.nombre}</strong></span>
              <code style="background: rgba(0,0,0,0.3); padding: 1px 6px; border-radius: 4px; font-size: 0.75rem; color: rgba(255,255,255,0.7);">{proyectoActivo.slug}</code>
              <button
                onclick={() => { vectorizacionTab = 'proyectos'; vinoDeCambiarProyecto = true; cargarProyectos(); }}
                style="margin-left: auto; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); color: rgba(255,255,255,0.9); cursor: pointer; font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 5px; transition: background 0.15s;"
                onmouseover={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
                onmouseout={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                title="Ir a Proyectos para cambiar el proyecto activo"
              >Cambiar de proyecto</button>
            </div>
          {:else}
            <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; background: rgba(200,40,40,0.85); border-radius: 8px; margin-bottom: 1rem; color: #fff; font-size: 0.9rem;">
              <Icon name="warning" size={16} />
              <span>No hay proyecto activo. Crea o selecciona uno en <strong>📁 Proyectos</strong> antes de crear bases de conocimiento.</span>
            </div>
          {/if}
          <div class="crear-contexto-wrap" class:abierto={crearContextoAbierto}>
            <button class="crear-contexto-toggle" onclick={() => crearContextoAbierto = !crearContextoAbierto}>
              <h3><Icon name="crear" size={18} /> Crear Nueva Base de Conocimiento</h3>
            </button>
            {#if crearContextoAbierto}
            <div class="crear-contexto-form">
              <div class="form-field">
                <label for="contexto-nombre">Nombre de la Base de Conocimiento</label>
                <input
                  id="contexto-nombre"
                  type="text"
                  value={nombreContextoGenerado}
                  disabled
                  class="contexto-input"
                  style="opacity: 0.65; cursor: default;"
                />
              </div>
              <div class="form-field">
                <label for="contexto-embedding">
                  Modelo de Embedding
                  {#if cargandoModelosEmbedding}
                    <span style="font-size:0.75rem; color:#888; margin-left:8px;">(Cargando...)</span>
                  {/if}
                </label>
                {#if modelosEmbedding.length > 0}
                  <select
                    id="contexto-embedding"
                    bind:value={nuevoContextoEmbedding}
                    onchange={() => aplicarChunkSugerido(nuevoContextoEmbedding)}
                    disabled={cargandoCrearContexto}
                    class="contexto-input"
                    style="display: block; width: 100%;"
                  >
                    <option value="">-- Selecciona Modelo --</option>
                    {#each modelosEmbedding as emb (emb)}
                      <option value={emb}>{emb}</option>
                    {/each}
                  </select>
                {:else}
                  <input
                    id="contexto-embedding"
                    type="text"
                    placeholder="ej: nomic-embed-text"
                    bind:value={nuevoContextoEmbedding}
                    disabled={cargandoCrearContexto}
                    class="contexto-input"
                  />
                  {#if !cargandoModelosEmbedding}
                    <p class="field-hint">No se detectaron modelos especificos de embedding, ingresa el nombre manual.</p>
                  {/if}
                {/if}
              </div>
              <div class="form-field">
                <label for="contexto-chunk-size">Medida Embedding</label>
                <input
                  id="contexto-chunk-size"
                  type="number"
                  value={nuevoContextoChunkSize}
                  onchange={(e) => nuevoContextoChunkSize = e.target.value}
                  disabled={cargandoCrearContexto}
                  class="contexto-input"
                  min="1"
                  style="-moz-appearance: textfield;"
                />
              </div>
              <button
                onclick={crearContexto}
                disabled={cargandoCrearContexto || !nombreContextoGenerado || !nuevoContextoEmbedding.trim()}
                class="crear-contexto-btn"
              >
                {cargandoCrearContexto ? '⟳ Creando...' : '✓ Crear'}
              </button>
            </div>
            {#if mensajeCrearContexto}
              <p class="mensaje-contexto" class:success={mensajeCrearContexto.includes('✅')}>
                {mensajeCrearContexto}
              </p>
            {/if}
            {/if}
          </div>

          {#if mensajeBorrarContexto}
            <p class="mensaje-contexto" class:success={mensajeBorrarContexto.includes('✅')} style="margin-top: 0.5rem;">
              {mensajeBorrarContexto}
            </p>
          {/if}

          <div class="contextos-table-wrap">
            <div class="seccion-header">
              <h3><Icon name="base-conocimiento" size={18} /> Bases de Conocimiento Existentes</h3>
              <button onclick={cargarContextosVectorizacion} class="vectorizacion-action-btn contextos-recargar-btn" disabled={cargandoVectorizacionContextos} aria-label="Recargar bases de conocimiento" title="Recargar bases de conocimiento">
                <Icon name="recargar" size={16} />
              </button>
            </div>
            {#if cargandoVectorizacionContextos}
              <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 1rem 0;">⟳ Cargando bases de conocimiento...</p>
            {:else if vectorizacionContextos.length === 0}
              <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 1rem 0;">No hay bases de conocimiento disponibles</p>
            {:else}
              <div class="contextos-table">
                {#each vectorizacionContextos as contexto (contexto.nombre)}
                  <div class="contexto-row">
                    <span class="contexto-nombre">{contexto.nombre}</span>
                    <button
                      class="contexto-editar-btn"
                      title="Editar base de conocimiento (ir a Documentos)"
                      onclick={() => {
                        contextoSeleccionadoParaDocumentos = contexto.nombre;
                        vinoDeEditarContexto = true;
                        vectorizacionTab = 'documentos';
                        cargarDocumentosVectorizacion(contexto.nombre);
                      }}
                    >
                      <Icon name="documentos" size={22} label="Editar" />
                    </button>
                    <button
                      class="contexto-borrar-btn"
                      title="Borrar base de conocimiento"
                      disabled={cargandoBorrarContexto}
                      onclick={() => { contextoABorrar = contexto.nombre; mostrarConfirmacionBorrar = true; }}
                    >
                      <Icon name="borrar" size={22} label="Borrar" />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Documentos -->
        {#if vectorizacionTab === 'documentos'}
          {#if proyectoActivo}
            <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.85rem; background: rgba(0,0,0,0.18); border-radius: 8px; margin-bottom: 1rem; font-size: 0.85rem; color: rgba(255,255,255,0.85);">
              <Icon name="proyecto" size={14} />
              <span>Trabajando en proyecto: <strong>{proyectoActivo.nombre}</strong></span>
              <code style="background: rgba(0,0,0,0.3); padding: 1px 6px; border-radius: 4px; font-size: 0.75rem; color: rgba(255,255,255,0.7);">{proyectoActivo.slug}</code>
              <button
                onclick={() => { vectorizacionTab = 'proyectos'; vinoDeCambiarProyecto = true; cargarProyectos(); }}
                style="margin-left: auto; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); color: rgba(255,255,255,0.9); cursor: pointer; font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 5px; transition: background 0.15s;"
                onmouseover={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
                onmouseout={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                title="Ir a Proyectos para cambiar el proyecto activo"
              >Cambiar de proyecto</button>
            </div>
          {/if}
          <div class="documentos-wrap">
            <div class="seccion-header">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <button
                  class="bc-detalle-volver-btn"
                  onclick={() => { vectorizacionTab = 'contextos'; vinoDeEditarContexto = false; }}
                  title="Volver a Bases de Conocimiento"
                  aria-label="Volver a Bases de Conocimiento"
                >← Bases de Conocimiento</button>
                <h3 style="margin: 0;"><Icon name="base-conocimiento" size={18} /> {contextoSeleccionadoParaDocumentos || 'Documentos'}</h3>
              </div>
              <button onclick={() => cargarDocumentosVectorizacion(contextoSeleccionadoParaDocumentos)} class="vectorizacion-action-btn contextos-recargar-btn" disabled={cargandoVectorizacionDocumentos} title="Recargar documentos" aria-label="Recargar documentos">
                <Icon name="recargar" size={16} />
              </button>
            </div>

            <!-- Lista de documentos -->
            {#if contextoSeleccionadoParaDocumentos}
              <div class="documentos-list-wrap">
                <h4>Documentos de la base de conocimiento: <strong>{contextoSeleccionadoParaDocumentos}</strong></h4>
                {#if cargandoVectorizacionDocumentos}
                  <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 1rem 0;">⟳ Cargando documentos...</p>
                {:else if vectorizacionDocumentos.length === 0}
                  <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 1rem 0;">No hay documentos en esta base de conocimiento</p>
                {:else}
                  <div class="documentos-table">
                    {#each vectorizacionDocumentos as doc (doc)}
                      <div class="documento-row">
                        <span class="documento-nombre">📋 {doc}</span>
                        <button
                          class="documento-borrar-btn"
                          title="Borrar documento"
                          disabled={cargandoBorrarDocumento}
                          onclick={() => { documentoSeleccionadoParaBorrar = doc; mostrarConfirmacionBorrarDocumento = true; }}
                        >
                          <Icon name="borrar" size={22} label="Borrar" />
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
              {#if mensajeBorrarDocumento}
                <p class="mensaje-documento" class:success={mensajeBorrarDocumento.includes('✅')} style="margin-top: 0.5rem;">
                  {mensajeBorrarDocumento}
                </p>
              {/if}
            {/if}
          </div>

          <!-- Integrar Documento -->
          <div class="integrar-documento-wrap">
            <h3>📤 Integrar Nuevo Documento a <strong>{contextoSeleccionadoParaDocumentos}</strong></h3>
            <div class="integrar-documento-form">
              <div class="form-field">
                <label for="doc-archivo">Selecciona archivo</label>
                <input
                  id="doc-archivo"
                  type="file"
                  onchange={(e) => {
                    const files = e.target.files;
                    archivoParaIntegrar = files && files[0] ? files[0] : null;
                  }}
                  disabled={cargandoIntegrarDocumento}
                  accept=".txt,.pdf,.doc,.docx"
                  class="documento-input"
                />
                {#if archivoParaIntegrar}
                  <small>Archivo: {archivoParaIntegrar.name} ({(archivoParaIntegrar.size / 1024).toFixed(2)} KB)</small>
                {/if}
              </div>
              <button
                onclick={integrarDocumento}
                disabled={cargandoIntegrarDocumento || !contextoSeleccionadoParaDocumentos.trim() || !archivoParaIntegrar}
                class="integrar-documento-btn"
              >
                {cargandoIntegrarDocumento ? '⟳ Procesando...' : '✓ Integrar'}
              </button>
            </div>

            {#if cargandoIntegrarDocumento}
              <div class="progreso-wrap">
                <div class="progreso-bar indeterminate"></div>
              </div>
            {:else if progresoIntegrar === 100}
              <div class="progreso-wrap">
                <div class="progreso-bar done"></div>
              </div>
            {/if}

            {#if mensajeIntegrarDocumento}
              <p class="mensaje-documento" class:success={mensajeIntegrarDocumento.includes('✅')}>
                {mensajeIntegrarDocumento}
              </p>
            {/if}
          </div>
        {/if}

        <!-- Confirmación Modal para Borrar Documento (compartido entre Documentos y ContextLight) -->
        {#if mostrarConfirmacionBorrarDocumento}
          <div class="modal-overlay">
            <div class="modal-content">
              <h3>⚠️ Confirmar Borrado de Documento</h3>
              <p>
                ¿Estás seguro de que deseas borrar el documento <strong>"{documentoSeleccionadoParaBorrar}"</strong> de la base de conocimiento <strong>"{contextoSeleccionadoParaDocumentos}"</strong>?
              </p>
              <p style="font-size: 0.85rem; color: rgba(0,0,0,0.55);">
                Esta acción es irreversible.
              </p>
              <div class="modal-buttons">
                <button
                  onclick={() => mostrarConfirmacionBorrarDocumento = false}
                  disabled={cargandoBorrarDocumento}
                  class="modal-btn cancel"
                >
                  Cancelar
                </button>
                <button
                  onclick={borrarDocumentoConfirmado}
                  disabled={cargandoBorrarDocumento}
                  class="modal-btn danger"
                >
                  {cargandoBorrarDocumento ? '⟳ Borrando...' : 'Sí, borrar'}
                </button>
              </div>
            </div>
          </div>
        {/if}

        <!-- Modelos -->
        {#if vectorizacionTab === 'modelos'}
          <div class="modelos-wrap">
            <div class="seccion-header">
              <h3>🤖 Modelos Disponibles</h3>
              <button onclick={cargarModelos} class="vectorizacion-action-btn" disabled={cargandoModelos}>
                ↻ Recargar
              </button>
            </div>

            {#if cargandoModelos}
              <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 1rem 0;">⟳ Cargando modelos...</p>
            {:else if errorModelos}
              <p style="color: #fff; font-size: 0.9rem; padding: 1rem; background: rgba(200,40,40,0.9); border-radius: 4px; line-height: 1.5; font-weight: 500;">{errorModelos}</p>
            {:else if modelosDisponibles.length === 0}
              <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 1rem 0;">No hay modelos disponibles</p>
            {:else}
              <div class="modelos-grid">
                {#each modelosDisponibles as modelo (modelo)}
                  <button
                    class="modelo-card"
                    class:active={modeloSeleccionado === modelo}
                    onclick={() => { modeloSeleccionado = modelo; cargarInfoModelo(modelo); }}
                  >
                    <span class="modelo-nombre">{modelo}</span>
                  </button>
                {/each}
              </div>
            {/if}

            {#if modeloSeleccionado && infoModeloSeleccionado}
              <div class="modelo-detalle">
                <h4>📋 Detalles de <strong>"{modeloSeleccionado}"</strong></h4>
                {#if cargandoInfoModelo}
                  <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem;">⟳ Cargando información...</p>
                {:else}
                  <div class="modelo-propiedades">
                    {#each Object.entries(infoModeloSeleccionado) as [key, value]}
                      <div class="propiedad-item">
                        <span class="propiedad-key">{key}:</span>
                        <span class="propiedad-value">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Sandbox -->
        {#if vectorizacionTab === 'sandbox'}
          {#if proyectoActivo}
            <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.85rem; background: rgba(0,0,0,0.18); border-radius: 8px; margin-bottom: 1rem; font-size: 0.85rem; color: rgba(255,255,255,0.85);">
              <Icon name="proyecto" size={14} />
              <span>Trabajando en proyecto: <strong>{proyectoActivo.nombre}</strong></span>
              <code style="background: rgba(0,0,0,0.3); padding: 1px 6px; border-radius: 4px; font-size: 0.75rem; color: rgba(255,255,255,0.7);">{proyectoActivo.slug}</code>
              <button
                onclick={() => { vectorizacionTab = 'proyectos'; vinoDeCambiarProyecto = true; cargarProyectos(); }}
                style="margin-left: auto; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); color: rgba(255,255,255,0.9); cursor: pointer; font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 5px; transition: background 0.15s;"
                onmouseover={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
                onmouseout={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                title="Ir a Proyectos para cambiar el proyecto activo"
              >Cambiar de proyecto</button>
            </div>
          {/if}
          {#if lightbotAsistenteSlug}
            {@const sandboxWidgetUrl = `${hostAsistentesBase}/embed/chat/${encodeURIComponent(lightbotAsistenteSlug)}`}
            <div class="lightbot-preview" style="margin-bottom: 1rem;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.4rem; flex-wrap: wrap;">
                <h4 style="margin: 0;">📋 URL del widget</h4>
                <div style="display: flex; gap: 0.4rem;">
                  <button
                    class="url-action-btn"
                    onclick={() => copiarUrl(sandboxWidgetUrl)}
                    title="Copiar URL"
                  >
                    {urlCopiada === sandboxWidgetUrl ? '✓ Copiado' : '📋 Copiar'}
                  </button>
                  <a
                    class="url-action-btn"
                    href={sandboxWidgetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir en nueva ventana"
                  >↗ Abrir</a>
                </div>
              </div>
              <code class="lightbot-url">{sandboxWidgetUrl}</code>
            </div>
          {/if}

          <div style="display: flex; gap: 1.5rem; align-items: flex-start; flex-wrap: wrap;">
            <div class="lightbot-form" style="margin: 0;">
              <div class="lightbot-field">
                <label for="lb-asistente">Asistente</label>
                {#if cargandoAsistentes}
                  <span style="color:rgba(255,255,255,0.6); font-size:0.9rem;">⟳ Cargando asistentes...</span>
                {:else if asistentes.length === 0}
                  <span style="color:rgba(255,255,255,0.6); font-size:0.9rem;">Sin asistentes — créalos en 🎧 Asistentes.</span>
                {:else}
                  <select id="lb-asistente" bind:value={lightbotAsistenteSlug}>
                    <option value="">— Seleccionar asistente —</option>
                    {#each asistentes as a (a.id)}
                      <option value={a.slug}>{a.nombre}</option>
                    {/each}
                  </select>
                {/if}
              </div>
            </div>

            {#if lightbotAsistenteSlug}
              {@const lightbotEmbedUrl = `${hostAsistentesBase}/embed/chat/${encodeURIComponent(lightbotAsistenteSlug)}`}
              <div style="width:100%; max-width:420px; height:70vh; min-height:520px; border:1px solid rgba(255,255,255,0.12); border-radius:12px; overflow:hidden; background:#fff; flex-shrink: 0;">
                <iframe
                  src={lightbotEmbedUrl}
                  title="Vista previa del widget"
                  style="width:100%; height:100%; border:0; display:block;"
                ></iframe>
              </div>
            {/if}
          </div>
        {/if}


        <!-- MiniAdmin -->
        {#if vectorizacionTab === 'miniadmin'}
          {#if proyectoActivo}
            <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.85rem; background: rgba(0,0,0,0.18); border-radius: 8px; margin-bottom: 1rem; font-size: 0.85rem; color: rgba(255,255,255,0.85);">
              <Icon name="proyecto" size={14} />
              <span>Trabajando en proyecto: <strong>{proyectoActivo.nombre}</strong></span>
              <code style="background: rgba(0,0,0,0.3); padding: 1px 6px; border-radius: 4px; font-size: 0.75rem; color: rgba(255,255,255,0.7);">{proyectoActivo.slug}</code>
              <button
                onclick={() => { vectorizacionTab = 'proyectos'; vinoDeCambiarProyecto = true; cargarProyectos(); }}
                style="margin-left: auto; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); color: rgba(255,255,255,0.9); cursor: pointer; font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 5px; transition: background 0.15s;"
                onmouseover={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
                onmouseout={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                title="Ir a Proyectos para cambiar el proyecto activo"
              >Cambiar de proyecto</button>
            </div>
          {/if}
          {#if contextlightAsistenteSlug}
            {@const miniadminWidgetUrl = `${hostAsistentesBase}/embed/admin/${encodeURIComponent(contextlightAsistenteSlug)}`}
            <div class="lightbot-preview" style="margin-bottom: 1rem;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.4rem; flex-wrap: wrap;">
                <h4 style="margin: 0;">📋 URL del widget</h4>
                <div style="display: flex; gap: 0.4rem;">
                  <button
                    class="url-action-btn"
                    onclick={() => copiarUrl(miniadminWidgetUrl)}
                    title="Copiar URL"
                  >
                    {urlCopiada === miniadminWidgetUrl ? '✓ Copiado' : '📋 Copiar'}
                  </button>
                  <a
                    class="url-action-btn"
                    href={miniadminWidgetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir en nueva ventana"
                  >↗ Abrir</a>
                </div>
              </div>
              <code class="lightbot-url">{miniadminWidgetUrl}</code>
            </div>
          {/if}

          <div style="display: flex; gap: 1.5rem; align-items: flex-start; flex-wrap: wrap;">
            <div class="lightbot-form" style="margin: 0;">
              <div class="lightbot-field">
                <label for="cle-asistente">Asistente</label>
                {#if cargandoAsistentes}
                  <span style="color:rgba(255,255,255,0.6); font-size:0.9rem;">⟳ Cargando asistentes...</span>
                {:else if asistentes.length === 0}
                  <span style="color:rgba(255,255,255,0.6); font-size:0.9rem;">Sin asistentes — créalos en 🎧 Asistentes.</span>
                {:else}
                  <select id="cle-asistente" bind:value={contextlightAsistenteSlug}>
                    <option value="">— Seleccionar asistente —</option>
                    {#each asistentes as a (a.id)}
                      <option value={a.slug}>{a.nombre}</option>
                    {/each}
                  </select>
                {/if}
              </div>
            </div>

            {#if contextlightAsistenteSlug}
              {@const contextlightEmbedUrl = `${hostAsistentesBase}/embed/admin/${encodeURIComponent(contextlightAsistenteSlug)}`}
              <div style="width:100%; max-width:720px; height:70vh; min-height:520px; border:1px solid rgba(255,255,255,0.12); border-radius:12px; overflow:hidden; background:#fff; flex-shrink: 0;">
                <iframe
                  src={contextlightEmbedUrl}
                  title="Vista previa del MiniAdmin"
                  style="width:100%; height:100%; border:0; display:block;"
                ></iframe>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Confirmación Modal -->
        {#if mostrarConfirmacionBorrar}
          <div class="modal-overlay">
            <div class="modal-content">
              {#if advertenciaBorrar}
                <h3>⚠️ Esta BC está en uso</h3>
                <p style="color: rgba(0,0,0,0.85);">
                  {advertenciaBorrar}
                </p>
                <p style="font-size: 0.85rem; color: rgba(0,0,0,0.65); margin-top: 0.5rem;">
                  Si borras la BC de todas formas, los asistentes que la usan quedarán sin base de conocimiento (chat puro, sin RAG) hasta que les asignes una nueva.
                </p>
                <div class="modal-buttons">
                  <button
                    onclick={cancelarBorradoBC}
                    disabled={cargandoBorrarContexto}
                    class="modal-btn cancel"
                  >
                    Cancelar
                  </button>
                  <button
                    onclick={() => borrarContextoConfirmado(true)}
                    disabled={cargandoBorrarContexto}
                    class="modal-btn danger"
                  >
                    {cargandoBorrarContexto ? '⟳ Borrando...' : 'Borrar de todas formas'}
                  </button>
                </div>
              {:else}
                <h3>⚠️ Confirmar Borrado</h3>
                <p>
                  ¿Estás seguro de que deseas borrar la base de conocimiento <strong>"{contextoABorrar}"</strong>?
                </p>
                <p style="font-size: 0.85rem; color: rgba(0,0,0,0.55);">
                  Esta acción es irreversible.
                </p>
                <div class="modal-buttons">
                  <button
                    onclick={cancelarBorradoBC}
                    disabled={cargandoBorrarContexto}
                    class="modal-btn cancel"
                  >
                    Cancelar
                  </button>
                  <button
                    onclick={() => borrarContextoConfirmado(false)}
                    disabled={cargandoBorrarContexto}
                    class="modal-btn danger"
                  >
                    {cargandoBorrarContexto ? '⟳ Borrando...' : 'Sí, borrar'}
                  </button>
                </div>
              {/if}
            </div>
          </div>
        {/if}

      </div>
      <p class="disclaimer">Constructor de Asistentes</p>
      </main>
  {/if}

  <!-- Administración section -->
  {#if activeTab === 'admin'}
    <main class="vectorizacion-body">
      <div class="vectorizacion-container">
        <h2 style="color: white; margin-bottom: 1.5rem;">👤 Administración</h2>

        <!-- Sub-tab bar -->
        <div class="vectorizacion-subtabs">
          <button
            class="vectorizacion-subtab-btn"
            class:active={adminTab === 'modelos'}
            onclick={() => { adminTab = 'modelos'; cargarModelos(); }}
          >
            🤖 Modelos
          </button>
          <button
            class="vectorizacion-subtab-btn"
            class:active={adminTab === 'alias'}
            onclick={() => { adminTab = 'alias'; cargarModelosEmbedding(); }}
          >
            🏷️ Alias
          </button>
          <button
            class="vectorizacion-subtab-btn"
            class:active={adminTab === 'defaultcontext'}
            onclick={() => { adminTab = 'defaultcontext'; if (contextos.length === 0) cargarContextos(); }}
          >
            ⭐ DefaultContext
          </button>
        </div>

        <!-- Modelos -->
        {#if adminTab === 'modelos'}
        <div class="modelos-wrap">
          <div class="seccion-header">
            <h3>🤖 Modelos Disponibles</h3>
            <button onclick={cargarModelos} class="vectorizacion-action-btn" disabled={cargandoModelos}>
              ↻ Recargar
            </button>
          </div>

          {#if cargandoModelos}
            <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 1rem 0;">⏳ Cargando modelos...</p>
          {:else if errorModelos}
            <p style="color: #fff; font-size: 0.9rem; padding: 1rem; background: rgba(200,40,40,0.9); border-radius: 4px; line-height: 1.5; font-weight: 500;">{errorModelos}</p>
          {:else if modelosDisponibles.length === 0}
            <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 1rem 0;">No hay modelos disponibles</p>
          {:else}
            <div class="modelos-grid">
              {#each modelosDisponibles as modelo (modelo)}
                <button
                  class="modelo-card"
                  class:active={modeloSeleccionado === modelo}
                  onclick={() => { modeloSeleccionado = modelo; cargarInfoModelo(modelo); }}
                >
                  <span class="modelo-nombre">{modelo}</span>
                </button>
              {/each}
            </div>
          {/if}

          {#if modeloSeleccionado && infoModeloSeleccionado}
            <div class="modelo-detalle">
              <h4>📋 Detalles de <strong>"{modeloSeleccionado}"</strong></h4>
              {#if cargandoInfoModelo}
                <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem;">⏳ Cargando información...</p>
              {:else}
                <div class="modelo-propiedades">
                  {#each Object.entries(infoModeloSeleccionado) as [key, value]}
                    <div class="propiedad-item">
                      <span class="propiedad-key">{key}:</span>
                      <span class="propiedad-value">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
        {/if}

        <!-- Alias de modelos de embedding -->
        {#if adminTab === 'alias'}
        <div class="modelos-wrap" style="margin-top: 2rem;">
          <div class="seccion-header">
            <h3>🏷️ Alias de Modelos de Embedding</h3>
            <button onclick={cargarModelosEmbedding} class="vectorizacion-action-btn" disabled={cargandoModelosEmbedding}>
              ↻ Recargar
            </button>
          </div>
          <p style="color: rgba(255,255,255,0.7); font-size: 0.9rem; margin: 0.25rem 0 1rem 0; line-height: 1.5;">
            <strong style="color: rgba(255,200,80,0.9);">⚠️ Legacy:</strong>
            Antes cada base de conocimiento se nombraba como <code style="background:rgba(0,0,0,0.25); padding:2px 6px; border-radius:4px;">bzz-&lt;alias&gt;-&lt;chunk&gt;</code>.
            Ahora se nombra como <code style="background:rgba(0,0,0,0.25); padding:2px 6px; border-radius:4px;">&lt;proyecto-slug&gt;-&lt;N&gt;</code>
            (N consecutivo desde 1, reusa huecos de BCs borradas). Estos alias quedan solo como referencia.
          </p>

          {#if cargandoModelosEmbedding}
            <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 1rem 0;">⏳ Cargando modelos de embedding...</p>
          {/if}

          {#snippet filaAlias(modelo, origen)}
            <div class="alias-row">
              <div class="alias-modelo">
                <span class="alias-modelo-nombre">{modelo}</span>
                <span class="alias-modelo-origen" data-origen={origen}>{origen}</span>
              </div>
              <input
                type="text"
                class="alias-input"
                placeholder={modelo.split(/[-:_\s]/)[0].toLowerCase()}
                value={MODELO_ALIAS[modelo] ?? ''}
                oninput={(e) => { MODELO_ALIAS[modelo] = e.currentTarget.value; guardarAlias(); }}
              />
              <span class="alias-preview" style="opacity: 0.55;">alias previo: <strong>{aliasModeloEmbedding(modelo)}</strong></span>
            </div>
          {/snippet}

          <div class="alias-grid">
            {#if modelosEmbedding.length > 0}
              <div class="alias-grupo">
                <h4 class="alias-grupo-titulo">🦙 Ollama (locales)</h4>
                {#each modelosEmbedding as modelo (modelo)}
                  {@render filaAlias(modelo, 'ollama')}
                {/each}
              </div>
            {/if}

            <div class="alias-grupo">
              <h4 class="alias-grupo-titulo">☁️ OpenAI</h4>
              {#each MODELOS_EMBEDDING_OPENAI as modelo (modelo)}
                {@render filaAlias(modelo, 'openai')}
              {/each}
            </div>

            {#if Object.keys(MODELO_ALIAS).filter(m => !modelosEmbedding.includes(m) && !MODELOS_EMBEDDING_OPENAI.includes(m)).length > 0}
              <div class="alias-grupo">
                <h4 class="alias-grupo-titulo">📌 Otros (configurados manualmente)</h4>
                {#each Object.keys(MODELO_ALIAS).filter(m => !modelosEmbedding.includes(m) && !MODELOS_EMBEDDING_OPENAI.includes(m)) as modelo (modelo)}
                  {@render filaAlias(modelo, 'manual')}
                {/each}
              </div>
            {/if}
          </div>

          <p style="color: rgba(255,255,255,0.5); font-size: 0.8rem; margin-top: 1rem;">
            💾 Los cambios se guardan automáticamente en este navegador (localStorage).
          </p>
        </div>
        {/if}

        <!-- DefaultContext -->
        {#if adminTab === 'defaultcontext'}
        <div class="modelos-wrap">
          <div class="seccion-header">
            <h3>⭐ DefaultContext</h3>
            <button onclick={cargarContextos} class="vectorizacion-action-btn" disabled={cargandoContextos}>
              ↻ Recargar
            </button>
          </div>
          <p style="color: rgba(255,255,255,0.7); font-size: 0.9rem; margin: 0.25rem 0 1rem 0; line-height: 1.5;">
            Selecciona la base de conocimiento que se usará por defecto.
          </p>

          <!-- Badge: contexto default actual -->
          <div style="display:flex; align-items:center; gap:0.6rem; padding:0.75rem 1rem; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); border-radius:8px; margin-bottom:1rem;">
            <span style="color:rgba(255,255,255,0.6); font-size:0.85rem;">Default actual:</span>
            {#if defaultContextGuardado}
              <span style="color:#fff; font-weight:600; font-size:0.95rem;">⭐ {defaultContextGuardado}</span>
            {:else}
              <span style="color:rgba(255,255,255,0.5); font-style:italic; font-size:0.9rem;">— Sin definir —</span>
            {/if}
          </div>

          <div class="lightbot-field" style="max-width: 420px;">
            <label for="default-context-select">Bases de Conocimiento disponibles</label>
            <select
              id="default-context-select"
              bind:value={defaultContext}
              disabled={cargandoContextos}
            >
              <option value="">— Seleccionar —</option>
              {#each contextos as ctx}
                <option value={ctx}>{ctx}</option>
              {/each}
            </select>
          </div>

          <div style="display:flex; align-items:center; gap:0.75rem; margin-top:1rem; flex-wrap:wrap;">
            <button
              class="vectorizacion-action-btn"
              onclick={guardarDefaultContext}
              disabled={!defaultContext || defaultContext === defaultContextGuardado}
              style="background:#198754; border-color:#198754;"
            >
              {#if defaultContext === defaultContextGuardado && defaultContextGuardado}
                ✓ Ya es el default
              {:else}
                ⭐ Guardar como default
              {/if}
            </button>

            {#if defaultContextGuardadoFlash}
              <span style="color:#4ade80; font-weight:600; font-size:0.9rem;">✓ Guardado: <strong>{defaultContextGuardado}</strong></span>
            {/if}
          </div>

          {#if cargandoContextos}
            <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 0.75rem 0;">⏳ Cargando bases de conocimiento...</p>
          {:else if contextos.length === 0}
            <p style="color: rgba(0,0,0,0.55); font-size: 0.9rem; padding: 0.75rem 0;">No hay bases de conocimiento disponibles. Pulsa ↻ Recargar.</p>
          {/if}

          <p style="color: rgba(255,255,255,0.5); font-size: 0.8rem; margin-top: 1rem;">
            💾 La selección se guarda en este navegador (localStorage).
          </p>
        </div>
        {/if}
      </div>
    </main>
  {/if}
</div>

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    height: 100dvh;
    overflow: hidden;
  }

  :global(#app) {
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: linear-gradient(160deg, #6b0016 0%, #a80028 30%, #c8102e 60%, #e0154a 100%);
    transition: background 0.5s ease;
  }

  .app.vectorizacion {
    background: linear-gradient(160deg, #ffaa00 0%, #ffc040 40%, #ffe8a0 75%, #ffffff 100%);
  }

  /* Textos del contenido en modo Construcción → azul marino */
  .app.vectorizacion .seccion-header h3,
  .app.vectorizacion .contextos-table-wrap h3,
  .app.vectorizacion .crear-contexto-wrap h3 {
    color: #0a1a3a;
  }

  .app.vectorizacion .contexto-nombre {
    color: #0a1a3a;
  }

  .app.vectorizacion .contexto-row {
    background: rgba(10, 26, 58, 0.08);
    border-left-color: rgba(10, 26, 58, 0.4);
  }

  .app.vectorizacion .contexto-row:hover {
    background: rgba(10, 26, 58, 0.15);
    border-left-color: rgba(10, 26, 58, 0.7);
  }

  .app.vectorizacion .form-field label {
    color: rgba(10, 26, 58, 0.7);
  }

  .app.vectorizacion .field-hint {
    color: rgba(10, 26, 58, 0.55);
  }

  .app.vectorizacion .contexto-input {
    color: #0a1a3a;
    background: rgba(10, 26, 58, 0.15);
    border-color: #0b1f4a;
    border-width: 2px;
  }

  .app.vectorizacion .contexto-input::placeholder {
    color: rgba(10, 26, 58, 0.5);
  }

  .app.vectorizacion .contexto-input:focus {
    border-color: #0a1a3a;
    background: rgba(10, 26, 58, 0.2);
    box-shadow: 0 0 0 3px rgba(10, 26, 58, 0.1);
  }

  .app.vectorizacion .contexto-select {
    color: #0a1a3a;
    background: rgba(10, 26, 58, 0.15);
    border-color: #0b1f4a;
    border-width: 2px;
  }

  .app.vectorizacion .contexto-select:focus {
    outline: none;
    border-color: #0a1a3a;
    background: rgba(10, 26, 58, 0.2);
    box-shadow: 0 0 0 3px rgba(10, 26, 58, 0.1);
  }

  .app.vectorizacion .contexto-select option {
    background: #0b1f4a;
    color: #fff;
  }

  .app.vectorizacion .contextos-table-wrap,
  .app.vectorizacion .crear-contexto-wrap {
    background: rgba(255, 255, 255, 0.35);
    border-color: #0b1f4a;
  }

  .app.vectorizacion .crear-contexto-btn {
    background: rgba(10, 50, 160, 0.75);
    border-color: rgba(10, 50, 160, 0.9);
    color: #fff;
  }

  .app.vectorizacion .crear-contexto-btn:hover:not(:disabled) {
    background: rgba(10, 50, 160, 0.95);
    border-color: #0a32a0;
  }

  .app.vectorizacion .vectorizacion-subtabs {
    background: #0b1f4a;
    border-color: rgba(255, 255, 255, 0.1);
  }

  .app.vectorizacion .vectorizacion-subtab-btn {
    color: rgba(255, 255, 255, 0.9);
  }

  .app.vectorizacion .vectorizacion-subtab-btn:hover:not(.active) {
    color: rgba(255, 255, 255, 0.85);
    background: rgba(255, 255, 255, 0.1);
  }

  .app.vectorizacion .subtab-arrow-indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #ffd75e;
    font-size: 1.6rem;
    font-weight: 900;
    line-height: 1;
    padding: 0 0.4rem;
    text-shadow: 0 0 8px rgba(255, 215, 94, 0.7);
    animation: subtab-arrow-pulse 1.2s ease-in-out infinite;
    user-select: none;
  }

  @keyframes subtab-arrow-pulse {
    0%, 100% { transform: translateX(0); opacity: 0.85; }
    50% { transform: translateX(4px); opacity: 1; }
  }

  .app.vectorizacion .vectorizacion-subtab-btn.active {
    background: #2952cc;
    color: #fff;
    box-shadow: 0 1px 6px rgba(10, 26, 80, 0.4);
  }

  .app.vectorizacion .vectorizacion-subtab-btn:disabled:not(.active) {
    opacity: 0.45;
    cursor: default;
  }

  .app.vectorizacion .vectorizacion-subtab-btn:disabled.active {
    opacity: 1;
    cursor: default;
  }

  .app.vectorizacion .header {
    background: #c8960a;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    border-bottom-color: rgba(0, 0, 0, 0.15);
  }

  .app.vectorizacion .tab-btn {
    color: #0b1f4a;
  }

  .app.vectorizacion .tab-btn:hover:not(:disabled) {
    color: #0b1f4a;
    opacity: 0.75;
  }

  .app.vectorizacion .tab-btn.active {
    color: #0b1f4a;
    border-bottom-color: #0b1f4a;
  }

  .app.vectorizacion .ambiente-toggle {
    background: #0b1f4a;
    border-color: rgba(255, 255, 255, 0.1);
    margin-left: auto;
    padding: 4px;
    gap: 4px;
  }

  .app.vectorizacion .ambiente-btn {
    font-size: 0.8rem;
    padding: 5px 13px;
    color: rgba(255, 255, 255, 0.9);
  }

  .app.vectorizacion .ambiente-btn.active {
    background: #2952cc;
    color: #fff;
    box-shadow: 0 1px 6px rgba(10, 26, 80, 0.4);
  }

  /* Construcción tab - navy blue text throughout */
  .app.vectorizacion {
    color: #0a1a3a;
  }

  .app.vectorizacion h2,
  .app.vectorizacion h3,
  .app.vectorizacion h4,
  .app.vectorizacion p,
  .app.vectorizacion label,
  .app.vectorizacion span {
    color: #0a1a3a;
  }

  .app.vectorizacion .context-select-wrap label {
    color: rgba(10, 26, 58, 0.7);
  }

  .app.vectorizacion .context-select-wrap select {
    color: #0a1a3a;
  }

  .app.vectorizacion .ctx-loading {
    color: rgba(10, 26, 58, 0.55);
  }

  /* Documentos subtab - same color scheme as Contextos */
  .app.vectorizacion .documentos-wrap,
  .app.vectorizacion .integrar-documento-wrap {
    background: rgba(255, 255, 255, 0.35);
    border-color: #0b1f4a;
  }

  .app.vectorizacion .documentos-wrap h3,
  .app.vectorizacion .integrar-documento-wrap h3,
  .app.vectorizacion .documentos-list-wrap h4 {
    color: #0a1a3a;
  }

  .app.vectorizacion .documentos-contexto-select {
    background: rgba(10, 26, 58, 0.08);
    border-color: rgba(10, 26, 58, 0.2);
  }

  .app.vectorizacion .documentos-contexto-select label {
    color: rgba(10, 26, 58, 0.7);
  }

  .app.vectorizacion .documentos-table {
    background: rgba(10, 26, 58, 0.08);
    border-color: rgba(10, 26, 58, 0.15);
  }

  .app.vectorizacion .documento-row {
    background: rgba(10, 26, 58, 0.08);
    border-left-color: rgba(10, 26, 58, 0.4);
  }

  .app.vectorizacion .documento-row:hover {
    background: rgba(10, 26, 58, 0.15);
  }

  .app.vectorizacion .documento-nombre {
    color: #0a1a3a;
  }

  .app.vectorizacion .documento-borrar-btn:hover:not(:disabled) {
    filter: brightness(1) drop-shadow(0 0 6px rgba(255, 200, 50, 0.9)) drop-shadow(0 0 12px rgba(255, 170, 0, 0.6));
    background: rgba(255, 80, 80, 0.18);
  }

  .app.vectorizacion .documento-input {
    color: #0a1a3a;
    background: rgba(10, 26, 58, 0.08);
    border-color: #0b1f4a;
  }

  .app.vectorizacion .documento-input::file-selector-button {
    background: rgba(10, 50, 160, 0.75);
    border-color: rgba(10, 50, 160, 0.9);
  }

  .app.vectorizacion .documento-input::file-selector-button:hover {
    background: rgba(10, 50, 160, 0.95);
  }

  .app.vectorizacion .integrar-documento-form small {
    color: rgba(10, 26, 58, 0.65);
  }

  .app.vectorizacion .integrar-documento-btn {
    background: rgba(10, 50, 160, 0.75);
    border-color: rgba(10, 50, 160, 0.9);
    color: #fff;
  }

  .app.vectorizacion .integrar-documento-btn:hover:not(:disabled) {
    background: rgba(10, 50, 160, 0.95);
    border-color: #0a32a0;
  }

  .app.vectorizacion .vectorizacion-action-btn {
    background: rgba(10, 26, 58, 0.12);
    border: 1px solid #0b1f4a;
    color: #0a1a3a;
  }

  .app.vectorizacion .vectorizacion-action-btn:hover:not(:disabled) {
    background: rgba(10, 26, 58, 0.22);
    border-color: #0b1f4a;
  }

  .app.admin {
    background: linear-gradient(160deg, #001a4d 0%, #003d99 30%, #0055cc 60%, #0077ff 100%);
  }

  /* ── Header ─────────────────────────────────────── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 1rem 1.5rem;
    background: rgba(0, 0, 0, 0.25);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 2rem;
  }

  .avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    border: 2px solid rgba(255, 255, 255, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .avatar svg {
    width: 24px;
    height: 24px;
  }

  .header-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .header-title {
    font-size: 1rem;
    font-weight: 700;
    color: #fff;
    letter-spacing: 0.01em;
  }

  .header-version {
    font-size: 0.7rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.55);
    letter-spacing: 0.04em;
    text-transform: lowercase;
  }

  .header-status {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.75);
    cursor: pointer;
    border-radius: 6px;
    padding: 2px 6px;
    transition: background 0.2s ease;
  }

  .header-status:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4ade80;
    box-shadow: 0 0 6px #4ade80;
    animation: pulse 2s ease-in-out infinite;
  }

  .status-dot.online {
    background: #4ade80;
    box-shadow: 0 0 6px #4ade80;
  }

  .status-dot.offline {
    background: #ef4444;
    box-shadow: 0 0 6px #ef4444;
    animation: none;
  }

  .status-dot.checking {
    background: #facc15;
    box-shadow: 0 0 6px #facc15;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .header-logo {
    font-size: 1.25rem;
    font-weight: 800;
    color: rgba(255, 255, 255, 0.9);
    letter-spacing: 0.06em;
  }

  .header-center {
    flex: 1;
    display: flex;
    justify-content: center;
  }

  .ambiente-indicador {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.7rem;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    cursor: default;
    user-select: none;
  }

  .ambiente-indicador-label {
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }

  .ambiente-indicador-valor {
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: rgba(255, 255, 255, 0.92);
    font-family: 'Consolas', 'Courier New', monospace;
  }

  .ambiente-btn {
    width: auto;
    height: auto;
    border-radius: 14px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.5);
    font-family: inherit;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 4px 10px;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
    box-shadow: none;
    letter-spacing: 0.01em;
    text-transform: capitalize;
  }

  .ambiente-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.75);
  }

  .ambiente-btn.active {
    background: rgba(255, 255, 255, 0.22);
    color: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  }

  /* ── Chat body ───────────────────────────────────── */
  .chat-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem 1rem;
    scroll-behavior: smooth;
  }

  .chat-body::-webkit-scrollbar {
    width: 5px;
  }

  .chat-body::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.25);
    border-radius: 10px;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 780px;
    margin: 0 auto;
  }

  /* ── Message rows ────────────────────────────────── */
  .message-row {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    animation: fadeUp 0.3s ease;
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .message-row.user {
    flex-direction: row-reverse;
  }

  .bot-avatar {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
    border: 1.5px solid rgba(255, 255, 255, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.85);
  }

  .bot-avatar svg {
    width: 18px;
    height: 18px;
  }

  .bubble-wrap {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-width: 72%;
  }

  .message-row.user .bubble-wrap {
    align-items: flex-end;
  }

  .bubble {
    padding: 0.75rem 1rem;
    border-radius: 18px;
    font-size: 0.9375rem;
    line-height: 1.55;
    word-break: break-word;
    white-space: pre-wrap;
  }

  /* Bot bubble */
  .message-row.bot .bubble {
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    color: #fff;
    border-bottom-left-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.18);
  }

  /* User bubble */
  .message-row.user .bubble {
    background: #fff;
    color: #a80028;
    font-weight: 500;
    border-bottom-right-radius: 4px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  }

  .message-row.error .bubble {
    background: rgba(0, 0, 0, 0.3);
    border-color: rgba(255, 100, 100, 0.4);
    color: rgba(255, 200, 200, 0.9);
  }

  .time {
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.5);
    padding: 0 4px;
  }

  /* ── Typing indicator ─────────────────────────────── */
  .bubble.typing {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0.9rem 1.1rem;
    min-width: 60px;
  }

  .bubble.typing span {
    display: block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.7);
    animation: bounce 1.2s ease-in-out infinite;
  }

  .bubble.typing span:nth-child(1) { animation-delay: 0s; }
  .bubble.typing span:nth-child(2) { animation-delay: 0.2s; }
  .bubble.typing span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 60%, 100% { transform: translateY(0); }
    30%            { transform: translateY(-6px); }
  }

  /* ── Input area ──────────────────────────────────── */
  .input-container button {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.2s ease, opacity 0.2s;
  }

  .input-container button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .input-container button:not(:disabled):hover {
    background: rgba(255, 255, 255, 0.35);
  }

  .reset-btn {
    background: rgba(255, 255, 255, 0.08) !important;
  }

  .reset-btn:not(:disabled):hover {
    background: rgba(255, 100, 100, 0.3) !important;
  }

  .input-area {
    padding: 1rem 1rem 1.25rem;
    background: rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    flex-shrink: 0;
  }

  .input-container {
    display: flex;
    align-items: flex-end;
    gap: 0.625rem;
    max-width: 780px;
    margin: 0 auto;
    background: rgba(255, 255, 255, 0.12);
    border: 1.5px solid rgba(255, 255, 255, 0.22);
    border-radius: 24px;
    padding: 0.5rem 0.5rem 0.5rem 1.25rem;
    transition: border-color 0.2s, background 0.2s;
  }

  .input-container:focus-within {
    border-color: rgba(255, 255, 255, 0.55);
    background: rgba(255, 255, 255, 0.18);
  }

  textarea {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-family: inherit;
    font-size: 0.9375rem;
    color: #fff;
    resize: none;
    line-height: 1.5;
    max-height: 120px;
    overflow-y: auto;
    padding: 4px 0;
  }

  textarea::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }

  textarea::-webkit-scrollbar { width: 3px; }
  textarea::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.25); border-radius: 10px; }

  textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .input-container button {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    border: none;
    background: #fff;
    color: #c8102e;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: transform 0.15s, opacity 0.15s, background 0.15s;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }

  .input-container button svg {
    width: 20px;
    height: 20px;
  }

  .input-container button:hover:not(:disabled) {
    transform: scale(1.08);
    background: #f0f0f0;
  }

  .input-container button:active:not(:disabled) {
    transform: scale(0.95);
  }

  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .disclaimer {
    text-align: center;
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.35);
    margin-top: 0.6rem;
    letter-spacing: 0.04em;
  }

  /* ── Footer controls (contexto + disclaimer) ─────── */
  .context-select-wrap {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .context-select-wrap label {
    font-size: 0.65rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.45);
    letter-spacing: 0.05em;
    white-space: nowrap;
    text-transform: uppercase;
  }

  .context-select-wrap select {
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 14px;
    color: #fff;
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 500;
    padding: 4px 24px 4px 10px;
    cursor: pointer;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M6 9l6 6 6-6' stroke='rgba(255,255,255,0.5)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    transition: border-color 0.2s, background 0.2s;
    max-width: 180px;
  }

  .context-select-wrap select:hover {
    background-color: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.25);
  }

  .context-select-wrap select:focus {
    border-color: rgba(255, 255, 255, 0.4);
    background-color: rgba(255, 255, 255, 0.18);
  }

  .context-select-wrap select option {
    background: #a80028;
    color: #fff;
  }

  .ctx-loading {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.35);
    font-style: italic;
  }

  .clear-chat-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.9rem;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 6px;
    opacity: 0.5;
    transition: opacity 0.2s, background 0.2s;
    color: #fff;
  }

  .clear-chat-btn:not(:disabled):hover {
    opacity: 1;
    background: rgba(255, 80, 80, 0.25);
  }

  .clear-chat-btn:disabled {
    opacity: 0.2;
    cursor: not-allowed;
  }

  /* ── Tabs toggle ────────────────────────────────── */
  .tabs-toggle {
    display: flex;
    gap: 0;
    background: transparent;
    padding: 0;
    border-radius: 0;
    border: none;
    margin-left: auto;
    border-bottom: 2px solid rgba(255, 255, 255, 0.2);
    align-items: center;
  }

  .admin-gear-btn {
    font-size: 1.4rem;
    padding: 0.5rem 0.75rem;
    margin-left: auto;
    opacity: 0.7;
    line-height: 1;
    border-bottom: none !important;
    bottom: 0;
    transition: opacity 0.2s ease, transform 0.2s ease;
  }

  .admin-gear-btn:hover:not(:disabled) {
    opacity: 1;
    transform: rotate(30deg);
  }

  .admin-gear-btn,
  .admin-gear-btn.active,
  .admin-gear-btn:hover:not(:disabled) {
    border-bottom: none !important;
    bottom: 0;
  }

  .tab-btn {
    width: auto;
    height: auto;
    border-radius: 0;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    padding: 0.75rem 1.5rem;
    cursor: pointer;
    transition: color 0.25s ease;
    box-shadow: none;
    letter-spacing: 0.01em;
    white-space: nowrap;
    border-bottom: 3px solid transparent;
    position: relative;
    bottom: -2px;
  }

  .tab-btn:hover:not(:disabled) {
    color: rgba(255, 255, 255, 0.85);
  }

  .tab-btn.active:not(.admin-gear-btn) {
    color: #fff;
    border-bottom-color: #fff;
    background: transparent;
    box-shadow: none;
  }

  /* ── Chat sub-nav ───────────────────────────────── */
  .chat-subnav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
    flex-wrap: wrap;
    padding: 0.5rem 1.5rem;
    background: rgba(0, 0, 0, 0.18);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(8px);
  }

  /* ── Admin Body ──────────────────────────────────── */
  .vectorizacion-body {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 1.5rem;
    width: 100%;
    min-width: 0;
  }

  .vectorizacion-container {
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
  }

  /* ── Banner Integración En Curso ─────────────────── */
  .banner-integracion {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    padding: 1rem 1.25rem;
    background: rgba(255, 170, 0, 0.15);
    border: 1px solid rgba(255, 170, 0, 0.4);
    border-left: 4px solid rgba(255, 170, 0, 0.8);
    border-radius: 10px;
    margin-bottom: 1.5rem;
    animation: slideUp 0.3s ease;
  }

  .banner-integracion-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .banner-integracion-text {
    flex: 1;
  }

  .banner-integracion-text strong {
    color: #ffcc00;
    font-size: 0.95rem;
  }

  .banner-integracion-text p {
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.85rem;
    line-height: 1.5;
    margin-top: 0.25rem;
  }

  .banner-dismiss-btn {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.7);
    padding: 0.3rem 0.75rem;
    border-radius: 6px;
    font-size: 0.8rem;
    cursor: pointer;
    margin-top: 0.5rem;
    transition: background 0.2s ease;
    white-space: nowrap;
    min-width: max-content;
  }

  .banner-dismiss-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  /* ── Admin Sub-tabs ──────────────────────────────── */
  .vectorizacion-subtabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 2rem;
    background: rgba(0, 0, 0, 0.2);
    padding: 0.4rem;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-sizing: border-box;
  }

  .vectorizacion-subtab-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 1.25rem;
    border-radius: 10px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.55);
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease;
    white-space: nowrap;
    flex-shrink: 0;
    min-width: max-content;
  }

  .vectorizacion-subtab-btn:hover:not(.active) {
    color: rgba(255, 255, 255, 0.8);
    background: rgba(255, 255, 255, 0.08);
  }

  .vectorizacion-subtab-btn.active {
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }

  .seccion-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    color: rgba(255, 255, 255, 0.4);
    font-size: 1.1rem;
    border: 2px dashed rgba(255, 255, 255, 0.15);
    border-radius: 12px;
  }

  .vectorizacion-action-btn {
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: #fff;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
    font-family: inherit;
    white-space: nowrap;
    flex-shrink: 0;
    min-width: max-content;
  }

  .vectorizacion-action-btn:hover {
    background: rgba(255, 255, 255, 0.3);
    border-color: rgba(255, 255, 255, 0.5);
  }

  .contextos-recargar-btn {
    padding: 0.4rem 0.6rem;
    min-width: 0;
    line-height: 1;
    font-size: 1.35rem;
  }

  .logs-table {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 400px;
    overflow-y: auto;
  }

  .log-row {
    display: grid;
    grid-template-columns: 80px 1fr 60px 40px;
    gap: 1rem;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    font-size: 0.8rem;
    align-items: center;
    border-left: 3px solid transparent;
  }

  .log-row.has-error {
    border-left-color: #ff6b6b;
  }

  .log-fecha {
    color: rgba(255, 255, 255, 0.6);
    font-weight: 600;
    font-family: 'Courier New', monospace;
  }

  .log-pregunta {
    color: rgba(255, 255, 255, 0.85);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .log-ms {
    color: #4ade80;
    text-align: right;
    font-weight: 600;
  }

  .log-error {
    color: #4ade80;
    text-align: center;
    font-weight: 600;
  }

  .log-error.has-error {
    color: #ff6b6b;
  }

  /* ── Contextos Table ────────────────────────────── */
  .contextos-table-wrap {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    padding: 1.5rem;
    backdrop-filter: blur(8px);
    margin-bottom: 2rem;
  }

  .contextos-table-wrap h3 {
    color: #fff;
    font-size: 1rem;
    margin-bottom: 1rem;
    font-weight: 600;
  }

  .contextos-table {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 500px;
    overflow-y: auto;
  }

  .contexto-row {
    display: flex;
    align-items: center;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    font-size: 0.85rem;
    border-left: 3px solid rgba(0, 200, 255, 0.5);
    transition: background 0.2s ease;
  }

  .contexto-row:hover {
    background: rgba(0, 0, 0, 0.3);
    border-left-color: rgba(0, 200, 255, 0.8);
  }

  .contexto-nombre {
    color: rgba(255, 255, 255, 0.9);
    font-weight: 600;
    flex: 1;
  }

  .contexto-borrar-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1.15rem;
    padding: 0.25rem 0.4rem;
    border-radius: 6px;
    opacity: 1;
    transition: opacity 0.15s, background 0.15s;
    line-height: 1;
    flex-shrink: 0;
    filter: drop-shadow(0 1px 4px rgba(0,0,0,0.55)) brightness(0.6);
  }

  .contexto-editar-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1.05rem;
    padding: 0.25rem 0.4rem;
    border-radius: 6px;
    opacity: 1;
    transition: opacity 0.15s, background 0.15s;
    line-height: 1;
    flex-shrink: 0;
    filter: drop-shadow(0 1px 4px rgba(0,0,0,0.55)) brightness(0.6);
  }

  .bc-detalle-volver-btn {
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .bc-detalle-volver-btn:hover {
    background: rgba(0, 0, 0, 0.4);
    border-color: rgba(255, 255, 255, 0.35);
  }

  .contexto-editar-btn:hover:not(:disabled) {
    opacity: 1;
    filter: brightness(1) drop-shadow(0 0 6px rgba(255, 200, 50, 0.9)) drop-shadow(0 0 12px rgba(255, 170, 0, 0.6));
    background: rgba(80, 130, 255, 0.18);
  }

  .contexto-borrar-btn:hover:not(:disabled) {
    opacity: 1;
    filter: brightness(1) drop-shadow(0 0 6px rgba(255, 200, 50, 0.9)) drop-shadow(0 0 12px rgba(255, 170, 0, 0.6));
    background: rgba(255, 80, 80, 0.18);
  }

  .contexto-borrar-btn:disabled {
    cursor: not-allowed;
    opacity: 0.2;
  }

  .recargar-btn {
    align-self: flex-start;
    margin-top: 0.5rem;
  }

  .seccion-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .seccion-header h3 {
    margin: 0;
    flex-shrink: 0;
    white-space: nowrap;
    color: white;
  }

  /* ── Crear Contexto Form ────────────────────────── */
  .crear-contexto-wrap {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    padding: 1.25rem 1.5rem;
    backdrop-filter: blur(8px);
    margin-bottom: 2rem;
  }

  .crear-contexto-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    width: 100%;
    text-align: left;
  }

  .crear-contexto-toggle h3 {
    color: #fff;
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .crear-contexto-toggle-icon {
    color: #fff;
    font-size: 0.85rem;
    line-height: 1;
    transition: transform 0.2s ease;
  }

  .crear-contexto-wrap h3 {
    color: #fff;
    font-size: 1rem;
    margin-bottom: 1rem;
    font-weight: 600;
  }

  .crear-contexto-wrap.abierto .crear-contexto-form,
  .crear-contexto-wrap.abierto .mensaje-contexto {
    margin-top: 1.25rem;
  }

  .crear-contexto-form {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.75rem;
    flex-wrap: wrap;
    align-items: flex-end;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
    min-width: 150px;
    position: relative;
  }

  .field-hint {
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    margin-top: 2px;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.65);
    line-height: 1.2;
  }

  .form-field label {
    font-size: 0.8rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    text-transform: uppercase;
    letter-spacing: 0.01em;
  }

  .contexto-input {
    flex: 1;
    padding: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.2);
    color: #fff;
    font-family: inherit;
    font-size: 0.9rem;
    transition: border-color 0.2s ease, background 0.2s ease;
  }

  /* Ocultar flechitas del input type=number por defecto */
  .contexto-input::-webkit-outer-spin-button,
  .contexto-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  /* Mostrar flechitas si la clase modificadora está presente */
  .contexto-input.contexto-input--with-spinners::-webkit-outer-spin-button,
  .contexto-input.contexto-input--with-spinners::-webkit-inner-spin-button {
    -webkit-appearance: auto;
    margin: 0;
    opacity: 1;
  }
  .contexto-input.contexto-input--with-spinners {
    -moz-appearance: number-input;
  }

  .contexto-input::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }

  .contexto-input:focus {
    outline: none;
    border-color: rgba(0, 200, 255, 0.8);
    background: rgba(0, 0, 0, 0.3);
  }

  .contexto-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .crear-contexto-btn {
    padding: 0.75rem 1.5rem;
    background: rgba(0, 200, 255, 0.3);
    border: 1px solid rgba(0, 200, 255, 0.5);
    border-radius: 8px;
    color: #fff;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease;
    white-space: nowrap;
    flex-shrink: 0;
    min-width: max-content;
    align-self: flex-end;
  }

  .crear-contexto-btn:hover:not(:disabled) {
    background: rgba(0, 200, 255, 0.5);
    border-color: rgba(0, 200, 255, 0.8);
  }

  .crear-contexto-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .mensaje-contexto {
    font-size: 0.9rem;
    padding: 0.75rem;
    border-radius: 8px;
    background: rgba(255, 0, 0, 0.2);
    border: 1px solid rgba(255, 0, 0, 0.4);
    color: rgba(255, 100, 100, 1);
    margin: 0;
  }

  .mensaje-contexto.success {
    background: rgba(0, 200, 0, 0.2);
    border-color: rgba(0, 200, 0, 0.4);
    color: rgba(100, 255, 100, 1);
  }

  /* ── Modal Confirmación ───────────────────────────── */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: linear-gradient(160deg, #3d2a0a 0%, #5e4214 40%, #7a5618 75%, #8e6420 100%);
    border: 1px solid rgba(255, 200, 100, 0.25);
    border-radius: 16px;
    padding: 2rem;
    max-width: 400px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(12px);
    animation: slideUp 0.3s ease;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .modal-content h3 {
    color: #fff;
    font-size: 1.2rem;
    margin-bottom: 1rem;
    font-weight: 700;
  }

  .modal-content p {
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.95rem;
    line-height: 1.5;
    margin-bottom: 0.75rem;
  }

  .modal-buttons {
    display: flex;
    gap: 1rem;
    margin-top: 1.5rem;
  }

  .modal-btn {
    flex: 1;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    border: none;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.1s ease;
  }

  .modal-btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .modal-btn.cancel {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.3);
  }

  .modal-btn.cancel:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.3);
  }

  .modal-btn.danger {
    background: rgba(255, 50, 50, 0.8);
    color: #fff;
    border: 1px solid rgba(255, 100, 100, 0.8);
  }

  .modal-btn.danger:hover:not(:disabled) {
    background: rgba(255, 50, 50, 1);
  }

  .modal-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── Documentos Section ──────────────────────────── */
  .documentos-wrap {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    padding: 1.5rem;
    backdrop-filter: blur(8px);
    margin-bottom: 2rem;
  }

  .documentos-contexto-select {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-bottom: 1.5rem;
    background: rgba(255, 255, 255, 0.08);
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
  }

  .documentos-contexto-select label {
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.9rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .documentos-contexto-select select {
    flex: 1;
    min-width: 200px;
  }

  .contexto-select {
    padding: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.2);
    color: #fff;
    font-family: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    transition: border-color 0.2s ease, background 0.2s ease;
    width: 100%;
  }

  .contexto-select:focus {
    outline: none;
    border-color: rgba(0, 200, 255, 0.6);
    background: rgba(0, 0, 0, 0.3);
  }

  .contexto-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .contexto-select option {
    background: #1a1a1a;
    color: #fff;
  }

  .documentos-list-wrap {
    margin-bottom: 1.5rem;
  }

  .documentos-list-wrap h4 {
    color: #fff;
    font-size: 0.95rem;
    margin-bottom: 1rem;
    font-weight: 600;
  }

  .documentos-table {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: rgba(0, 0, 0, 0.2);
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .documento-row {
    display: flex;
    align-items: center;
    padding: 0.75rem 1rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    border-left: 3px solid rgba(0, 119, 255, 0.5);
    transition: background 0.2s ease;
  }

  .documento-row:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .documento-nombre {
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.9rem;
    word-break: break-word;
    flex: 1;
  }

  .documento-borrar-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1.1rem;
    padding: 0.2rem 0.4rem;
    border-radius: 6px;
    flex-shrink: 0;
    filter: drop-shadow(0 1px 4px rgba(0,0,0,0.55)) brightness(0.6);
    transition: filter 0.15s, background 0.15s;
    line-height: 1;
  }

  .documento-borrar-btn:hover:not(:disabled) {
    filter: brightness(1) drop-shadow(0 0 6px rgba(255, 200, 50, 0.9)) drop-shadow(0 0 12px rgba(255, 170, 0, 0.6));
    background: rgba(255, 80, 80, 0.18);
  }

  .documento-borrar-btn:disabled {
    opacity: 0.2;
    cursor: not-allowed;
  }

  /* ── Integrar Documento Form ─────────────────────── */
  .integrar-documento-wrap {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    padding: 1.5rem;
    backdrop-filter: blur(8px);
    margin-bottom: 2rem;
  }

  .integrar-documento-wrap h3 {
    color: #fff;
    font-size: 1rem;
    margin-bottom: 1rem;
    font-weight: 600;
  }

  .integrar-documento-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .documento-input {
    padding: 0.75rem;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.2);
    color: #fff;
    font-family: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    transition: border-color 0.2s ease;
    width: 100%;
  }

  .documento-input::file-selector-button {
    background: rgba(0, 119, 255, 0.3);
    border: 1px solid rgba(0, 119, 255, 0.5);
    color: #fff;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    margin-right: 1rem;
    font-weight: 600;
    transition: background 0.2s ease;
  }

  .documento-input::file-selector-button:hover {
    background: rgba(0, 119, 255, 0.6);
  }

  .documento-input:focus {
    outline: none;
    border-color: rgba(0, 119, 255, 0.8);
  }

  .documento-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .integrar-documento-form small {
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.8rem;
  }

  .integrar-documento-btn {
    padding: 0.75rem 1.5rem;
    background: rgba(0, 119, 255, 0.3);
    border: 1px solid rgba(0, 119, 255, 0.5);
    border-radius: 8px;
    color: #fff;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease;
    white-space: nowrap;
    min-width: max-content;
    align-self: flex-start;
  }

  .integrar-documento-btn:hover:not(:disabled) {
    background: rgba(0, 119, 255, 0.5);
    border-color: rgba(0, 119, 255, 0.8);
  }

  .integrar-documento-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── Barra de Progreso ───────────────────────────── */
  .progreso-wrap {
    height: 6px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 99px;
    overflow: hidden;
    margin-top: 0.75rem;
    position: relative;
  }

  .progreso-bar {
    height: 100%;
    border-radius: 99px;
  }

  .progreso-bar.indeterminate {
    position: absolute;
    width: 45%;
    background: linear-gradient(90deg, transparent, #0077ff, #00c8ff, transparent);
    animation: sweep 1.4s ease-in-out infinite;
  }

  @keyframes sweep {
    0%   { left: -50%; }
    100% { left: 110%; }
  }

  .progreso-bar.done {
    width: 100%;
    background: linear-gradient(90deg, #16a34a, #4ade80);
    box-shadow: 0 0 8px rgba(74, 222, 128, 0.6);
    transition: width 0.3s ease;
  }

  /* ── Borrar Documento Form ───────────────────────── */
  /* (removed — trash button now inline per document row) */

  .borrar-documento-form {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
    align-items: flex-end;
  }

  .borrar-documento-btn {
    padding: 0.75rem 1.5rem;
    background: rgba(200, 50, 50, 0.3);
    border: 1px solid rgba(200, 50, 50, 0.5);
    border-radius: 8px;
    color: #fff;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease;
    white-space: nowrap;
    flex-shrink: 0;
    min-width: max-content;
    align-self: flex-end;
  }

  .borrar-documento-btn:hover:not(:disabled) {
    background: rgba(200, 50, 50, 0.5);
    border-color: rgba(200, 50, 50, 0.8);
  }

  .borrar-documento-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── Mensajes Documento ──────────────────────────── */
  .mensaje-documento {
    color: rgba(200, 50, 50, 0.9);
    font-size: 0.9rem;
    padding: 0.75rem 1rem;
    background: rgba(200, 50, 50, 0.15);
    border-left: 3px solid rgba(200, 50, 50, 0.8);
    border-radius: 4px;
    margin-top: 0.75rem;
    animation: slideUp 0.3s ease;
  }

  .mensaje-documento.success {
    color: rgba(74, 222, 128, 0.9);
    background: rgba(74, 222, 128, 0.15);
    border-left-color: rgba(74, 222, 128, 0.8);
  }

  /* ── Modelos Section ───────────────────────────── */
  .modelos-wrap {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    padding: 1.5rem;
    backdrop-filter: blur(8px);
    margin-bottom: 2rem;
  }

  .modelos-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .modelo-card {
    padding: 1rem;
    background: rgba(0, 119, 255, 0.15);
    border: 2px solid rgba(0, 119, 255, 0.3);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: center;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .modelo-card:hover:not(:disabled) {
    background: rgba(0, 119, 255, 0.25);
    border-color: rgba(0, 119, 255, 0.6);
  }

  .modelo-card.active {
    background: rgba(0, 119, 255, 0.4);
    border-color: rgba(0, 119, 255, 0.8);
    color: #fff;
    box-shadow: 0 0 12px rgba(0, 119, 255, 0.5);
  }

  .modelo-nombre {
    display: block;
    word-break: break-word;
  }

  .modelo-detalle {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 1.5rem;
    margin-top: 1.5rem;
  }

  .modelo-detalle h4 {
    color: #fff;
    font-size: 0.95rem;
    margin-bottom: 1rem;
    font-weight: 600;
  }

  .modelo-propiedades {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .propiedad-item {
    display: flex;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: rgba(0, 0, 0, 0.2);
    border-left: 3px solid rgba(0, 119, 255, 0.5);
    border-radius: 4px;
    align-items: flex-start;
  }

  .propiedad-key {
    color: rgba(0, 200, 255, 0.8);
    font-weight: 600;
    font-size: 0.85rem;
    min-width: fit-content;
    text-transform: capitalize;
  }

  .propiedad-value {
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.85rem;
    word-break: break-word;
    font-family: 'Monaco', 'Courier New', monospace;
  }

  /* ── Alias de Modelos de Embedding ─────────────── */
  .alias-grid {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .alias-grupo-titulo {
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.95rem;
    margin: 0 0 0.5rem 0;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .alias-row {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) 180px minmax(180px, 1fr);
    gap: 0.75rem;
    align-items: center;
    padding: 0.5rem 0;
  }

  .alias-modelo {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .alias-modelo-nombre {
    color: rgba(255, 255, 255, 0.95);
    font-size: 0.9rem;
    font-family: 'Monaco', 'Courier New', monospace;
    word-break: break-all;
  }

  .alias-modelo-origen {
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .alias-modelo-origen[data-origen="ollama"] { color: rgba(120, 220, 120, 0.8); }
  .alias-modelo-origen[data-origen="openai"] { color: rgba(120, 200, 255, 0.8); }
  .alias-modelo-origen[data-origen="manual"] { color: rgba(255, 200, 120, 0.8); }

  .alias-input {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: white;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    font-family: 'Monaco', 'Courier New', monospace;
    transition: border-color 0.15s;
  }

  .alias-input:focus {
    outline: none;
    border-color: rgba(120, 200, 255, 0.6);
    background: rgba(0, 0, 0, 0.4);
  }

  .alias-input::placeholder {
    color: rgba(255, 255, 255, 0.3);
    font-style: italic;
  }

  .alias-preview {
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.85rem;
    font-family: 'Monaco', 'Courier New', monospace;
    word-break: break-all;
  }

  .alias-preview strong {
    color: rgba(120, 220, 180, 0.95);
    font-weight: 600;
  }

  @media (max-width: 720px) {
    .alias-row {
      grid-template-columns: 1fr;
      gap: 0.4rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
  }

  /* ── Lightbot Section ──────────────────────────── */
  .lightbot-wrap {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    padding: 1.5rem;
    backdrop-filter: blur(8px);
    margin-bottom: 2rem;
  }

  .lightbot-desc {
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.85rem;
    margin-bottom: 1.5rem;
    line-height: 1.5;
  }

  .lightbot-form {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .lightbot-field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .lightbot-field label {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .lightbot-field select {
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    border: 1.5px solid rgba(255, 255, 255, 0.2);
    background: rgba(0, 0, 0, 0.25);
    color: #fff;
    font-family: inherit;
    font-size: 0.875rem;
    outline: none;
    cursor: pointer;
    transition: border-color 0.2s;
  }

  .lightbot-field select:focus {
    border-color: rgba(0, 150, 255, 0.6);
  }

  .lightbot-field select option,
  .lightbot-field select optgroup {
    background: #1a1a2e;
    color: #fff;
  }

  .lightbot-preview {
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 1rem 1.25rem;
  }

  .lightbot-preview h4 {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.7);
    margin-bottom: 0.5rem;
  }

  .url-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.7rem;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.92);
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
    transition: background 0.15s, border-color 0.15s, transform 0.1s;
    white-space: nowrap;
  }

  .asistente-link-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .asistente-link-chip:hover {
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.32);
  }
  .url-action-btn:hover {
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.32);
  }
  .url-action-btn:active {
    transform: scale(0.97);
  }

  .lightbot-url {
    display: block;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
    font-size: 0.78rem;
    color: rgba(100, 200, 255, 0.9);
    word-break: break-all;
    font-family: 'Monaco', 'Courier New', monospace;
    line-height: 1.5;
    user-select: all;
  }

  /* ── Responsive ──────────────────────────────────── */
  @media (max-width: 480px) {
    .header { padding: 0.875rem 1rem; }
    .chat-body { padding: 1rem 0.75rem; }
    .bubble-wrap { max-width: 85%; }
    .header-logo { display: none; }
  }
</style>
