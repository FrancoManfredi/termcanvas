/**
 * ForemanLogStore — ring buffer 500 + subscribe.
 * First-class log, no console.log suelto. Exposed via GET /foreman/logs.
 */

import type { ForemanLog, ForemanDecision } from "../../shared/types/foreman";
import { buildForemanLog } from "../../shared/types/foreman";

const RING_MAX = 500;

type ForemanLogListener = (log: ForemanLog) => void;

export class ForemanLogStore {
  private ring: ForemanLog[] = [];
  private listeners = new Set<ForemanLogListener>();

  append(entry: ForemanLog): void {
    this.ring.push(entry);
    if (this.ring.length > RING_MAX) {
      this.ring.splice(0, this.ring.length - RING_MAX);
    }
    for (const cb of this.listeners) {
      try {
        cb(entry);
      } catch {}
    }
  }

  /**
   * Creates and appends a log entry for a decision (Ola 1 stub).
   */
  logDecision(params: {
    workItemId: string;
    prompt: string;
    worktree: string;
    modelRef?: { providerID: string; modelID: string; variant?: string };
    decision?: ForemanDecision;
  }): ForemanLog {
    const entry = buildForemanLog(params);
    this.append(entry);
    return entry;
  }

  /**
   * Simple info log not tied to decision.
   */
  info(message: string, workItemId: string = "system"): ForemanLog {
    const entry: ForemanLog = {
      id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      level: "info",
      message,
      workItemId,
      decision: {
        decision: "building",
        reason: "stub Ola 1 - always building",
        runnerId: "linux-build",
        confidence: 1.0,
      },
    };
    this.append(entry);
    return entry;
  }

  list(limit?: number): ForemanLog[] {
    if (limit !== undefined && limit > 0) {
      return this.ring.slice(-limit);
    }
    return [...this.ring];
  }

  clear(): void {
    this.ring = [];
  }

  subscribe(cb: ForemanLogListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  size(): number {
    return this.ring.length;
  }
}

// Singleton
export const foremanLogStore = new ForemanLogStore();
