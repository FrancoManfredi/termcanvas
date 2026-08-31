// Contenido del SKILL.md para la skill diag-seguridad.
// El frontmatter lo genera scopedSession; acá va solo el cuerpo markdown.

export const diagSeguridadBody = `
# Diagnóstico de Seguridad

Metodología para auditar superficie de ataque cuando las herramientas
deterministas (npm-audit, license-checker, semgrep, gitleaks, zizmor) ya
corrieron. Tu valor agregado es lo que NINGÚN scanner cubre: la lógica
de negocio explotable.

## Qué investigar con foco (más allá de los hallazgos de herramientas)

- **Autorización débil**: endpoints/comandos que validan autenticación pero
  no autorización por rol/recurso (IDOR: acceder al recurso de otro sin
  chequear ownership).
- **Bordes de entrada IPC**: en apps Electron, cada handler ipcMain es una
  superficie de ataque del renderer hacia el main. Buscar handlers que
  reciben rutas/paths y los usan sin validar que estén dentro del repo.
- **Inyección por construcción de comandos**: exec/execFile/spawn que
  interpolan input de usuario en el comando o sus args.
- **Secretos en código**: claves hardcodeadas que gitleaks no detecta por
  ser patrones no estándar (tokens internos, firmas webhook).
- **Validación faltante antes de persistir**: datos externos (APIs, webhooks,
  archivos del usuario) guardados sin sanitizar ni validar schema.
- **Workflows CI**: permisos excesivos (permissions: write-all), acciones de
  terceros sin pin por SHA, secrets expuestos a forks en pull_request_target.
- **Hardening del BrowserWindow**: webPreferences con nodeIntegration: true,
  contextIsolation: false o webSecurity: false — cada uno convierte un XSS
  de renderer en RCE del proceso main.
- **Prototype pollution**: merges/asignaciones recursivas de input externo
  sin filtrar las claves __proto__/constructor/prototype — contaminan el
  molde de TODOS los objetos creados después.
- **ReDoS**: regex sobre input controlado por el usuario con backtracking
  catastrófico (cuantificadores anidados, alternancias ambiguas) — una sola
  entrada cuelga renderer o main.
- **SSRF**: fetch/request a URL provista por input externo sin allowlist —
  alcanza servicios internos (localhost, puertos de dev) desde el proceso
  Node.

## Calibración de severidad

- critical: secreto real commiteado, RCE, bypass de auth completo.
- high: IDOR explotable, inyección con input controlado, dependencia con CVE
  explotable en runtime.
- medium: defensa en profundidad ausente (sin rate limit, sin CSRF en
  mutation), CVE en dependencia solo-dev.
- low: higiene (headers faltantes, logging de datos sensibles no-PHI).

## Falsos positivos típicos a DESCARTAR

- Secretos de ejemplo en .env.example, fixtures o tests.
- CVEs de devDependencies que nunca llegan al bundle de producción.
- "Vulnerabilidades" en código muerto (verificar que el archivo se alcance
  desde un entrypoint real antes de reportar).

## Estándar de evidencia

Cada finding necesita: archivo:línea, vector de ataque concreto ("un renderer
comprometido puede...") y por qué la mitigación actual no alcanza. Sin
vector, no es finding de seguridad: es comentario.
`.trim();
