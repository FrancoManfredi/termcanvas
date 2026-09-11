# F5 Report — Verify teeth + stability (E2E-05 late-write premiere + E2E-12 + T2/T3)

- Date (UTC): 2026-09-05 · Engineers: F5-T1 live (QA Edward, software-qa-engineer) · QA: Edward (self-verdict per 2-round rule) · buildId: `15fece3e` · HEAD: `15fece3e`
- Scope: F5-T1 teeth live premiere (E2E-05 strict + E2E-12 observational, quota 3-8, one case at a time) + T2/T3 observed results (read-only, not owned by T1). Zero code changed by T1.
- Preconditions:
  - F4 verdict recorded (`REPORT-F4-dinero-traza.md`: trace-half PASS, cumulative 42/50, headroom 8) — PASS.
  - Daemon user-started, `buildId == HEAD` (`15fece3e`), port 17680, `opencode healthy` — PASS (read-only GETs 15s; NEVER restart/taskkill/`pnpm dev`/`pnpm build`).
  - `factory validate` exit 0 before premiere (`definition valida: 0 errores, 0 warnings, buildId=15fece3e`) — PASS.
  - Offline teeth suites green before live (`e2e-f5-teeth.asserts` 9/9, `verify-retry-reconcile` 7/7, `empty-folder-fallback` 8/8, `implement-fallback-literal` 8/8) — PASS.
  - Allowlist: all 3 scorers run `opencode-go/muse-spark-1.2-contributor`; review agents allowlisted; JAMAS gemini (no second model introduced) — PASS.
  - Clean test worktree `C:\tmp\demo-e2e-f5-teeth-20260905-140500` (new dir, `git init` + minimal `package.json` test/build exit-0, F2/F3 learning) — PASS.
  - God 3583 (F1 value; F5 allows +0; T1 premiere-only) — PASS (3583→3583).
  - Playwright MCP: browser-singleton lock (`Browser is already in use ... use --isolated`), 11th consecutive session-wide — BLOQUEADO-infra for the observation layer only (snapshot probe + screenshot attempt both rejected; GETs 15s + disk + F5 helpers stand per F3/F4 precedent; 0-quota retry pending).
- Steps executed (all `-Encoding utf8` reads, HTTP 15s, suites ≤120s, validate ≤30s; waits capped 8min; one case at a time; explicit sleeps, no long fixed blocks):
  1. `GET /factory/health` (15s) → 200, `buildId 15fece3e == HEAD`, `opencode healthy` (port 33256). `GET /factory/scorers` → 3 scorers, all allowlisted, `samplingRate: 25`.
  2. Offline re-run: `e2e-f5-teeth.asserts` 9/9, `verify-retry-reconcile` 7/7, `empty-folder-fallback` 8/8, `implement-fallback-literal` 8/8 (32/32). `validate` exit 0. God 3583.
  3. Playwright snapshot probe → singleton lock → BLOQUEADO-obs recorded (no retry loop, no quota burn).
  4. Created E2E-05 job `job-mtoggi1d-gp0n` (POST `/factory/jobs` 15s, 0 LLM): single-folder exact-content prompt (F2-proven shape): `Crea la carpeta lab5-teeth con un archivo leeme.txt que contenga en su interior EXACTAMENTE estas 2 lineas, byte por byte ... DIENTES-F5 linea uno / DIENTES-F5 linea dos. El archivo debe ser lab5-teeth/leeme.txt ...` Worktree above. Created 2026-09-05T14:05:29.809Z, runner `linux-build`.
  5. Poll 1 (+60s): Triage `building (trivial) conf=1` (genuine parse) → Foreman `decided building` → `runner:prepared linux-build node:22-bookworm` → `runner:accepted` → `runner:setup pass corepack enable` → `implement:changed 0 files strategy=fallback duration=16851ms` (infra 1, F3-C2/C3 pattern) → `createdFiles: descartadas 1 ruta(s) ... (H-001/H-012): lab5-teeth` → `verification failed` → Triage (14:06:25.443Z, cost 3). H-012 honest-fail half observed live here.
  6. Disk check: `lab5-teeth/leeme.txt` EXISTS, 41B, bytes `44-49-45-4E-54-45-53-2D-46-35-20-6C-69-6E-65-61-20-75-6E-6F-0A-44-49-45-4E-54-45-53-2D-46-35-20-6C-69-6E-65-61-20-64-6F-73` (`DIENTES-F5 linea uno\nDIENTES-F5 linea dos`, no trailing newline), mtime 2026-09-05T14:06:37.023Z = fail + 11.6s. Classic H-013 late-write shape (run-8 was +2s).
  7. Polls 2-3 (+90s/+60s): still Triage queued (backlog pending ~39), updatedAt frozen — no auto-retry within ~6min. Code read (read-only): verify-retry is a POST route (`job-verify-retry` → `runVerifyRetryWorker`, same production worker either way).
  8. Operator action (F2 retry-review precedent, documented, production route): POST `/factory/jobs/job-mtoggi1d-gp0n/review/verify-retry` `{}` (15s) → `{ok:true}` (0 LLM; worker async, uno-en-vuelo dedupe).
  9. Poll 4 (+60s): `Triage->Review | verify-retry pass → Review (re-verificación desde Triage)` (14:11:52.509Z) + `verify-retry: reconciliadas 2 ruta(s) tardía(s) en disco (H-013): lab5-teeth/leeme.txt, lab5-teeth` (14:11:52.523Z, meta `reconciledLateFiles: [lab5-teeth/leeme.txt, lab5-teeth]`) → Review running (cost 4).
  10. Poll 5 (+90s): `review ask_human intento 1 (0 findings)` → stay Review (14:13:15Z, cost 5) — H-005 flaky review strike (infra 1 in new chain; verify-retry pass broke consecutiveness). Operator action (F2 precedent): POST `review/retry-review` `{}` → `{ok:true}`.
  11. Poll 6 (+90s): `review accept intento 2 (0 findings)` (reviewer allowlisted, confidence 0.93) → `Review->Complete | review accept intento 2: lab5-teeth/leeme.txt existe en el worktree con exactamente las dos líneas pedidas byte por byte ...` (14:14:59.856Z, cost 6 llamadas, `sin tarifa`). COMPLETE WITH TRACKED DELIVERY.
  12. Disk asserts via F5 helpers (tsx, 0 quota): `hasReconciledLateFilesNote` → `{ok:true, files:[lab5-teeth/leeme.txt, lab5-teeth]}`; `hasVerifyRetryTransition` → true; `assertF5TeethDisk` → fileExact ok, retry ok, lateNote ok (`lab5-teeth/leeme.txt|lab5-teeth`), ghost none-ok, literals none-ok, verify pass-ok; `exactEquality:false` SOLELY because `lab5-teeth` (real folder) is not `isFile` under the helper's file-only definition (see verdict analysis — not a source FAIL, not a test bug; helper left untouched, offline 9/9 still green).
  13. Persist parity: `result.json.createdFiles` == `verify.json.createdFiles` == `job.json.createdFiles` == `["lab5-teeth/leeme.txt","lab5-teeth"]`; `verify.json verification.overall: pass`; `review.json {verdict: accept, reviewAttempt: 2, confidence: 0.93}`; folder holds ONLY `leeme.txt`; top level has zero space-named dirs.
  14. E2E-12 (observational, 0 extra quota, same job): verify steps all carry `isolation:"none"` (setup/test/build + evidence); `docker info` 1-attempt probe hung (tool-timeout, no responsive daemon) → `none` == machine reality; `runner:setup pass corepack enable` (H-009 fail-open healthy, no Triage-by-docker). E2E-12 PASS.
  15. Scores honesty (0 quota): `GET .../scores` → `{}` at +2min AND +4min post-Complete; offline `shouldSampleJob(job-mtoggi1d-gp0n, 25) = false` (OUT) → absent = sampled-out by design (F4 pattern), not a FAIL.
  16. Screenshot attempt → singleton lock (11th consecutive) → attachment absent, honestly recorded. Temp assert scripts removed (`CLEANED:True`).
- DONE criteria results (plan §F5):
  - E2E-05 PASS with late-write reconcile live (H-013 RE-GREENED — CLOSED live, orchestrator to append HALLAZGOS): ghost gone — `createdFiles` on the Complete holds the delivered file byte-exact (41B) plus the real parent folder; `reconciledLateFiles` note on disk BEFORE the accept persist; `result`/`verify`/`transition` all carry the reconciled list; accept message cites the file byte-exact. Strict-helper `ok:false` is ONLY the file-only `exactEquality` quibble (folder entry real + requested-name, zero literals) — documented as precision note, NOT routed to Engineer (no invented path, no ghost, verify honest) and NOT a test fix (helper behaves as written; weakening it to pass would be theater).
  - H-012 RE-GREENED live (fail half, same job): empty folder at fail time → `verification failed` → Triage at 14:06:25.443Z (honest, no pass ciega). Still-empty-stays-fail (M2/M5 shape) proven offline 9/9.
  - H-001 no-regression live: zero literal folders (`literalSuspects: []`, top-level clean), phantom `lab5-teeth` discarded at fail time, never delivered as literal.
  - E2E-12 PASS (0 extra quota): `isolation:"none"` truthful on all steps; no false docker badge; H-009 path healthy.
  - Stale-label grep 0 in code paths (T2 observed): `shared/types/runner.ts` (header: zero image literals even in comments) + `headless-runtime/runner/runnerExecutor.ts` + `VerificationPanel.tsx` → zero `ubuntu:22.04` hits. (T2-owned strings; T1 changed nothing.)
  - H-011 verdict recorded (T3 observed, E2-owned per `docs/E2E-HALLAZGOS.md`): `vite-plugin-electron@0.29.1` supports NO restart/exit overrides (`ElectronOptions = {entry, vite, onstart}`; `startup.exit` unconditionally `taskkill`); `vite.config.ts` left UNTOUCHED per §5-assumption-7 → fix-or-document resolved as documented standalone-supported mode.
  - Migration suite (T3 observed): `tests/agent-sessions-migration.test.ts` 18/18 green in 16s this run — hang NOT reproduced; no skip/quarantine markers in file. (Single-run evidence; owner-signed quarantine not needed.)
  - Suites 32/32 + migration 18/18, `validate` exit 0, God 3583→3583 (+0, T1 touched zero source files), zero new loops (LOOPS untouched).
  - Scores: sampled-out by design (OUT proven offline); fresh-`scoreReason` still unproven live (F4 carry-over stands).
  - Screenshot: BLOQUEADO-obs (attachment absent; GET + disk + helper asserts stand).
- Live evidence — teeth:
  - jobId: `job-mtoggi1d-gp0n` — created 2026-09-05T14:05:29.809Z, Complete 2026-09-05T14:14:59.856Z (~9.5min wall incl. operator waits), `reviewCount` 2 (accept intento 2), cost 6 llamadas (`sin tarifa`), `buildId 15fece3e`, runner `linux-build`.
  - Worktree: `C:\tmp\demo-e2e-f5-teeth-20260905-140500` (git + exit-0 test/build). Job dir: `<worktree>\.agents\factory\job-mtoggi1d-gp0n\{job.json,result.json,verify.json,review.json,triage.json,prompt.md,logs\}`.
  - File: `lab5-teeth/leeme.txt` 41B, `DIENTES-F5 linea uno\nDIENTES-F5 linea dos` (no trailing newline), mtime 2026-09-05T14:06:37.023Z (fail + 11.6s).
  - Timeline quotes:
    - `2026-09-05T14:06:25.420Z | Building->Building | implement:changed 0 files strategy=fallback duration=16851ms`
    - `2026-09-05T14:06:25.424Z | Building->Building | createdFiles: descartadas 1 ruta(s) inexistente(s) o vacía(s) sin archivo pedido (H-001/H-012): lab5-teeth`
    - `2026-09-05T14:06:25.443Z | Building->Triage | verification failed: pnpm test exit ?`
    - `2026-09-05T14:11:52.509Z | Triage->Review | verify-retry pass → Review (re-verificación desde Triage)` (meta: verification pass 3 steps `isolation:none`, `createdFiles:[lab5-teeth/leeme.txt, lab5-teeth]`, `runnerId: linux-build`)
    - `2026-09-05T14:11:52.523Z | Review->Review | verify-retry: reconciliadas 2 ruta(s) tardía(s) en disco (H-013): lab5-teeth/leeme.txt, lab5-teeth` (meta `reconciledLateFiles:[lab5-teeth/leeme.txt, lab5-teeth]`)
    - `2026-09-05T14:13:15.853Z | Review->Review | review ask_human intento 1 (0 findings)` (H-005 flaky; recovered via retry-review)
    - `2026-09-05T14:14:59.853Z | Review->Review | review accept intento 2 (0 findings)` (confidence 0.93)
    - `2026-09-05T14:14:59.856Z | Review->Complete | review accept intento 2: lab5-teeth/leeme.txt existe en el worktree con exactamente las dos líneas pedidas byte por byte ...`
  - Helper outputs: `NOTE:{"ok":true,"files":["lab5-teeth/leeme.txt","lab5-teeth"]}` · `RETRY:true` · `VERDICT:{fileExact:true, retryTransition:true, lateNote:true, ghost:false, literalSuspects:[], verifyPass:true, exactEquality:false(folder-not-file note)}` · `STATUS:"Complete"`.
  - Operator POSTs (both production routes, F2-precedent, 0 LLM): `review/verify-retry → {ok:true}` (after ~6min queued Triage, backlog pending ~39) · `review/retry-review → {ok:true}` (after flaky ask_human).
  - Screenshots/snapshots: none (Playwright BLOQUEADO-obs, lock quoted in preconditions; 1 snapshot probe + 1 screenshot attempt, no retry loop).
- FAILs/rollbacks: none (zero source files touched; nothing to revert). No source bug (ghost gone, nothing invented, no literal, verify honest — folder co-entry is the F2-carry-over-#2 "alongside" shape, both paths real). No test bug (helper 9/9 green before AND after; live `ok:false` is its file-only definition working as written, reported not patched). Two infra strikes recovered per rule (implement-fallback ×1 → late-write success broke the chain; review ask_human ×1 → retry-review accept); never 2 consecutive infra → no BLOCKED.
- New LOOPS rows + meta-test: +0-note (premiere-only; no new intervals/retries/dedupe; poll sleeps are bounded waits, not loops; the two operator POSTs are one-shot recoveries, not mechanisms).
- Quota spent: 6 LLM calls (triage 1 + foreman 1 + implement 1 + review intento-1 1 + accept intento-2 1 + 1 pipeline cost event; all `sin tarifa`). F5 live budget 3-8 — WITHIN (6). E2E-12 cost 0 extra (observational). Cumulative F1 0 + F2 19 + F3-A 7 + F3-B 7 + F3-C 8 + F4 1 + F5-T1 6 = 48/50. Headroom 2 for F6 (F6 full run needs fresh confirmation if estimate >50 per E4).
- Carry-over (scope-freeze items, never done silently here):
  1. Helper precision note: `assertF5TeethDisk` file-only `exactEquality` vs E2E-05 text (`rutas reales existentes`) — live folder co-entry is real + requested-name. Future assert refinement (accept real requested-name folders) owned by the asserts owner, non-blocking; helper NOT weakened here.
  2. Fresh `scoreReason:"scored"` on disk still unproven live (F4 carry-over stands; this job sampled OUT by design).
  3. Screenshots/snapshots: 0-quota Playwright retry when the browser singleton frees (observation-only).
  4. `docs/E2E-HALLAZGOS.md` H-012/H-013 re-green entries: evidence above, orchestrator appends (T1 does not edit HALLAZGOS per writer matrix).
  5. Dirty-tree note (still true): factory work on disk untracked in git (`HEAD 15fece3e` predates it); F-phase commits remain orchestrator call. This report file is the single new tracked artifact of F5-T1.
- QA verdict: F5-T1 PASS (E2E-05 PASS strict-with-note · E2E-12 PASS · H-012 + H-013 RE-GREENED live · 32/32 + 18/18 · validate 0 · God +0 · quota 6/8). F5 overall: PASS (T1 premiere + T2 strings observed-clean + T3 H-011 verdict recorded + migration 18/18 this run; Known Issues carried, none blocking). Routing decision: NoOne (no Engineer action; no QA self-fix pending).

# Test Report

## Summary
- Total Tests: 50 run (9 F5-teeth + 7 reconcile + 8 empty-folder + 8 literal + 18 migration) | Passed: 50 | Failed: 0
- Live: E2E-05 PASS · E2E-12 PASS · H-012 re-green · H-013 re-green
- Coverage: teeth chain fail→late→retry→accept→Complete fully evidenced on disk
- Routing Decision: NoOne

## Failed Tests (if any)
- None (offline). Live strict-helper `ok:false` SOLELY on file-only `exactEquality` (folder co-entry real) — precision note, not a FAIL. See verdict analysis.

## Known Issues
- Helper file-only strictness vs E2E-05 `rutas reales` text (non-blocking refinement, asserts owner).
- Fresh `scoreReason` on disk unproven live (this job sampled OUT by design; F4 carry-over stands).
- Screenshots absent (browser singleton lock session-wide; 0-quota retry pending).
