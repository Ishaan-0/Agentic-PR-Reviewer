
# Frontend Design Spec — AgenticPR Reviewer
**Date:** 2026-07-03

## Overview

A single-page React frontend for the AgenticPR Reviewer. The core experience is watching an AI agent reason through a GitHub PR live — tool calls, reasoning text, and a final structured review. No auth, no persistence, stateless by design.

## Stack

- **React 19** — already scaffolded via Vite
- **Tailwind CSS** — utility-first styling
- **shadcn/ui** — component library built on Radix UI, fully Tailwind-styled, components copied into codebase
- **Plain `EventSource`** — native SSE, no extra library needed

## UI States

The app has one screen that transitions through four phases in sequence:

1. **Idle** — centered hero with URL input and submit button
2. **Streaming** — input locks, dark terminal panel appears and streams agent events live
3. **Done** — terminal panel stays visible; structured review fades in below
4. **Error** — terminal panel shows error message; input unlocks for retry

## File Structure

```
frontend/src/
  hooks/
    useReview.ts         ← all SSE logic and state machine
  components/
    URLInput.tsx         ← PR URL input form
    EventLog.tsx         ← dark terminal panel with streamed events
    ReviewResult.tsx     ← verdict badge + grouped issues display
  App.tsx                ← composes everything, holds top-level state
```

## Component Details

### `useReview.ts`
Custom hook that owns all async logic.

**State shape:**
```ts
{
  phase: "idle" | "streaming" | "done" | "error",
  events: SSEEvent[],
  result?: ReviewResult,
  error?: string
}
```

**Behavior:**
- `startReview(prUrl)` → POST `/api/review` → get `reviewId`
- Open `EventSource` on `/api/review/:id/stream`
- Append each SSE event to `events` array as it arrives
- On `type: "done"` → store result, transition to `done` phase
- On `type: "error"` → store error message, transition to `error` phase
- `EventSource.onerror` → transition to `error` with "Connection lost" message
- Cleanup closes the EventSource on unmount

### `URLInput.tsx`
Centered hero section rendered in idle and streaming phases.

- shadcn `Input` + `Button`
- Disabled while `phase === "streaming"`
- Client-side validation: URL must match `github.com/{owner}/{repo}/pull/{number}` — show inline error if invalid, don't hit the backend
- If `POST /api/review` takes >5s with no response, show a banner: *"Waking up the agent — free-tier hosting, ~30s"*. Hide once response arrives.

### `EventLog.tsx`
Dark terminal panel (`bg-zinc-950` text-green-400 or similar). Renders the `events` array.

Two event types render differently:
- **`type: "status"`** — reasoning text appended word-by-word into flowing monospace paragraphs. Feels like watching the agent think.
- **`type: "tool"`** — rendered as a collapsible row using shadcn `Collapsible`:
  - Header: `▶ get_pr_diff { owner, repo, prNumber }` with an amber/yellow accent to visually distinguish tool calls from reasoning text
  - Body (expanded): full JSON input, formatted

### `ReviewResult.tsx`
Light card area that fades in when `phase === "done"`.

- **Verdict badge** at the top: `approve` → green, `request_changes` → red, `comment` → blue
- **Summary paragraph** below the badge
- **Issues grouped by severity**: HIGH → MEDIUM → LOW sections, only rendered if that severity has issues
- Each issue: shadcn `Card` with file path in monospace, optional line number, comment text
- If `issues` is empty: show *"No issues found."* — no broken empty sections

## Data Flow

```
User submits URL
  → POST /api/review
  → { reviewId, cached: boolean }
  → EventSource /api/review/:id/stream
  → SSE events stream in
      type: "status"  → append to EventLog as text
      type: "tool"    → append to EventLog as collapsible row
      type: "done"    → store result, render ReviewResult
      type: "error"   → show error in EventLog, unlock input
```

**Cached reviews** (`cached: true`): SSE stream replays all stored events instantly — no special UI needed, it just plays back fast.

## Error Handling

| Scenario | Behavior |
|---|---|
| Cold backend start (>5s POST) | Show "Waking up the agent" banner under input |
| `type: "error"` SSE event | Error state in terminal panel, input unlocks |
| Network drop mid-stream | `EventSource.onerror` → "Connection lost — try again" |
| Invalid PR URL | Inline input validation error, no backend call |
| Empty issues array | Show "No issues found." in review section |

## Visual Design

- **Theme:** Light page background, dark terminal panel — high contrast between streaming and result phases
- **Terminal panel:** `bg-zinc-950`, monospace font, status text in muted green, tool call rows in amber
- **Review section:** Clean white/light cards, bold severity labels with semantic colors
- **No dark mode toggle** for v1 — YAGNI
