import { createHash } from "crypto";

export interface UsageRecordHashInput {
  model: string;
  project: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_5m_tokens: number;
  cache_create_1h_tokens: number;
  cost_usd: number;
  recorded_at: string;
  source_id?: string;
}

export function buildUsageRecordHash(record: UsageRecordHashInput): string {
  const hashPayload = JSON.stringify({
    sourceId: record.source_id ?? null,
    recordedAt: record.recorded_at,
    model: record.model,
    project: record.project || "",
    inputTokens: record.input_tokens,
    outputTokens: record.output_tokens,
    cacheReadTokens: record.cache_read_tokens,
    cacheCreate5mTokens: record.cache_create_5m_tokens,
    cacheCreate1hTokens: record.cache_create_1h_tokens,
    costUsd: record.cost_usd,
  });

  return createHash("sha256").update(hashPayload).digest("hex");
}
