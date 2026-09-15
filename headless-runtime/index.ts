
import fs from "node:fs";
import path from "node:path";
import { PtyManager } from "../electron/pty-manager.ts";
import { TelemetryService } from "../electron/telemetry-service.ts";
import { ProjectScanner } from "../electron/project-scanner.ts";
import { ProjectStore } from "./project-store.ts";
import { HeadlessApiServer } from "./api-server.ts";
import { Heartbeat } from "./heartbeat.ts";
import { ServerEventBus } from "./event-bus.ts";
import { WebhookService } from "./webhook.ts";
import {
  createGracefulShutdown,
  createPersistenceController,
} from "./lifecycle.ts";
import { sanitizeProjectsForPersistence } from "./persisted-projects.ts";
import {
  resolveTermCanvasPortFile,
  resolveTermCanvasInstance,
  getTermCanvasDataDir,
} from "../shared/termcanvas-instance.ts";

interface HeadlessConfig {
  taskId: string | undefined;
  resultCallbackUrl: string | undefined;
  gitRepoUrl: string | undefined;
  workspaceDir: string;
  s3Endpoint: string | undefined;
  s3Bucket: string | undefined;
  host: string;
  port: number;
  rateLimit: number;
  corsOrigins: string[];
}

function loadConfig(): HeadlessConfig {
  const rawRateLimit = process.env.TERMCANVAS_RATE_LIMIT?.trim();
  const rawCorsOrigins = process.env.TERMCANVAS_CORS_ORIGINS?.trim();

  return {
    taskId: process.env.TASK_ID,
    resultCallbackUrl: process.env.RESULT_CALLBACK_URL,
    gitRepoUrl: process.env.GIT_REPO_URL,
    workspaceDir: process.env.WORKSPACE_DIR ?? process.cwd(),
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Bucket: process.env.S3_BUCKET,
    host: process.env.TERMCANVAS_HOST ?? "0.0.0.0",
    port: parseInt(process.env.TERMCANVAS_PORT ?? "7080", 10),
    rateLimit: rawRateLimit ? parseInt(rawRateLimit, 10) : 0,
    corsOrigins: rawCorsOrigins
      ? rawCorsOrigins.split(",").map((o) => o.trim()).filter(Boolean)
      : [],
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const startedAt = Date.now();


  const ptyManager = new PtyManager();
  const telemetryService = new TelemetryService();
  const projectScanner = new ProjectScanner();
  const projectStore = new ProjectStore();

  let serverVersion = "0.0.0";
  try {
    const pkgPath = path.resolve(
      import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
      "..",
      "package.json",
    );
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    serverVersion = pkg.version ?? serverVersion;
  } catch {
    // Non-critical — version will show 0.0.0
  }

  const eventBus = new ServerEventBus();

  let webhookService: WebhookService | null = null;
  const webhookUrl = process.env.TERMCANVAS_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    webhookService = new WebhookService({
      url: webhookUrl,
      secret: process.env.TERMCANVAS_WEBHOOK_SECRET?.trim() || undefined,
      eventBus,
    });
  }

  // State persistence
  const dataDir = getTermCanvasDataDir(resolveTermCanvasInstance());
  const statePath = path.join(dataDir, "state.json");

  // Load persisted state on startup
  try {
    if (fs.existsSync(statePath)) {
      const raw = fs.readFileSync(statePath, "utf-8");
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) {
        for (const project of sanitizeProjectsForPersistence(saved)) {
          projectStore.addProject(project);
        }
      }
    }
  } catch (err) {
    console.error("[headless] failed to load state:", err);
  }

  const persistence = createPersistenceController(
    statePath,
    () => sanitizeProjectsForPersistence(projectStore.getProjects()),
  );

  const apiServer = new HeadlessApiServer({
    projectStore,
    ptyManager,
    projectScanner,
    telemetryService,
    eventBus,
    workspaceDir: config.workspaceDir,
    onMutation: () => persistence.schedule(),
    rateLimit: config.rateLimit,
    corsOrigins: config.corsOrigins,
    serverVersion,
  });

  const port = await apiServer.start(config.port, config.host);

  eventBus.emit("server_started", {
    host: config.host,
    port,
    version: serverVersion,
  });

  const portFile = resolveTermCanvasPortFile();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(portFile, String(port), "utf-8");

  let heartbeat: Heartbeat | null = null;
  if (config.resultCallbackUrl) {
    heartbeat = new Heartbeat({
      callbackUrl: config.resultCallbackUrl,
      getPayload: () => {
        const mem = process.memoryUsage();
        const terminals = projectStore.listTerminals();
        return {
          workflow_status: "idle",
          current_assignment: null,
          telemetry_snapshot: {
            active_terminals: terminals.length,
            active_workflows: 0,
          },
          resource_usage: {
            memory_mb: Math.round(mem.rss / (1024 * 1024)),
            uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
          },
        };
      },
    });
    heartbeat.start();
  }

  // Graceful shutdown
  const shutdown = createGracefulShutdown({
    host: config.host,
    port,
    version: serverVersion,
    eventBus,
    persistence,
    apiServer,
    ptyManager,
    telemetryService,
    heartbeat,
    webhookService,
    portFile,
    exit: (code) => process.exit(code),
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((err) => {
  console.error("[headless] fatal error:", err);
  process.exit(1);
});
