# Fix: restore-worktree falla con "a branch named ... already exists"

## Contexto

Regresión introducida por `resolveBranchCheckoutRef()` (fix anterior del
`fatal: invalid reference`): el resolver devuelve `source: "origin"` siempre
que el ref remoto exista, aunque la rama local también exista.
`project:restore-worktree` usa ese flag para elegir comando y ejecuta
`git worktree add -b <rama> <path> origin/<rama>`, que muere con
*"fatal: a branch named '...' already exists"* cuando la rama local sigue
existiendo (worktree de implementación eliminado, rama huérfana).

Escenario real: IMPLEMENTAR FIX sobre PRs #59/#58/#55 en education-games.

## Cambios

### 1. electron/git-info.ts — resolver más expresivo

- Firma del éxito: `{ ok: true; ref; source: "local" | "origin"; hasLocal: boolean }`.
- `hasLocal = await refResolves(refs/heads/<branch>)` se computa una vez.
- `ref`/`source` siguen prefiriendo `origin/<rama>` (el review sigue viendo
  el head real del PR); `hasLocal` permite a los flujos que ADJUNTAN una
  rama evitar recrearla.
- Actualizar el comentario de cabecera.

### 2. electron/main.ts — `project:restore-worktree`

Decidir el modo por `hasLocal`, no por `source`:

```ts
if (resolved.hasLocal) {
  // Adjuntar la rama existente — `-b` moriría con "already exists".
  ["worktree", "add", worktreePath, trimmedBranch]
} else {
  // Autocuración: crear rama de seguimiento desde origin.
  ["worktree", "add", "-b", trimmedBranch, worktreePath, `origin/${trimmedBranch}`]
}
```

`create-review-worktree` NO cambia (detached; usa `resolved.ref` tal cual).

### 3. tests/git-info.test.ts — regresión

- Nuevo test: rama local + rama en origin + sin worktrees →
  `hasLocal === true` y el comando attach (`worktree add <path> <rama>`
  sin `-b`) funciona contra git real.
- En el test origin-only existente: añadir `assert.equal(resolved.hasLocal, false)`.

## Verificación

- `npm run typecheck`
- `npx tsx --test tests/git-info.test.ts`
- Suites review/worktree/fix/conflict:
  `tests/issue-review-worktree.test.ts tests/issue-fix-worktree.test.ts
   tests/resolve-conflict-worktree.test.ts tests/project-scanner.test.ts`

## No incluido (por decisión)

Fast-forward automático hacia origin tras adjuntar la rama local atrás
(`merge --ff-only`); restaurar usa la rama local tal cual, igual que antes
de la regresión.
