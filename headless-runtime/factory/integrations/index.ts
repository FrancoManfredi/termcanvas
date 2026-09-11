/**
 * integrations/index — Wave 14 T03 (Track B): domain barrel.
 *
 * Single entry point of the integrations domain (mock adapter + service +
 * R3-R4 routes). Re-export only, zero logic. ESM only, zero `require()`.
 * Parsers/schemas keep living in `./integrationTypes.ts` (C6/C7); this
 * barrel never redefines them.
 */

export {
  INTEGRATIONS_MOCK_FILE_NAME,
  ackMockPost,
  getIntegrationsMockFilePath,
  listMockPosts,
  mockAdapter,
  postMockPost,
  resetMockAdapterForTests,
} from "./mockAdapter";
export type { MockPostInput } from "./mockAdapter";
export {
  getIntegrationsConfig,
  ackNotification as ackIntegrationNotification,
  getStatus as getIntegrationsStatusData,
  postNotification as postIntegrationNotification,
  sliceTopSection,
} from "./integrationService";
export type {
  IntegrationsConfigResult,
  IntegrationsEffectiveConfig,
  IntegrationsStatusData,
  PostNotificationResult,
} from "./integrationService";
export {
  INTEGRATION_STATUS_POSTS_LIMIT,
  INTEGRATION_TEST_POST_MAX_BODY_BYTES,
  buildIntegrationsStatusResponse,
  handleIntegrationsStatusRoute,
  handleIntegrationsTestPostRoute,
  isIntegrationsStatusRoute,
  isIntegrationsTestPostRoute,
} from "./integrationRoutes";
export type { IntegrationsStatusResponse } from "./integrationRoutes";
export {
  INTEGRATION_BODY_MAX,
  INTEGRATION_MOCK_MAX,
  INTEGRATION_TITLE_MAX,
  IntegrationsSectionSchema,
  MockPostInputSchema,
} from "./integrationTypes";
export type {
  IntegrationAdapter,
  IntegrationsMockFileShape,
  MockPostRecord,
} from "./integrationTypes";
