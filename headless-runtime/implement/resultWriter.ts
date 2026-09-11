/**
 * ResultWriter — Ola 3 (motor interno desde refactor ① E1, A2).
 * FASE 4 E1 — Entierro del singleton público (las 8 + C3/C7/C10): `resultWriter`
 * extirpado por uso-cero (cero importadores en fuente; ver
 * tests/legacy-zero-use.test.ts). MÓDULO INTERNO: la tienda única
 * `headless-runtime/workItem/resultStore.ts` es el único escritor público
 * (valida con schema + atómico tmp→rename) y el ÚNICO importador de
 * `ResultWriter` (ver barrido en `tests/result-store.test.ts` + techo final
 * en `tests/import-sweep-final.test.ts`). Nadie nuevo debe importar este
 * módulo. Escribe result.json atómico tmp→rename con {workItemId, modelRef, worktreePath, status pass/fail,
 * verification:{steps,overall}, createdFiles, timestamp}
 * + .done solo si pass (write done atomico)
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ImplementResultJsonSchema,
  type ImplementResultJson,
  type VerificationReport,
} from "../../shared/types/implement";

/**
 * FASE 4 E1 (las 8 + C3/C10): la clase sigue exportada SOLO como motor interno
 * de `resultStore` (único importador; el singleton público `resultWriter` se
 * extirpó en esta fase por uso-cero).
 */
export class ResultWriter {
  /**
   * Writes result.json atomically (tmp → rename) and validates with zod.
   * Ensures logs dir exists.
   * If status === pass, caller should also create .done (we handle it).
   */
  write(
    dir: string,
    payload: ImplementResultJson,
  ): ImplementResultJson {
    const validated = ImplementResultJsonSchema.parse(payload);
    const target = path.join(dir, "result.json");
    const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(validated, null, 2), "utf-8");
      fs.renameSync(tmp, target);
      // Ensure .done state matches status
      const donePath = path.join(dir, ".done");
      if (validated.status === "pass") {
        if (!fs.existsSync(donePath)) fs.writeFileSync(donePath, "", "utf-8");
      } else {
        try {
          fs.unlinkSync(donePath);
        } catch {}
      }
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {}
      throw e;
    }
    return validated;
  }

  /**
   * Reads and validates result.json. Returns null if not exists or invalid.
   */
  read(dir: string): ImplementResultJson | null {
    const target = path.join(dir, "result.json");
    if (!fs.existsSync(target)) return null;
    try {
      const raw = fs.readFileSync(target, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      return ImplementResultJsonSchema.parse(parsed);
    } catch (e) {
      console.warn(`[ResultWriter] read failed ${target}: ${String(e)}`);
      return null;
    }
  }

  /**
   * Validates payload without writing.
   */
  validate(payload: unknown): ImplementResultJson {
    return ImplementResultJsonSchema.parse(payload);
  }

  /**
   * Atomic write helper for arbitrary path.
   */
  writeAtomic(targetPath: string, content: string): void {
    const tmp = `${targetPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(tmp, content, "utf-8");
      fs.renameSync(tmp, targetPath);
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {}
      throw e;
    }
  }

  /**
   * Build payload helper from verification + createdFiles.
   */
  buildPayload(params: {
    workItemId: string;
    modelRef?: ImplementResultJson["modelRef"];
    worktreePath: string;
    verification: VerificationReport;
    createdFiles: string[];
    runnerId?: "linux-build";
  }): ImplementResultJson {
    const status = params.verification.overall === "pass" ? "pass" : "fail";
    const timestamp = new Date().toISOString();
    const runnerId = params.runnerId ?? "linux-build";
    return {
      workItemId: params.workItemId,
      ...(params.modelRef ? { modelRef: params.modelRef } : {}),
      worktreePath: path.resolve(params.worktreePath),
      status,
      verification: params.verification,
      createdFiles: params.createdFiles.slice(0, 50),
      timestamp,
      runnerId,
    };
  }
}
