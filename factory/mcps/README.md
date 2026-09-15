# Bundles MCP por agente

Un bundle MCP es UN archivo `factory/mcps/<nombre>.json`. Los agentes lo
declaran por nombre en su frontmatter (`factory/agents/<agente>/agent.md`):

```md
---
mcps: {github}
---
```

## Formato

```json
{
  "mcpServers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp",
      "headers": { "Authorization": "Bearer ${GITHUB_TOKEN}" }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "env": { "TOKEN": "${FS_TOKEN}" }
    }
  }
}
```

- Remoto: `url` (+ `headers` opcional). Local: `command` (+ `args`/`env`
  opcional). Un bundle puede declarar varios servers.
- Nunca escribas secretos literales acá: usá variables de entorno
  (`${ENV_VAR}`) o headers resueltos por opencode.
- El nombre del archivo solo admite `[a-z0-9_-]` (anti-traversal).

## Runtime

Cuando un nodo del engine corre con un agente que declara `mcps`, el engine
materializa un server opencode scopeado y mergea los servers de esos bundles
(`headless-runtime/workflows/capabilities.ts` → `resolveAgentMcps`). El MCP
declarado en el nodo (`node.mcp`) pisa claves homónimas. Como el archivo se lee
en cada spawn, un cambio impacta en el próximo nodo sin reciclar el server
base.

## Gestión

- UI: sección **Agents** del WarpPanel (cada agente tiene su lista de MCPs;
  botón New MCP para crear/editar bundles).
- API del daemon: `GET /factory/mcps`, `GET /factory/mcps/:name`,
  `POST /factory/mcps`, `PUT /factory/mcps/:name`, `DELETE /factory/mcps/:name`
  (409 si un agente lo referencia).
- Validación: `pnpm validate:agents` marca con file:line los `mcps` de agentes
  que apunten a bundles inexistentes.
