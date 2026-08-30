// Domain types — Single Responsibility: only shape, no validation
// Follows WarpFactories.md §7 definitions as code

export type SchemaVersion = "v1alpha1";

export interface RepositoryRef {
  owner: string;
  name: string;
}

export type CredentialStrategy = "EXECUTOR" | "CREATOR";

export type HarnessType = "oz" | "claude" | "codex" | "gemini";

export interface HarnessConfig {
  type: HarnessType;
  model?: string;
  reasoningLevel?: string;
  auth?: {
    source: "managedSecret" | "workerEnvironment";
    secretName?: string;
  };
}

export interface McpServerRef {
  warpId: string;
}

export type IntegrationType = "slack" | "linear" | "jira";

export interface FactoryIntegration {
  type: IntegrationType;
}

export interface CloudProviders {
  gcp?: {
    projectNumber: string;
    workloadIdentityFederationPoolId: string;
    workloadIdentityFederationProviderId: string;
    serviceAccountEmail?: string;
  };
  aws?: {
    roleArn: string;
  };
}

export interface AgentDefaults {
  model?: string;
  harness?: HarnessConfig;
  runner?: string;
  environmentId?: string;
  secrets?: string[];
  mcpServers?: Record<string, McpServerRef>;
  workerHost?: string;
}

export interface FactoryDefinition {
  schemaVersion: SchemaVersion;
  name: string;
  description?: string;
  alias?: string;
  credentialStrategy?: CredentialStrategy;
  repositories: RepositoryRef[];
  secrets?: string[];
  mcpServers?: Record<string, McpServerRef>;
  cloudProviders?: CloudProviders;
  integrations?: FactoryIntegration[];
  agentDefaults: AgentDefaults;
}

export type AgentType = "CUSTOM" | "FOREMAN" | "MAIN" | "TRIAGE" | "SPEC" | "IMPLEMENT" | "REVIEW" | "VERIFY";

export interface AgentDefinition {
  name: string; // from path agents/<name>/agent.md
  description?: string;
  agentType: AgentType;
  credentialStrategy?: CredentialStrategy;
  model?: string;
  harness?: HarnessConfig;
  runner?: string;
  environmentId?: string;
  secrets?: string[];
  mcpServers?: Record<string, McpServerRef>;
  workerHost?: string;
  instructions: string; // markdown body
  rawPath: string;
}

export interface RunnerDefinition {
  name: string; // from filename
  description?: string;
  setupCommands?: string[];
  instanceShape?: {
    vcpus: number;
    memoryGb: number;
  };
  platform?: {
    os: "linux" | "macos";
    arch: "x86_64" | "aarch64";
    linux?: { dockerImage: string };
    mac?: { version: "14" | "15" | "26" | "27" };
  };
  rawPath: string;
}

export interface AutomationTriggerFilter {
  repos?: string[] | { in?: string[]; not_in?: string[] };
  labels?: string[] | { in?: string[]; not_in?: string[] };
  branches?: string[] | { in?: string[]; not_in?: string[] };
  base_branches?: string[] | { in?: string[]; not_in?: string[] };
  // extensible: paths, authors, etc. — keep open
  [key: string]: unknown;
}

export interface AutomationTrigger {
  provider: "github" | "gitlab" | "linear" | "jira" | "slack" | "schedule" | "factory";
  event: string;
  filter?: AutomationTriggerFilter;
  schedule?: string;
  name?: string;
}

export interface AutomationDefinition {
  name: string;
  enabled: boolean;
  agent: string;
  triggers: AutomationTrigger[];
  model?: string;
  harness?: HarnessConfig;
  runner?: string;
  environmentId?: string;
  secrets?: string[];
  mcpServers?: Record<string, McpServerRef>;
  workerHost?: string;
  prompt: string; // markdown body
  rawPath: string;
}

export interface ScorerLabel {
  value: string;
  score: number; // 0..1
  description?: string;
}

export interface ScorerDefinition {
  slug: string; // dir name
  name: string; // identity field
  description?: string;
  agents: string[];
  output?: "classification";
  labels: ScorerLabel[];
  passingScore: number;
  samplingRate?: number; // 0..100
  model: string;
  selfImprovement?: boolean;
  rubric: string; // markdown body
  rawPath: string;
}
