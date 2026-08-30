# PRD — Pulido Onboarding Cero + Dashboard Limpio

**Épica:** Onboarding Cero + Dashboard Limpio  
**Tipo:** PRD Incremental Simple  
**Versión:** 1.0 — 2026-08-30  
**Autora:** Alice — Product Manager  
**Equipo:** software-termcanvas-pulido  
**Estado:** Draft para revisión de Arquitectura

---

## 1. Proyecto

| Campo | Valor |
|---|---|
| **Language** | Español rioplatense |
| **Programming Language** | Vite + React + MUI + Tailwind CSS (web) / Hono :8787 (server), proxy vite |
| **Project Name** | `termcanvas_pulido_onboarding` |
| **Feature Flag** | Existente (mantener, extender para fullscreen) |
| **Repositorios afectados** | `web/src/components/quickstart/QuickstartWizard.tsx`, `web/src/lib/factory/store/factoryWorkspace.store.ts`, `web/src/components/dashboard/DashboardPage.tsx`, `server/src/lib/githubApp.ts` + nuevo OAuth/Install flow |

### 1.1 Requisito original — transcripción literal

> "Momento en el que entrás en la aplicación y no tenés nada, absolutamente nada. ¿Qué tiene que ocurrir ahí? Se tiene que aparecer y ocupar toda la pantalla el Quick Start, ¿ok? Lo único que va a ir mostrando son las tarjetas paso a paso hasta llegar al séptimo paso, ¿ok? Eso lo ocupa toda la pantalla. Entonces vos decidís. Primero, como es para mí local esto, primero lo que vamos a hacer es conectar proveedor con GitHub únicamente. Entonces al darle clic a GitHub antes de darle al botón de continuar me va a tener que abrir una pestaña aparte para poder conectarlo y que ya quede conectado y en el futuro no tenga que volver a conectarlo. Después que quede conectado se verifica con un tick y podemos continuar. Después van a aparecer los repositorios que yo tengo en mi GitHub real y ahí lo voy a poder seleccionar. Después voy a poder armar nuevamente el nombre de la factory, que elijo el que yo quiera y continuás. Después lo de conectar el Slack por ahora no lo vamos a hacer. Como dijimos anteriormente que vamos a dejar todo en local. Después se eligen los agentes que vos querés implementar y elegir el tracker. Por ahora tampoco lo vamos a implementar. Bien, el Factory MSP tampoco lo vamos a usar. Ya hablamos de esto, pero nada, no se crea eso. Entonces una vez que creás tu primera fábrica te lleva directamente al dashboard de esa misma. El dashboard vas a sacar todo, absolutamente todos los datos hardcodeados que estén. Vamos a comenzar por hacer esto ahora mismo."

### 1.2 Interpretación del problema

Hoy el sistema **miente**. Aunque no tengas nada, te muestra factories seed (`payments-factory`, `termcanvas-factory`) y un dashboard con 8 métricas mock. El `QuickstartWizard` existe (7 pasos) pero vive como modal/card dentro del App shell, no como experiencia a pantalla completa. GitHub real existe en `server/src/lib/githubApp.ts` (dry_run/real) pero no hay flujo OAuth/App Install local ni listado real de repos.

Este pulido corrige eso: **cero absoluto significa cero**. Si no hay factories, no hay shell, no hay mocks. Solo el Quick Start ocupando todo.

---

## 2. Definición de Producto

### 2.1 Product Goals — 3 objetivos ortogonales

**G1 — Confianza en el cero absoluto:** Si entrás y no tenés nada, el sistema te lo muestra sin trampas. Nada de seeds, nada de métricas inventadas. Solo el camino para crear tu primera factory. Métrica: 0 factories seed en `localStorage` cuando el estado está vacío; 0 valores mock renderizados en Dashboard.

**G2 — Conexión GitHub local que no molesta dos veces:** Conectar GitHub una vez en local y que quede persistida, verificada con tick, sin volver a pedirla en el futuro. Métrica: tasa de reconexión innecesaria = 0; tiempo de conexión < 30s.

**G3 — De cero a dashboard real en < 2 minutos:** Completar los 7 pasos y aterrizar en el Dashboard de la factory recién creada, sin datos truchos, solo empty states accionables. Métrica: funnel 7 pasos completado end-to-end con repos reales.

### 2.2 User Stories

> **US-1 — Primer ingreso en vacío**
> Como usuario local que entra por primera vez, quiero que toda la pantalla sea el Quick Start paso a paso, para entender que estoy en cero y saber exactamente qué hacer sin distracciones del shell.

> **US-2 — Conexión GitHub persistida**
> Como usuario local, quiero conectar GitHub clickeando el proveedor y que se abra una pestaña aparte (OAuth / App Install), para autorizar una sola vez y ver un tick de verificación que me habilite a continuar sin volver a conectarlo en el futuro.

> **US-3 — Selección de repos reales**
> Como usuario con GitHub conectado, quiero ver el listado real de mis repositorios (no mocks), para seleccionar el/los que van a alimentar mi factory.

> **US-4 — Factory con nombre propio**
> Como usuario, quiero ponerle a mi factory el nombre que yo elija, para reconocerla al instante en el dashboard.

> **US-5 — Aterrizaje limpio**
> Como usuario que acaba de crear su primera factory, quiero que me lleve directo al Dashboard de esa factory y que ese dashboard no me muestre ningún dato hardcodeado, solo estados vacíos honestos hasta que haya actividad real, para no tomar decisiones con información falsa.

---

## 3. Flujo 7 Pasos — Quick Start a Pantalla Completa

### 3.1 Regla de entrada (routing fullscreen)

- **Condición:** `factoryWorkspace.store` con 0 factories (tras remover seeds) Y sin localStorage previo O localStorage vacío.
- **Comportamiento:** No se renderiza App shell (sidebar, header, nav). Ruta dedicada (ej. `/quickstart` o `/` en estado vacío) renderiza `QuickstartWizard` a **pantalla completa** (100vw/vh, centrado, sin chrome). Solo tarjetas paso a paso, una a la vez con progress.
- **Salida:** Al completar paso 7 y crear factory, navegar directo a `/factory/:factoryId/dashboard` (dashboard de esa factory). No al listado, no al home genérico.
- **Retorno:** Si ya existe ≥1 factory, el Quick Start no vuelve a ocupar pantalla completa. Accesible solo vía CTA "Crear factory" si se quiere repetir.

### 3.2 Detalle paso a paso (must mantener 7 tarjetas)

| Paso | Título | Qué pasa | Qué NO pasa (por ahora) | Criterio de avance |
|---|---|---|---|---|
| **1** | Conectar proveedor — GitHub | Solo GitHub visible. Al clickear GitHub, se abre **pestaña aparte** (OAuth o GitHub App Install). Al volver/autorizar, se verifica conexión y aparece **tick verde** + estado "Conectado". Persiste. | No GitLab, no Bitbucket. No Slack acá. | must tener tick verificado para habilitar "Continuar". |
| **2** | Seleccionar repositorios | Fetch real a GitHub del usuario autenticado. Lista con nombre, visibilidad (public/private), updated_at. Selección single (v1) o multi con límite claro. | No mocks. No repos hardcodeados. | must seleccionar ≥1 repo real. |
| **3** | Nombre de la factory | Input libre con validación inline (3-40 chars, snake/kebab, sin duplicados). Preview del slug. | No autocompletado mágico. | must nombre válido. |
| **4** | Conectar Slack — Skip | Card explicativa: "Slack queda en local, lo salteamos por ahora". Botón "Omitir / Continuar". Sin integración real. | No OAuth Slack. No webhook. | must click "Continuar" (skip explícito). |
| **5** | Elegir agentes | Lista de agentes disponibles (placeholder informativo). Selección visual pero **no implementa lógica** en esta épica. Se guarda preferencia. | No instala agentes, no llama server. | should seleccionar ≥1 para guardar preferencia, pero puede continuar con default. |
| **6** | Tracker + Factory MSP — Skip | Dos bloques: Tracker (Jira/Linear/etc.) y Factory MSP. Ambos marcados como "No disponible en local". Botón "Omitir y crear". | No crea MSP. No conecta tracker. | must skip explícito. |
| **7** | Crear y navegar | Resumen de lo elegido (GitHub ✓, repo(s), nombre). CTA "Crear factory". Al éxito → redirect directo a Dashboard de esa factory. | No paso intermedio. | must factory persistida y navegación exitosa. |

**Navegación entre pasos:** Stepper visible (1/7 → 7/7), "Atrás" siempre habilitado excepto paso 1, "Continuar" deshabilitado hasta cumplir criterio. No se puede saltear paso 1-3 por URL.

### 3.3 Persistencia de conexión GitHub

- Guardar token/instalación de forma local segura (ver preguntas abiertas). Al reabrir la app, si la conexión sigue válida, paso 1 muestra tick directo y habilita continuar.
- Si token expirado/revocado, tick pasa a estado "Reconectar" con CTA que reabre pestaña.
- No volver a pedir si ya está conectado y verificado.

---

## 4. Dashboard Limpio — Qué significa "sacar todo lo hardcodeado"

### 4.1 Estado actual a remover

`DashboardPage.tsx` hoy renderiza **8 métricas con valores mock** (ej. throughput, issues abiertas, velocity, coverage — valores fijos), listas de actividad y gráficos con datos inventados. Además `factoryWorkspace.store.ts` siembra 2 factories (`payments-factory`, `termcanvas-factory`) que hacen que nunca veas el cero.

### 4.2 Definición de "limpio"

- **must** eliminar seeds: si no hay factories creadas por el usuario, store vacío. Sin fallback a mocks. Migración: limpiar `localStorage` legacy con seeds en primer arranque (con confirmación si ya había datos de usuario).
- **must** eliminar 8 métricas mock. Ningún número inventado.
- **must** cada widget del Dashboard tener 3 estados:
  1. **Empty** (cero datos reales): ilustración + mensaje honesto + CTA accionable. Ej: "Todavía no hay actividad — conectá un repo o corré tu primer agente".
  2. **Loading** (fetch real en curso): skeleton, no spinner eterno.
  3. **Data** (datos reales): solo cuando hay datos del server/factory. Si no hay backend aún, se queda en Empty (no se inventa).
- **must** no mostrar gráficos vacíos con ejes falsos. Si no hay datos, no hay gráfico.
- **should** mantener estructura/ layout del Dashboard (grid, cards) pero con placeholders vacíos, para que el pulido visual no rompa responsive.

### 4.3 Empty states por widget (ejemplo)

- Métricas: "Sin datos todavía" + subtítulo "Tus métricas van a aparecer acá cuando tu factory tenga actividad".
- Actividad reciente: "Nada por acá aún — creá tu primera tarea o conectá un repo".
- Repos vinculados: lista real del paso 2, si no hay más, CTA "Vincular otro repo" (deshabilitado si no hay GitHub).

---

## 5. Requisitos — Pool Priorizado

### P0 — Must have (sin esto no hay pulido)

- **P0-1 Fullscreen routing:** Cuando `factoryCount === 0`, Quick Start ocupa 100% viewport sin shell. Criterio: inspección visual + test de ruta.
- **P0-2 Remover seeds:** Eliminar `payments-factory` y `termcanvas-factory` del store y `localStorage`. App inicia en cero absoluto. Migración de limpieza legacy.
- **P0-3 GitHub connect en pestaña aparte:** Click en GitHub → `window.open` a flujo OAuth/App Install. Al completar, pestaña se cierra o redirige y la original detecta conexión.
- **P0-4 Persistencia + tick:** Conexión guardada (local + validada). Tick verde visible. Reconexión no pedida si sigue válida. "Continuar" solo habilitado con tick.
- **P0-5 Repo listing real:** Fetch a `GET /user/repos` (o App Install repos) del usuario real autenticado. Manejo de loading/error/empty. Sin mocks.
- **P0-6 Nombre factory custom:** Input con validación y slug, persistido en store.
- **P0-7 Skip Slack / Tracker / MSP explícitos:** Pasos 4 y 6 son pantallas de skip con copy claro ("En local lo dejamos afuera por ahora") y botón Continuar. No se crea MSP.
- **P0-8 Crear y navegar a Dashboard de esa factory:** `POST` (o store local v1) crea factory y hace `navigate(/factory/:id/dashboard)`.
- **P0-9 Dashboard sin hardcodeados:** Remover 8 métricas mock. Todos los widgets en empty state cuando no hay datos.

> **Gherkin P0-1**
> ```gherkin
> Feature: Onboarding a pantalla completa en cero absoluto
>   Scenario: Usuario entra sin factories
>     Given no existe ninguna factory en el store ni en localStorage
>     When abro la app en "/"
>     Then veo el Quick Start ocupando toda la pantalla
>     And no veo sidebar ni header del shell
>     And veo el stepper "Paso 1 de 7 — Conectar GitHub"
> ```

> **Gherkin P0-3 + P0-4**
> ```gherkin
> Feature: Conexión GitHub persistida con tick
>   Scenario: Conectar GitHub por primera vez
>     Given estoy en Paso 1 y GitHub no está conectado
>     When clickeo "Conectar GitHub"
>     Then se abre una pestaña aparte con el flujo de autorización
>     When completo la autorización y vuelvo a la app
>     Then veo un tick verde "GitHub conectado"
>     And el botón "Continuar" se habilita
>     When recargo la página al día siguiente
>     Then sigo viendo "GitHub conectado" sin tener que reconectar
> ```

> **Gherkin P0-5**
> ```gherkin
> Feature: Listado real de repos
>   Scenario: Ver mis repos reales
>     Given GitHub está conectado y verificado
>     When avanzo al Paso 2
>     Then veo la lista de mis repositorios reales de GitHub
>     And no veo repos mock ni hardcodeados
>     When selecciono "mi-repo-real"
>     Then el botón "Continuar" se habilita
> ```

> **Gherkin P0-8 + P0-9**
> ```gherkin
> Feature: Crear factory y aterrizar en dashboard limpio
>   Scenario: Finalizar onboarding
>     Given completé los pasos 1 a 6
>     When en Paso 7 clickeo "Crear factory" con nombre "mi-factory"
>     Then se crea la factory "mi-factory"
>     And navego a "/factory/mi-factory/dashboard"
>     And en el Dashboard no veo ninguna métrica con valores inventados
>     And veo empty states con mensajes y CTAs
> ```

### P1 — Should have (pulido que se nota)

- **P1-1 Verificación real de conexión:** No solo guardar token, hacer `GET /user` para validar y mostrar avatar/username junto al tick.
- **P1-2 Manejo de errores GitHub:** Token expirado, permisos denegados, rate limit, sin repos. Mensajes claros + CTA "Reintentar / Reconectar".
- **P1-3 Loading / skeleton coherente:** En paso 2 y Dashboard, skeletons consistentes con MUI, no layout shift.
- **P1-4 Validación de nombre con feedback:** Duplicado, caracteres inválidos, largo. Mensaje inline inmediato.
- **P1-5 Feature flag para fullscreen:** Flag `quickstart_fullscreen` que permita rollback a modal si hace falta, sin deploy.
- **P1-6 Limpieza de localStorage legacy:** Si detecta seeds viejas, banner "Limpiamos datos de demo" + confirmación.
- **P1-7 Guard de navegación:** No permitir saltar a paso 3 por URL si paso 1 no está verificado.

### P2 — Could have (nice, no bloquea)

- **P2-1 Paginación / búsqueda de repos:** Si el usuario tiene >30 repos, paginar o filtrar con input. Paginado server-side con `per_page` + `page`.
- **P2-2 Refetch silencioso:** Revalidar conexión GitHub en background al reabrir la app.
- **P2-3 Desconectar / cambiar cuenta GitHub:** CTA "Desconectar" en Paso 1 con confirmación.
- **P2-4 Preferencias de agentes/tracker persistidas:** Guardar selección de pasos 5-6 aunque no se ejecuten, para futura implementación.
- **P2-5 Animación de transición entre pasos:** Slide/fade suave, progress bar animada.
- **P2-6 Telemetría local:** Log de funnel (paso abandonado) sin enviar a terceros.

---

## 6. UI Design Draft — Sin código, solo layout

### 6.1 Quick Start Fullscreen (estado vacío)

```
┌─────────────────────────────────────────────────────┐
│  Full viewport (100vw x 100vh), bg muted            │
│  ┌─────────────────────────────────────────────┐    │
│  │  Header minimal: logo + "Quick Start  2/7"  │    │
│  │  Progress bar (7 dots, actual resaltado)    │    │
│  ├─────────────────────────────────────────────┤    │
│  │                                             │    │
│  │  Tarjeta centrada (max 640px)               │    │
│  │  ┌───────────────────────────────────┐      │    │
│  │  │ Título paso + subtítulo           │      │    │
│  │  │                                   │      │    │
│  │  │ Contenido específico del paso    │      │    │
│  │  │ (GitHub btn / repo list / input) │      │    │
│  │  │                                   │      │    │
│  │  │ [Atrás]        [Continuar →]      │      │    │
│  │  └───────────────────────────────────┘      │    │
│  │                                             │    │
│  │  Footer tiny: "Local only — no se envía    │    │
│  │  nada fuera de tu máquina"                  │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

- Tipografía y MUI consistente con app, pero sin shell. Card elevada con sombra, no modal overlay.
- Paso 1: botón grande "Conectar con GitHub" (ícono GitHub) + estado tick/validando/error debajo. Botón Continuar deshabilitado hasta tick.
- Paso 2: lista scrollable de repos (checkbox/radio), altura max, skeleton al cargar, empty "No tenés repos o no dimos permisos — revisar instalación".
- Pasos 4 y 6: ilustración simple + copy "Lo salteamos en local" + botón Continuar primario (sin opción de conectar).
- Paso 7: resumen en 3 filas (GitHub ✓ username, Repo(s), Nombre factory) + CTA grande "Crear factory y ir al Dashboard".

### 6.2 Dashboard Limpio (post-creación)

```
┌─ Header factory: "mi-factory" + repo vinculado ─────┐
│ Grid 2x4 o 3x3 de cards                              │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│ │ Métrica A│ │ Métrica B│ │ Métrica C│  ← cada una  │
│ │ Empty    │ │ Empty    │ │ Empty    │  con icono   │
│ │ "Sin datos      + CTA"│              tenue        │
│ └──────────┘ └──────────┘ └──────────┘              │
│ ┌────────────────────┐ ┌────────────────────┐        │
│ │ Actividad reciente │ │ Repos vinculados   │        │
│ │ Empty ilustración  │ │ lista real (1)     │        │
│ └────────────────────┘ └────────────────────┘        │
└──────────────────────────────────────────────────────┘
```

- Sin números, sin gráficos mock. Si el día de mañana hay datos reales (API), el mismo componente pasa de Empty a Data sin cambiar layout.

---

## 7. Criterios de Aceptación Globales

- [ ] Entrar con `localStorage` limpio → veo Quick Start fullscreen, no shell, no factories seed.
- [ ] Paso 1 abre pestaña aparte, al autorizar veo tick y puedo continuar; al recargar sigo conectado.
- [ ] Paso 2 lista mis repos reales de GitHub (verificable con cuenta real del dev).
- [ ] Puedo poner nombre custom a la factory y se persiste.
- [ ] Pasos 4 y 6 son skip explícitos, no piden Slack ni crean MSP.
- [ ] Paso 7 crea factory y me lleva a `/factory/:id/dashboard` de esa factory.
- [ ] Dashboard no muestra ninguno de los 8 valores mock anteriores; solo empty states.
- [ ] No hay regresión: si ya tengo factories, no veo fullscreen al entrar.

---

## 8. Preguntas Abiertas para Arquitecto

> Estas son las decisiones que frenan el inicio del código. Necesitamos respuesta antes de implementar P0-3 a P0-5.

**1. OAuth vs GitHub App Install — ¿qué flujo usamos en local?**
Hoy `server/src/lib/githubApp.ts` soporta `dry_run` y modo real como GitHub App. Para "conectar proveedor" en local con pestaña aparte, ¿vamos por OAuth App (client_id/secret en `.env`, scope `repo read:user`) o por GitHub App Install (App ID + private key, instalación por usuario/org)? Tradeoff: OAuth es simple para repo listing pero no da webhooks/checks; App Install es más potente pero requiere instalar en cada org y manejar `installation_id`. ¿Cuál dejamos como P0?

**2. ¿Dónde y cómo persistimos la conexión?**
Opciones: (a) `localStorage` con token en web, (b) cookie httpOnly en server Hono :8787 + session, (c) híbrido (token en server, flag en web). En local, ¿aceptamos token en `localStorage` para simplificar o exigimos server session aunque sea local? ¿Cómo evitamos filtrar token en logs?

**3. Repo listing — ¿paginado y con qué endpoint?**
`GET /user/repos` vs `GET /installation/repositories` vs `GET /user/installations`. ¿Paginamos desde P0 o traemos primeros 30 y P2 paginación? ¿Cómo manejamos usuarios con 200+ repos (rate limit, `per_page=100`)? ¿Filtramos por `affiliation=owner,collaborator`?

**4. Fullscreen routing — ¿ruta dedicada o guarda condicional en `/`?**
¿Creamos `/quickstart` con guard `if (factories.length===0) redirect /quickstart` o hacemos que `/` mismo renderice fullscreen cuando está vacío? Impacto en deep links y en tests. ¿Cómo evitamos flash del shell antes de chequear store?

**5. Seed removal — ¿migración destructiva o soft?**
¿Borramos `payments-factory` y `termcanvas-factory` de forma dura (código + `localStorage.clear` de keys legacy) o dejamos migración que detecta `isSeed` y las oculta pero no borra? ¿Qué pasa con devs que ya tienen datos locales valiosos con esos seeds?

**6. Validación del tick — ¿polling, callback o postMessage?**
Tras abrir pestaña aparte, ¿cómo sabe la pestaña original que se completó el OAuth? Opciones: (a) redirect a `http://localhost:5173/auth/callback` que cierra y hace `postMessage`, (b) polling a `GET /auth/status`, (c) `BroadcastChannel`. ¿Cuál es más robusto en vite proxy?

**7. Crear factory — ¿solo store local o también server?**
Hoy `factoryWorkspace.store.ts` es localStorage. ¿Paso 7 persiste solo en web (rápido, local-first) o también hace `POST /factories` al Hono para preparar multi-factory real? Si es solo local, ¿cómo evitamos duplicar lógica cuando se agregue backend?

**8. Dashboard empty vs loading — ¿fuente de verdad?**
Si Dashboard ya no tiene mocks, ¿de dónde vienen los datos reales en el futuro? ¿Dejamos contratos TypeScript de widgets vacíos y el server los llena cuando haya datos, o mockeamos con MSW en dev? Definir para no reintroducir hardcodeos por la ventana.

---

## 9. Fuera de Alcance Explícito (no hacer en esta épica)

- Integración Slack (OAuth, webhooks, canales).
- Selección real de agentes (instalación/ejecución).
- Tracker externo (Jira, Linear, GitHub Issues sync).
- Factory MSP (multi-tenant, billing, orgs).
- Paginación avanzada de repos (P2).
- Deploy / CI / hosting del flujo OAuth (todo local).

---

## 10. Riesgos y Mitigación

| Riesgo | Impacto | Mitigación |
|---|---|---|
| OAuth en localhost falla por callback URL no whitelisteada | P0 bloqueado | Documentar `.env` + callback `http://localhost:5173/auth/callback` en GitHub App settings; fallback a PAT local solo para dev |
| Usuario con 0 repos ve pantalla vacía y se bloquea | Abandono | Empty state con CTA "Crear repo en GitHub" + link + botón Reintentar |
| Flash de shell antes de detectar cero | Mala UX pulido | Guard sincrónico en store + suspense, no renderizar shell hasta saber `factoryCount` |
| Borrado agresivo de localStorage borra trabajo real | Pérdida datos | Migración con confirmación modal si se detectan factories no-seed del usuario |

---

## 11. Próximo Paso

Arquitecto responde preguntas abiertas (especialmente 1, 2, 4) → se crea ADR breve → se trocea en tickets P0 con Gherkin listo para `to-tickets`.

*Fin del PRD — listo para revisión.*
