import { EventEmitter } from "node:events";
import { ReviewResult, SSEEvent } from "./types";

export type CacheEntry = {
    reviewId: string,
    status: "pending" | "complete" | "error",
    events: SSEEvent[],
    emitter: EventEmitter,
    result?: ReviewResult,
}

export const cache = new Map<string, CacheEntry>();

export const prUrlToReviewId = new Map<string, string>(); 