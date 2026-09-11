/**
 * VerifyEvidence writer — Ola 9 (Verify como servicio+artefacto+loop propios).
 * Artefacto `verify.json`: {workItemId, verification (incl. evidence),
 * createdFiles, timestamp}. Escritura atómica tmp→rename, best-effort
 * (nunca lanza). `result.json` sigue intacto en resultWriter.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  VerificationReportSchema,
  type VerificationReport,
} from "../../shared/types/implement";

export const VerifyJsonSchema = z.object({
  workItemId: z.string().min(1),
  verification: VerificationReportSchema,
  createdFiles: z.array(z.string()),
  timestamp: z.string().min(1),
});

export type VerifyJson = z.infer<typeof VerifyJsonSchema>;

export interface WriteVerifyJsonInput {
  workItemId: string;
  verification: VerificationReport;
  createdFiles: string[];
}

/**
 * Construye y valida el payload de verify.json (puro, lanza si inválido).
 */
export function buildVerifyJson(input: WriteVerifyJsonInput): VerifyJson {
  return VerifyJsonSchema.parse({
    workItemId: input.workItemId,
    verification: input.verification,
    createdFiles: (input.createdFiles ?? []).slice(0, 50),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Escribe verify.json de forma atómica (tmp→rename).
 * Best-effort: nunca lanza; retorna el payload escrito o null si falló.
 * No toca result.json ni ningún otro artefacto.
 */
export function writeVerifyJsonAtomic(dir: string, input: WriteVerifyJsonInput): VerifyJson | null {
  try {
    const payload = buildVerifyJson(input);
    const target = path.join(dir, "verify.json");
    const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
      fs.renameSync(tmp, target);
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {}
      throw e;
    }
    return payload;
  } catch (e) {
    try {
      console.warn(`[VerifyEvidence] write verify.json fail in ${dir}: ${String(e)}`);
    } catch {}
    return null;
  }
}

/**
 * Lee y valida verify.json. Retorna null si no existe o es inválido.
 */
export function readVerifyJson(dir: string): VerifyJson | null {
  const target = path.join(dir, "verify.json");
  if (!fs.existsSync(target)) return null;
  try {
    const raw = fs.readFileSync(target, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return VerifyJsonSchema.parse(parsed);
  } catch (e) {
    console.warn(`[VerifyEvidence] read failed ${target}: ${String(e)}`);
    return null;
  }
}
