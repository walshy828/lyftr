import { useNavigate } from 'react-router-dom'
import { programAPI } from '../services/api'
import ProgramEditor, { ProgramFormData } from '../components/ProgramEditor'

export default function AddProgram() {
  const navigate = useNavigate()

  return (
    <ProgramEditor
      title="New Program"
      initialData={{ name: '', notes: '', exercises: [] }}
      onSave={async (payload: ProgramFormData) => {
        const created = await programAPI.create(payload)
        // Straight into "which days?" — a routine that isn't on the week never shows up as Up next.
        navigate(`/programs/${created.id}?new=1`)
      }}
      onCancel={() => navigate(-1)}
    />
  )
}
