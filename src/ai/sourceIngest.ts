import { v4 as uuidv4 } from 'uuid'
import { digestSource } from './gemini'
import { saveSource } from '../store/sourceDb'

export interface IngestResult {
  title: string
  digest: string
  sourceId: string
  kind: 'md'
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target!.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function chunkText(text: string): Array<{ id: string; text: string; offset: number }> {
  const chunks: Array<{ id: string; text: string; offset: number }> = []
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim())
  let current = ''
  let currentOffset = 0
  let offset = 0

  for (const para of paragraphs) {
    const paraLen = para.length
    if (current.length + paraLen > 700 && current.length > 0) {
      chunks.push({ id: uuidv4(), text: current.trim(), offset: currentOffset })
      currentOffset = offset
      current = para
    } else {
      current = current ? current + '\n\n' + para : para
    }
    offset += paraLen + 2
  }
  if (current.trim()) {
    chunks.push({ id: uuidv4(), text: current.trim(), offset: currentOffset })
  }
  return chunks
}

export async function ingestSource(file: File): Promise<IngestResult> {
  const fullText = await readFileAsText(file)

  if (!fullText.trim()) throw new Error('File appears to be empty or unreadable')

  const { title, digest } = await digestSource(fullText)
  const chunks = chunkText(fullText)
  const sourceId = uuidv4()

  await saveSource({ sourceId, kind: 'md', fullText, chunks })

  return { title, digest, sourceId, kind: 'md' }
}
