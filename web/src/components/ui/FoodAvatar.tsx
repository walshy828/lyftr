import AuthedImg from './AuthedImg'
import { foodVisual, type MacroKey } from '../../utils/foodVisual'
import { MACRO_COLORS } from '../../utils/macroColors'

const SIZES = {
  xs: 'w-7 h-7 text-sm rounded-lg',
  sm: 'w-10 h-10 text-lg rounded-xl',
  md: 'w-12 h-12 text-2xl rounded-xl',
  lg: 'w-16 h-16 text-3xl rounded-2xl',
} as const

const TINT: Record<MacroKey, string> = {
  protein: MACRO_COLORS.protein,
  carbs: MACRO_COLORS.carbs,
  fat: MACRO_COLORS.fat,
}

interface Props {
  food: { name: string; image_url?: string | null; protein?: number; carbs?: number; fat?: number }
  size?: keyof typeof SIZES
  className?: string
}

/**
 * The picture for a food: its real photo when one exists, otherwise a
 * keyword-matched emoji on a tile tinted by the food's dominant macro. Every
 * food in a list therefore reads differently at a glance.
 */
export default function FoodAvatar({ food, size = 'sm', className = '' }: Props) {
  const v = foodVisual(food)
  const tint = v.dominant ? TINT[v.dominant] : '#64748b'
  const box = `${SIZES[size]} flex-shrink-0 ${className}`
  const fallback = (
    <div
      aria-hidden
      className={`${box} flex items-center justify-center border`}
      style={{ background: `${tint}1f`, borderColor: `${tint}33` }}
    >
      <span className="leading-none select-none">{v.emoji}</span>
    </div>
  )
  return (
    <AuthedImg
      src={food.image_url || undefined}
      alt=""
      className={`${box} object-cover border border-surface-border`}
      fallback={fallback}
    />
  )
}
