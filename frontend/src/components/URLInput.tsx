import { useState , useEffect , useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { parsePRUrl } from '@/lib/pr'

type Props = {
  phase: 'idle' | 'streaming' | 'done' | 'error'
  onSubmit: (prUrl: string) => void
}

export function URLInput({ phase, onSubmit }: Props) {
  const [url, setUrl] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [showColdStart, setShowColdStart] = useState(false)
  const coldStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDisabled = phase === 'streaming'

  // Show cold-start banner if streaming starts and 5 seconds pass with no events
  useEffect(() => {
    if (phase === 'streaming') {
      coldStartTimer.current = setTimeout(() => setShowColdStart(true), 5000)
    } else {
      if (coldStartTimer.current) clearTimeout(coldStartTimer.current)
      setShowColdStart(false)
    }
    return () => {
      if (coldStartTimer.current) clearTimeout(coldStartTimer.current)
    }
  }, [phase])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!parsePRUrl(trimmed)) {
      setValidationError('Enter a valid GitHub PR URL, e.g. https://github.com/owner/repo/pull/123')
      return
    }
    setValidationError(null)
    onSubmit(trimmed)
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-zinc-900 mb-2">PR Reviewer</h1>
        <p className="text-zinc-500 text-sm">
          Paste a public GitHub PR URL. Watch the agent decide what to inspect.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          type="url"
          placeholder="https://github.com/owner/repo/pull/123"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            if (validationError) setValidationError(null)
          }}
          disabled={isDisabled}
          className="flex-1 font-mono text-sm"
        />
        <Button type="submit" disabled={isDisabled}>
          {isDisabled ? 'Reviewing…' : 'Review'}
        </Button>
      </form>

      {validationError && (
        <p className="mt-2 text-sm text-red-500">{validationError}</p>
      )}

      {showColdStart && (
        <p className="mt-3 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Waking up the agent — free-tier hosting, may take ~30s on first run.
        </p>
      )}
    </div>
  )
}