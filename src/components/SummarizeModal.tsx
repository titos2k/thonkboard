import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, RefreshCw, Download, FileText, List, FlaskConical, Check, AlertTriangle, Microscope, Sparkles, MessageCircleQuestion, Swords, User, MoveRight, History } from 'lucide-react'
import { BulbIcon } from '@/components/icons/BulbIcon'
import { Spinner } from '@/components/ui/spinner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { generateBrief, generateGaps, generateReport } from '@/ai/gemini'
import type { ThonkGraph } from '@/store/types'

interface PersistedCache {
  fingerprint: string
  title: string
  markdown: string
  mode: 'list' | 'analysis' | 'gaps'
  savedAt: string
}

interface Props {
  open: boolean
  onClose: () => void
  graph: ThonkGraph
  boardId: string
}

function storageKey(boardId: string, mode: 'list' | 'analysis' | 'gaps') {
  return `thonk.summary-${boardId}-${mode}`
}

function loadCache(boardId: string, mode: 'list' | 'analysis' | 'gaps'): PersistedCache | null {
  try {
    const raw = localStorage.getItem(storageKey(boardId, mode))
    return raw ? (JSON.parse(raw) as PersistedCache) : null
  } catch {
    return null
  }
}

function saveCache(boardId: string, entry: PersistedCache) {
  try {
    localStorage.setItem(storageKey(boardId, entry.mode), JSON.stringify(entry))
  } catch {}
}

function fingerprint(graph: ThonkGraph, mode: 'list' | 'analysis' | 'gaps'): string {
  return mode + '|' + graph.nodes
    .map(n => `${n.id}:${n.type}:${n.title}:${n.body}:${n.thumb ?? ''}:${n.resolved ?? ''}`)
    .sort()
    .join('|')
}

function computeHealth(graph: ThonkGraph) {
  const questions = graph.nodes.filter(n => n.type === 'question')
  const problems  = graph.nodes.filter(n => n.type === 'problem')
  const answeredIds  = new Set(graph.edges.filter(e => e.relation === 'answers').map(e => e.source))
  const hasOutgoing  = new Set(graph.edges.map(e => e.source))
  return {
    questionsAnswered:  questions.filter(n => !!n.resolvedAs || answeredIds.has(n.id)).length,
    questionsTotal:     questions.length,
    problemsAddressed:  problems.filter(n => !!n.thumb || hasOutgoing.has(n.id)).length,
    problemsTotal:      problems.length,
    conflicts:          graph.nodes.filter(n => n.conflicts?.some(c => !c.ignored)).length,
    ideasExplored:      graph.nodes.filter(n => n.type === 'idea' && !!n.thumb).length,
    ideasTotal:         graph.nodes.filter(n => n.type === 'idea').length,
    answersTotal:       graph.nodes.filter(n => n.type === 'answer').length,
    answersHumanPct:    (() => { const a = graph.nodes.filter(n => n.type === 'answer'); return a.length ? Math.round(a.filter(n => !n.meta?.aiGenerated).length / a.length * 100) : 0 })(),
  }
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

type Status = 'idle' | 'loading' | 'ready' | 'error'

export function SummarizeModal({ open, onClose, graph, boardId }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [mode, setMode] = useState<'list' | 'analysis' | 'gaps' | null>(null)
  const [title, setTitle] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const run = async (m: 'list' | 'analysis' | 'gaps', force = false) => {
    const fp = fingerprint(graph, m)

    if (!force) {
      const cached = loadCache(boardId, m)
      if (cached) {
        setTitle(cached.title)
        setMarkdown(cached.markdown)
        setMode(m)
        setSavedAt(cached.savedAt)
        setStale(cached.fingerprint !== fp)
        setStatus('ready')
        return
      }
    }

    setMode(m)
    setStatus('loading')
    setError('')
    setStale(false)

    try {
      const result = m === 'analysis' ? await generateReport(graph) : m === 'gaps' ? await generateGaps(graph) : await generateBrief(graph)
      const now = new Date().toISOString()
      saveCache(boardId, { fingerprint: fp, title: result.title, markdown: result.markdown, mode: m, savedAt: now })
      setTitle(result.title)
      setMarkdown(result.markdown)
      setSavedAt(now)
      setStale(false)
      setStatus('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setStatus('error')
    }
  }

  useEffect(() => {
    if (!open) { setStatus('idle'); setMode(null); setStale(false); setSavedAt(null) }
    return () => { abortRef.current?.abort() }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pr-12 pt-5 pb-1 shrink-0">
          <DialogTitle className="text-2xl font-semibold leading-tight">
            {status === 'ready' ? title || 'Summary' : 'How\'s the thinking?'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pt-0 pb-4 min-h-0">
          {status === 'idle' && (() => {
            const health = computeHealth(graph)
            const hasHealth = health.questionsTotal + health.problemsTotal + health.conflicts + health.ideasTotal + health.answersTotal > 0
            const cachedList     = !!loadCache(boardId, 'list')
            const cachedAnalysis = !!loadCache(boardId, 'analysis')
            const cachedGaps     = !!loadCache(boardId, 'gaps')
            return (
              <div className="py-2 flex flex-col gap-3">
                {hasHealth && (
                  <div className="flex gap-1">
                    {health.questionsTotal > 0 && (() => { const red = health.questionsAnswered / health.questionsTotal < 0.1; return (
                      <div className="flex-1 text-center py-1.5">
                        <div className="w-11 h-11 rounded-xl bg-black/[0.06] dark:bg-white/25 flex items-center justify-center mx-auto mb-2.5"><MessageCircleQuestion className="w-5 h-5 text-muted-foreground dark:text-foreground/70" /></div>
                        <div className={`text-xl font-semibold tabular-nums leading-none ${red ? 'text-[var(--thonk-problem)]' : ''}`}>
                          {health.questionsAnswered}<span className={red ? '' : 'text-muted-foreground'}>/{health.questionsTotal}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 leading-tight">questions<br/>answered</div>
                      </div>
                    )})()}
                    {health.problemsTotal > 0 && (() => { const red = health.problemsAddressed / health.problemsTotal < 0.1; return (
                      <div className="flex-1 text-center py-1.5">
                        <div className="w-11 h-11 rounded-xl bg-black/[0.06] dark:bg-white/25 flex items-center justify-center mx-auto mb-2.5"><AlertTriangle className="w-5 h-5 text-muted-foreground dark:text-foreground/70" /></div>
                        <div className={`text-xl font-semibold tabular-nums leading-none ${red ? 'text-[var(--thonk-problem)]' : ''}`}>
                          {health.problemsAddressed}<span className={red ? '' : 'text-muted-foreground'}>/{health.problemsTotal}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 leading-tight">problems<br/>addressed</div>
                      </div>
                    )})()}
                    {health.conflicts > 0 && (
                      <div className="flex-1 text-center py-1.5">
                        <div className="w-11 h-11 rounded-xl bg-black/[0.06] dark:bg-white/25 flex items-center justify-center mx-auto mb-2.5"><Swords className="w-5 h-5 text-muted-foreground dark:text-foreground/70" /></div>
                        <div className="text-xl font-semibold tabular-nums leading-none">{health.conflicts}</div>
                        <div className="text-xs text-muted-foreground mt-1 leading-tight">active<br/>conflicts</div>
                      </div>
                    )}
                    {health.ideasTotal > 0 && (() => { const red = health.ideasExplored / health.ideasTotal < 0.1; return (
                      <div className="flex-1 text-center py-1.5">
                        <div className="w-11 h-11 rounded-xl bg-black/[0.06] dark:bg-white/25 flex items-center justify-center mx-auto mb-2.5"><BulbIcon className="w-5 h-5 text-muted-foreground dark:text-foreground/70" /></div>
                        <div className={`text-xl font-semibold tabular-nums leading-none ${red ? 'text-[var(--thonk-problem)]' : ''}`}>
                          {health.ideasExplored}<span className={red ? '' : 'text-muted-foreground'}>/{health.ideasTotal}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 leading-tight">ideas<br/>explored</div>
                      </div>
                    )})()}
                    {health.answersTotal > 0 && (
                      <div className="flex-1 text-center py-1.5">
                        <div className="w-11 h-11 rounded-xl bg-black/[0.06] dark:bg-white/25 flex items-center justify-center mx-auto mb-2.5"><User className="w-5 h-5 text-muted-foreground dark:text-foreground/70" /></div>
                        <div className={`text-xl font-semibold tabular-nums leading-none ${health.answersHumanPct < 20 ? 'text-[var(--thonk-problem)]' : ''}`}>
                          {health.answersHumanPct}<span className={health.answersHumanPct < 20 ? '' : 'text-muted-foreground'}>%</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 leading-tight">answers<br/>by human</div>
                      </div>
                    )}
                  </div>
                )}
                <div className="text-base font-semibold flex items-center gap-1.5 mt-5"><Sparkles className="w-4 h-4 text-primary" />Generate a summary</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    onClick={() => run('list')}
                    className="cursor-pointer text-left px-4 py-4 rounded-xl border border-border bg-white dark:bg-white/10 hover:bg-muted/40 hover:border-foreground/20 transition-colors flex flex-row sm:flex-col items-start gap-3 sm:gap-0"
                  >
                    <div className="shrink-0 sm:mb-3">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--thonk-source) 18%, transparent)' }}>
                        <List className="w-6 h-6" style={{ color: 'var(--thonk-source)' }} />
                      </div>
                    </div>
                    <div className="flex-1 flex flex-col">
                      <div className="text-base font-semibold mb-1">List</div>
                      <div className="text-sm text-muted-foreground mb-auto">Ideas and decisions as bullets, good for sharing a quick overview.</div>
                      <div className="flex items-center mt-3">
                        {cachedList && <History className="w-3.5 h-3.5 text-muted-foreground/40" />}
                        <MoveRight className="w-5 h-5 text-muted-foreground/40 ml-auto" />
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => run('analysis')}
                    className="cursor-pointer text-left px-4 py-4 rounded-xl border border-border bg-white dark:bg-white/10 hover:bg-muted/40 hover:border-foreground/20 transition-colors flex flex-row sm:flex-col items-start gap-3 sm:gap-0"
                  >
                    <div className="shrink-0 sm:mb-3">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--thonk-answer) 18%, transparent)' }}>
                        <FlaskConical className="w-6 h-6" style={{ color: 'var(--thonk-answer)' }} />
                      </div>
                    </div>
                    <div className="flex-1 flex flex-col">
                      <div className="text-base font-semibold mb-1">Analysis</div>
                      <div className="text-sm text-muted-foreground mb-auto">What you figured out, what's still open, and the core tension.</div>
                      <div className="flex items-center mt-3">
                        {cachedAnalysis && <History className="w-3.5 h-3.5 text-muted-foreground/40" />}
                        <MoveRight className="w-5 h-5 text-muted-foreground/40 ml-auto" />
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => run('gaps')}
                    className="cursor-pointer text-left px-4 py-4 rounded-xl border border-border bg-white dark:bg-white/10 hover:bg-muted/40 hover:border-foreground/20 transition-colors flex flex-row sm:flex-col items-start gap-3 sm:gap-0"
                  >
                    <div className="shrink-0 sm:mb-3">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--thonk-problem) 18%, transparent)' }}>
                        <Microscope className="w-6 h-6" style={{ color: 'var(--thonk-problem)' }} />
                      </div>
                    </div>
                    <div className="flex-1 flex flex-col">
                      <div className="text-base font-semibold mb-1">Gaps</div>
                      <div className="text-sm text-muted-foreground mb-auto">What's assumed, what's missing, and what doesn't connect.</div>
                      <div className="flex items-center mt-3">
                        {cachedGaps && <History className="w-3.5 h-3.5 text-muted-foreground/40" />}
                        <MoveRight className="w-5 h-5 text-muted-foreground/40 ml-auto" />
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            )
          })()}

          {status === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Spinner className="w-6 h-6 opacity-60" />
              Writing…
            </div>
          )}

          {status === 'error' && (
            <div className="text-sm text-[var(--thonk-problem)] py-4">{error}</div>
          )}

          {status === 'ready' && (
            <>
              {stale && savedAt && (
                <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-amber-100 text-sm text-foreground dark:bg-amber-900/40">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Generated {formatDate(savedAt)} · Board has changed since then.</span>
                </div>
              )}
              <div className="prose max-w-none leading-relaxed [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-medium [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_p]:mb-4 [&_p:last-child]:mb-0">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {markdown}
                </ReactMarkdown>
              </div>
            </>
          )}
        </div>

        {status !== 'idle' && (
          <div className="px-6 py-3 border-t border-border flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Button
                size="sm" variant="outline"
                className="h-8 text-sm cursor-pointer"
                onClick={() => { setStatus('idle'); setMode(null) }}
              >
                Back
              </Button>
              {status === 'ready' && mode && (
                <Button
                  size="sm" variant="outline"
                  className="h-8 text-sm gap-1.5 cursor-pointer"
                  onClick={() => run(mode, true)}
                  disabled={status !== 'ready'}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Regenerate
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm" variant="outline"
                className="h-8 text-sm gap-1.5 cursor-pointer"
                onClick={() => { navigator.clipboard.writeText(markdown); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                disabled={status !== 'ready'}
              >
                {copied ? <><Check className="w-3.5 h-3.5" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
              </Button>
              <Button
                size="sm" variant="outline"
                className="h-8 text-sm gap-1.5 cursor-pointer"
                onClick={() => downloadMd(title, markdown)}
                disabled={status !== 'ready'}
              >
                <FileText className="w-3.5 h-3.5" /> .md
              </Button>
              <Button
                size="sm" variant="outline"
                className="h-8 text-sm gap-1.5 cursor-pointer"
                onClick={() => downloadPdf(title, markdown)}
                disabled={status !== 'ready'}
              >
                <Download className="w-3.5 h-3.5" /> PDF
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
