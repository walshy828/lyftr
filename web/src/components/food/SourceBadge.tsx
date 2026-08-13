import { foodSourceBadge, FOOD_SOURCE_TONE_CLASS } from '../../utils/foodSource'
import * as types from '../../types'

type Props = {
  item: Pick<types.FoodSearchResult, 'source' | 'label_accurate'>
  className?: string
}

/**
 * Marks where a food's numbers came from. Renders nothing when the source says
 * nothing useful about accuracy (a My Foods entry could have any origin), so
 * callers can drop it in unconditionally.
 */
export default function SourceBadge({ item, className = '' }: Props) {
  const badge = foodSourceBadge(item)
  if (!badge) return null

  return (
    <span
      title={badge.detail}
      className={`inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium border whitespace-nowrap ${FOOD_SOURCE_TONE_CLASS[badge.tone]} ${className}`}
    >
      {badge.label}
    </span>
  )
}
