import * as types from '../types'

interface Props {
  detail?: types.PlanDetail
  /**
   * Plain-text fallback (a goal's `notes`) for plans accepted before the AI
   * returned structured sections, or from a provider that only sent prose.
   */
  fallback?: string
}

/**
 * Renders an AI plan write-up as a summary line plus headed bullet lists.
 *
 * The AI returns typed sections rather than markdown precisely so this can
 * stay a plain renderer — every string below goes into the DOM as a text
 * node, so there's no markdown parser and no HTML-injection surface. Bullet
 * styling matches the adherence "drivers" list on the plan page.
 */
export default function PlanDetailSections({ detail, fallback }: Props) {
  const summary = detail?.summary ?? ''
  const sections = detail?.sections?.filter(s => s.heading || s.bullets?.length) ?? []

  if (!summary && sections.length === 0) {
    return fallback ? <p className="text-sm text-tx-secondary">{fallback}</p> : null
  }

  return (
    <div className="space-y-4">
      {summary && <p className="text-sm text-tx-primary">{summary}</p>}
      {sections.map((section, i) => (
        <div key={i}>
          {section.heading && (
            <h4 className="text-xs font-semibold uppercase tracking-wide text-tx-muted mb-1.5">
              {section.heading}
            </h4>
          )}
          {section.bullets?.length > 0 && (
            <ul className="space-y-1.5">
              {section.bullets.map((bullet, j) => (
                <li key={j} className="flex items-start gap-2 text-sm text-tx-secondary">
                  <span className="w-1 h-1 rounded-full bg-tx-muted mt-2 flex-shrink-0" />
                  {bullet}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
