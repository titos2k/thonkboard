import { useState, useCallback, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X, Eye, Edit3, Loader2, Sparkles, Bold, Italic, Heading2, List, Code2, Copy, Check } from 'lucide-react'
import type { ThonkNode } from '@/store/types'
import { generateSummary } from '@/ai/gemini'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface EditorPanelProps {
  node: ThonkNode
  nodes?: ThonkNode[]
  onSave: (id: string, patch: { title?: string; body?: string; summary?: string }) => void
  onClose: () => void
  onNavigateToNode?: (nodeId: string) => void
}

const TYPE_BADGE: Record<string, string> = {
  core:     'bg-[#392946] text-white',
  idea:     'bg-[#f5c44a] text-gray-900',
  problem:  'bg-[#e95a32] text-white',
  question: 'bg-[#f4f6f6] text-gray-900 border border-black/10',
  answer:   'bg-[#00ae60] text-white',
}

function insertAround(
  ta: HTMLTextAreaElement,
  before: string,
  after: string,
  setter: (v: string) => void,
) {
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const selected = ta.value.slice(start, end)
  const next = ta.value.slice(0, start) + before + selected + after + ta.value.slice(end)
  setter(next)
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(start + before.length, end + before.length)
  })
}

function insertLine(ta: HTMLTextAreaElement, prefix: string, setter: (v: string) => void) {
  const start = ta.selectionStart
  const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1
  const next = ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart)
  setter(next)
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(start + prefix.length, start + prefix.length)
  })
}

export function EditorPanel({ node, nodes = [], onSave, onClose, onNavigateToNode }: EditorPanelProps) {
  const [title, setTitle] = useState(node.title)
  const [body, setBody] = useState(node.body)
  const [tab, setTab] = useState<'write' | 'preview'>('preview')
  const [dirty, setDirty] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [copied, setCopied] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const handleCopy = () => {
    const text = [title, body].filter(Boolean).join('\n\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Sync if node prop changes externally (e.g. Approve merges content) while panel is clean
  useEffect(() => {
    if (!dirty) {
      setTitle(node.title)
      setBody(node.body)
    }
  }, [node.title, node.body, dirty])

  const handleSave = useCallback(async () => {
    onSave(node.id, { title, body })
    setDirty(false)
    if (body.trim().length > 15) {
      setSummarizing(true)
      try {
        const summary = await generateSummary(title || node.title, body)
        onSave(node.id, { summary })
      } catch {
        // non-fatal — summary stays stale
      } finally {
        setSummarizing(false)
      }
    } else {
      // Body was cleared — wipe the summary too
      onSave(node.id, { summary: '' })
    }
  }, [node.id, node.title, title, body, onSave])

  // Auto-save on panel close when dirty
  const handleClose = useCallback(() => {
    if (dirty) handleSave()
    onClose()
  }, [dirty, handleSave, onClose])

  const markBody = (v: string) => { setBody(v); setDirty(true) }
  const markTitle = (v: string) => { setTitle(v); setDirty(true) }

  // Toolbar helpers
  const tb = {
    bold:   () => taRef.current && insertAround(taRef.current, '**', '**', markBody),
    italic: () => taRef.current && insertAround(taRef.current, '_', '_', markBody),
    h2:     () => taRef.current && insertLine(taRef.current, '## ', markBody),
    list:   () => taRef.current && insertLine(taRef.current, '- ', markBody),
    code:   () => taRef.current && insertAround(taRef.current, '`', '`', markBody),
  }

  return (
    <div className="fixed right-0 top-0 bottom-0 w-full md:w-[560px] bg-white border-l border-border shadow-2xl z-20 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
        <span className={cn('text-sm font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0', TYPE_BADGE[node.type] ?? 'bg-muted text-muted-foreground')}>
          {node.type}
        </span>
        <Input
          value={title}
          onChange={e => markTitle(e.target.value)}
          placeholder="Title…"
          className="flex-1 h-7 text-sm font-semibold border-0 shadow-none focus-visible:ring-0 px-1 bg-transparent"
        />
        <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={handleClose}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* AI summary bar */}
      {(node.summary || summarizing) && (
        <div className="px-4 py-3 bg-muted/50 border-b border-border text-sm text-muted-foreground flex items-start gap-2.5 shrink-0">
          {summarizing
            ? <><Loader2 className="w-5 h-5 animate-spin mt-0.5 shrink-0" /><span>Generating summary…</span></>
            : <><Sparkles className="w-5 h-5 mt-0.5 shrink-0 text-primary/70" /><span>{node.summary}</span></>
          }
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center border-b border-border shrink-0">
        {(['write', 'preview'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'write' ? <Edit3 className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            {t}
          </button>
        ))}

        {/* Markdown toolbar — only in write mode */}
        {tab === 'write' && (
          <div className="ml-auto flex items-center gap-0.5 pr-2">
            {[
              { icon: <Bold className="w-5 h-5" />, label: 'Bold', fn: tb.bold },
              { icon: <Italic className="w-5 h-5" />, label: 'Italic', fn: tb.italic },
              { icon: <Heading2 className="w-5 h-5" />, label: 'Heading', fn: tb.h2 },
              { icon: <List className="w-5 h-5" />, label: 'List', fn: tb.list },
              { icon: <Code2 className="w-5 h-5" />, label: 'Code', fn: tb.code },
            ].map(({ icon, label, fn }) => (
              <button
                key={label}
                title={label}
                onMouseDown={e => { e.preventDefault(); fn() }}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                {icon}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {tab === 'write' ? (
          <textarea
            ref={taRef}
            value={body}
            onChange={e => markBody(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation()
              if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault()
                handleSave()
              }
            }}
            className="w-full h-full resize-none py-4 pl-4 pr-4 md:pr-6 text-sm font-mono leading-relaxed outline-none bg-transparent"
            placeholder={'Write your description in Markdown…\n\n## Supports\n- **bold**, _italic_, `code`\n- Headers, lists, blockquotes\n\nCtrl+S to save'}
            spellCheck
          />
        ) : (
          <div className="h-full overflow-auto py-4 pl-4 pr-4 md:pr-6 md-preview text-sm">
            {body.trim()
              ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => {
                      // Resolve node:ID links from AI
                      let nodeId: string | undefined
                      if (href?.startsWith('node:')) {
                        nodeId = href.slice(5)
                      } else {
                        // Fallback: match link text against node titles (AI often omits the href)
                        const text = typeof children === 'string' ? children : ''
                        const match = text && nodes.find(n => n.title.trim().toLowerCase() === text.trim().toLowerCase())
                        if (match) nodeId = match.id
                      }
                      if (nodeId) {
                        return (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={() => onNavigateToNode?.(nodeId!)}
                            onKeyDown={e => e.key === 'Enter' && onNavigateToNode?.(nodeId!)}
                            className="node-ref text-primary underline cursor-pointer font-medium hover:opacity-70 transition-opacity"
                          >
                            {children}
                          </span>
                        )
                      }
                      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                    },
                  }}
                >
                  {body}
                </ReactMarkdown>
              )
              : <p className="text-muted-foreground italic">Nothing written yet — switch to Write to add content.</p>
            }
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2.5 border-t border-border flex items-center gap-2 shrink-0">
        <Button size="default" onClick={handleSave} disabled={!dirty}>
          Save
        </Button>
        {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
        <div className="ml-auto flex items-center gap-2">
          <Button size="default" variant="ghost" onClick={handleCopy} className="gap-1.5 text-muted-foreground">
            {copied ? <><Check className="w-5 h-5" /> Copied</> : <><Copy className="w-5 h-5" /> Copy</>}
          </Button>
          <span className="text-sm text-muted-foreground">Markdown · Ctrl+S</span>
        </div>
      </div>
    </div>
  )
}
