export type ReviewResult = { 
    summary: string;
    issues: Array<{file: string; line?: number; severity: "high" | "medium" | "low"; comment: string}>;
    verdict: "approve" | "request_changes" | "comment" 
}

export type SSEEvent =  
    | { type: "status";  message: string }
    | { type: "tool";    tool: string; input: unknown }
    | { type: "finding"; severity: "high" | "medium" | "low"; message: string }
    | { type: "done";    result: ReviewResult }
    | { type: "error";   message: string }