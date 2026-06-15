import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { RefreshCw, Download, FileText } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { generateBrief } from '@/ai/gemini'
import type { ThonkGraph } from '@/store/types'

export interface SummarizeCache {
  fingerprint: string
  title: string
  markdown: string
}

interface Props {
  open: boolean
  onClose: () => void
  graph: ThonkGraph
  cache: React.MutableRefObject<SummarizeCache | null>
}

function fingerprint(graph: ThonkGraph): string {
  return graph.nodes
    .filter(n => n.type === 'core' || n.type === 'idea')
    .map(n => `${n.id}:${n.title}:${n.body}`)
    .sort()
    .join('|')
}

function mdToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul])(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '')
}

function downloadMd(title: string, md: string) {
  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.toLowerCase().replace(/\s+/g, '-')}.md`
  a.click()
  URL.revokeObjectURL(url)
}

function downloadPdf(title: string, md: string) {
  const html = mdToHtml(md)
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { font-family: Georgia, 'Times New Roman', serif; max-width: 680px; margin: 48px auto; line-height: 1.7; color: #1a1a1a; font-size: 15px; }
      h1, h2, h3 { font-family: system-ui, sans-serif; font-weight: 600; margin-top: 2em; }
      h1 { font-size: 1.6em; } h2 { font-size: 1.25em; } h3 { font-size: 1.05em; }
      p { margin: 0.8em 0; }
      ul { padding-left: 1.4em; margin: 0.6em 0; }
      li { margin: 0.3em 0; }
      strong { font-weight: 600; }
      @media print { body { margin: 0; } }
    </style>
  </head><body>${html}</body></html>`)
  win.document.close()
  win.focus()
  win.print()
}

type Status = 'loading' | 'ready' | 'error'

export function SummarizeModal({ open, onClose, graph, cache }: Props) {
  const [status, setStatus] = useState<Status>('loading')
  const [title, setTitle] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const run = async (force = false) => {
    const fp = fingerprint(graph)

    if (!force && cache.current?.fingerprint === fp) {
      setTitle(cache.current.title)
      setMarkdown(cache.current.markdown)
      setStatus('ready')
      return
    }

    setStatus('loading')
    setError('')

    try {
      const result = await generateBrief(graph)
      cache.current = { fingerprint: fp, title: result.title, markdown: result.markdown }
      setTitle(result.title)
      setMarkdown(result.markdown)
      setStatus('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setStatus('error')
    }
  }

  useEffect(() => {
    if (!open) return
    run()
    return () => { abortRef.current?.abort() }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-base font-semibold">
            {status === 'ready' ? title || 'Summary' : 'Summarize'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          {status === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Spinner className="w-6 h-6 opacity-60" />
              Writing…
            </div>
          )}

          {status === 'error' && (
            <div className="text-sm text-red-500 py-4">{error}</div>
          )}

          {status === 'ready' && (
            <div className="prose prose-sm max-w-none text-sm leading-relaxed [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium [&_ul]:my-1 [&_li]:my-0.5 [&_p]:mb-4 [&_p:last-child]:mb-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {markdown}
              </ReactMarkdown>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border flex items-center justify-between shrink-0">
          <Button
            size="sm" variant="ghost"
            className="h-8 text-sm gap-1.5 text-muted-foreground cursor-pointer"
            onClick={() => run(true)}
            disabled={status === 'loading'}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Regenerate
          </Button>

          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline"
              className="h-8 text-sm gap-1.5 cursor-pointer"
              onClick={() => downloadMd(title, markdown)}
              disabled={status !== 'ready'}
            >
              <FileText className="w-3.5 h-3.5" /> Download .md
            </Button>
            <Button
              size="sm" variant="outline"
              className="h-8 text-sm gap-1.5 cursor-pointer"
              onClick={() => downloadPdf(title, markdown)}
              disabled={status !== 'ready'}
            >
              <Download className="w-3.5 h-3.5" /> Download PDF
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
