import { z } from "zod"

export const ReviewResultSchema = z.object({
  summary: z.string(),
  issues: z.array(z.object({
    file: z.string(),
    line: z.number().optional(),
    severity: z.enum(["high", "medium", "low"]),
    comment: z.string(),
  })),
  verdict: z.enum(["approve", "request_changes", "comment"]),
})

export type ReviewResult = z.infer<typeof ReviewResultSchema>


export type SSEEvent =  
    | { type: "status";  message: string }
    | { type: "tool";    tool: string; input: unknown }
    | { type: "finding"; severity: "high" | "medium" | "low"; message: string }
    | { type: "done";    result: ReviewResult }
    | { type: "error";   message: string }