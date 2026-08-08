# Handoff — Costos por consulta (Fase 2, frontend)

> ⚠️ **Este archivo es solo un puntero.** El handoff maestro, con el diseño
> completo, los bugs encontrados y el plan de las dos fases, vive en el repo
> hermano del backend:
>
> ```
> c:\Moibe\code\constructor-agente-rag\HANDOFF-COSTOS.md
> ```
>
> Léelo primero. Este archivo solo anota lo que toca a este repo.

---

## Qué es este trabajo

Mostrar **cuánto cuesta cada consulta** al chatbot, en dinero, y dejar el sistema
listo para más proveedores (Claude, Gemini) además de OpenAI y Ollama.

El grueso es backend (`constructor-agente-rag`). Este repo recibe tres cambios,
todos al final.

## ⛔ No arrancar todavía

La Fase 2 depende del contrato de API que define la Fase 1: nombres de endpoints,
forma de la respuesta, y si las tarifas terminan siendo editables desde el admin
o una constante en el backend (decisión pendiente, ver sección 6 del maestro).

**Escribir esto antes de que la Fase 1 esté cerrada es adivinar.** Cuando el
backend esté listo, este archivo se reemplaza por el handoff real con el contrato
ya definido.

## Lo que toca a este repo (Fase 2, items 10-12 del maestro)

1. **Columna Costo** en la tabla de Registros, junto a Tokens
   (`src/App.svelte:5220-5257`). Ya existe el helper `formatUsd()`.
   Mostrar `—` cuando el costo sea `NULL` — significa *"sin tarifa conocida"*,
   que no es lo mismo que cero.
2. **Tab de tarifas** en Administración. Modelo visual a copiar: el tab Alias
   (`src/App.svelte:4722+`). Solo aplica si se elige tarifas editables.
3. **Dropdown de modelo del asistente** (`src/App.svelte:3283-3297`) debe leer del
   registro de modelos del backend en vez de las constantes hardcodeadas
   `MODELOS` / `MODELOS_OPENAI` (`src/App.svelte:134-135`).

## Bug de este repo que se arregla con el item 3

`MODELOS = ['mistral', 'llama3.1']` está hardcodeado, mientras que el tab Modelos
consulta Ollama directo vía `GET /listarModelos` y lista ~10 LLMs instalados.

Resultado: **qwen3, mixtral, deepseek-r1, gemma3 y gpt-oss se ven en el admin pero
no se pueden asignar a ningún asistente.** El item 3 los desbloquea.

## Gotcha

`consumoData.tokens_openai` se lee en **8 lugares** del tab Consumo
(`src/App.svelte:4926-4955`). Es un nombre acoplado al proveedor y es candidato a
renombrarse a algo neutro (`tokens_ia`) cuando entren Claude y Gemini. Si el
backend lo renombra, este repo se actualiza **en el mismo cambio** o el tab
Consumo queda en blanco.

## Cómo correr

```bash
npm run dev   # levanta los tres: API :8077, admin :4175, widgets :4176
```

Este repo es el orquestador (`scripts/dev-local.mjs`). Admin en
`http://localhost:4175` → tab Administración → Registros / Consumo.
