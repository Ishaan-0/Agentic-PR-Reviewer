import { useReview } from '@/hooks/useReview'
import { URLInput } from '@/components/URLInput'
import { EventLog } from '@/components/EventLog'
import { ReviewResult } from '@/components/ReviewResult'

export default function App() {
  const { state, startReview } = useReview()

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <span className="text-lg font-bold text-zinc-900">🔍 PR Reviewer</span>
          <span className="text-xs text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full font-mono">
            powered by Llama 3.3
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        <URLInput phase={state.phase} onSubmit={startReview} />

        {(state.phase === 'streaming' || state.phase === 'done' || state.phase === 'error') && (
          <EventLog events={state.events} phase={state.phase} />
        )}

        {state.phase === 'done' && state.result && (
          <ReviewResult result={state.result} />
        )}

        {state.phase === 'error' && !state.events.some((e) => e.type === 'error') && (
          <p className="mt-4 text-sm text-red-500 text-center">{state.error}</p>
        )}
      </main>
    </div>
  )
}