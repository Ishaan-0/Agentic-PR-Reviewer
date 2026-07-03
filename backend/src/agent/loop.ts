import { streamText, isStepCount } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { ReviewResultSchema , ReviewResult , SSEEvent } from "../types";
import { systemPrompt } from "./prompt";
import { get_pr_diff, get_file_content, list_existing_comments } from "./tools";

import dotenv from "dotenv";

dotenv.config();

export async function runAgentLoop(prDetails: {owner: string, repo: string, prNumber: number}, onEvent: (event: SSEEvent) => void): Promise<ReviewResult> {
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

    let finalText = "";                                                                                                                        
                                                                                                                                             
    const result = streamText({
        model: groq("llama-3.3-70b-versatile"),
        system: systemPrompt,
        prompt: `Review this pull request: owner=${prDetails.owner}, repo=${prDetails.repo}, PR #${prDetails.prNumber}`,
        tools: { get_pr_diff, get_file_content, list_existing_comments },
        stopWhen: isStepCount(15),
        onChunk({ chunk }) {
            if (chunk.type === "text-delta") {
                finalText += chunk.text;
                onEvent({ type: "status", message: chunk.text });
            } else if (chunk.type === "tool-call") {
                onEvent({ type: "tool", tool: chunk.toolName, input: chunk.input });
            }
        }
    });

    await result.text;

    const jsonMatch = finalText.match(/```json\s*([\s\S]*?)\s*```/) || finalText.match(/(\{[\s\S]*\})/);
    const jsonString = jsonMatch ? jsonMatch[1] : finalText;
    const parsed = ReviewResultSchema.safeParse(JSON.parse(jsonString)); 
    if (!parsed.success) {
        throw new Error(`Invalid output: ${parsed.error.message}`)
    }

    return parsed.data;
}