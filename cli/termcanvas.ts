import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { resolveTermCanvasPortFile } from "../shared/termcanvas-instance";
import {
  contextInit,
  contextPull,
  contextPush,
  contextStatus,
  realDeps,
} from "./context-sync/operations.ts";

const CONNECTION_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRYABLE_CODES = new Set(["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"]);

interface ConnectionTarget {
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
  basePath: string;
}

function normalizeBasePath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "";
  }
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function buildRequestPath(basePath: string, urlPath: string): string {
  const [pathname, search = ""] = urlPath.split("?");
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const resolvedPath = `${basePath}${normalizedPath}`;
  return search ? `${resolvedPath}?${search}` : resolvedPath;
}

function getConnection(): ConnectionTarget {
  const envUrl = process.env.TERMCANVAS_URL?.trim();
  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`);
      }
      const port = parsed.port
        ? parseInt(parsed.port, 10)
        : parsed.protocol === "https:" ? 443 : 80;
      return {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port,
        basePath: normalizeBasePath(parsed.pathname),
      };
    } catch {
      console.error(`Invalid TERMCANVAS_URL: ${envUrl}`);
      process.exit(1);
    }
  }

  const envHost = process.env.TERMCANVAS_HOST?.trim();
  const envPort = process.env.TERMCANVAS_PORT?.trim();

  if (envHost && envPort) {
    return {
      protocol: "http:",
      hostname: envHost,
      port: parseInt(envPort, 10),
      basePath: "",
    };
  }

  const portFile = resolveTermCanvasPortFile(process.env);
  try {
    const [portStr, pidStr] = fs.readFileSync(portFile, "utf-8").trim().split("\n");
    const port = parseInt(portStr, 10);
    const pid = parseInt(pidStr, 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0); // probe: throws if process is dead
      } catch {
        try { fs.unlinkSync(portFile); } catch {}
        console.error(`TermCanvas is not running (stale port file removed from ${portFile}).`);
        process.exit(1);
      }
    }
    return {
      protocol: "http:",
      hostname: "127.0.0.1",
      port,
      basePath: "",
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    console.error(`TermCanvas is not running (no port file found at ${portFile}).`);
    process.exit(1);
  }
}

const apiToken = process.env.TERMCANVAS_API_TOKEN?.trim();

function requestOnce(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<any> {
  const { protocol, hostname, port, basePath } = getConnection();
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (data) headers["Content-Length"] = String(Buffer.byteLength(data));
    if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;

    const transport = protocol === "https:" ? https : http;
    const req = transport.request(
      {
        protocol,
        hostname,
        port,
        path: buildRequestPath(basePath, urlPath),
        method,
        headers,
        timeout: CONNECTION_TIMEOUT_MS,
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk: string) => (responseBody += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(responseBody);
            if (res.statusCode && res.statusCode >= 400) {
              reject(json);
            } else {
              resolve(json);
            }
          } catch {
            reject(new Error(responseBody));
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("ETIMEDOUT"));
    });
    req.on("error", (err) => reject(err));
    if (data) req.write(data);
    req.end();
  });
}

async function request(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await requestOnce(method, urlPath, body);
    } catch (err: unknown) {
      lastError = err;
      const code = err instanceof Error && "code" in err
        ? (err as NodeJS.ErrnoException).code
        : undefined;
      const isTimeout = err instanceof Error && err.message === "ETIMEDOUT";
      if ((code && RETRYABLE_CODES.has(code)) || isTimeout) {
        if (attempt < MAX_RETRIES) {
          const delay = 1000 * 2 ** attempt;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      throw err;
    }
  }
  const { protocol, hostname, port, basePath } = getConnection();
  console.error(
    `Failed to connect to TermCanvas at ${protocol}//${hostname}:${port}${basePath} after ${MAX_RETRIES + 1} attempts.\n` +
    `Check that the server is running and the host/port are correct.`,
  );
  throw lastError;
}

const args = process.argv.slice(2);
const jsonFlag = args.includes("--json");
const filteredArgs = args.filter((a) => a !== "--json");
const [group, command, ...rest] = filteredArgs;

async function main() {
  try {
    if (group === "project") {
      if (command === "add" && rest[0]) {
        const result = await request("POST", "/project/add", { path: rest[0] });
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else
          console.log(
            `Added "${result.name}" with ${result.worktrees} worktree(s). ID: ${result.id}`,
          );
      } else if (command === "list") {
        const projects = await request("GET", "/project/list");
        if (jsonFlag) {
          console.log(JSON.stringify(projects, null, 2));
          return;
        }
        if (projects.length === 0) {
          console.log("No projects.");
          return;
        }
        for (const p of projects) {
          console.log(
            `${p.id}  ${p.name}  ${p.path}  (${p.worktrees.length} worktrees)`,
          );
        }
      } else if (command === "remove" && rest[0]) {
        const result = await request("DELETE", `/project/${rest[0]}`);
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Removed.");
      } else if (command === "rescan" && rest[0]) {
        const result = await request("POST", `/project/${rest[0]}/rescan`);
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`Rescanned. ${result.worktrees} worktree(s) found.`);
      } else {
        console.log("Usage: termcanvas project <add|list|remove> [args]");
      }
    } else if (group === "worktree") {
      if (command === "list") {
        const repoIdx = rest.indexOf("--repo");
        const repo = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
        if (!repo) {
          console.error("--repo is required");
          process.exit(1);
        }
        const result = await request(
          "GET",
          `/worktree/list?repo=${encodeURIComponent(repo)}`,
        );
        if (jsonFlag) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (result.length === 0) {
          console.log("No worktrees.");
          return;
        }
        for (const worktree of result) {
          console.log(`${worktree.path}  ${worktree.branch}`);
        }
      } else if (command === "create") {
        const repoIdx = rest.indexOf("--repo");
        const branchIdx = rest.indexOf("--branch");
        const pathIdx = rest.indexOf("--path");
        const baseBranchIdx = rest.indexOf("--base-branch");
        const repo = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
        const branch = branchIdx >= 0 ? rest[branchIdx + 1] : undefined;
        const worktreePath = pathIdx >= 0 ? rest[pathIdx + 1] : undefined;
        const baseBranch = baseBranchIdx >= 0 ? rest[baseBranchIdx + 1] : undefined;
        if (!repo) {
          console.error("--repo is required");
          process.exit(1);
        }
        if (!branch) {
          console.error("--branch is required");
          process.exit(1);
        }
        const result = await request("POST", "/worktree/create", {
          repo,
          branch,
          ...(worktreePath ? { path: worktreePath } : {}),
          ...(baseBranch ? { baseBranch } : {}),
        });
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`Created ${result.path}.`);
      } else if (command === "remove") {
        const repoIdx = rest.indexOf("--repo");
        const pathIdx = rest.indexOf("--path");
        const repo = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
        const worktreePath = pathIdx >= 0 ? rest[pathIdx + 1] : undefined;
        const force = rest.includes("--force");
        if (!repo) {
          console.error("--repo is required");
          process.exit(1);
        }
        if (!worktreePath) {
          console.error("--path is required");
          process.exit(1);
        }
        const query = new URLSearchParams({
          repo,
          path: worktreePath,
        });
        if (force) query.set("force", "true");
        const result = await request("DELETE", `/worktree?${query.toString()}`);
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Removed.");
      } else {
        console.log("Usage: termcanvas worktree <list|create|remove> [args]");
      }
    } else if (group === "terminal") {
      if (command === "create") {
        const wtIdx = rest.indexOf("--worktree");
        const typeIdx = rest.indexOf("--type");
        const promptIdx = rest.indexOf("--prompt");
        const parentIdx = rest.indexOf("--parent-terminal");
        const workflowIdx = rest.indexOf("--workflow-id");
        const assignmentIdx = rest.indexOf("--assignment-id");
        const repoIdx = rest.indexOf("--repo");
        const resumeIdx = rest.indexOf("--resume-session-id");
        const autoApprove = rest.includes("--auto-approve");
        const worktree = wtIdx >= 0 ? rest[wtIdx + 1] : undefined;
        const type = typeIdx >= 0 ? rest[typeIdx + 1] : "shell";
        const prompt = promptIdx >= 0 ? rest[promptIdx + 1] : undefined;
        const parentTerminalId = parentIdx >= 0 ? rest[parentIdx + 1] : undefined;
        const workflowId = workflowIdx >= 0 ? rest[workflowIdx + 1] : undefined;
        const assignmentId = assignmentIdx >= 0 ? rest[assignmentIdx + 1] : undefined;
        const repoPath = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
        const resumeSessionId = resumeIdx >= 0 ? rest[resumeIdx + 1] : undefined;
        if (!worktree) {
          console.error("--worktree is required");
          process.exit(1);
        }
        const result = await request("POST", "/terminal/create", {
          worktree,
          type,
          ...(prompt ? { prompt } : {}),
          ...(autoApprove ? { autoApprove: true } : {}),
          ...(parentTerminalId ? { parentTerminalId } : {}),
          ...(workflowId ? { workflowId } : {}),
          ...(assignmentId ? { assignmentId } : {}),
          ...(repoPath ? { repoPath } : {}),
          ...(resumeSessionId ? { resumeSessionId } : {}),
        });
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else
          console.log(
            `Created ${result.type} terminal "${result.title}". ID: ${result.id}`,
          );
      } else if (command === "list") {
        const wtIdx = rest.indexOf("--worktree");
        const worktree = wtIdx >= 0 ? rest[wtIdx + 1] : undefined;
        const query = worktree
          ? `?worktree=${encodeURIComponent(worktree)}`
          : "";
        const terminals = await request("GET", `/terminal/list${query}`);
        if (jsonFlag) {
          console.log(JSON.stringify(terminals, null, 2));
          return;
        }
        if (terminals.length === 0) {
          console.log("No terminals.");
          return;
        }
        for (const t of terminals) {
          console.log(
            `${t.id}  ${t.type}  ${t.status}  ${t.title}  (${t.project}/${t.worktree})`,
          );
        }
      } else if (command === "status" && rest[0]) {
        const result = await request("GET", `/terminal/${rest[0]}/status`);
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(result.status);
      } else if (command === "output" && rest[0]) {
        const linesIdx = rest.indexOf("--lines");
        const lines = linesIdx >= 0 ? rest[linesIdx + 1] : "50";
        const result = await request(
          "GET",
          `/terminal/${rest[0]}/output?lines=${lines}`,
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(result.lines.join("\n"));
      } else if (command === "destroy" && rest[0]) {
        const result = await request("DELETE", `/terminal/${rest[0]}`);
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Destroyed.");
      } else if (command === "set-title" && rest[0] && rest[1]) {
        const title = rest.slice(1).join(" ");
        const result = await request("PUT", `/terminal/${rest[0]}/custom-title`, {
          customTitle: title,
        });
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Title updated.");
      } else if (command === "input") {
        console.error(
          "termcanvas terminal input has been removed. Start Claude/Codex tasks with `termcanvas terminal create --prompt \"...\"` instead.",
        );
        process.exit(1);
      } else {
        console.log(
          "Usage: termcanvas terminal <create|list|status|output|destroy|set-title> [args]",
        );
        process.exit(1);
      }
    } else if (group === "telemetry") {
      if (command === "get") {
        const terminalIdx = rest.indexOf("--terminal");
        const workflowIdx = rest.indexOf("--workflow");
        const repoIdx = rest.indexOf("--repo");
        const terminalId = terminalIdx >= 0 ? rest[terminalIdx + 1] : undefined;
        const workflowId = workflowIdx >= 0 ? rest[workflowIdx + 1] : undefined;
        const repoPath = repoIdx >= 0 ? rest[repoIdx + 1] : process.cwd();

        if (terminalId) {
          const result = await request("GET", `/telemetry/terminal/${encodeURIComponent(terminalId)}`);
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (workflowId) {
          const result = await request(
            "GET",
            `/telemetry/workflow/${encodeURIComponent(workflowId)}?repo=${encodeURIComponent(repoPath)}`,
          );
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.error("Provide --terminal <id> or --workflow <id>");
        process.exit(1);
      } else if (command === "events") {
        const terminalIdx = rest.indexOf("--terminal");
        const limitIdx = rest.indexOf("--limit");
        const cursorIdx = rest.indexOf("--cursor");
        const terminalId = terminalIdx >= 0 ? rest[terminalIdx + 1] : undefined;
        const limit = limitIdx >= 0 ? rest[limitIdx + 1] : "50";
        const cursor = cursorIdx >= 0 ? rest[cursorIdx + 1] : undefined;
        if (!terminalId) {
          console.error("--terminal is required");
          process.exit(1);
        }
        const query = new URLSearchParams({ limit });
        if (cursor) query.set("cursor", cursor);
        const result = await request(
          "GET",
          `/telemetry/terminal/${encodeURIComponent(terminalId)}/events?${query.toString()}`,
        );
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(
          "Usage: termcanvas telemetry <get|events> [--terminal <id> | --workflow <id> --repo <path>]",
        );
      }
    } else if (group === "workflow") {
      const factoryFetch = async (
        method: string,
        urlPath: string,
        body?: unknown,
      ): Promise<any> => {
        let lastError = "factory daemon no disponible (puertos 17680-17690)";
        for (let port = 17680; port <= 17690; port++) {
          try {
            const health = await fetch(
              `http://127.0.0.1:${port}/factory/health`,
              { signal: AbortSignal.timeout(700) },
            );
            if (!health.ok) continue;
            const response = await fetch(
              `http://127.0.0.1:${port}${urlPath}`,
              {
                method,
                headers: body
                  ? { "Content-Type": "application/json" }
                  : undefined,
                body: body ? JSON.stringify(body) : undefined,
              },
            );
            const text = await response.text();
            const payload = text ? JSON.parse(text) : {};
            if (!response.ok) {
              throw new Error(
                typeof payload?.error === "string"
                  ? payload.error
                  : `HTTP ${response.status}`,
              );
            }
            return payload;
          } catch (error) {
            if (
              error instanceof Error &&
              !/fetch failed|timeout|ECONN|aborted|The operation was aborted/i.test(
                error.message,
              )
            ) {
              lastError = error.message;
              break;
            }
            lastError = error instanceof Error ? error.message : String(error);
          }
        }
        throw new Error(lastError);
      };
      const workflowFlag = (flag: string): string | undefined => {
        const idx = rest.indexOf(flag);
        return idx >= 0 && idx + 1 < rest.length ? rest[idx + 1] : undefined;
      };
      const workflowInputs = (): Record<string, string> | undefined => {
        const inputs: Record<string, string> = {};
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === "--input" && i + 1 < rest.length) {
            const [key, ...valueParts] = rest[i + 1].split("=");
            if (key) inputs[key] = valueParts.join("=");
            i += 1;
          }
        }
        return Object.keys(inputs).length > 0 ? inputs : undefined;
      };

      if (command === "list") {
        const payload = await factoryFetch("GET", "/factory/workflows");
        if (jsonFlag) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          for (const wf of payload.workflows ?? []) {
            console.log(`${wf.name}\t[${wf.scope}]\t${wf.description ?? ""}`);
          }
        }
      } else if (command === "run" && rest[0]) {
        const useWorktree = rest.includes("--worktree");
        const payload = await factoryFetch("POST", "/factory/workflows/run", {
          name: rest[0],
          args: workflowFlag("--args"),
          inputs: workflowInputs(),
          ...(useWorktree ? { isolation: "worktree" } : {}),
          ...(workflowFlag("--base")
            ? { baseBranch: workflowFlag("--base") }
            : {}),
        });
        if (jsonFlag) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.log(
            `run ${payload.run.id} (${payload.run.status}) — workflow ${payload.run.workflow}`,
          );
        }
      } else if (command === "runs") {
        const payload = await factoryFetch("GET", "/factory/workflows/runs");
        if (jsonFlag) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          for (const run of (payload.runs ?? []).slice(0, 20)) {
            console.log(`${run.id}\t${run.status}\t${run.workflow}`);
          }
        }
      } else if (command === "status" && rest[0]) {
        const payload = await factoryFetch(
          "GET",
          `/factory/workflows/runs/${encodeURIComponent(rest[0])}`,
        );
        if (jsonFlag) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          const run = payload.run;
          console.log(
            `${run.id} ${run.workflow} → ${run.status}${run.error ? ` (${run.error})` : ""}`,
          );
          for (const [id, state] of Object.entries<any>(run.nodes)) {
            console.log(
              `  ${id}\t${state.status}\t${String(state.output ?? "").slice(0, 80)}`,
            );
          }
          if (payload.pending) {
            console.log(
              `GATE pendiente (${payload.pending.nodeId}): ${payload.pending.message}`,
            );
          }
        }
      } else if (command === "watch" && rest[0]) {
        const runId = rest[0];
        for (;;) {
          const payload = await factoryFetch(
            "GET",
            `/factory/workflows/runs/${encodeURIComponent(runId)}`,
          );
          const run = payload.run;
          if (jsonFlag) {
            console.log(
              JSON.stringify({
                status: run.status,
                nodes: run.nodes,
                pending: payload.pending ?? null,
              }),
            );
          } else {
            process.stdout.write(`... ${run.status}\n`);
          }
          if (["completed", "failed", "cancelled"].includes(run.status)) {
            process.exit(run.status === "completed" ? 0 : 1);
          }
          if (payload.pending) {
            console.log(
              `GATE pendiente (${payload.pending.nodeId}): ${payload.pending.message}`,
            );
            console.log(
              `Resolver: termcanvas workflow approve ${runId} --text "..."`,
            );
            process.exit(3);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } else if ((command === "approve" || command === "reject") && rest[0]) {
        await factoryFetch(
          "POST",
          `/factory/workflows/runs/${encodeURIComponent(rest[0])}/${command}`,
          { text: workflowFlag("--text") },
        );
        console.log(`${command} enviado a ${rest[0]}`);
      } else if (command === "cancel" && rest[0]) {
        await factoryFetch(
          "POST",
          `/factory/workflows/runs/${encodeURIComponent(rest[0])}/cancel`,
          {},
        );
        console.log(`cancel enviado a ${rest[0]}`);
      } else if (command === "resume" && rest[0]) {
        const payload = await factoryFetch(
          "POST",
          `/factory/workflows/runs/${encodeURIComponent(rest[0])}/resume`,
          {},
        );
        if (jsonFlag) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.log(
            `resume ${payload.run.id} (${payload.run.status}) — workflow ${payload.run.workflow}`,
          );
        }
      } else if (command === "signal" && rest[0] && rest[1]) {
        await factoryFetch(
          "POST",
          `/factory/workflows/runs/${encodeURIComponent(rest[0])}/signal`,
          { event: rest[1] },
        );
        console.log(`signal "${rest[1]}" enviado a ${rest[0]}`);
      } else {
        console.log(
          "Usage: termcanvas workflow <list|run|runs|status|watch|approve|reject|cancel|resume|signal> [args]",
        );
      }
    } else if (group === "diff" && command) {
      const worktreePath = command;
      const summary = rest.includes("--summary");
      const query = summary ? "?summary" : "";
      const result = await request(
        "GET",
        `/diff/${encodeURIComponent(worktreePath)}${query}`,
      );
      if (jsonFlag) {
        console.log(JSON.stringify(result, null, 2));
      } else if (summary) {
        if (result.files.length === 0) {
          console.log("No changes.");
        } else {
          for (const f of result.files) {
            const stat = f.binary
              ? "binary"
              : `+${f.additions} -${f.deletions}`;
            console.log(`${stat}\t${f.name}`);
          }
        }
      } else {
        console.log(result.diff);
      }
    } else if (group === "pin") {
      const pinOptionalFlag = (flag: string): string | undefined => {
        const idx = rest.indexOf(flag);
        return idx >= 0 && idx + 1 < rest.length ? rest[idx + 1] : undefined;
      };
      const pinRequireFlag = (flag: string): string => {
        const value = pinOptionalFlag(flag);
        if (!value) {
          console.error(`${flag} is required`);
          process.exit(1);
        }
        return value;
      };
      const resolveRepo = (): string => {
        const explicit = pinOptionalFlag("--repo");
        return path.resolve(explicit ?? process.cwd());
      };
      const pinNumberFlag = (flag: string): number | undefined => {
        const value = pinOptionalFlag(flag);
        if (value === undefined) return undefined;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          console.error(`${flag} must be a number`);
          process.exit(1);
        }
        return parsed;
      };

      if (command === "add") {
        const title = pinRequireFlag("--title");
        const pinBody = pinOptionalFlag("--body");
        const status = pinOptionalFlag("--status");
        const linkUrl = pinOptionalFlag("--link");
        const linkType = pinOptionalFlag("--link-type") ?? "url";
        const links = linkUrl ? [{ type: linkType, url: linkUrl }] : undefined;
        const result = await request("POST", "/pin/create", {
          title,
          repo: resolveRepo(),
          body: pinBody,
          status,
          links,
        });
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`${result.pin.id}  ${result.pin.title}`);
      } else if (command === "list") {
        const repo = resolveRepo();
        const statusFilter = pinOptionalFlag("--status");
        const result = await request(
          "GET",
          `/pin/list?repo=${encodeURIComponent(repo)}`,
        );
        const pins = statusFilter
          ? result.pins.filter((t: any) => t.status === statusFilter)
          : result.pins;
        if (jsonFlag) {
          console.log(JSON.stringify({ pins }, null, 2));
          return;
        }
        if (pins.length === 0) {
          console.log("No pins.");
          return;
        }
        for (const t of pins) {
          const linkSuffix = t.links?.length ? `  [${t.links.length} link]` : "";
          console.log(`${t.id}  [${t.status}]  ${t.title}${linkSuffix}`);
        }
      } else if (command === "show" && rest[0]) {
        const id = rest[0];
        const repo = resolveRepo();
        const result = await request(
          "GET",
          `/pin/${encodeURIComponent(id)}?repo=${encodeURIComponent(repo)}`,
        );
        if (jsonFlag) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const t = result.pin;
        console.log(`id:      ${t.id}`);
        console.log(`title:   ${t.title}`);
        console.log(`status:  ${t.status}`);
        console.log(`created: ${t.created}`);
        console.log(`updated: ${t.updated}`);
        if (t.links?.length) {
          console.log(`links:`);
          for (const l of t.links) {
            console.log(`  - ${l.type}: ${l.url}`);
          }
        }
        if (t.body) {
          console.log("");
          console.log(t.body);
        }
      } else if (command === "render" && rest[0]) {
        const id = rest[0];
        const repo = resolveRepo();
        const payload: Record<string, unknown> = { repo };
        const out = pinOptionalFlag("--out");
        if (out !== undefined) payload.outputPath = path.resolve(out);
        const width = pinNumberFlag("--width");
        if (width !== undefined) payload.width = width;
        const height = pinNumberFlag("--height");
        if (height !== undefined) payload.height = height;
        const waitMs = pinNumberFlag("--wait-ms");
        if (waitMs !== undefined) payload.waitMs = waitMs;
        if (rest.includes("--full-page")) payload.fullPage = true;

        const result = await request(
          "POST",
          `/pin/${encodeURIComponent(id)}/render`,
          payload,
        );
        if (jsonFlag) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(result.image_path);
      } else if (command === "update" && rest[0]) {
        const id = rest[0];
        const repo = resolveRepo();
        const payload: Record<string, unknown> = { repo };
        const newTitle = pinOptionalFlag("--title");
        if (newTitle !== undefined) payload.title = newTitle;
        const newStatus = pinOptionalFlag("--status");
        if (newStatus !== undefined) payload.status = newStatus;
        const newBody = pinOptionalFlag("--body");
        if (newBody !== undefined) payload.body = newBody;
        const result = await request(
          "PUT",
          `/pin/${encodeURIComponent(id)}`,
          payload,
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`Updated ${result.pin.id}`);
      } else if ((command === "rm" || command === "remove") && rest[0]) {
        const id = rest[0];
        const repo = resolveRepo();
        const result = await request(
          "DELETE",
          `/pin/${encodeURIComponent(id)}?repo=${encodeURIComponent(repo)}`,
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`Removed ${id}`);
      } else {
        console.log(
          "Usage: termcanvas pin <add|list|show|render|update|rm> [args]\n" +
          "  pin add --title <t> [--body <b>] [--status open|done|dropped] [--link <url>] [--link-type <type>] [--repo <path>]\n" +
          "  pin list [--status open|done|dropped] [--repo <path>]\n" +
          "  pin show <id> [--repo <path>]\n" +
          "  pin render <id> [--repo <path>] [--out <png>] [--width N] [--height N] [--wait-ms N] [--full-page]\n" +
          "  pin update <id> [--title <t>] [--status <s>] [--body <b>] [--repo <path>]\n" +
          "  pin rm <id> [--repo <path>]",
        );
      }
    } else if (group === "context") {
      // Sincronización de contexto (.agents) vía el sidecar privado
      // termcanvas-context. Standalone: corre git/gh directo, no requiere
      // TermCanvas abierto.
      const ctxOptionalFlag = (flag: string): string | undefined => {
        const idx = rest.indexOf(flag);
        return idx >= 0 && idx + 1 < rest.length ? rest[idx + 1] : undefined;
      };
      const ctxResolveRepo = (): string => {
        const explicit = ctxOptionalFlag("--repo");
        return path.resolve(explicit ?? process.cwd());
      };
      const deps = realDeps();

      if (command === "init") {
        const result = await contextInit(ctxResolveRepo(), deps);
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else {
          console.log(`Sidecar: ${result.slug} (${result.remote})`);
          console.log(`Clone local: ${result.repoDir}`);
          if (result.gitignoreUpdated) {
            console.log("Se agregó .agents/ al .gitignore del proyecto.");
          }
        }
      } else if (command === "push") {
        const result = await contextPush(ctxResolveRepo(), deps);
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else if (!result.changed) console.log("Sin cambios para sincronizar.");
        else
          console.log(
            `Pusheado: ${result.copiedCount} archivo(s) copiado(s), ${result.deletedCount} eliminado(s).`,
          );
      } else if (command === "pull") {
        const result = await contextPull(ctxResolveRepo(), deps);
        if (jsonFlag) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (!result.pulled) {
          console.log("El sidecar todavía no tiene contexto para este proyecto.");
          return;
        }
        console.log(`Traído: ${result.addedKeys.length} archivo(s) nuevo(s).`);
        for (const conflict of result.conflicts) {
          console.log(
            `CONFLICTO: ${conflict.key}\n  versión remota guardada en: ${conflict.incomingPath}\n  la local quedó intacta — resolvé a mano y pusheá.`,
          );
        }
        if (result.onlyLocalCount > 0) {
          console.log(
            `${result.onlyLocalCount} archivo(s) solo locales (no se tocan con pull).`,
          );
        }
      } else if (command === "status") {
        const result = await contextStatus(ctxResolveRepo(), deps);
        if (jsonFlag) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`slug:       ${result.slug ?? "?"}`);
        console.log(`sidecar:    ${result.initialized ? "clonado" : "sin inicializar (corré termcanvas context init)"}`);
        console.log(`unpushed:   ${result.unpushedCommits} commit(s)`);
        console.log(`behind:     ${result.behindRemote} commit(s)`);
        console.log(`uncommitted (sidecar): ${result.uncommittedFiles} archivo(s)`);
        console.log(`solo local:   ${result.onlyLocal.length}`);
        console.log(`solo remoto:  ${result.onlyRemote.length}`);
        console.log(`cambiados:    ${result.changed.length}`);
      } else {
        console.log(
          "Usage: termcanvas context <init|push|pull|status> [--repo <path>]",
        );
      }
    } else if (group === "state") {
      const state = await request("GET", "/state");
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log(
        "Usage: termcanvas <project|worktree|terminal|telemetry|pin|context|workflow|diff|state> <command> [args]",
      );
      console.log("");
      console.log("Commands:");
      console.log(
        "  project add <path>                          Add a project",
      );
      console.log(
        "  project list                                List projects",
      );
      console.log(
        "  project remove <id>                         Remove a project",
      );
      console.log(
        "  project rescan <id>                         Rescan worktrees",
      );
      console.log(
        "  worktree list --repo <p>                   List worktrees",
      );
      console.log(
        "  worktree create --repo <p> --branch <b>    Create a worktree",
      );
      console.log(
        "  worktree remove --repo <p> --path <p>      Remove a worktree",
      );
      console.log(
        "  terminal create --worktree <p> --type <t>   Create terminal",
      );
      console.log(
        "  terminal list [--worktree <p>]              List terminals",
      );
      console.log("  terminal status <id>                        Get status");
      console.log("  terminal output <id> [--lines N]            Read output");
      console.log(
        "  terminal destroy <id>                       Destroy terminal",
      );
      console.log(
        "  terminal set-title <id> <title>             Set custom title",
      );
      console.log(
        "  telemetry get --terminal <id>               Get terminal telemetry",
      );
      console.log(
        "  telemetry get --workflow <id> [--repo <p>]  Get workflow telemetry",
      );
      console.log(
        "  telemetry events --terminal <id>            List terminal telemetry events",
      );
      console.log(
        "  workflow list                               List workflows",
      );
      console.log(
        "  workflow run <name> [--args <t>] [--input k=v]   Run a workflow",
      );
      console.log(
        "  workflow status <runId>                     Run detail",
      );
      console.log(
        "  workflow watch <runId>                      Follow a run (exit 3 en gate)",
      );
      console.log(
        "  workflow approve|reject <runId> [--text <t>]     Resolve a gate",
      );
      console.log(
        "  workflow cancel <runId>                     Cancel a run",
      );
      console.log("  diff <worktree-path> [--summary]            Get git diff");
      console.log(
        "  pin add --title <t> [--body <b>] [--link <url>]   Record a pin",
      );
      console.log(
        "  pin list [--status open|done|dropped]              List pins for cwd repo",
      );
      console.log(
        "  pin show <id>                              Show pin detail",
      );
      console.log(
        "  pin render <id>                            Render pin HTML/Markdown to PNG",
      );
      console.log(
        "  pin update <id> [--title|--status|--body]  Edit a pin",
      );
      console.log(
        "  pin rm <id>                                Delete a pin",
      );
      console.log(
        "  context init [--repo <p>]                  Init context sync (private sidecar repo)",
      );
      console.log(
        "  context push [--repo <p>]                  Push local .agents to the sidecar",
      );
      console.log(
        "  context pull [--repo <p>]                  Pull sidecar context into .agents",
      );
      console.log(
        "  context status [--repo <p>]                Compare local .agents vs sidecar",
      );
      console.log(
        "  state                                       Full canvas state",
      );
      console.log("");
      console.log("Flags:");
      console.log("  --json    Output in JSON format");
      process.exit(1);
    }
  } catch (err: any) {
    console.error(err.error ?? err.message ?? err);
    process.exit(1);
  }
}

main();
