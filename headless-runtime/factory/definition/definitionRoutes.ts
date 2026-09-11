/**
 * factory/definition/definitionRoutes — FASE 3 E2: dominio definition.
 *
 * Dueno E2 en FASE 3 (apartado 2 + apartado 3 + apartado 4 de
 * docs/MASTER-PLAN-MODULARIDAD.md): este modulo es la puerta del cascaron
 * (`factoryServer.ts`, bloque Rutas definition) hacia el estado validado de
 * la definition para el badge: `{valid, issues, checkedAt, buildId}` donde
 * cada issue trae `file`, `line` opcional y `rule`. El server conserva formas
 * y handlers y respuestas; solo el MATCH y la lectura delegan. El bloque
 * Rutas measure de E1 queda intacto.
 *
 * Reglas que honra (las 8 de los master plans + C1-C10):
 * - C1 ESM y cotas: ESM puro, cero llamadas dinamicas con cadena, sin
 *   temporizadores nuevos, sin recorridos escritos a mano (la iteracion
 *   acotada por readdir vive en el dueno `definitionValidate`).
 * - C2 puras fail-safe: cada export con try y catch; ante fallo catastrofico
 *   retorna 1 issue error `validate-crashed`, nunca lanza hacia el server.
 * - C3 un escritor: este modulo SOLO LEE la definition (via el validador
 *   dueno). Jamas escribe factory, jobs, resultados ni propuestas.
 * - C4 disco best-effort: heredado del validador (cada archivo con su propio
 *   resguardo; un archivo roto no aborta el resto).
 * - C5 aditivo: codigos, textos y formas identicos a los handlers actuales
 *   (pacts F01-F14, polling 30s reutilizado, `valid` igual a cero issues
 *   error; los avisos no bloquean).
 * - C6 y C7 vocabulario unico, nada duplicado: el estado se IMPORTA del
 *   validador dueno (`getDefinitionStatus`, `validateDefinition`), no se
 *   copia; el cascaron re-exporta por identidad.
 * - C8 rutas en tabla: cubre definition-status de
 *   `factory/routing/routeTable.ts` (global, sin alias dual).
 * - C9 builders puros testeables: el payload del GET es funcion del estado
 *   mas el buildId que el cascaron ya calcula para salud (mismo valor,
 *   no inventado).
 * - C10 trazabilidad: cada helper cita su bloque espejo del cascaron.
 *
 * Lista blanca de imports (reparto FASE 3 E2): definitionValidate (dueno del
 * estado: `getDefinitionStatus`, `validateDefinition` mas tipos) y
 * agentLoader en lectura (reservado para resolucion de rutas; hoy no se
 * necesita porque el validador ya resuelve `factory/` sin literales de
 * maquina).
 * PROHIBIDO: review, triage, spec, measure, runner-executor y sus stores,
 * notify, VerificationPanel, package.json.
 */

import {
  getDefinitionStatus,
  validateDefinition,
} from "../definitionValidate";
import type {
  DefinitionIssue,
  DefinitionStatus,
} from "../definitionValidate";

export type { DefinitionIssue, DefinitionStatus };

/**
 * True para GET /factory/definition/status (espejo del bloque Ola 20 del
 * cascaron). Puro, nunca lanza.
 */
export function isDefinitionStatusRoute(method: unknown, pathname: unknown): boolean {
  try {
    return method === "GET" && pathname === "/factory/definition/status";
  } catch {
    return false;
  }
}

export interface DefinitionStatusResponse {
  valid: boolean;
  issues: DefinitionIssue[];
  checkedAt: string;
  buildId: string;
}

/**
 * Payload de GET /factory/definition/status (espejo del bloque Ola 20 del
 * cascaron). `buildId` es el mismo que expone salud (lo pasa el cascaron via
 * su helper existente; nunca se inventa aca). `valid` equivale a cero issues
 * con severidad error. `factoryDir` es seam documentado SOLO para tests
 * (sandbox): en produccion se omite y el validador usa `factory/` del repo.
 * Nunca lanza.
 */
export function buildDefinitionStatusResponse(
  buildId: string,
  factoryDir?: string,
): DefinitionStatusResponse {
  try {
    const hasSandbox =
      typeof factoryDir === "string" && factoryDir.trim().length > 0;
    if (hasSandbox) {
      try {
        const issues = validateDefinition({ factoryDir: (factoryDir as string).trim() });
        const list = Array.isArray(issues) ? issues : [];
        return {
          valid: !list.some((i) => i?.severity === "error"),
          issues: list,
          checkedAt: new Date().toISOString(),
          buildId: typeof buildId === "string" && buildId.length > 0 ? buildId : "dev-unknown",
        };
      } catch {
        return {
          valid: false,
          issues: [
            {
              file: "factory/",
              rule: "validate-crashed",
              message: "no se pudo validar la definition (fallo interno del endpoint)",
              severity: "error",
            },
          ],
          checkedAt: new Date().toISOString(),
          buildId: typeof buildId === "string" && buildId.length > 0 ? buildId : "dev-unknown",
        };
      }
    }
    const status = getDefinitionStatus(buildId);
    return {
      valid: status.valid === true,
      issues: Array.isArray(status.issues) ? status.issues : [],
      checkedAt: typeof status.checkedAt === "string" ? status.checkedAt : new Date().toISOString(),
      buildId:
        typeof status.buildId === "string" && status.buildId.length > 0
          ? status.buildId
          : typeof buildId === "string" && buildId.length > 0
            ? buildId
            : "dev-unknown",
    };
  } catch {
    try {
      return {
        valid: false,
        issues: [
          {
            file: "factory/",
            rule: "validate-crashed",
            message: "no se pudo validar la definition (fallo interno del endpoint)",
            severity: "error",
          },
        ],
        checkedAt: new Date().toISOString(),
        buildId: typeof buildId === "string" && buildId.length > 0 ? buildId : "dev-unknown",
      };
    } catch {
      return {
        valid: false,
        issues: [],
        checkedAt: new Date().toISOString(),
        buildId: "dev-unknown",
      };
    }
  }
}
