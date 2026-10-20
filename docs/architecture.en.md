# Kumihimo architecture

A Next.js app (App Router, standalone output) that runs on Cloud Run. The browser renders the canvas and schedules work; the server holds the Atlas Cloud key, the passcode sessions and the shared counters.

## Modules and dependency rules

```
src/
  app/          pages and route handlers
    api/mode        GET: which mode this browser is in (decided by the server)
    api/session     POST passcode / DELETE: live-mode session
    api/atlas/*     live mode only: chat, generate-image, generate-video, upload, prediction/[id]
    go/contact      counts a click, then redirects to SolanaLink's contact form
    privacy         the privacy notice (Japanese, then English)
  proxy.ts      any request carrying a Next-Action header gets 403 (no Server Actions here)
  atlas/        adapter interface, mock adapter (no network), live adapter (server only), model registry, input validation
  server/       server only: environment, mode, session, client address, cost, live gate, usage counters
  engine/       pure functions: graph algorithms, run rules, connections, history, layout, stress graphs
  workers/      the graph Worker and its client
  store/        Zustand: graph store (document, undo) and execution store (by node id); workflow files
  client/       browser side: scheduler, runners, API client, in-browser demo adapter, autosave, upload consent
  demo/         the built-in example's words, shared by the canvas and the demo adapter
  canvas/       React Flow canvas, nodes, side panel, toolbar
  i18n/         interface text and the privacy notice
```

Rules, enforced by `test/security.test.ts`:

1. `ATLASCLOUD_API_KEY` is read only in `src/server/env.ts`; the Atlas host appears only in `src/atlas/live.ts`.
2. Server modules and the live adapter start with `import "server-only"`, so importing them from client code fails the build.
3. Client components never import `@/server/*` or `@/atlas/live`.
4. `engine/` does no I/O: no fetch, no clock, no randomness (time is passed in). The Worker and the tests share it.

## Demo mode and live mode

The mode is decided on the server; the browser cannot choose or claim it. `GET /api/mode` answers in this order:

1. `LIVE_MODE` is not `on` → demo (the kill switch beats everything; signed-in visitors see "Live mode is temporarily off").
2. No API key → demo (so a fresh clone runs without an account).
3. No valid passcode session → demo.
4. Otherwise → live.

In demo mode the browser answers every request itself with the mock adapter (`src/client/demo-adapter.ts`): sample results bundled in `public/samples/`, chosen to match the workflow (`docs/demo-samples.md`). Prompts and images never leave the page; the server is asked only for the mode, which also says how fast demo results arrive. In live mode the browser calls `/api/atlas/*`, where each request is checked in order, failing closed: live mode on (503) → key present (503) → valid session (401) → counter store reachable (503) → rate limit by address hash (429) → upload rule (403) → budget and concurrency (429). Only then is it forwarded.

**Passcode sessions.** The passcode is sent only in a POST body and compared in constant time against SHA-256 hashes in `KUMIHIMO_PASSCODES` (each with a label, an expiry and a daily budget). The answer is an HttpOnly, SameSite=Lax cookie (Secure in production) holding only the label and expiry, signed with HMAC; it lasts at most 12 hours and never beyond the passcode's own expiry. Five wrong attempts per minute from one address lock that address for the rest of the minute.

**Client address.** Taken from the right-hand end of `X-Forwarded-For` (clients can prepend anything), skipping `KUMIHIMO_FORWARDED_HOPS` entries. Only a salted HMAC of it is ever stored.

**Why the browser cannot get round it.** Every live request checks the session; submit bodies are strict schemas (extra fields such as `mode` are a 400); a prediction id is bound to the passcode label that created it, and anyone else gets a 404 without Atlas being asked; models and parameters must be in the registry and within its limits; and the upload rule is enforced on the server as well (below).

**Demo samples.** Demo predictions are stateless: the id encodes the kind, creation time, sample and outcome, so polling (and resuming after a reload) needs no storage. The sample images and videos are original, drawn in code by `scripts/demo-assets/`, and listed with their provenance in `docs/demo-samples.md`.

## Counters: budgets, concurrency, rate limits

Requirements: costs are counted in money (registry price × images, seconds or tokens) and reserved on submit; the passcode's and the site's daily budgets are charged together; a global concurrency limit applies across instances; and nothing resets when an instance restarts (Cloud Run scales to zero and may run two instances).

Firestore (Native mode) holds them:

| Document | Fields | Use |
|---|---|---|
| `budget/{JST date}_{label}` | `spentMicroUsd`, `submits`, `succeeded`, `failed`, `limitMicroUsd`, `updatedAt` | read, check and add in a transaction; the counts feed the usage report |
| `budget/{JST date}_site` | same | charged in the same transaction |
| `concurrency/global` | `slots: { [reservation id]: expiry }` | expired slots are dropped, then counted |
| `ratelimit/{bucket}_{window}_{address hash}` | `count`, `expireAt` | per-address limits; TTL deletes them |
| `predictions/{hash of id}` | label, reservation id, upload flag, `expireAt` (1 day) | binds a prediction to its session |
| `uploads/{hash of URL}` | `expireAt` (15 days) | the server half of the upload rule |

One live submission:

1. Check the session, the registry and the parameter limits; compute the **upper-bound** cost (LLM: input characters as tokens plus the registry's `max_tokens`; images: count × price; video: price × seconds × resolution factor).
2. In **one transaction**, charge the passcode budget and the site budget and take a concurrency slot; all three or nothing.
3. Forward to Atlas. A failed forward releases the slot but not the budget (Atlas may have charged).
4. The slot is released when polling sees the job finish, or when its lease runs out (image 2 minutes, video 6 minutes).

Usage report: `pnpm usage-report --project <id>` lists, per passcode label, today's and all-time submissions, successes, failures and spend, and what is left of today's budget. It reads only the `budget` collection, with the runner's own gcloud login. Alerts watch three log events that carry no detail: `upstream_402`, `budget_exhausted` and `passcode_rate_limited`.

Firestore is used only when `KUMIHIMO_FIRESTORE_PROJECT` names the project explicitly; ambient credentials and `GOOGLE_CLOUD_PROJECT` are never picked up. Under `next dev` a file ledger (`.data/ledger.json`, not in git) stands in; elsewhere, without Firestore, live mode answers 503. TTL policies delete expired documents (usually within a day of `expireAt`); the code trusts `expireAt`, not the deletion.

## Main thread and Worker

| Where | What | Why |
|---|---|---|
| main thread | React rendering, React Flow interaction, the two stores | only the main thread touches the DOM |
| main thread | scheduler: state changes, slots, requests, polling, cancel | mostly waiting on the network |
| main thread | streamed text: tokens are buffered and flushed once per animation frame | tied to rendering |
| Worker | ancestors of a node when a connection starts, so `isValidConnection` can refuse cycles synchronously; checked again on drop | React Flow needs a synchronous answer |
| Worker | topological order, downstream invalidation | no main-thread work for 500 nodes |
| Worker | stress-graph generation and layout | no long task on the main thread |

One module Worker (`src/workers/graph.worker.ts`) with request-id RPC over `postMessage`; it receives only ids, ports and edges. If a Worker cannot start, the same functions run on the main thread. Cache keys are the stable JSON of a node's kind, parameters and input values.

Execution state (status, progress, elapsed time, streamed text) lives in a store keyed by node id, not in React Flow's `nodes` array; each node subscribes only to its own entry.

## Security and logs

- The key stays on the server; tests lock where it is read and that no client module can import it.
- **Uploaded images are not stored.** The upload route checks size (≤ 10 MB) and type in memory, forwards the file and drops it; no file name, content or prompt is logged. Results are not stored either: the browser keeps result URLs in its own IndexedDB.
- **Upload rule.** An uploaded image, and every result made from it, may only go to models confirmed to run on Atlas Cloud itself. The browser refuses such runs; the server records hashes of upload-derived URLs and answers 403 if one is sent elsewhere.
- Image and video requests ask Atlas to delete the request record when the job finishes and the output after 24 hours.
- Logs never contain the key, passcodes, prompts, images, raw IP addresses or e-mail addresses; upstream error text is truncated and any key in it redacted. The only event the app itself writes is a contact-button click, without any detail about the visitor. Cloud Run request logs are excluded.

## Deployment

A Docker image (`Dockerfile`, standalone output, non-root user) is built by Cloud Build, checked inside the image for env files, keys and swap files (`scripts/image-check.sh`; the push happens only if the check prints its completion line), and deployed by digest. Instance count, timeouts and the live-mode switch are configuration; `LIVE_MODE=off` changes only an environment variable, with no rebuild.
