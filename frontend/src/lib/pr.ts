export type PRDetails = {
  owner: string
  repo: string
  prNumber: number
}

export function parsePRUrl(url: string): PRDetails | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
  }
}