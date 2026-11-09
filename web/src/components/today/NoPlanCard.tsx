import { Link } from 'react-router-dom'
import { Target, ArrowRight } from 'lucide-react'

/**
 * Shown on Today when there's no active weight plan: everything the app can
 * say about pace and "should I change course" depends on having one.
 */
export default function NoPlanCard() {
  return (
    <Link to="/weight/plan" className="card-interactive flex items-center gap-3.5 p-4">
      <div className="w-11 h-11 rounded-xl bg-body/15 flex items-center justify-center flex-shrink-0">
        <Target className="w-5 h-5 text-body" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-tx-primary">Set a weight goal</p>
        <p className="text-xs text-tx-muted">Get calorie and macro targets, a week-by-week path, and a daily read on whether you're on pace.</p>
      </div>
      <ArrowRight className="w-4 h-4 text-tx-muted flex-shrink-0" />
    </Link>
  )
}
