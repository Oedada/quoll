import { useState } from 'react'
import { BatchListView } from './import/BatchListView'
import { BatchView } from './import/BatchView'

export default function ImportPage() {
  const [batchId, setBatchId] = useState<number | null>(null)

  if (batchId == null) return <BatchListView onOpen={setBatchId} />
  return <BatchView batchId={batchId} onBack={() => setBatchId(null)} />
}
