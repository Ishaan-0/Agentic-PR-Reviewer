import { runAgentLoop } from "../agent/loop";
import { EventEmitter } from "node:events";
import { SSEEvent } from "../types";
import { Router } from "express";
import { cache, prUrlToReviewId } from "../cache";

const router = Router();

router.post("/review", (req, res) => {
    const { prUrl } = req.body;

    const parts = prUrl.split("/");
    const owner = parts[3];
    const repo = parts[4];
    const prNumber = parseInt(parts[6]);

    if (prUrlToReviewId.has(prUrl)) {
        const reviewId = prUrlToReviewId.get(prUrl)!;
        return res.json({ reviewId, cached: true });
    }

    const reviewId = crypto.randomUUID();
    cache.set(reviewId, {
        reviewId,
        status: "pending",
        events: [] as SSEEvent[],
        emitter: new EventEmitter(),
    });
    prUrlToReviewId.set(prUrl, reviewId);

    runAgentLoop({ owner, repo, prNumber }, (event: SSEEvent) => {
        const entry = cache.get(reviewId);
        if (!entry) return;
        entry.events.push(event);
        entry.emitter.emit("event", event);
    })
    .then((result) => {
        const entry = cache.get(reviewId);
        if (!entry) return;
        const doneEvent: SSEEvent = { type: "done", result };
        entry.events.push(doneEvent);
        entry.emitter.emit("event", doneEvent);
        entry.status = "complete";
        entry.result = result;
    })
    .catch((err) => {
        const entry = cache.get(reviewId);
        if (!entry) return;
        entry.status = "error";
        entry.events.push({ type: "error", message: err.message });
        entry.emitter.emit("event", { type: "error", message: err.message });
    });

    res.json({ reviewId, cached: false });
});


router.get("/review/:id/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const entry = cache.get(req.params.id);
    if (!entry) {
        res.status(404).end();
        return;
    }

    if (entry.status === "complete" || entry.status === "error") {
        for (const event of entry.events) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        res.end();
        return;
    }

    for (const event of entry.events) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const onEvent = (event: SSEEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === "done" || event.type === "error") {
            res.end();
        }
    }

    entry.emitter.on("event", onEvent);
    
    req.on("close", () => {
        entry.emitter.off("event", onEvent);
    });
});


export default router;