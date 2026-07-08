import { useState, useRef, useCallback } from 'react'

import type { SSEEvent, ReviewResult } from '@/types'

type ReviewState = {
  phase: 'idle' | 'streaming' | 'done' | 'error'
  events: SSEEvent[]
  result: ReviewResult | null
  error: string | null
}


const initialState: ReviewState = {
  phase: 'idle',
  events: [],
  result: null,
  error: null,
}

export function useReview() {
  const [state, setState] = useState<ReviewState>(initialState)
  const esRef = useRef<EventSource | null>(null)

  const startReview = useCallback((prUrl: string) => {
    // Close any existing connection
    if (esRef.current) {
      esRef.current.close()
    }

    setState({ phase: 'streaming', events: [], result: null, error: null })

    fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prUrl }),
    })
      .then((res) => res.json())
      .then(({ reviewId }: { reviewId: string }) => {
        const es = new EventSource(`/api/review/${reviewId}/stream`)
        esRef.current = es

        es.onmessage = (e: MessageEvent) => {
          const event = JSON.parse(e.data as string) as SSEEvent

          setState((prev) => {
            if (event.type === 'done') {
              es.close()
              return { ...prev, phase: 'done', result: event.result, events: [...prev.events, event] }
            }
            if (event.type === 'error') {
              es.close()
              return { ...prev, phase: 'error', error: event.message, events: [...prev.events, event] }
            }
            return { ...prev, events: [...prev.events, event] }
          })
        }

        es.onerror = () => {
          es.close()
          setState((prev) => ({
            ...prev,
            phase: 'error',
            error: 'Connection lost — please try again.',
          }))
        }
      })
      .catch((err: Error) => {
        setState((prev) => ({
          ...prev,
          phase: 'error',
          error: err.message,
        }))
      })
  }, [])

  return { state, startReview }
}