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
        await programAPI.create(payload)
        navigate('/programs')
      }}
      onCancel={() => navigate(-1)}
    />
  )
}
