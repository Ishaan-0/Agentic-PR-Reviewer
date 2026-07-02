import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";

dotenv.config();

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

export async function getPRDiff(owner: string , repo: string, pull_number: number) {
    const response = await octokit.pulls.listFiles({
        owner: owner,
        repo: repo,
        pull_number: pull_number
    })

    return response.data; 
}

export async function getFileContent(owner: string, repo: string, path: string, ref: string) {
    const response = await octokit.repos.getContent({
        owner: owner,
        repo: repo,
        path: path,
        ref: ref
    });
    
    if (!('content' in response.data)) throw new Error('Not a file');
    const content = Buffer.from(response.data.content, 'base64').toString("utf-8");

    return content;
}

export async function listExistingComments(owner: string, repo: string, pull_number: number) {
    const response = await octokit.pulls.listReviewComments({
        owner: owner, 
        repo: repo, 
        pull_number: pull_number
    });

    return response.data;
}