/**
 * Bot review ingestion — pure parse, bounded wait and mechanical
 * reconciliation of external-reviewer (pullfrog/CodeRabbit) findings.
 * Offline: injected `run`/`sleep`, zero network, zero daemon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BOT_REVIEW_MAX_POLLS,
  changedFilesSince,
  defaultBotLogins,
  extractFindingBullets,
  extractFindingHeadings,
  fetchBotFindings,
  hasFindingStructure,
  isBotLogin,
  parseBotComments,
  reconcileBotFindings,
  repoFromPrUrl,
  waitForBotReview,
} from "../headless-runtime/review/botReview.ts";

test("logins: env override, defaults and matching", () => {
  assert.deepEqual(defaultBotLogins({}), ["pullfrog", "coderabbit"]);
  assert.deepEqual(defaultBotLogins({ TERMCANVAS_REVIEW_BOTS: "PullFrog, my-bot " }), [
    "pullfrog",
    "my-bot",
  ]);
  assert.equal(isBotLogin("pullfrog[bot]", ["pullfrog"]), true);
  assert.equal(isBotLogin("PullFrog", ["pullfrog"]), true);
  assert.equal(isBotLogin("coderabbitai[bot]", ["coderabbit"]), true);
  assert.equal(isBotLogin("rasmus", ["pullfrog"]), false);
  assert.equal(isBotLogin("", ["pullfrog"]), false);
});

test("bullets: list items become findings, fences stripped, dedupe, fallback", () => {
  const body = [
    "Some intro",
    "- `a.ts:10` — guard faltante en el parseo",
    "* Second finding with enough text",
    "- `a.ts:10` — guard faltante en el parseo",
    "```json",
    "- ruido dentro de fence",
    "```",
  ].join("\n");
  const got = extractFindingBullets(body);
  assert.deepEqual(got, [
    "`a.ts:10` — guard faltante en el parseo",
    "Second finding with enough text",
  ]);
  assert.deepEqual(extractFindingBullets("- short"), [], "bullets cortos se descartan");
  assert.deepEqual(extractFindingBullets("una prosa sin bullets pero suficientemente larga"), [
    "una prosa sin bullets pero suficientemente larga",
  ]);
  assert.deepEqual(extractFindingBullets(""), []);
  assert.deepEqual(extractFindingBullets(null), []);
});

test("parse: bot comments only, inline first, summary headings after, capped", () => {
  const prJson = {
    url: "https://github.com/o/r/pull/7",
    comments: [
      { author: { login: "human" }, body: "- humana, no entra", createdAt: "2026-01-01", url: "u0" },
      {
        author: { login: "pullfrog[bot]" },
        body: "### ℹ️ primer finding del summary\n### ⚠️ segundo finding del summary",
        createdAt: "2026-01-02",
        url: "u1",
      },
    ],
    reviews: [
      { author: { login: "coderabbitai[bot]" }, body: "### ⚠️ review body finding", createdAt: "2026-01-03", url: "u2" },
    ],
  };
  const inlineJson = [
    {
      user: { login: "pullfrog[bot]" },
      body: "- inline finding en el archivo",
      path: "src/a.ts",
      line: 12,
      html_url: "u3",
      created_at: "2026-01-04",
    },
    { user: { login: "human" }, body: "- humana inline", path: "x", line: 1, html_url: "u4" },
  ];
  const got = parseBotComments({ prJson, inlineJson });
  assert.equal(got.length, 4);
  assert.equal(got[0]?.file, "src/a.ts:12", "inline primero con path:line");
  assert.equal(got[0]?.source, "pullfrog[bot]");
  assert.equal(got[0]?.message, "- inline finding en el archivo".replace(/^-\s*/, ""));
  assert.ok(got.some((f) => f.message === "ℹ️ primer finding del summary"));
  assert.ok(got.some((f) => f.message === "⚠️ segundo finding del summary"));
  assert.ok(got.some((f) => f.message === "⚠️ review body finding"));
  assert.ok(!got.some((f) => f.message.includes("humana")));
  assert.deepEqual(parseBotComments({ prJson: null, inlineJson: null }), []);
  const capped = parseBotComments({ prJson, inlineJson }, { max: 2 });
  assert.equal(capped.length, 2);
});

test("parse: pullfrog lifecycle greeting produces no findings", () => {
  const greeting = [
    "New pull request. Leaping into action...",
    "",
    "---",
    "",
    "<a href=\"https://pullfrog.com\"><img src=\"https://pullfrog.com/badge.svg\" alt=\"Powered by pullfrog\" /></a>",
  ].join("\n");
  const prJson = {
    url: "https://github.com/o/r/pull/160",
    comments: [{ author: { login: "pullfrog[bot]" }, body: greeting, createdAt: "2026-01-01", url: "u1" }],
    reviews: [{ author: { login: "pullfrog[bot]" }, body: greeting, createdAt: "2026-01-01", url: "u2" }],
  };
  assert.deepEqual(parseBotComments({ prJson, inlineJson: [] }), []);
  assert.equal(hasFindingStructure(greeting), false);

  const quoted = "> New pull request. Leaping into action...\n\n### ℹ️ heading that would otherwise parse";
  const inlineJson = [{ user: { login: "pullfrog[bot]" }, body: quoted, path: "a.ts", line: 1 }];
  assert.deepEqual(
    parseBotComments({ prJson: { comments: [{ author: { login: "pullfrog[bot]" }, body: quoted, url: "u" }] }, inlineJson }),
    [],
    "chatter se ignora aunque traiga estructura",
  );
});

test("parse: pullfrog-style review body yields heading candidates, not prose bullets", () => {
  const body = [
    "### ℹ️ Banner copy is read-oriented, but the widget is interactive",
    "",
    "Nice work overall — one note on the banner widget.",
    "",
    "<details>",
    "<summary>Review notes</summary>",
    "",
    "- Reviewed PR #160 for correctness and structure",
    "- Followed the refactor through the CLI",
    "",
    "```ts",
    "### ⚠️ heading inside a fence does not count",
    "```",
    "",
    "</details>",
  ].join("\n");
  const prJson = {
    url: "https://github.com/o/r/pull/160",
    comments: [{ author: { login: "pullfrog[bot]" }, body, createdAt: "2026-01-01", url: "u1" }],
  };
  const got = parseBotComments({ prJson, inlineJson: [] });
  assert.equal(got.length, 1);
  assert.equal(got[0]?.message, "ℹ️ Banner copy is read-oriented, but the widget is interactive");
  assert.ok(!got.some((f) => f.message.includes("Reviewed PR #160")));
  assert.equal(hasFindingStructure(body), true);
});

test("parse: CodeRabbit summary — nitpick heading only, walkthrough ignored", () => {
  const body = [
    "## Walkthrough",
    "",
    "This PR updates the banner widget and its tests.",
    "",
    "### 🧹 Nitpick comments (1)",
    "",
    "<details>",
    "<summary>src/a.ts (1)</summary>",
    "",
    "- Consider renaming the variable for readability.",
    "",
    "</details>",
  ].join("\n");
  const prJson = {
    url: "https://github.com/o/r/pull/160",
    reviews: [{ author: { login: "coderabbitai[bot]" }, body, createdAt: "2026-01-01", url: "u1" }],
  };
  const got = parseBotComments({ prJson, inlineJson: [] });
  assert.equal(got.length, 1);
  assert.equal(got[0]?.message, "🧹 Nitpick comments");
  assert.ok(!got.some((f) => f.message.includes("Walkthrough")));
});

test("parse: inline comment still parses with its file anchor", () => {
  const inlineJson = [
    {
      user: { login: "coderabbitai[bot]" },
      body: "- `src/a.ts:12` — rename `foo` to `bar`",
      path: "src/a.ts",
      line: 12,
      html_url: "u1",
      created_at: "2026-01-01",
    },
  ];
  const got = parseBotComments({ prJson: null, inlineJson });
  assert.equal(got.length, 1);
  assert.equal(got[0]?.file, "src/a.ts:12");
  assert.equal(got[0]?.message, "`src/a.ts:12` — rename `foo` to `bar`");
});

test("structure helpers: never throw on garbage, detect structure forms", () => {
  for (const v of [null, undefined, 42, {}, []]) {
    assert.equal(hasFindingStructure(v as unknown), false);
    assert.deepEqual(extractFindingHeadings(v as unknown), []);
  }
  assert.equal(hasFindingStructure("### ℹ️ real heading"), true);
  assert.equal(hasFindingStructure("- [x] checklist item"), true);
  assert.equal(hasFindingStructure("**Major** severity marker"), true);
  assert.equal(hasFindingStructure("plain prose without structure"), false);
  assert.deepEqual(extractFindingHeadings("### ℹ️ One ###"), ["ℹ️ One"]);
  assert.deepEqual(extractFindingHeadings("### ⚠️ Dup\n### ⚠️ Dup"), ["⚠️ Dup"]);
  assert.deepEqual(extractFindingHeadings("#### 🔴 Deeper\n##### ℹ️ Too deep"), ["🔴 Deeper"]);
});

function fakeRun(script: Record<string, { stdout: string; stderr?: string }>) {
  const calls: string[] = [];
  const run = async (cmd: string, args: readonly string[]) => {
    const key = `${cmd} ${args.join(" ")}`;
    calls.push(key);
    for (const [prefix, out] of Object.entries(script)) {
      if (key.startsWith(prefix)) return { stdout: out.stdout, stderr: out.stderr ?? "" };
    }
    throw new Error(`unexpected: ${key}`);
  };
  return { run, calls };
}

test("fetch: reads pr view + inline api; api failure keeps summary findings", async () => {
  const script = {
    "gh pr view 7": {
      stdout: JSON.stringify({
        url: "https://github.com/o/r/pull/7",
        comments: [
          { author: { login: "pullfrog[bot]" }, body: "### ℹ️ summary finding", url: "u1" },
        ],
      }),
    },
    "gh api repos/o/r/pulls/7/comments": {
      stdout: JSON.stringify([
        { user: { login: "pullfrog[bot]" }, body: "- inline finding", path: "a.ts", line: 3, html_url: "u2" },
      ]),
    },
  };
  const fake = fakeRun(script);
  const got = await fetchBotFindings({ repoPath: "/r", prNumber: 7, run: fake.run });
  assert.equal(got.ok, true);
  if (got.ok) {
    assert.equal(got.findings.length, 2);
    assert.equal(got.findings[0]?.file, "a.ts:3");
  }
  assert.ok(fake.calls.some((c) => c.includes("repos/o/r/pulls/7/comments")));

  const noApi = fakeRun({
    "gh pr view 7": script["gh pr view 7"],
    "gh api": { stdout: "not-json" },
  });
  const degraded = await fetchBotFindings({ repoPath: "/r", prNumber: 7, run: noApi.run });
  assert.equal(degraded.ok, true);
  if (degraded.ok) assert.equal(degraded.findings.length, 1, "summary sobrevive");
});

test("wait: bounded polls, first non-empty batch wins, timeout honesto", async () => {
  let reads = 0;
  const run = async (cmd: string, args: readonly string[]) => {
    reads += 1;
    const has = reads >= 2;
    return {
      stdout: JSON.stringify({
        url: "https://github.com/o/r/pull/7",
        comments: has
          ? [{ author: { login: "pullfrog[bot]" }, body: "### ⚠️ llego el bot", url: "u" }]
          : [],
      }),
      stderr: "",
    };
  };
  const sleeps: number[] = [];
  const found = await waitForBotReview({
    repoPath: "/r",
    prNumber: 7,
    run,
    timeoutMs: 5_000,
    pollMs: 1_000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(found.status, "found");
  assert.equal(found.findings.length, 1);
  assert.equal(sleeps.length, 1, "una espera entre dos polls");

  let emptyReads = 0;
  const empty = await waitForBotReview({
    repoPath: "/r",
    prNumber: 7,
    run: async (cmd, args) => {
      if (cmd === "gh" && args[1] === "view") emptyReads += 1;
      return { stdout: JSON.stringify({ url: "https://github.com/o/r/pull/7", comments: [] }), stderr: "" };
    },
    timeoutMs: 3_000,
    pollMs: 1_000,
    sleep: async () => {},
  });
  assert.equal(empty.status, "timeout");
  assert.ok(emptyReads <= BOT_REVIEW_MAX_POLLS, `polls acotados (${emptyReads})`);
  assert.equal(emptyReads, 3, "ceil(3000/1000) polls");
});

test("wait: un review limpio (0 findings) se confirma con un poll extra y publica sin findings", async () => {
  let views = 0;
  const run = async (cmd: string, args: readonly string[]) => {
    if (cmd === "gh" && args[1] === "view") views += 1;
    return {
      stdout: JSON.stringify({
        url: "https://github.com/o/r/pull/9",
        comments: [
          {
            author: { login: "pullfrog[bot]" },
            body: "No new issues found in this diff.",
            url: "u",
          },
        ],
      }),
      stderr: "",
    };
  };
  const sleeps: number[] = [];
  const got = await waitForBotReview({
    repoPath: "/r",
    prNumber: 9,
    run,
    timeoutMs: 10_000,
    pollMs: 1_000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(got.status, "found", "review limpio → found (no deadline)");
  assert.equal(got.findings.length, 0, "sin findings");
  assert.equal(views, 2, "confirmación con un poll extra");
  assert.equal(sleeps.length, 1, "una espera entre los dos polls");
});

test("wait: lifecycle chatter keeps polling; the first real heading is found", async () => {
  const greeting =
    'New pull request. Leaping into action...\n\n---\n\n<a href="https://pullfrog.com">🪄</a>';
  const review = "### ℹ️ Banner copy is read-oriented, but the widget is interactive";
  let views = 0;
  const run = async (cmd: string, args: readonly string[]) => {
    if (cmd === "gh" && args[1] === "view") {
      views += 1;
      const body = views === 1 ? greeting : review;
      return {
        stdout: JSON.stringify({
          url: "https://github.com/o/r/pull/160",
          comments: [{ author: { login: "pullfrog[bot]" }, body, url: "u" }],
        }),
        stderr: "",
      };
    }
    return { stdout: "[]", stderr: "" };
  };
  const sleeps: number[] = [];
  const got = await waitForBotReview({
    repoPath: "/r",
    prNumber: 160,
    run,
    timeoutMs: 10_000,
    pollMs: 1_000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(got.status, "found");
  assert.equal(got.findings.length, 1);
  assert.equal(
    got.findings[0]?.message,
    "ℹ️ Banner copy is read-oriented, but the widget is interactive",
  );
  assert.equal(views, 2, "primer poll: solo saludo; segundo poll: review real");
  assert.equal(sleeps.length, 1, "espera entre polls");
});

test("P7: un details block del bot no ensucia el mensaje extraído", () => {
  const body = [
    "As written this script fails on a clean checkout.",
    "",
    "<details><summary>Technical details</summary>",
    "lots of noise inside the annex",
    "</details>",
  ].join("\n");
  const got = parseBotComments({
    inlineJson: [{ user: { login: "pullfrog[bot]" }, body, path: "package.json", line: 7 }],
  });
  assert.equal(got.length, 1);
  const msg = String(got[0]?.message);
  assert.ok(!msg.includes("<details>"), "sin details");
  assert.ok(!msg.includes("Technical details"), "sin anexo");
  assert.ok(msg.includes("As written this script fails"), "el mensaje real sobrevive");
});

test("P7: un details dentro de un fence no se come headings reales", () => {
  const body = [
    "Heads up...",
    "",
    "```html",
    "<details>",
    "```",
    "",
    "### ⚠️ Real finding outside any annex",
    "",
    "<details><summary>Noise</summary>",
    "noise",
    "</details>",
  ].join("\n");
  assert.equal(hasFindingStructure(body), true, "estructura detectada");
  assert.ok(
    extractFindingHeadings(body).some((h) => h.includes("Real finding")),
    "heading real detectado pese al fence abierto",
  );
});

test("P7: details anidados no dejan residuo en el mensaje", () => {
  const body = [
    "Real message line.",
    "",
    "<details><summary>Outer</summary>",
    "<details><summary>Inner</summary>",
    "deep noise",
    "</details>",
    "tail noise",
    "</details>",
  ].join("\n");
  const got = parseBotComments({
    inlineJson: [{ user: { login: "pullfrog[bot]" }, body, path: "a.ts", line: 1 }],
  });
  assert.equal(got.length, 1);
  const msg = String(got[0]?.message);
  assert.ok(!msg.includes("</details>"), "sin residuo de cierre");
  assert.ok(!msg.includes("deep noise"), "sin anexo interno");
  assert.ok(!msg.includes("tail noise"), "sin cola del anexo");
  assert.ok(msg.includes("Real message line"), "el mensaje real sobrevive");
});

test("reconcile: taken (fix posterior), overlap (mismo file interno), open", () => {
  const findings = [
    { id: "bot-1", source: "b", file: "a.ts:10", message: "m1", url: "", createdAt: "" },
    { id: "bot-2", source: "b", file: "b.ts", message: "m2", url: "", createdAt: "" },
    { id: "bot-3", source: "b", file: "c.ts", message: "m3", url: "", createdAt: "" },
  ];
  const got = reconcileBotFindings(findings, {
    internalFindings: [{ id: "f1", file: "b.ts", state: "FIXED" }],
    changedFiles: ["a.ts", "z.ts"],
  });
  assert.equal(got[0]?.status, "taken");
  assert.ok(got[0]?.statusReason.includes("a.ts"));
  assert.equal(got[1]?.status, "overlap");
  assert.ok(got[1]?.statusReason.includes("f1"));
  assert.equal(got[2]?.status, "open");
  assert.deepEqual(reconcileBotFindings([], {}), []);
});

test("reconcile P4: disposiciones terminales marcan dispositioned (mensaje o índice)", () => {
  const mk = (id: string, file: string, message: string) => ({
    id,
    source: "b",
    file,
    message,
    url: "",
    createdAt: "",
  });
  const findings = [mk("bot-1", "a.ts:10", "uno"), mk("bot-2", "b.ts", "dos"), mk("bot-3", "c.ts", "tres")];
  const got = reconcileBotFindings(findings, {
    changedFiles: ["a.ts"],
    dispositions: [
      { index: 1, message: "uno", disposition: "FIXED", reason: "x" },
      { index: 2, message: "dos", disposition: "TRACKED_FOLLOW_UP", reason: "issue #99" },
      // Sin mensaje: el fallback por índice 1-based del feedback (f3) aplica.
      { index: 3, disposition: "DECLINED", reason: "no aplica" },
    ],
  });
  assert.equal(got[0]?.status, "taken", "el archivo tocado gana sobre la disposición");
  assert.equal(got[1]?.status, "dispositioned");
  assert.match(String(got[1]?.statusReason), /TRACKED_FOLLOW_UP — issue #99/);
  assert.equal(got[2]?.status, "dispositioned", "fallback por índice");
  assert.match(String(got[2]?.statusReason), /DECLINED/);
  // Un mensaje que no matchea y sin índice válido no dispone: sigue open.
  const miss = reconcileBotFindings([mk("bot-9", "d.ts", "otro")], {
    dispositions: [{ message: "distinto", disposition: "FIXED" }],
  });
  assert.equal(miss[0]?.status, "open");
});

test("P3: un mensaje largo del bot corta en boundary con elipsis (nunca mid-word)", () => {
  const long = Array.from({ length: 80 }, (_, i) => `palabra${i}`).join(" ");
  const got = parseBotComments({
    inlineJson: [
      { user: { login: "pullfrog[bot]" }, body: `- ${long}`, path: "a.ts", line: 1 },
    ],
  });
  assert.equal(got.length, 1);
  const msg = String(got[0]?.message);
  assert.ok(msg.endsWith("…"), "marca el corte con elipsis");
  assert.ok(msg.length <= 241, "cap respetado");
  assert.ok(/palabra\d+…$/.test(msg), "termina en palabra completa (no mid-word)");
});

test("changedFilesSince: parsea git log --name-only y acota", async () => {
  const fake = fakeRun({
    "git log": { stdout: "a.ts\n\nb/c.ts\na.ts\n" },
  });
  const got = await changedFilesSince({ repoPath: "/r", sinceIso: "2026-01-01T00:00:00Z", run: fake.run });
  assert.deepEqual(got, ["a.ts", "b/c.ts"]);
  assert.deepEqual(await changedFilesSince({ repoPath: "/r", sinceIso: "", run: fake.run }), []);
});

test("repoFromPrUrl: owner/repo o null", () => {
  assert.equal(repoFromPrUrl("https://github.com/o/r/pull/7"), "o/r");
  assert.equal(repoFromPrUrl("https://github.com/o/r/pull/7#issuecomment-1"), "o/r");
  assert.equal(repoFromPrUrl("no-url"), null);
  assert.equal(repoFromPrUrl(null), null);
});
