# Agentic PR Reviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a monorepo web app where users paste a public GitHub PR URL and watch an AI agent stream its reasoning live while producing a structured code review.

**Architecture:** Express backend runs a Vercel AI SDK agent loop (Groq/Llama) that calls GitHub tools, emitting SSE events per tool call. React/Vite frontend connects via SSE after POSTing the PR URL, rendering events live and the final review on completion.

**Tech Stack:** Node.js + Express + TypeScript, Vercel AI SDK (`ai` + `@ai-sdk/groq`), Octokit, Zod, Vitest (backend + frontend), React 18 + Vite, `@testing-library/react`, `express-rate-limit`, `supertest`

## Global Constraints

- TypeScript strict mode across both backend and frontend
- All tests use Vitest; no Jest
- `tsx` for backend dev (no compile step); `tsc && vite build` for frontend prod
- Agent loop in `backend/src/agent/loop.ts` is the only file that imports `ai` or `@ai-sdk/groq`
- `github.ts` is the only file that imports `@octokit/rest`
- No shared npm workspace — duplicate the SSEEvent and ReviewResult types in frontend
- Groq model: `llama-3.3-70b-versatile`
- Max tool calls per review: 15 (`maxSteps: 15`)
- Max full file fetches: 5
- Diff cap: 50 KB after filtering generated files
- Per-IP rate limit: 10 req/hr, max 2 concurrent

---

## File Map

```
backend/src/
  types.ts                  — SSEEvent, ReviewResult, PrDetails, FileChange, PrDiff, PrComment
  github.ts                 — Octokit wrapper: getPrDiff, getFileContent, listExistingComments
  agent/
    prompt.ts               — SYSTEM_PROMPT string
    tools.ts                — Vercel AI SDK tool definitions + preprocessDiff
    loop.ts                 — runAgentLoop(prDetails, onEvent): Promise<ReviewResult>
  cache.ts                  — In-memory Map: createReview, addEvent, completeReview, failReview, getReview
  rateLimit.ts              — hourlyLimit middleware + concurrentLimit middleware factory
  routes/review.ts          — POST /api/review + GET /api/review/:id/stream
  index.ts                  — Express app wiring + server start
  __tests__/
    github.test.ts
    tools.test.ts
    loop.test.ts
    cache.test.ts
    rateLimit.test.ts
    review.routes.test.ts

frontend/src/
  types.ts                  — SSEEvent, ReviewResult (duplicated from backend)
  hooks/useReview.ts        — SSE connection, state machine, event accumulation
  components/EventLog.tsx   — Renders accumulated SSEEvent[]
  components/ReviewResult.tsx — Renders ReviewResult
  App.tsx                   — URL input, state routing, wires hook + components
  __tests__/
    useReview.test.ts
    EventLog.test.tsx
    ReviewResult.test.tsx
    App.test.tsx
```

---

## Task 1: Monorepo Scaffolding + Shared Types

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/.env.example`
- Create: `backend/src/types.ts`
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `.gitignore` (update)

- [ ] **Step 1: Create backend package.json**

```json
{
  "name": "pr-reviewer-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/groq": "^1.0.0",
    "@octokit/rest": "^21.0.0",
    "cors": "^2.8.5",
    "express": "^4.21.0",
    "express-rate-limit": "^7.4.0",
    "uuid": "^10.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.0.0",
    "@types/supertest": "^6.0.2",
    "@types/uuid": "^10.0.0",
    "supertest": "^7.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create backend/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create backend/.env.example**

```
GROQ_API_KEY=your_groq_api_key_here
GITHUB_TOKEN=your_github_pat_here
PORT=3000
FRONTEND_URL=http://localhost:5173
```

- [ ] **Step 4: Create backend/src/types.ts**

```typescript
import { z } from 'zod'

export const ReviewResultSchema = z.object({
  summary: z.string(),
  issues: z.array(z.object({
    file: z.string(),
    line: z.number().optional(),
    severity: z.enum(['high', 'medium', 'low']),
    comment: z.string(),
  })),
  verdict: z.enum(['approve', 'request_changes', 'comment']),
})

export type ReviewResult = z.infer<typeof ReviewResultSchema>

export interface PrDetails {
  owner: string
  repo: string
  prNumber: number
}

export interface FileChange {
  filename: string
  status: 'added' | 'modified' | 'removed' | 'renamed'
  additions: number
  deletions: number
  patch?: string
}

export interface PrDiff {
  files: FileChange[]
  totalAdditions: number
  totalDeletions: number
  truncated: boolean
}

export interface PrComment {
  path: string
  body: string
  line?: number
}

export type SSEEvent =
  | { type: 'status'; message: string }
  | { type: 'tool'; tool: string; input: unknown }
  | { type: 'finding'; severity: 'high' | 'medium' | 'low'; message: string }
  | { type: 'done'; result: ReviewResult }
  | { type: 'error'; message: string }
```

- [ ] **Step 5: Install backend dependencies**

```bash
cd backend && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Create frontend via Vite**

```bash
cd .. && npm create vite@latest frontend -- --template react-ts
```

When prompted: select React, TypeScript.

- [ ] **Step 7: Install frontend dependencies**

```bash
cd frontend && npm install && npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 8: Update frontend/vite.config.ts to add Vitest config**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
})
```

- [ ] **Step 9: Create frontend/src/test-setup.ts**

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 10: Create frontend/src/types.ts**

```typescript
import type { ReviewResult, SSEEvent } from './types'

export type { ReviewResult, SSEEvent }

export interface ReviewResult {
  summary: string
  issues: Array<{
    file: string
    line?: number
    severity: 'high' | 'medium' | 'low'
    comment: string
  }>
  verdict: 'approve' | 'request_changes' | 'comment'
}

export type SSEEvent =
  | { type: 'status'; message: string }
  | { type: 'tool'; tool: string; input: unknown }
  | { type: 'finding'; severity: 'high' | 'medium' | 'low'; message: string }
  | { type: 'done'; result: ReviewResult }
  | { type: 'error'; message: string }
```

Replace the broken re-export above with a standalone definition (no import from self):

```typescript
// frontend/src/types.ts
export interface ReviewResult {
  summary: string
  issues: Array<{
    file: string
    line?: number
    severity: 'high' | 'medium' | 'low'
    comment: string
  }>
  verdict: 'approve' | 'request_changes' | 'comment'
}

export type SSEEvent =
  | { type: 'status'; message: string }
  | { type: 'tool'; tool: string; input: unknown }
  | { type: 'finding'; severity: 'high' | 'medium' | 'low'; message: string }
  | { type: 'done'; result: ReviewResult }
  | { type: 'error'; message: string }
```

- [ ] **Step 11: Verify TypeScript compiles in backend**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 12: Commit**

```bash
cd .. && git add backend/ frontend/ && git commit -m "feat: scaffold monorepo — backend (Express/TS) + frontend (React/Vite/TS)"
```

---

## Task 2: GitHub API Wrapper

**Files:**
- Create: `backend/src/github.ts`
- Create: `backend/src/__tests__/github.test.ts`

**Interfaces produced:**
- `getPrDiff(owner: string, repo: string, prNumber: number): Promise<PrDiff>`
- `getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string>`
- `listExistingComments(owner: string, repo: string, prNumber: number): Promise<PrComment[]>`

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/__tests__/github.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockListFiles = vi.fn()
const mockGetContent = vi.fn()
const mockListReviewComments = vi.fn()

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      pulls: {
        listFiles: mockListFiles,
        listReviewComments: mockListReviewComments,
      },
      repos: {
        getContent: mockGetContent,
      },
    },
  })),
}))

// Import after mock is set up
const { getPrDiff, getFileContent, listExistingComments } = await import('../github.js')

describe('getPrDiff', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns parsed diff with file changes', async () => {
    mockListFiles.mockResolvedValue({
      data: [
        { filename: 'src/auth.ts', status: 'modified', additions: 10, deletions: 3, patch: '@@ -1,3 +1,10 @@' },
      ],
    })

    const result = await getPrDiff('owner', 'repo', 42)

    expect(result.files).toHaveLength(1)
    expect(result.files[0].filename).toBe('src/auth.ts')
    expect(result.totalAdditions).toBe(10)
    expect(result.totalDeletions).toBe(3)
    expect(result.truncated).toBe(false)
  })

  it('omits patch for binary files (no patch field)', async () => {
    mockListFiles.mockResolvedValue({
      data: [{ filename: 'image.png', status: 'added', additions: 0, deletions: 0 }],
    })

    const result = await getPrDiff('owner', 'repo', 1)
    expect(result.files[0].patch).toBeUndefined()
  })
})

describe('getFileContent', () => {
  it('returns decoded file content', async () => {
    const content = 'export const foo = 1'
    mockGetContent.mockResolvedValue({
      data: { type: 'file', content: Buffer.from(content).toString('base64'), encoding: 'base64' },
    })

    const result = await getFileContent('owner', 'repo', 'src/foo.ts', 'main')
    expect(result).toBe(content)
  })

  it('throws if response is not a file', async () => {
    mockGetContent.mockResolvedValue({ data: { type: 'dir' } })
    await expect(getFileContent('owner', 'repo', 'src/', 'main')).rejects.toThrow('not a file')
  })
})

describe('listExistingComments', () => {
  it('returns comment list with path and body', async () => {
    mockListReviewComments.mockResolvedValue({
      data: [{ path: 'src/auth.ts', body: 'Looks good', line: 5 }],
    })

    const result = await listExistingComments('owner', 'repo', 1)
    expect(result[0]).toEqual({ path: 'src/auth.ts', body: 'Looks good', line: 5 })
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && npx vitest run src/__tests__/github.test.ts
```

Expected: FAIL — `../github.js` not found.

- [ ] **Step 3: Implement backend/src/github.ts**

```typescript
import { Octokit } from '@octokit/rest'
import type { PrDiff, PrComment, FileChange } from './types.js'

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

export async function getPrDiff(owner: string, repo: string, prNumber: number): Promise<PrDiff> {
  const { data } = await octokit.rest.pulls.listFiles({ owner, repo, pull_number: prNumber })

  const files: FileChange[] = data.map((f) => ({
    filename: f.filename,
    status: f.status as FileChange['status'],
    additions: f.additions,
    deletions: f.deletions,
    ...(f.patch !== undefined ? { patch: f.patch } : {}),
  }))

  return {
    files,
    totalAdditions: files.reduce((s, f) => s + f.additions, 0),
    totalDeletions: files.reduce((s, f) => s + f.deletions, 0),
    truncated: false,
  }
}

export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string> {
  const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref })

  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`${path} is not a file`)
  }

  return Buffer.from(data.content, 'base64').toString('utf-8')
}

export async function listExistingComments(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PrComment[]> {
  const { data } = await octokit.rest.pulls.listReviewComments({
    owner,
    repo,
    pull_number: prNumber,
  })

  return data.map((c) => ({
    path: c.path,
    body: c.body,
    ...(c.line !== undefined ? { line: c.line } : {}),
  }))
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd backend && npx vitest run src/__tests__/github.test.ts
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/github.ts backend/src/__tests__/github.test.ts
git commit -m "feat: add GitHub API wrapper (getPrDiff, getFileContent, listExistingComments)"
```

---

## Task 3: Agent Tools + Diff Preprocessing + System Prompt

**Files:**
- Create: `backend/src/agent/prompt.ts`
- Create: `backend/src/agent/tools.ts`
- Create: `backend/src/__tests__/tools.test.ts`

**Interfaces produced:**
- `preprocessDiff(diff: PrDiff): PrDiff`
- `buildTools(owner: string, repo: string, prNumber: number, onEvent: (e: SSEEvent) => void): Record<string, Tool>`
- `SYSTEM_PROMPT: string`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/src/__tests__/tools.test.ts
import { describe, it, expect, vi } from 'vitest'
import { preprocessDiff } from '../agent/tools.js'
import type { PrDiff } from '../types.js'

describe('preprocessDiff', () => {
  it('filters out generated files', () => {
    const diff: PrDiff = {
      files: [
        { filename: 'package-lock.json', status: 'modified', additions: 500, deletions: 200 },
        { filename: 'src/auth.ts', status: 'modified', additions: 10, deletions: 3 },
        { filename: 'dist/bundle.min.js', status: 'modified', additions: 100, deletions: 0 },
      ],
      totalAdditions: 610,
      totalDeletions: 203,
      truncated: false,
    }

    const result = preprocessDiff(diff)
    expect(result.files.map((f) => f.filename)).toEqual(['src/auth.ts'])
  })

  it('caps total patch size at 50KB, keeping highest-churn files', () => {
    const bigPatch = 'x'.repeat(30 * 1024) // 30KB
    const diff: PrDiff = {
      files: [
        { filename: 'src/a.ts', status: 'modified', additions: 5, deletions: 1, patch: bigPatch },
        { filename: 'src/b.ts', status: 'modified', additions: 500, deletions: 200, patch: bigPatch },
      ],
      totalAdditions: 505,
      totalDeletions: 201,
      truncated: false,
    }

    const result = preprocessDiff(diff)
    // b.ts has more churn (700 changes vs 6), should be kept first; together they exceed 50KB
    expect(result.files[0].filename).toBe('src/b.ts')
    expect(result.truncated).toBe(true)
  })

  it('sets truncated: false when under cap', () => {
    const diff: PrDiff = {
      files: [
        { filename: 'src/a.ts', status: 'modified', additions: 5, deletions: 1, patch: 'small patch' },
      ],
      totalAdditions: 5,
      totalDeletions: 1,
      truncated: false,
    }

    const result = preprocessDiff(diff)
    expect(result.truncated).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && npx vitest run src/__tests__/tools.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create backend/src/agent/prompt.ts**

```typescript
export const SYSTEM_PROMPT = `You are a senior software engineer reviewing a GitHub pull request.

You have three tools:
- get_pr_diff: Fetches the list of changed files and their diffs. ALWAYS call this first.
- get_file_content: Fetches the full content of a specific file. Use when the diff lacks context (e.g. a function is called but defined elsewhere).
- list_existing_comments: Fetches comments already left by human reviewers. Call this to avoid repeating feedback.

## Process
1. Call get_pr_diff first to understand what changed.
2. For each changed file, reason explicitly: "I need the full file because [reason]" or "The diff is sufficient because [reason]".
3. Fetch full file content only when genuinely needed — maximum 5 files.
4. Call list_existing_comments to check what has already been flagged.
5. When you have enough context, output your review as JSON.

## Skip these files
Ignore: package-lock.json, yarn.lock, pnpm-lock.yaml, *.min.js, *.min.css, dist/, vendor/, node_modules/, build/, *.generated.*

## Output
Output ONLY valid JSON — no text before or after. Schema:
{
  "summary": "2-3 sentences: what the PR does and your overall assessment",
  "issues": [
    {
      "file": "relative/file/path.ts",
      "line": 42,
      "severity": "high" | "medium" | "low",
      "comment": "Specific, actionable feedback"
    }
  ],
  "verdict": "approve" | "request_changes" | "comment"
}
If there are no issues, return an empty issues array and verdict "approve".`
```

- [ ] **Step 4: Create backend/src/agent/tools.ts**

```typescript
import { tool } from 'ai'
import { z } from 'zod'
import { getPrDiff, getFileContent, listExistingComments } from '../github.js'
import type { PrDiff, SSEEvent } from '../types.js'

const GENERATED_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.min\.js$/,
  /\.min\.css$/,
  /^dist\//,
  /^vendor\//,
  /^node_modules\//,
  /^build\//,
  /\.generated\./,
]

const MAX_DIFF_BYTES = 50 * 1024

export function preprocessDiff(diff: PrDiff): PrDiff {
  const filtered = diff.files.filter(
    (f) => !GENERATED_PATTERNS.some((p) => p.test(f.filename))
  )

  const sorted = [...filtered].sort(
    (a, b) => b.additions + b.deletions - (a.additions + a.deletions)
  )

  let totalBytes = 0
  const capped = []
  for (const file of sorted) {
    const bytes = Buffer.byteLength(file.patch ?? '', 'utf8')
    if (totalBytes + bytes > MAX_DIFF_BYTES && capped.length > 0) {
      return {
        files: capped,
        totalAdditions: capped.reduce((s, f) => s + f.additions, 0),
        totalDeletions: capped.reduce((s, f) => s + f.deletions, 0),
        truncated: true,
      }
    }
    capped.push(file)
    totalBytes += bytes
  }

  return {
    files: capped,
    totalAdditions: capped.reduce((s, f) => s + f.additions, 0),
    totalDeletions: capped.reduce((s, f) => s + f.deletions, 0),
    truncated: false,
  }
}

export function buildTools(
  owner: string,
  repo: string,
  prNumber: number,
  onEvent: (e: SSEEvent) => void
) {
  let fileFetchCount = 0

  return {
    get_pr_diff: tool({
      description: 'Get the list of changed files and their diffs for the PR.',
      parameters: z.object({}),
      execute: async () => {
        onEvent({ type: 'status', message: 'Reading diff...' })
        const raw = await getPrDiff(owner, repo, prNumber)
        const diff = preprocessDiff(raw)
        if (diff.truncated) {
          onEvent({ type: 'status', message: 'Large PR detected — focusing on highest-churn files.' })
        }
        return diff
      },
    }),

    get_file_content: tool({
      description: 'Fetch the full content of a file. Use sparingly — maximum 5 calls per review.',
      parameters: z.object({
        path: z.string().describe('Relative file path'),
        ref: z.string().describe('Git ref (branch name or commit SHA)'),
      }),
      execute: async ({ path, ref }) => {
        if (fileFetchCount >= 5) {
          return { error: 'File fetch limit reached (5 files max per review).' }
        }
        fileFetchCount++
        onEvent({ type: 'tool', tool: 'get_file_content', input: { path, ref } })
        onEvent({ type: 'status', message: `Pulling context for ${path}...` })
        const content = await getFileContent(owner, repo, path, ref)
        return { path, content }
      },
    }),

    list_existing_comments: tool({
      description: 'Get existing review comments on the PR to avoid repeating feedback.',
      parameters: z.object({}),
      execute: async () => {
        onEvent({ type: 'status', message: 'Checking existing review comments...' })
        return listExistingComments(owner, repo, prNumber)
      },
    }),
  }
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd backend && npx vitest run src/__tests__/tools.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/agent/ backend/src/__tests__/tools.test.ts
git commit -m "feat: add agent tools, diff preprocessing, and system prompt"
```

---

## Task 4: Agent Loop

**Files:**
- Create: `backend/src/agent/loop.ts`
- Create: `backend/src/__tests__/loop.test.ts`

**Interfaces produced:**
- `runAgentLoop(prDetails: PrDetails, onEvent: (e: SSEEvent) => void): Promise<ReviewResult>`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/src/__tests__/loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()

vi.mock('ai', () => ({ generateText: mockGenerateText }))
vi.mock('@ai-sdk/groq', () => ({ createGroq: vi.fn(() => vi.fn()) }))
vi.mock('../agent/tools.js', () => ({
  buildTools: vi.fn(() => ({})),
}))

const { runAgentLoop } = await import('../agent/loop.js')

const validResult = {
  summary: 'Adds OAuth login flow.',
  issues: [{ file: 'src/auth.ts', line: 42, severity: 'high', comment: 'Token in localStorage.' }],
  verdict: 'request_changes',
}

describe('runAgentLoop', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits status event and returns ReviewResult on success', async () => {
    mockGenerateText.mockResolvedValue({ text: JSON.stringify(validResult) })

    const events: unknown[] = []
    const result = await runAgentLoop(
      { owner: 'acme', repo: 'api', prNumber: 1 },
      (e) => events.push(e)
    )

    expect(result.verdict).toBe('request_changes')
    expect(result.issues).toHaveLength(1)
    expect(events.some((e: any) => e.type === 'done')).toBe(true)
  })

  it('retries once when LLM output fails Zod validation', async () => {
    mockGenerateText
      .mockResolvedValueOnce({ text: 'not json' })
      .mockResolvedValueOnce({ text: JSON.stringify(validResult) })

    const events: unknown[] = []
    const result = await runAgentLoop({ owner: 'a', repo: 'b', prNumber: 1 }, (e) => events.push(e))

    expect(mockGenerateText).toHaveBeenCalledTimes(2)
    expect(result.verdict).toBe('request_changes')
  })

  it('emits error event when both attempts fail validation', async () => {
    mockGenerateText.mockResolvedValue({ text: 'invalid' })

    const events: unknown[] = []
    await expect(
      runAgentLoop({ owner: 'a', repo: 'b', prNumber: 1 }, (e) => events.push(e))
    ).rejects.toThrow()

    expect(events.some((e: any) => e.type === 'error')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && npx vitest run src/__tests__/loop.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement backend/src/agent/loop.ts**

```typescript
import { generateText } from 'ai'
import { createGroq } from '@ai-sdk/groq'
import { SYSTEM_PROMPT } from './prompt.js'
import { buildTools } from './tools.js'
import { ReviewResultSchema } from '../types.js'
import type { PrDetails, ReviewResult, SSEEvent } from '../types.js'

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY })

export async function runAgentLoop(
  prDetails: PrDetails,
  onEvent: (event: SSEEvent) => void
): Promise<ReviewResult> {
  const { owner, repo, prNumber } = prDetails
  const tools = buildTools(owner, repo, prNumber, onEvent)

  onEvent({ type: 'status', message: 'Agent starting review...' })

  async function attempt(extraMessages: Array<{ role: 'user'; content: string }> = []) {
    const { text } = await generateText({
      model: groq('llama-3.3-70b-versatile'),
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Review this pull request: ${owner}/${repo}#${prNumber}`,
        },
        ...extraMessages,
      ],
      tools,
      maxSteps: 15,
      onStepFinish: ({ toolCalls }) => {
        for (const call of toolCalls) {
          onEvent({ type: 'tool', tool: call.toolName, input: call.args })
        }
      },
    })
    return text
  }

  function parse(text: string): ReviewResult | null {
    try {
      const parsed = ReviewResultSchema.safeParse(JSON.parse(text))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  const firstText = await attempt()
  const firstResult = parse(firstText)
  if (firstResult) {
    onEvent({ type: 'done', result: firstResult })
    return firstResult
  }

  // One retry with validation error fed back
  onEvent({ type: 'status', message: 'Retrying — fixing output format...' })
  const secondText = await attempt([
    {
      role: 'user',
      content: `Your previous response was not valid JSON matching the required schema. Raw output: "${firstText}". Please try again and output only valid JSON.`,
    },
  ])
  const secondResult = parse(secondText)
  if (secondResult) {
    onEvent({ type: 'done', result: secondResult })
    return secondResult
  }

  const err = new Error('Agent failed to produce valid output after 2 attempts')
  onEvent({ type: 'error', message: err.message })
  throw err
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd backend && npx vitest run src/__tests__/loop.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agent/loop.ts backend/src/__tests__/loop.test.ts
git commit -m "feat: add agent loop with Zod validation and retry logic"
```

---

## Task 5: Cache

**Files:**
- Create: `backend/src/cache.ts`
- Create: `backend/src/__tests__/cache.test.ts`

**Interfaces produced:**
- `createReview(reviewId: string): void`
- `addEvent(reviewId: string, event: SSEEvent): void`
- `completeReview(reviewId: string, result: ReviewResult): void`
- `failReview(reviewId: string, error: string): void`
- `getReview(reviewId: string): CacheEntry | undefined`
- `getCachedResult(prUrl: string): ReviewResult | undefined`
- `setCachedResult(prUrl: string, result: ReviewResult): void`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/src/__tests__/cache.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createReview,
  addEvent,
  completeReview,
  failReview,
  getReview,
  getCachedResult,
  setCachedResult,
  clearAll,
} from '../cache.js'

describe('cache', () => {
  beforeEach(() => clearAll())

  it('createReview initializes a pending entry', () => {
    createReview('abc')
    const entry = getReview('abc')
    expect(entry?.status).toBe('pending')
    expect(entry?.events).toEqual([])
  })

  it('addEvent appends to events and emits on emitter', () => {
    createReview('abc')
    const received: unknown[] = []
    getReview('abc')!.emitter.on('event', (e) => received.push(e))

    addEvent('abc', { type: 'status', message: 'Reading diff...' })
    expect(getReview('abc')!.events).toHaveLength(1)
    expect(received).toHaveLength(1)
  })

  it('completeReview sets status and result', () => {
    createReview('abc')
    const result = { summary: 'ok', issues: [], verdict: 'approve' as const }
    completeReview('abc', result)
    const entry = getReview('abc')
    expect(entry?.status).toBe('complete')
    expect(entry?.result).toEqual(result)
  })

  it('failReview sets status to error', () => {
    createReview('abc')
    failReview('abc', 'something went wrong')
    expect(getReview('abc')?.status).toBe('error')
  })

  it('getCachedResult returns undefined for unknown PR URL', () => {
    expect(getCachedResult('https://github.com/a/b/pull/1')).toBeUndefined()
  })

  it('setCachedResult and getCachedResult round-trip', () => {
    const result = { summary: 'ok', issues: [], verdict: 'approve' as const }
    setCachedResult('https://github.com/a/b/pull/1', result)
    expect(getCachedResult('https://github.com/a/b/pull/1')).toEqual(result)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && npx vitest run src/__tests__/cache.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement backend/src/cache.ts**

```typescript
import { EventEmitter } from 'events'
import type { SSEEvent, ReviewResult } from './types.js'

export interface CacheEntry {
  status: 'pending' | 'complete' | 'error'
  events: SSEEvent[]
  emitter: EventEmitter
  result?: ReviewResult
  error?: string
}

const reviews = new Map<string, CacheEntry>()
const resultCache = new Map<string, ReviewResult>()

export function createReview(reviewId: string): void {
  reviews.set(reviewId, {
    status: 'pending',
    events: [],
    emitter: new EventEmitter(),
  })
}

export function addEvent(reviewId: string, event: SSEEvent): void {
  const entry = reviews.get(reviewId)
  if (!entry) return
  entry.events.push(event)
  entry.emitter.emit('event', event)
}

export function completeReview(reviewId: string, result: ReviewResult): void {
  const entry = reviews.get(reviewId)
  if (!entry) return
  entry.status = 'complete'
  entry.result = result
  entry.emitter.emit('done', result)
}

export function failReview(reviewId: string, error: string): void {
  const entry = reviews.get(reviewId)
  if (!entry) return
  entry.status = 'error'
  entry.error = error
  entry.emitter.emit('error', error)
}

export function getReview(reviewId: string): CacheEntry | undefined {
  return reviews.get(reviewId)
}

export function getCachedResult(prUrl: string): ReviewResult | undefined {
  return resultCache.get(prUrl)
}

export function setCachedResult(prUrl: string, result: ReviewResult): void {
  resultCache.set(prUrl, result)
}

// Test helper only
export function clearAll(): void {
  reviews.clear()
  resultCache.clear()
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd backend && npx vitest run src/__tests__/cache.test.ts
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/cache.ts backend/src/__tests__/cache.test.ts
git commit -m "feat: add in-memory cache with EventEmitter per review"
```

---

## Task 6: Rate Limiting

**Files:**
- Create: `backend/src/rateLimit.ts`
- Create: `backend/src/__tests__/rateLimit.test.ts`

**Interfaces produced:**
- `hourlyLimit`: Express middleware (10 req/hr per IP)
- `concurrentLimit(max: number)`: Express middleware factory (2 concurrent per IP)

- [ ] **Step 1: Write failing tests**

```typescript
// backend/src/__tests__/rateLimit.test.ts
import { describe, it, expect, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { concurrentLimit } from '../rateLimit.js'

function mockReq(ip: string) {
  return { ip } as unknown as Request
}

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    on: vi.fn(),
  }
  return res as unknown as Response
}

describe('concurrentLimit', () => {
  it('allows requests under the limit', () => {
    const limit = concurrentLimit(2)
    const next = vi.fn()
    limit(mockReq('1.2.3.4'), mockRes(), next)
    expect(next).toHaveBeenCalled()
  })

  it('blocks requests over the limit', () => {
    const limit = concurrentLimit(1)
    const next = vi.fn()
    const res1 = mockRes()
    const res2 = mockRes()

    limit(mockReq('1.2.3.4'), res1, next)
    limit(mockReq('1.2.3.4'), res2, vi.fn())

    expect(res2.status).toHaveBeenCalledWith(429)
    expect(res2.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('concurrent') })
    )
  })

  it('allows new requests after previous one finishes', () => {
    const limit = concurrentLimit(1)
    const next = vi.fn()
    const res1 = mockRes()

    limit(mockReq('5.5.5.5'), res1, next)

    // Simulate response finish
    const finishCallback = (res1.on as ReturnType<typeof vi.fn>).mock.calls.find(
      ([event]: [string]) => event === 'finish'
    )?.[1] as () => void
    finishCallback()

    const res2 = mockRes()
    limit(mockReq('5.5.5.5'), res2, vi.fn())
    expect(res2.status).not.toHaveBeenCalledWith(429)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && npx vitest run src/__tests__/rateLimit.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement backend/src/rateLimit.ts**

```typescript
import rateLimit from 'express-rate-limit'
import type { Request, Response, NextFunction } from 'express'

export const hourlyLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? 'unknown',
  message: { error: 'You have hit the rate limit. Try again in 1 hour.' },
})

const concurrentMap = new Map<string, number>()

export function concurrentLimit(max: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? 'unknown'
    const current = concurrentMap.get(ip) ?? 0

    if (current >= max) {
      res.status(429).json({
        error: `Too many concurrent reviews. Wait for one to complete.`,
      })
      return
    }

    concurrentMap.set(ip, current + 1)

    res.on('finish', () => {
      const updated = (concurrentMap.get(ip) ?? 1) - 1
      if (updated <= 0) concurrentMap.delete(ip)
      else concurrentMap.set(ip, updated)
    })

    next()
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd backend && npx vitest run src/__tests__/rateLimit.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/rateLimit.ts backend/src/__tests__/rateLimit.test.ts
git commit -m "feat: add per-IP rate limiting (hourly + concurrent)"
```

---

## Task 7: Express Routes + Server

**Files:**
- Create: `backend/src/routes/review.ts`
- Create: `backend/src/index.ts`
- Create: `backend/src/__tests__/review.routes.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/src/__tests__/review.routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

vi.mock('../cache.js', () => ({
  createReview: vi.fn(),
  addEvent: vi.fn(),
  completeReview: vi.fn(),
  failReview: vi.fn(),
  getReview: vi.fn(),
  getCachedResult: vi.fn().mockReturnValue(undefined),
  setCachedResult: vi.fn(),
}))

vi.mock('../agent/loop.js', () => ({
  runAgentLoop: vi.fn().mockResolvedValue({
    summary: 'ok',
    issues: [],
    verdict: 'approve',
  }),
}))

vi.mock('../rateLimit.js', () => ({
  hourlyLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  concurrentLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

const { app } = await import('../index.js')

describe('POST /api/review', () => {
  it('returns 400 for invalid PR URL', async () => {
    const res = await request(app).post('/api/review').send({ prUrl: 'not-a-url' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid/i)
  })

  it('returns reviewId for valid PR URL', async () => {
    const res = await request(app)
      .post('/api/review')
      .send({ prUrl: 'https://github.com/vercel/next.js/pull/1' })
    expect(res.status).toBe(200)
    expect(res.body.reviewId).toBeDefined()
    expect(typeof res.body.reviewId).toBe('string')
  })

  it('returns cached: true when result is already cached', async () => {
    const { getCachedResult } = await import('../cache.js')
    vi.mocked(getCachedResult).mockReturnValueOnce({
      summary: 'cached',
      issues: [],
      verdict: 'approve',
    })

    const res = await request(app)
      .post('/api/review')
      .send({ prUrl: 'https://github.com/vercel/next.js/pull/1' })
    expect(res.body.cached).toBe(true)
  })
})

describe('GET /api/review/:id/stream', () => {
  it('returns 404 for unknown reviewId', async () => {
    const { getReview } = await import('../cache.js')
    vi.mocked(getReview).mockReturnValue(undefined)

    const res = await request(app).get('/api/review/unknown-id/stream')
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && npx vitest run src/__tests__/review.routes.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create backend/src/routes/review.ts**

```typescript
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import {
  createReview,
  addEvent,
  completeReview,
  failReview,
  getReview,
  getCachedResult,
  setCachedResult,
} from '../cache.js'
import { runAgentLoop } from '../agent/loop.js'
import type { SSEEvent } from '../types.js'

export const reviewRouter = Router()

function parsePrUrl(url: string) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) }
}

reviewRouter.post('/', async (req, res) => {
  const { prUrl } = req.body as { prUrl?: string }

  if (!prUrl) {
    res.status(400).json({ error: 'prUrl is required' })
    return
  }

  const prDetails = parsePrUrl(prUrl)
  if (!prDetails) {
    res.status(400).json({ error: 'Invalid GitHub PR URL' })
    return
  }

  const cached = getCachedResult(prUrl)
  if (cached) {
    res.json({ reviewId: null, cached: true, result: cached })
    return
  }

  const reviewId = uuidv4()
  createReview(reviewId)

  // Fire and forget
  ;(async () => {
    try {
      const onEvent = (event: SSEEvent) => addEvent(reviewId, event)
      const result = await runAgentLoop(prDetails, onEvent)
      completeReview(reviewId, result)
      setCachedResult(prUrl, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      failReview(reviewId, message)
    }
  })()

  res.json({ reviewId, cached: false })
})

reviewRouter.get('/:id/stream', (req, res) => {
  const { id } = req.params
  const entry = getReview(id)

  if (!entry) {
    res.status(404).json({ error: 'Review not found' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  function send(event: SSEEvent) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  // Replay accumulated events
  for (const event of entry.events) {
    send(event)
  }

  if (entry.status === 'complete' && entry.result) {
    send({ type: 'done', result: entry.result })
    res.end()
    return
  }

  if (entry.status === 'error') {
    send({ type: 'error', message: entry.error ?? 'Unknown error' })
    res.end()
    return
  }

  // Live stream
  const onEvent = (event: SSEEvent) => send(event)
  const onDone = (result: unknown) => {
    send({ type: 'done', result: result as never })
    res.end()
  }
  const onError = (message: string) => {
    send({ type: 'error', message })
    res.end()
  }

  entry.emitter.on('event', onEvent)
  entry.emitter.once('done', onDone)
  entry.emitter.once('error', onError)

  req.on('close', () => {
    entry.emitter.off('event', onEvent)
    entry.emitter.off('done', onDone)
    entry.emitter.off('error', onError)
  })
})
```

- [ ] **Step 4: Create backend/src/index.ts**

```typescript
import express from 'express'
import cors from 'cors'
import { reviewRouter } from './routes/review.js'
import { hourlyLimit, concurrentLimit } from './rateLimit.js'

export const app = express()

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }))
app.use(express.json())

app.use('/api/review', hourlyLimit, concurrentLimit(2), reviewRouter)

app.get('/health', (_req, res) => res.json({ ok: true }))

const PORT = process.env.PORT ?? 3000

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd backend && npx vitest run src/__tests__/review.routes.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 6: Smoke test the server manually**

```bash
cd backend && cp .env.example .env
# Fill in GROQ_API_KEY and GITHUB_TOKEN in .env, then:
npm run dev
```

In another terminal:
```bash
curl -X POST http://localhost:3000/api/review \
  -H "Content-Type: application/json" \
  -d '{"prUrl":"https://github.com/vercel/next.js/pull/1"}'
```

Expected: `{"reviewId":"<uuid>","cached":false}`

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/ backend/src/index.ts backend/src/__tests__/review.routes.test.ts
git commit -m "feat: add Express routes (POST /api/review, GET /api/review/:id/stream) and server entry"
```

---

## Task 8: useReview Hook

**Files:**
- Create: `frontend/src/hooks/useReview.ts`
- Create: `frontend/src/__tests__/useReview.test.ts`

**Interfaces produced:**
- `useReview(): { submit, status, events, result, error }`
  - `submit(prUrl: string): void`
  - `status: 'idle' | 'loading' | 'streaming' | 'complete' | 'error'`
  - `events: SSEEvent[]`
  - `result: ReviewResult | null`
  - `error: string | null`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/__tests__/useReview.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReview } from '../hooks/useReview.js'

const mockFetch = vi.fn()
global.fetch = mockFetch

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {}
  readyState = 1

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(fn)
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent
    this.listeners[type]?.forEach((fn) => fn(event))
  }

  close = vi.fn()
}

global.EventSource = MockEventSource as unknown as typeof EventSource

beforeEach(() => {
  MockEventSource.instances = []
  vi.clearAllMocks()
})

describe('useReview', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useReview())
    expect(result.current.status).toBe('idle')
  })

  it('transitions to loading then streaming on submit', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reviewId: 'abc', cached: false }),
    })

    const { result } = renderHook(() => useReview())

    await act(async () => {
      result.current.submit('https://github.com/vercel/next.js/pull/1')
    })

    expect(result.current.status).toBe('streaming')
    expect(MockEventSource.instances).toHaveLength(1)
  })

  it('accumulates events from SSE', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reviewId: 'abc', cached: false }),
    })

    const { result } = renderHook(() => useReview())

    await act(async () => {
      result.current.submit('https://github.com/vercel/next.js/pull/1')
    })

    const es = MockEventSource.instances[0]

    await act(async () => {
      es.emit('message', { type: 'status', message: 'Reading diff...' })
    })

    expect(result.current.events).toHaveLength(1)
    expect(result.current.events[0]).toEqual({ type: 'status', message: 'Reading diff...' })
  })

  it('sets result and status complete on done event', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reviewId: 'abc', cached: false }),
    })

    const { result } = renderHook(() => useReview())

    await act(async () => {
      result.current.submit('https://github.com/vercel/next.js/pull/1')
    })

    const es = MockEventSource.instances[0]
    const donePayload = { type: 'done', result: { summary: 'ok', issues: [], verdict: 'approve' } }

    await act(async () => {
      es.emit('message', donePayload)
    })

    expect(result.current.status).toBe('complete')
    expect(result.current.result?.verdict).toBe('approve')
    expect(es.close).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd frontend && npx vitest run src/__tests__/useReview.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement frontend/src/hooks/useReview.ts**

```typescript
import { useState, useRef, useCallback } from 'react'
import type { SSEEvent, ReviewResult } from '../types.js'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
const COLD_START_THRESHOLD_MS = 3000

type Status = 'idle' | 'loading' | 'streaming' | 'complete' | 'error'

export function useReview() {
  const [status, setStatus] = useState<Status>('idle')
  const [events, setEvents] = useState<SSEEvent[]>([])
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const submit = useCallback(async (prUrl: string) => {
    setStatus('loading')
    setEvents([])
    setResult(null)
    setError(null)

    const coldStartTimer = setTimeout(() => {
      setEvents((prev) => [
        ...prev,
        { type: 'status', message: 'Waking up the agent (~30s)...' },
      ])
    }, COLD_START_THRESHOLD_MS)

    try {
      const res = await fetch(`${API_URL}/api/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl }),
      })
      clearTimeout(coldStartTimer)

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }))
        setError(body.error ?? 'Request failed')
        setStatus('error')
        return
      }

      const { reviewId, cached, result: cachedResult } = await res.json()

      if (cached) {
        setResult(cachedResult)
        setStatus('complete')
        return
      }

      setStatus('streaming')

      const es = new EventSource(`${API_URL}/api/review/${reviewId}/stream`)
      esRef.current = es

      es.addEventListener('message', (e: MessageEvent) => {
        const event: SSEEvent = JSON.parse(e.data)

        if (event.type === 'done') {
          setResult(event.result)
          setStatus('complete')
          es.close()
          return
        }

        if (event.type === 'error') {
          setError(event.message)
          setStatus('error')
          es.close()
          return
        }

        setEvents((prev) => [...prev, event])
      })

      es.onerror = () => {
        // Attempt reconnect once — if already closed, don't retry
        if (es.readyState === EventSource.CLOSED) {
          setError('Connection lost. Please try again.')
          setStatus('error')
        }
      }
    } catch (err) {
      clearTimeout(coldStartTimer)
      setError(err instanceof Error ? err.message : 'Network error')
      setStatus('error')
    }
  }, [])

  return { submit, status, events, result, error }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd frontend && npx vitest run src/__tests__/useReview.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/ frontend/src/__tests__/useReview.test.ts frontend/src/types.ts
git commit -m "feat: add useReview hook with SSE state machine and cold-start detection"
```

---

## Task 9: EventLog Component

**Files:**
- Create: `frontend/src/components/EventLog.tsx`
- Create: `frontend/src/__tests__/EventLog.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/__tests__/EventLog.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EventLog } from '../components/EventLog.js'
import type { SSEEvent } from '../types.js'

describe('EventLog', () => {
  it('renders nothing when events are empty', () => {
    const { container } = render(<EventLog events={[]} streaming={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders status events as plain text', () => {
    const events: SSEEvent[] = [{ type: 'status', message: 'Reading diff...' }]
    render(<EventLog events={events} streaming={false} />)
    expect(screen.getByText('Reading diff...')).toBeInTheDocument()
  })

  it('renders tool events with tool name highlighted', () => {
    const events: SSEEvent[] = [{ type: 'tool', tool: 'get_file_content', input: { path: 'src/auth.ts' } }]
    render(<EventLog events={events} streaming={false} />)
    expect(screen.getByText(/get_file_content/)).toBeInTheDocument()
  })

  it('renders finding events with severity badge', () => {
    const events: SSEEvent[] = [{ type: 'finding', severity: 'high', message: 'XSS vulnerability' }]
    render(<EventLog events={events} streaming={false} />)
    expect(screen.getByText('high')).toBeInTheDocument()
    expect(screen.getByText('XSS vulnerability')).toBeInTheDocument()
  })

  it('shows streaming pulse when streaming is true', () => {
    render(<EventLog events={[]} streaming={true} />)
    expect(screen.getByTestId('streaming-pulse')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd frontend && npx vitest run src/__tests__/EventLog.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement frontend/src/components/EventLog.tsx**

```tsx
import { useEffect, useRef } from 'react'
import type { SSEEvent } from '../types.js'

const SEVERITY_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#3b82f6',
}

interface Props {
  events: SSEEvent[]
  streaming: boolean
}

export function EventLog({ events, streaming }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  if (events.length === 0 && !streaming) return null

  return (
    <div style={{ fontFamily: 'monospace', fontSize: 14, lineHeight: 1.6 }}>
      {events.map((event, i) => {
        if (event.type === 'status') {
          return (
            <div key={i} style={{ color: '#6b7280', padding: '2px 0' }}>
              {event.message}
            </div>
          )
        }

        if (event.type === 'tool') {
          return (
            <div key={i} style={{ color: '#a78bfa', padding: '2px 0' }}>
              <span style={{ fontWeight: 600 }}>{event.tool}</span>
              {typeof event.input === 'object' && event.input !== null && 'path' in event.input
                ? ` → ${(event.input as { path: string }).path}`
                : ''}
            </div>
          )
        }

        if (event.type === 'finding') {
          return (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
              <span
                style={{
                  background: SEVERITY_COLORS[event.severity],
                  color: '#fff',
                  borderRadius: 4,
                  padding: '0 6px',
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  lineHeight: '20px',
                }}
              >
                {event.severity}
              </span>
              <span>{event.message}</span>
            </div>
          )
        }

        return null
      })}

      {streaming && (
        <div
          data-testid="streaming-pulse"
          style={{ display: 'flex', gap: 4, padding: '4px 0' }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#6b7280',
                animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd frontend && npx vitest run src/__tests__/EventLog.test.tsx
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EventLog.tsx frontend/src/__tests__/EventLog.test.tsx
git commit -m "feat: add EventLog component with severity-colored events and streaming pulse"
```

---

## Task 10: ReviewResult Component

**Files:**
- Create: `frontend/src/components/ReviewResult.tsx`
- Create: `frontend/src/__tests__/ReviewResult.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/__tests__/ReviewResult.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewResult } from '../components/ReviewResult.js'
import type { ReviewResult as ReviewResultType } from '../types.js'

const baseResult: ReviewResultType = {
  summary: 'This PR adds OAuth. There are security concerns.',
  issues: [
    { file: 'src/auth.ts', line: 42, severity: 'high', comment: 'Token stored in localStorage.' },
    { file: 'src/routes.ts', severity: 'low', comment: 'Unused import.' },
  ],
  verdict: 'request_changes',
}

describe('ReviewResult', () => {
  it('renders verdict prominently', () => {
    render(<ReviewResult result={baseResult} />)
    expect(screen.getByText(/request_changes/i)).toBeInTheDocument()
  })

  it('renders summary text', () => {
    render(<ReviewResult result={baseResult} />)
    expect(screen.getByText(/OAuth/)).toBeInTheDocument()
  })

  it('renders all issues with severity and file', () => {
    render(<ReviewResult result={baseResult} />)
    expect(screen.getByText('src/auth.ts')).toBeInTheDocument()
    expect(screen.getByText('Token stored in localStorage.')).toBeInTheDocument()
    expect(screen.getAllByText(/high|low/i)).toHaveLength(2)
  })

  it('shows line number when present', () => {
    render(<ReviewResult result={baseResult} />)
    expect(screen.getByText(/:42/)).toBeInTheDocument()
  })

  it('renders approve verdict in green', () => {
    const result = { ...baseResult, verdict: 'approve' as const, issues: [] }
    render(<ReviewResult result={result} />)
    const verdict = screen.getByTestId('verdict')
    expect(verdict).toHaveStyle({ color: '#16a34a' })
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd frontend && npx vitest run src/__tests__/ReviewResult.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement frontend/src/components/ReviewResult.tsx**

```tsx
import type { ReviewResult as ReviewResultType } from '../types.js'

const VERDICT_COLORS: Record<string, string> = {
  approve: '#16a34a',
  request_changes: '#dc2626',
  comment: '#d97706',
}

const SEVERITY_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#3b82f6',
}

interface Props {
  result: ReviewResultType
}

export function ReviewResult({ result }: Props) {
  const verdictColor = VERDICT_COLORS[result.verdict] ?? '#6b7280'

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720 }}>
      <div
        data-testid="verdict"
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: verdictColor,
          marginBottom: 12,
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}
      >
        {result.verdict.replace('_', ' ')}
      </div>

      <p style={{ color: '#374151', marginBottom: 20, lineHeight: 1.6 }}>{result.summary}</p>

      {result.issues.length === 0 ? (
        <p style={{ color: '#6b7280', fontStyle: 'italic' }}>No issues found.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {result.issues.map((issue, i) => (
            <div
              key={i}
              style={{
                borderLeft: `3px solid ${SEVERITY_COLORS[issue.severity]}`,
                paddingLeft: 12,
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <span
                  style={{
                    background: SEVERITY_COLORS[issue.severity],
                    color: '#fff',
                    borderRadius: 4,
                    padding: '0 6px',
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {issue.severity}
                </span>
                <code style={{ fontSize: 13, color: '#4b5563' }}>
                  {issue.file}
                  {issue.line !== undefined ? `:{issue.line}` : ''}
                  {issue.line !== undefined ? `:${issue.line}` : ''}
                </code>
              </div>
              <p style={{ margin: 0, color: '#1f2937', fontSize: 14 }}>{issue.comment}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

Wait — there's a bug in the template literal above. Fix it:

```tsx
<code style={{ fontSize: 13, color: '#4b5563' }}>
  {issue.file}{issue.line !== undefined ? `:${issue.line}` : ''}
</code>
```

The full corrected file:

```tsx
import type { ReviewResult as ReviewResultType } from '../types.js'

const VERDICT_COLORS: Record<string, string> = {
  approve: '#16a34a',
  request_changes: '#dc2626',
  comment: '#d97706',
}

const SEVERITY_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#3b82f6',
}

interface Props {
  result: ReviewResultType
}

export function ReviewResult({ result }: Props) {
  const verdictColor = VERDICT_COLORS[result.verdict] ?? '#6b7280'

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720 }}>
      <div
        data-testid="verdict"
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: verdictColor,
          marginBottom: 12,
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}
      >
        {result.verdict.replace('_', ' ')}
      </div>

      <p style={{ color: '#374151', marginBottom: 20, lineHeight: 1.6 }}>{result.summary}</p>

      {result.issues.length === 0 ? (
        <p style={{ color: '#6b7280', fontStyle: 'italic' }}>No issues found.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {result.issues.map((issue, i) => (
            <div
              key={i}
              style={{
                borderLeft: `3px solid ${SEVERITY_COLORS[issue.severity]}`,
                paddingLeft: 12,
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <span
                  style={{
                    background: SEVERITY_COLORS[issue.severity],
                    color: '#fff',
                    borderRadius: 4,
                    padding: '0 6px',
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {issue.severity}
                </span>
                <code style={{ fontSize: 13, color: '#4b5563' }}>
                  {issue.file}{issue.line !== undefined ? `:${issue.line}` : ''}
                </code>
              </div>
              <p style={{ margin: 0, color: '#1f2937', fontSize: 14 }}>{issue.comment}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd frontend && npx vitest run src/__tests__/ReviewResult.test.tsx
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ReviewResult.tsx frontend/src/__tests__/ReviewResult.test.tsx
git commit -m "feat: add ReviewResult component with severity badges and verdict color"
```

---

## Task 11: App.tsx + Deployment Config

**Files:**
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/__tests__/App.test.tsx`
- Create: `backend/render.yaml`  *(not committed with secrets — just the config shape)*
- Create: `frontend/vercel.json`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/__tests__/App.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from '../App.js'

vi.mock('../hooks/useReview.js', () => ({
  useReview: vi.fn(),
}))

import { useReview } from '../hooks/useReview.js'

const mockUseReview = vi.mocked(useReview)

function makeHook(overrides = {}) {
  return {
    submit: vi.fn(),
    status: 'idle' as const,
    events: [],
    result: null,
    error: null,
    ...overrides,
  }
}

describe('App', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the URL input in idle state', () => {
    mockUseReview.mockReturnValue(makeHook())
    render(<App />)
    expect(screen.getByPlaceholderText(/github\.com/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument()
  })

  it('shows error for invalid URL before submitting', () => {
    mockUseReview.mockReturnValue(makeHook())
    render(<App />)
    const input = screen.getByPlaceholderText(/github\.com/i)
    fireEvent.change(input, { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByRole('button', { name: /review/i }))
    expect(screen.getByText(/invalid/i)).toBeInTheDocument()
  })

  it('calls submit with valid URL', () => {
    const submit = vi.fn()
    mockUseReview.mockReturnValue(makeHook({ submit }))
    render(<App />)
    const input = screen.getByPlaceholderText(/github\.com/i)
    fireEvent.change(input, { target: { value: 'https://github.com/vercel/next.js/pull/1' } })
    fireEvent.click(screen.getByRole('button', { name: /review/i }))
    expect(submit).toHaveBeenCalledWith('https://github.com/vercel/next.js/pull/1')
  })

  it('shows EventLog when streaming', () => {
    mockUseReview.mockReturnValue(
      makeHook({
        status: 'streaming',
        events: [{ type: 'status', message: 'Reading diff...' }],
      })
    )
    render(<App />)
    expect(screen.getByText('Reading diff...')).toBeInTheDocument()
  })

  it('shows ReviewResult when complete', () => {
    mockUseReview.mockReturnValue(
      makeHook({
        status: 'complete',
        result: { summary: 'LGTM', issues: [], verdict: 'approve' },
      })
    )
    render(<App />)
    expect(screen.getByTestId('verdict')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd frontend && npx vitest run src/__tests__/App.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement frontend/src/App.tsx**

```tsx
import { useState } from 'react'
import { useReview } from './hooks/useReview.js'
import { EventLog } from './components/EventLog.js'
import { ReviewResult } from './components/ReviewResult.js'

const PR_URL_REGEX = /github\.com\/[^/]+\/[^/]+\/pull\/\d+/

export default function App() {
  const [url, setUrl] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const { submit, status, events, result, error } = useReview()

  function handleSubmit() {
    if (!PR_URL_REGEX.test(url)) {
      setValidationError('Invalid GitHub PR URL. Example: https://github.com/owner/repo/pull/123')
      return
    }
    setValidationError(null)
    submit(url)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0f172a',
        color: '#f1f5f9',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '60px 20px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8 }}>PR Reviewer</h1>
      <p style={{ color: '#94a3b8', marginBottom: 40 }}>
        Paste a public GitHub PR URL and watch the agent review it live.
      </p>

      {(status === 'idle' || status === 'error') && (
        <div style={{ width: '100%', maxWidth: 600 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="https://github.com/owner/repo/pull/123"
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#1e293b',
                color: '#f1f5f9',
                fontSize: 15,
                outline: 'none',
              }}
            />
            <button
              onClick={handleSubmit}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: '#6366f1',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 15,
              }}
            >
              Review
            </button>
          </div>

          {validationError && (
            <p style={{ color: '#f87171', marginTop: 8, fontSize: 13 }}>{validationError}</p>
          )}
          {error && (
            <p style={{ color: '#f87171', marginTop: 8, fontSize: 13 }}>{error}</p>
          )}
        </div>
      )}

      {(status === 'loading' || status === 'streaming' || status === 'complete') && (
        <div style={{ width: '100%', maxWidth: 720 }}>
          <div
            style={{
              background: '#1e293b',
              borderRadius: 10,
              padding: 20,
              marginBottom: 24,
              minHeight: 80,
            }}
          >
            <EventLog events={events} streaming={status === 'streaming'} />
            {status === 'loading' && events.length === 0 && (
              <p style={{ color: '#6b7280', margin: 0 }}>Connecting...</p>
            )}
          </div>

          {status === 'complete' && result && <ReviewResult result={result} />}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd frontend && npx vitest run src/__tests__/App.test.tsx
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Run all frontend tests together**

```bash
cd frontend && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 6: Run all backend tests together**

```bash
cd backend && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 7: Create backend/render.yaml**

```yaml
services:
  - type: web
    name: pr-reviewer-backend
    runtime: node
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: GROQ_API_KEY
        sync: false
      - key: GITHUB_TOKEN
        sync: false
      - key: FRONTEND_URL
        sync: false
```

- [ ] **Step 8: Create frontend/vercel.json**

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/" }]
}
```

- [ ] **Step 9: Create frontend/.env.example**

```
VITE_API_URL=http://localhost:3000
```

- [ ] **Step 10: Smoke test full stack locally**

Terminal 1 (backend):
```bash
cd backend && npm run dev
```

Terminal 2 (frontend):
```bash
cd frontend && cp .env.example .env && npm run dev
```

Open `http://localhost:5173`, paste `https://github.com/vercel/next.js/pull/72561`, click Review.

Expected: events stream in live, final review renders.

- [ ] **Step 11: Commit**

```bash
cd ..
git add frontend/src/App.tsx frontend/src/__tests__/App.test.tsx \
  backend/render.yaml frontend/vercel.json frontend/.env.example
git commit -m "feat: wire up App.tsx with all states + add deployment config (Render + Vercel)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered in |
|---|---|
| POST /api/review + GET /api/review/:id/stream | Task 7 |
| SSE event types (status, tool, finding, done, error) | Tasks 1, 7, 8 |
| Agent loop with maxSteps: 15 | Task 4 |
| Zod validation + one retry | Task 4 |
| get_pr_diff / get_file_content / list_existing_comments | Tasks 2, 3 |
| preprocessDiff (50KB cap, filter generated files) | Task 3 |
| Max 5 file fetches | Task 3 (fileFetchCount guard) |
| In-memory cache with EventEmitter | Task 5 |
| Per-IP rate limiting (10/hr + 2 concurrent) | Task 6 |
| useReview hook with SSE state machine | Task 8 |
| Cold start detection (>3s → message) | Task 8 |
| EventLog with severity coloring | Task 9 |
| ReviewResult with verdict color | Task 10 |
| Three UI states (idle, streaming, complete) | Task 11 |
| Render + Vercel deployment config | Task 11 |
| Fire-and-forget agent (POST returns immediately) | Task 7 |
| Replay missed events on reconnect | Task 7 (routes/review.ts) |

All spec requirements are covered. No placeholders. Type signatures are consistent across all tasks.
