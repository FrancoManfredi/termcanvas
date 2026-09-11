/**
 * integrations/index-live — F1 live seam barrel (single barrel choice).
 *
 * Re-export only, zero logic. This file is the ONE entry point for the
 * opt-in live seam (live schemas + vault + pure filter engine).
 * `index.ts` stays the mock-local barrel untouched; live consumers import
 * from `./index-live` until F1-T3 wiring lands. ESM only. This barrel
 * never redefines schemas or types (single vocabulary: `integrationTypes`).
 */

export {
  FilterLeafSchema,
  FilterNodeSchema,
  IntakeEventSchema,
  IntakeFieldAllowlist,
  IntegrationRefSchema,
  LiveSectionSchema,
  PostBackSchema,
  INTEGRATION_REF_MAX,
  POSTBACK_MAX_ATTEMPTS,
  WEBHOOK_DEDUPE_MAX,
} from "./integrationTypes";
export type {
  IntakeEvent,
  IntakeField,
  IntakeFilter,
  IntakeFilterLeaf,
  IntegrationRef,
  LiveSection,
  PostBack,
} from "./integrationTypes";
export {
  VAULT_REF_NAME_MAX,
  hasLiveCredentials,
  readRef,
  redact,
  vault,
} from "./vault";
export type { Vault } from "./vault";
export {
  explainIntakeFilter,
  filterEngine,
  matchesIntakeFilter,
} from "./filterEngine";
export type { FilterEngine } from "./filterEngine";
