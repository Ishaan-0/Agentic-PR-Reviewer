import { tool } from "ai";
import { z } from "zod";
import { getPRDiff, getFileContent, listExistingComments } from "../github";

export const get_pr_diff = tool({
    description: "Get the diff of a pull request from GitHub", 
    inputSchema: z.object({
        owner: z.string().describe("The owner of the repository"),
        repo: z.string().describe("The name of the repository"),
        pull_number: z.number().describe("The number of the pull request"),
    }),
    execute: async ({ owner, repo, pull_number }) => {                                                                                         
        const files = await getPRDiff(owner, repo, pull_number);                                                                                 
        return files.map(f => ({ filename: f.filename, patch: f.patch ?? '' }));                                                               
    } 
});

export const get_file_content = tool({
    description: "Get the content of a file from GitHub",
    inputSchema: z.object({
        owner: z.string().describe("The owner of the repository"),
        repo: z.string().describe("The name of the repository"),
        path: z.string().describe("The path of the file"),
        ref: z.string().describe("The git reference (branch, tag, commit SHA)"),
    }),
    execute: async ({ owner, repo, path, ref }) => {
        return await getFileContent(owner, repo, path, ref);
    }
});

export const list_existing_comments = tool({
    description: "List existing comments on a pull request from GitHub",
    inputSchema: z.object({
        owner: z.string().describe("The owner of the repository"),
        repo: z.string().describe("The name of the repository"),
        pull_number: z.number().describe("The number of the pull request"), 
    }),
    execute: async ({ owner, repo, pull_number }) => {
        const comments = await listExistingComments(owner, repo, pull_number);
        return comments.map(c => ({ path: c.path, line: c.line, body: c.body }));
    }
});