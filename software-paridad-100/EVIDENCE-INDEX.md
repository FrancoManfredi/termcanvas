# EVIDENCE-INDEX — F6 final run (buildId `15fece3e` == HEAD `15fece3e`)

Worktree: `C:\tmp\demo-e2e-f6-final-20260905-143000` · Job dir pattern: `<worktree>\.agents\factory\<jobId>\` · Daemon: `127.0.0.1:17680` · Screenshots: BLOQUEADO-obs (browser lock 12th consecutive + renderer 5173 down; 0-quota retry pending).

| Case | Job / artifact | Timestamps (UTC) | Disk paths | GETs (15s) |
|---|---|---|---|---|
| Gate | validate exit 0, tsc exit 0, health 200 | 2026-09-05T14:23–14:26Z | — | `/factory/health` (buildId 15fece3e, opencode healthy :35007 after 1 transient not_started) |
| E2E-01/05 | `job-mtoh92oh-g1yi` Complete, accept-1, cost 5 | created 14:27:42Z, Complete 14:32:10Z, file mtime 14:28:41Z (fail+7s) | `job-mtoh92oh-g1yi\{job,result,verify,review}.json`, `lab6-final/leeme.txt` 38B | `GET /jobs/:id` (status+timeline), counts 294 |
| E2E-02 | `job-mtohgjp0-9jlu` Triage (prompt-gap, 2 calls) | created 14:33:31Z | `job-mtohgjp0-9jlu\job.json` (`implement sin parse confiable`) | `GET /jobs/:id` |
| E2E-02 retry | `job-mtohjzq0-vmto` Complete, accept-1, RC1, cost 4 | Complete 14:40:16Z, file mtime 14:36:53Z | `job-mtohjzq0-vmto\{job,review}.json` (`verdict accept attempt 1 findings 0`), `lab6-rev2/dato.txt` 52B | `GET /jobs/:id` |
| E2E-03 | `job-mtohs9bm-1ihi` Triage 0.96, 3 Qs | created 14:42:38Z, triaged 14:43:00Z | `job-mtohs9bm-1ihi\{job.json,triage.json}` (decision triage, openQuestions 3) | `GET /jobs/:id` |
| E2E-06 corroboration | 4/4 Completes 1 session/role | — | `job.json agentSessions {foreman,implement,review,triage}` ×4 | — |
| E2E-08 | summary 1/1/0; 2 empties = sampled-out | 14:4xZ | — | `GET /scores/summary`, `GET /jobs/:id/scores` ×2 + offline `shouldSampleJob=false` ×2 |
| E2E-09 probe1 | `job-mtohvo0i-bfol` Complete accept-1, `strategy=llm`, cost 4 | Complete 14:46:31Z | `job-mtohvo0i-bfol\job.json`, `lab6-rod1/reto.txt` | `GET /jobs/:id` |
| E2E-09 probe2 | `job-mtohz20a-4twc` Complete accept-1 via retry, cost 4 | Complete 14:51:56Z, retry meta 14:51:42Z | `job-mtohz20a-4twc\job.json`, `lab6-rod2/reto.txt` 58B | `GET /jobs/:id` + `POST review/verify-retry {ok:true}` |
| E2E-09 gates | failures [] proposals [] | 14:52Z | — | `GET /improve/failures?scorer=review-formato-valido`, `GET /improve/proposals` |
| E2E-10 | red exit 1 + served valid:false → green | 14:54:34–14:54:47Z | `factory/scorers/review-formato-valido/scorer.md` (restored, rate 25, no .bak) | `GET /definition/status` (valid:false→true, `scorer.md:7`) |
| E2E-11 | ring 100 + ack `n-1788617595863-437` | ack 14:5xZ | — | `GET /notifications` (100), `POST /notifications/:id/ack {ok:true}` → `acked:true` |
| E2E-12 | isolation=none meta + local runner events; docker hung | 14:5xZ | `job-mtoh92oh-g1yi\job.json` timeline meta (`isolation=none` steps+evidence), `verify.json` shortcut (key absent — P2 note) | `docker info` hung 15s (1 attempt) |
| E2E-13 | 6/6 llmCalls>0, 0 USD strings | — | `job.json costSummary` ×6 (`estimatedUSD null basis estimated-chars/4`) | — |
| E2E-14 | 125/125 suites + God 3583 + route 42 | — | `headless-runtime/factory/factoryServer.ts` (3583), `routing/routeTable.ts` (308) | — |
| D18/D19 live | triggers:[] ; mock-local count 3 liveMode:false | 14:5xZ | `factory/.integrations-mock.json` (3 posts) | `GET /automations`, `GET /integrations/status` |

Prior-phase same-build evidence incorporated by reference (all `buildId 15fece3e`, 2026-09-05): F1 `REPORT-F1-intake-live.md` (webhook/filter/post-back, `job-mto11ea2-3ko5`, `m-1788591134039-3`) · F2 `REPORT-F2-revise-loop.md` (`job-mto1oxqg-jcdd`, E2E-06 PASS) · F3 `REPORT-F3-measure-humano.md` (benchmark `bench-mtoce4ee2ph0ap` + decision sidecar + `n-1788610481909-433`) · F4 `REPORT-F4-dinero-traza.md` (trace-half, `job-mto1nbpw-hjrk`) · F5 `REPORT-F5-dientes-estabilidad.md` (`job-mtoggi1d-gp0n`, H-012/H-013 re-green).
