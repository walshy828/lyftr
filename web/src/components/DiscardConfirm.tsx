import { Trash2 } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  open: boolean
  onKeep: () => void
  onDiscard: () => void
}

// Discard-workout confirmation, shared by every gym-mode phase. Thin wrapper
// around the generic ConfirmDialog.
export default function DiscardConfirm({ open, onKeep, onDiscard }: Props) {
  return (
    <ConfirmDialog
      open={open}
      title="Discard workout?"
      body="This ends the workout without saving — all progress is lost."
      confirmLabel={<><Trash2 className="w-3.5 h-3.5" />Discard</>}
      cancelLabel="Keep Going"
      onConfirm={onDiscard}
      onCancel={onKeep}
    />
  )
}
