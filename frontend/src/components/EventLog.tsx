import { useEffect, useRef } from 'react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import type { SSEEvent } from '@/types'

type Props = {
  events: SSEEvent[]
  phase: 'idle' | 'streaming' | 'done' | 'error'
}

function ToolCallRow({ tool, input }: { tool: string; input: unknown }) {
  const preview = JSON.stringify(input)
  const truncated = preview.length > 60 ? preview.slice(0, 60) + '…' : preview

  return (
    <Collapsible className="my-1">
      <CollapsibleTrigger className="flex items-center gap-2 text-amber-400 hover:text-amber-300 cursor-pointer w-full text-left group">
        <span className="text-amber-500 group-data-[state=open]:rotate-90 transition-transform duration-150 inline-block">▶</span>
        <span className="font-semibold">{tool}</span>
        <span className="text-zinc-500 text-xs font-normal truncate">{truncated}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 ml-5">
        <pre className="text-xs text-zinc-400 bg-zinc-900 rounded p-2 overflow-x-auto">
          {JSON.stringify(input, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function EventLog({ events, phase }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  // Collect consecutive status messages into paragraphs
  const renderedEvents = events.filter(
    (e) => e.type === 'status' || e.type === 'tool' || e.type === 'error'
  )

  return (
    <div className="w-full max-w-2xl mx-auto mt-6">
      <div className="bg-zinc-950 rounded-xl border border-zinc-800 p-4 min-h-48 max-h-[480px] overflow-y-auto font-mono text-sm leading-relaxed">
        {renderedEvents.length === 0 && phase === 'streaming' && (
          <span className="text-zinc-500 animate-pulse">Connecting to agent…</span>
        )}

        {renderedEvents.map((event, i) => {
          if (event.type === 'status') {
            return (
              <span key={i} className="text-zinc-300 whitespace-pre-wrap">
                {event.message}
              </span>
            )
          }
          if (event.type === 'tool') {
            return <ToolCallRow key={i} tool={event.tool} input={event.input} />
          }
          if (event.type === 'error') {
            return (
              <p key={i} className="text-red-400 mt-2">
                ✗ {event.message}
              </p>
            )
          }
          return null
        })}

        {phase === 'streaming' && renderedEvents.length > 0 && (
          <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-0.5 align-middle" />
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}