import { describe, it, expect } from 'vitest'
import { parsePRUrl } from '../pr'

describe('parsePRUrl', () => {
  it('parses a valid PR URL', () => {
    const result = parsePRUrl('https://github.com/facebook/react/pull/123')
    expect(result).toEqual({ owner: 'facebook', repo: 'react', prNumber: 123 })
  })

  it('parses a URL without trailing slash', () => {
    const result = parsePRUrl('https://github.com/vercel/next.js/pull/67890')
    expect(result).toEqual({ owner: 'vercel', repo: 'next.js', prNumber: 67890 })
  })

  it('returns null for a repo URL with no PR number', () => {
    expect(parsePRUrl('https://github.com/facebook/react')).toBeNull()
  })

  it('returns null for a completely invalid string', () => {
    expect(parsePRUrl('not a url')).toBeNull()
    expect(parsePRUrl('')).toBeNull()
  })

  it('returns null for a non-GitHub URL', () => {
    expect(parsePRUrl('https://gitlab.com/owner/repo/merge_requests/1')).toBeNull()
  })
})