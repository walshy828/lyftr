import type React from 'react'
import { Scan, Camera, Sparkles, Plus } from 'lucide-react'

interface FoodCaptureBarProps {
  onScanBarcode: () => void
  onScanLabel: () => void
  onDescribeMeal: () => void
  onAddManually: () => void
}

/**
 * The four ways to add a food that aren't "search for it", kept in one
 * persistent row under the search field.
 *
 * Previously these were scattered — barcode beside the search input, "describe
 * your meal" as a banner, label scan only inside the no-results block, and
 * manual entry below the entire result list, absent altogether on the Recent
 * and My Foods views. Each is now one tap from anywhere on the search screen.
 *
 * Four buttons, not five: the meal-photo path lives inside the describe-meal
 * sheet, which accepts a photo and text together.
 */
export default function FoodCaptureBar({
  onScanBarcode, onScanLabel, onDescribeMeal, onAddManually,
}: FoodCaptureBarProps) {
  const actions: { icon: React.ElementType; label: string; onClick: () => void; accent: string }[] = [
    { icon: Scan, label: 'Barcode', onClick: onScanBarcode, accent: 'text-sky-400' },
    { icon: Camera, label: 'Label', onClick: onScanLabel, accent: 'text-amber-400' },
    { icon: Sparkles, label: 'Describe', onClick: onDescribeMeal, accent: 'text-brand-400' },
    { icon: Plus, label: 'Manual', onClick: onAddManually, accent: 'text-tx-secondary' },
  ]

  return (
    <div className="flex items-stretch gap-2">
      {actions.map(({ icon: Icon, label, onClick, accent }) => (
        <button
          key={label}
          type="button"
          onClick={onClick}
          className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2.5 px-1 rounded-xl bg-surface-muted border border-surface-border text-tx-secondary hover:bg-surface-overlay hover:text-tx-primary active:scale-95 transition-all"
        >
          <Icon className={`w-[18px] h-[18px] flex-shrink-0 ${accent}`} />
          <span className="text-[10px] font-medium leading-none truncate max-w-full">{label}</span>
        </button>
      ))}
    </div>
  )
}
