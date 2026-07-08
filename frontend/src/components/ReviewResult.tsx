import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ReviewResult } from '@/types'

type Props = {
  result: ReviewResult
}

const verdictConfig = {
  approve: { label: '✓ Approve', className: 'bg-green-100 text-green-800 border-green-200' },
  request_changes: { label: '✗ Request Changes', className: 'bg-red-100 text-red-800 border-red-200' },
  comment: { label: '◆ Comment', className: 'bg-blue-100 text-blue-800 border-blue-200' },
} as const

const severityConfig = {
  high: { label: 'HIGH', className: 'bg-red-100 text-red-700 border-red-200' },
  medium: { label: 'MEDIUM', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  low: { label: 'LOW', className: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
} as const

function IssueCard({ file, line, severity, comment }: ReviewResult['issues'][number]) {
  const sev = severityConfig[severity]
  return (
    <Card className="mb-3 border-zinc-200">
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <Badge variant="outline" className={`shrink-0 text-xs font-bold ${sev.className}`}>
            {sev.label}
          </Badge>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs text-zinc-500 mb-1 truncate">
              {file}{line !== undefined ? `:${line}` : ''}
            </p>
            <p className="text-sm text-zinc-800">{comment}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function ReviewResult({ result }: Props) {
  const verdict = verdictConfig[result.verdict]

  const high = result.issues.filter((i) => i.severity === 'high')
  const medium = result.issues.filter((i) => i.severity === 'medium')
  const low = result.issues.filter((i) => i.severity === 'low')

  return (
    <div className="w-full max-w-2xl mx-auto mt-8 animate-in fade-in duration-500">
      {/* Verdict */}
      <div className="flex items-center gap-3 mb-4">
        <Badge variant="outline" className={`text-sm px-3 py-1 font-semibold ${verdict.className}`}>
          {verdict.label}
        </Badge>
        <span className="text-xs text-zinc-400 uppercase tracking-wide font-medium">Verdict</span>
      </div>

      {/* Summary */}
      <p className="text-zinc-700 text-sm leading-relaxed mb-6 bg-white border border-zinc-200 rounded-lg p-4">
        {result.summary}
      </p>

      {/* Issues */}
      {result.issues.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-4">No issues found.</p>
      ) : (
        <>
          {high.length > 0 && (
            <section className="mb-5">
              <h3 className="text-xs font-bold text-red-600 uppercase tracking-widest mb-2">
                High — {high.length} {high.length === 1 ? 'issue' : 'issues'}
              </h3>
              {high.map((issue, i) => <IssueCard key={i} {...issue} />)}
            </section>
          )}
          {medium.length > 0 && (
            <section className="mb-5">
              <h3 className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">
                Medium — {medium.length} {medium.length === 1 ? 'issue' : 'issues'}
              </h3>
              {medium.map((issue, i) => <IssueCard key={i} {...issue} />)}
            </section>
          )}
          {low.length > 0 && (
            <section className="mb-5">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">
                Low — {low.length} {low.length === 1 ? 'issue' : 'issues'}
              </h3>
              {low.map((issue, i) => <IssueCard key={i} {...issue} />)}
            </section>
          )}
        </>
      )}
    </div>
  )
}