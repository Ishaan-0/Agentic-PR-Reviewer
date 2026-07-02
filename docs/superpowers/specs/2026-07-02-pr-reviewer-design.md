# Agentic PR Reviewer — Design Spec
**Date:** 2026-07-02
**Timebox:** 2 days
**Goal:** A live, working demo people can try instantly — a free, no-auth AI agent that reviews public GitHub PRs and streams its reasoning live.

---

## 1. What We're Building

Paste any public GitHub PR URL → watch an AI agent decide what to inspect, read the diff and relevant files, and stream its reasoning live → get a structured review (summary, issues by severity, verdict).

The differentiator is **watching the agent decide what to inspect**. That tool-selection reasoning, streamed live, is the core "wow" moment and the demo hook.

**Explicitly out of scope for v1:** GitHub OAuth, posting comments back to GitHub, user accounts, saved history, private repos.

---

## 2. Repository Structure

Single monorepo, TypeScript across both frontend and backend.

```
AgenticPR_Reviewer/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express server entry point
│   │   ├── routes/
│   │   │   └── review.ts         # POST /api/review + GET /api/review/:id/stream
│   │   ├── agent/
│   │   │   ├── loop.ts           # Swappable agent loop — runAgentLoop(prDetails, onEvent)
│   │   │   ├── tools.ts          # get_pr_diff, get_file_content, list_existing_comments
│   │   │   └── prompt.ts         # System prompt for the LLM
│   │   ├── github.ts             # Octokit wrapper — raw GitHub API calls
│   │   ├── cache.ts              # In-memory Map keyed by PR URL
│   │   └── rateLimit.ts          # Per-IP rate limiting middleware
│   ├── .env.example
│   ├── tsconfig.json
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Root — URL input, event log, result panel
│   │   ├── components/
│   │   │   ├── EventLog.tsx      # Live streaming event list
│   │   │   └── ReviewResult.tsx  # Final structured output render
│   │   └── hooks/
│   │       └── useReview.ts      # SSE connection logic + state management
│   ├── index.html
│   ├── tsconfig.json
│   └── package.json
├── CLAUDE.md
└── .gitignore
```

**Key boundaries:**
- `agent/loop.ts` is the only file that imports the Vercel AI SDK. Swapping it out (to raw Groq or LangChain) only requires touching this one file.
- `github.ts` is separate from `agent/tools.ts` — tools call `github.ts`, so tools can be tested without touching the LLM.
- `useReview.ts` hook owns all SSE logic — no SSE code leaks into components.

---

## 3. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Backend runtime | Node.js + Express + TypeScript | Minimal, familiar, handles SSE natively |
| Agent / LLM | Groq API via Vercel AI SDK (`@ai-sdk/groq`) | Free tier, tool-calling support, fast inference |
| GitHub data | Octokit + read-only PAT | 5,000 req/hr on free tier |
| Streaming | SSE (Server-Sent Events) | Simpler than WebSockets for one-directional streaming |
| Frontend | React + Vite + TypeScript | Modern standard, zero-config TS, fast HMR |
| Backend hosting | Render (free tier) | Simplest deploy, persistent process for SSE |
| Frontend hosting | Vercel (free tier) | Static SPA deploy |
| Schema validation | Zod | LLM output validation + TypeScript inference |
| Dev runtime | `tsx` (backend) | No separate compile step during development |

**Fallback LLM:** Gemini (AI Studio free tier) if Groq rate limits are hit in production.

---

## 4. API Design

### `POST /api/review`

**Request:**
```json
{ "prUrl": "https://github.com/owner/repo/pull/123" }
```

**What it does:**
1. Parses URL into `owner`, `repo`, `prNumber`
2. Checks in-memory cache — if hit, returns cached result immediately
3. If miss: generates a unique `reviewId`, stores pending entry in cache, kicks off `runAgentLoop()` in the background
4. Returns immediately with the `reviewId` — does not wait for the agent

**Response:**
```json
{ "reviewId": "abc123", "cached": false }
```

### `GET /api/review/:id/stream`

SSE endpoint. Client connects here after receiving the `reviewId`.

**What it does:**
1. Sets SSE headers (`Content-Type: text/event-stream`)
2. If review is already complete, flushes all accumulated events + final result and closes
3. If still running, attaches to the live EventEmitter and streams events as they arrive
4. On agent completion, emits `done` event with structured result and closes

**Why two endpoints:** The agent runs independently of the SSE connection. A page refresh or dropped connection doesn't kill the agent — the client reconnects with the same `reviewId` and replays missed events from the cache.

### SSE Event Shape

```ts
type SSEEvent =
  | { type: "status";  message: string }
  | { type: "tool";    tool: string; input: unknown }
  | { type: "finding"; severity: "high" | "medium" | "low"; message: string }
  | { type: "done";    result: ReviewResult }
  | { type: "error";   message: string }
```

### Full Request Flow

```
Frontend          Backend              Groq            GitHub
   |                  |                  |                |
   |-- POST /review ->|                  |                |
   |<- { reviewId } --|                  |                |
   |                  |                  |                |
   |-- GET /stream -->|                  |                |
   |                  |-- get_pr_diff -->|                |
   |                  |                 |-- GET /pulls -->|
   |                  |<-- tool result--|<-- diff --------|
   |<- status event --|                  |                |
   |                  |-- get_file ----->|                |
   |<- tool event ----|                  |                |
   |                  |<-- tool result--|                 |
   |<- finding event -|                  |                |
   |                  |-- final answer ->|                |
   |<- done event ----|                  |                |
```

---

## 5. Agent Loop

### Signature

```ts
async function runAgentLoop(
  prDetails: { owner: string; repo: string; prNumber: number },
  onEvent: (event: SSEEvent) => void
): Promise<ReviewResult>
```

`onEvent` is the only communication channel to the outside world. The loop has no knowledge of SSE, Express, or cache.

### Tools

| Tool | What it does | When used |
|---|---|---|
| `get_pr_diff` | Fetches changed files + patches | Always first — maps what changed |
| `get_file_content` | Fetches full file at a given path + ref | When diff lacks context (e.g. called function defined elsewhere) |
| `list_existing_comments` | Fetches existing PR review comments | Avoids repeating what a human already flagged |

### Loop Logic

```
1. Send system prompt + PR details to Groq via Vercel AI SDK streamText
2. Groq responds — tool call or final answer
3. If tool call:
   a. Emit "tool" SSE event
   b. Execute tool (hits GitHub API)
   c. Feed result back to Groq
   d. Repeat from step 2
4. If final answer:
   a. Validate against ReviewResult Zod schema
   b. If invalid → one retry with Zod error fed back to model
   c. Emit "done" event
   d. Return ReviewResult
```

### Guardrails

- **Max tool calls: 15** — cuts off runaway loops, returns partial result with a note
- **Diff size cap: ~50KB** — strip lockfiles/generated files first (`package-lock.json`, `*.min.js`, `dist/`, `vendor/`, `node_modules/`), then keep highest-churn files if still over limit
- **Max file fetches: 5** — agent may pull full context for at most 5 files per review

### Zod Output Schema

```ts
const ReviewResultSchema = z.object({
  summary: z.string(),
  issues: z.array(z.object({
    file: z.string(),
    line: z.number().optional(),
    severity: z.enum(["high", "medium", "low"]),
    comment: z.string(),
  })),
  verdict: z.enum(["approve", "request_changes", "comment"]),
})

type ReviewResult = z.infer<typeof ReviewResultSchema>
```

### System Prompt Strategy

The system prompt must:
1. Define the agent's job and the exact JSON output schema it must return
2. Instruct it to reason out loud about *why* it's fetching each file (this reasoning is what gets streamed — it's the product)
3. Instruct it to skip generated/vendor files and focus on logic changes

---

## 6. Frontend

### UI States

**State 1 — Idle:**
Centered input, submit button, nothing else. Inline URL validation before hitting the backend (must match GitHub PR URL pattern).

**State 2 — Streaming:**
- Live event log (left/top): scrolling list of SSE events as they arrive
  - `status` → plain muted text
  - `tool` → highlighted, shows tool name + target file
  - `finding` → severity-colored pill (red/yellow/blue for high/medium/low)
- Animated pulse indicator (right/bottom) while agent runs
- Cold start state: if POST takes >3s, show "Waking up the agent (~30s)..." — not a silent spinner

**State 3 — Complete:**
Event log stays visible (the reasoning trail is part of the value). Result panel renders:
```
VERDICT: Request Changes
────────────────────────────────────
Summary: This PR adds OAuth but...

● HIGH   auth/middleware.ts:42
  Token stored in localStorage...

● MEDIUM routes/user.ts:17
  Missing input validation on...

● LOW    utils/helpers.ts:83
  Unused import left in...
```
Verdict color: red for `request_changes`, green for `approve`, yellow for `comment`.

### Component Responsibilities

- **`useReview.ts`** — opens SSE connection, accumulates events into state, parses `done` event, handles errors and connection drops (auto-reconnect once with same `reviewId`)
- **`App.tsx`** — reads state from hook, decides which UI state to render. No SSE logic.
- **`EventLog.tsx`** — renders the accumulated events array, auto-scrolls to bottom
- **`ReviewResult.tsx`** — renders the final `ReviewResult` object

---

## 7. Caching

In-memory `Map` in `cache.ts`, keyed by PR URL.

Each entry stores:
```ts
{
  status: "pending" | "complete" | "error",
  events: SSEEvent[],          // accumulated for replay on reconnect
  emitter: EventEmitter,       // live stream for connected clients
  result?: ReviewResult,       // set on completion
}
```

**No persistence** — cache lives in process memory. A Render restart clears it. Acceptable for v1.

---

## 8. Rate Limiting

Two limits stacked per IP:
- **10 requests per hour** — protects Groq/GitHub quota from a single user
- **2 concurrent reviews** — prevents queue abuse

Returns `429` with a human-readable message: `"You've hit the rate limit. Try again in X minutes."` Frontend surfaces this as an inline error.

---

## 9. Error Handling

| Error | Handling |
|---|---|
| Invalid PR URL | Frontend inline validation, never hits backend |
| Private / non-existent repo | GitHub 404 → `error` SSE event → "Only public repos are supported." |
| Diff too large after filtering | Truncate, note in summary: "Large PR — reviewed highest-churn files only" |
| Groq rate limit | Retry once after 2s, then `error` SSE event |
| LLM output fails Zod validation | One retry with error fed back to model, then `error` SSE event |
| Agent hits 15-tool-call cap | Return partial result with note in summary |
| SSE connection drop | Client auto-reconnects once with same `reviewId`, replays missed events |
| Backend cold start | Frontend detects POST >3s → shows "Waking up the agent (~30s)..." |

---

## 10. Deployment

| Service | What's deployed there |
|---|---|
| Render (free tier) | Backend — Node/Express process |
| Vercel (free tier) | Frontend — static Vite build |

**Environment variables (backend):**
```
GROQ_API_KEY=
GITHUB_TOKEN=
PORT=3000
FRONTEND_URL=https://your-vercel-app.vercel.app  # for CORS
```

**Environment variables (frontend):**
```
VITE_API_URL=https://your-render-app.onrender.com
```

---

## 11. Known Risks

| Risk | Mitigation |
|---|---|
| Groq tool calling flakiness | Zod validation + one automatic retry with error fed back to model |
| Large diffs blowing context | 50KB cap, skip generated files, sample highest-churn files |
| Public tool quota abuse | Per-IP rate limiting (10 req/hr, 2 concurrent) |
| Render cold starts | Honest "waking up" UI state, no keep-alive hacks |
