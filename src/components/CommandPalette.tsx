import { useState, useRef, useEffect, useMemo } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Search, ThumbsUp, ThumbsDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ThonkNode, ThonkEdge } from '@/store/types'
import type { BoardMeta } from '@/store/types'

const TYPE_DOT: Record<string, string> = {
  note:     'bg-[#f7efd0] border border-black/20',
  idea:     'bg-[#f5c44a]',
  problem:  'bg-[#e95a32]',
  question: 'bg-[#e2e4e4] border border-black/20',
  answer:   'bg-[#00ae60]',
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  nodes: ThonkNode[]
  edges: ThonkEdge[]
  onNavigate: (id: string) => void
  initialScope?: 'this' | 'all'
  otherBoards?: BoardMeta[]
  onLoadBoardNodes?: (boardId: string) => ThonkNode[]
  onNavigateBoard?: (boardId: string, nodeId: string) => void
}

const TYPE_ORDER = ['idea', 'problem', 'question', 'answer', 'note'] as const

type ResultItem = { node: ThonkNode; boardId?: string; boardName?: string }

export function CommandPalette({
  open, onClose, nodes, edges, onNavigate,
  initialScope = 'this', otherBoards = [], onLoadBoardNodes, onNavigateBoard,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'this' | 'all'>(initialScope)
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set())
  const [thumbFilter, setThumbFilter] = useState<'up' | 'down' | null>(null)
  const [undecidedFilter, setUndecidedFilter] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const allBoardsCacheRef = useRef<ResultItem[] | null>(null)

  const showScopeToggle = otherBoards.length > 0

  const presentTypes = useMemo(
    () => TYPE_ORDER.filter(t => nodes.some(n => n.type === t)),
    [nodes],
  )

  const leafNodeIds = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of edges) {
      counts.set(e.source, (counts.get(e.source) ?? 0) + 1)
      counts.set(e.target, (counts.get(e.target) ?? 0) + 1)
    }
    const result = new Set<string>()
    for (const n of nodes) {
      if (n.type === 'core') continue
      if ((counts.get(n.id) ?? 0) <= 1) result.add(n.id)
    }
    return result
  }, [nodes, edges])

  const allBoardsItems = useMemo((): ResultItem[] => {
    if (scope !== 'all' || !onLoadBoardNodes) return []
    if (allBoardsCacheRef.current) return allBoardsCacheRef.current
    const items: ResultItem[] = []
    for (const b of otherBoards) {
      const bNodes = onLoadBoardNodes(b.id)
      for (const n of bNodes) {
        if (n.type === 'core' || n.type === 'source' || n.type === 'note') continue
        items.push({ node: n, boardId: b.id, boardName: b.name })
      }
    }
    allBoardsCacheRef.current = items
    return items
  }, [scope, otherBoards, onLoadBoardNodes])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()

    if (scope === 'all') {
      if (!q && typeFilter.size === 0) return allBoardsItems.slice(0, 100)
      return allBoardsItems.filter(({ node: n }) =>
        (typeFilter.size === 0 || typeFilter.has(n.type)) &&
        (!q || n.title.toLowerCase().includes(q))
      ).slice(0, 100)
    }

    const matches = (n: ThonkNode) =>
      (typeFilter.size === 0 || typeFilter.has(n.type)) &&
      (thumbFilter === null || n.thumb === thumbFilter) &&
      (!undecidedFilter || leafNodeIds.has(n.id)) &&
      (!q || n.title.toLowerCase().includes(q))
    const active   = nodes.filter(n => !n.resolved && matches(n))
    const resolved = nodes.filter(n =>  n.resolved && matches(n))
    return [...active, ...resolved].map(node => ({ node }))
  }, [nodes, query, typeFilter, thumbFilter, undecidedFilter, leafNodeIds, scope, allBoardsItems])

  useEffect(() => {
    if (open) {
      setQuery('')
      setTypeFilter(new Set())
      setThumbFilter(null)
      setUndecidedFilter(false)
      setActiveIdx(0)
      setScope(initialScope)
      allBoardsCacheRef.current = null
    }
  }, [open, initialScope])

  useEffect(() => {
    setActiveIdx(i => Math.min(i, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  useEffect(() => {
    if (!listRef.current || filtered.length === 0) return
    const el = listRef.current.children[activeIdx] as HTMLElement
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, filtered.length])

  const handleSelect = ({ node, boardId }: ResultItem) => {
    if (boardId && onNavigateBoard) {
      onNavigateBoard(boardId, node.id)
    } else {
      onNavigate(node.id)
    }
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[activeIdx]) handleSelect(filtered[activeIdx]) }
  }

  const hasStatusFilter = thumbFilter !== null || undecidedFilter
  const hasAnyFilter = typeFilter.size > 0 || hasStatusFilter

  return (
    <DialogPrimitive.Root open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 dark:bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={e => { e.preventDefault(); inputRef.current?.focus() }}
          className="fixed left-[50%] top-[15%] z-50 w-[calc(100vw-2rem)] max-w-lg translate-x-[-50%] bg-background border border-border rounded-2xl shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">Search nodes</DialogPrimitive.Title>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
              onKeyDown={handleKeyDown}
              placeholder={scope === 'all' ? 'Search all boards…' : 'Search nodes…'}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="text-xs font-mono text-muted-foreground/60 border border-border px-1.5 py-0.5 rounded-sm">Esc</kbd>
          </div>

          {/* Scope toggle */}
          {showScopeToggle && (
            <div className="flex items-center gap-1 px-4 py-2 border-b border-border">
              <button
                onClick={() => { setScope('this'); setActiveIdx(0) }}
                className={cn(
                  'px-3 py-0.5 rounded-full text-sm transition-colors border',
                  scope === 'this'
                    ? 'bg-foreground text-background border-foreground'
                    : 'text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground',
                )}
              >
                This board
              </button>
              <button
                onClick={() => { setScope('all'); setActiveIdx(0) }}
                className={cn(
                  'px-3 py-0.5 rounded-full text-sm transition-colors border',
                  scope === 'all'
                    ? 'bg-foreground text-background border-foreground'
                    : 'text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground',
                )}
              >
                All boards
              </button>
            </div>
          )}

          {/* Row 1: type filters (this board only) */}
          {scope === 'this' && presentTypes.length > 1 && (
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border flex-wrap">
              {presentTypes.map(t => (
                <button
                  key={t}
                  onClick={() => {
                    setTypeFilter(prev => {
                      const next = new Set(prev)
                      next.has(t) ? next.delete(t) : next.add(t)
                      return next
                    })
                    setActiveIdx(0)
                  }}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-sm capitalize transition-colors border',
                    typeFilter.has(t)
                      ? 'bg-foreground text-background border-foreground'
                      : 'text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground',
                  )}
                >
                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', TYPE_DOT[t])} />
                  {t}
                </button>
              ))}
            </div>
          )}

          {/* Row 2: status filters (this board only) */}
          {scope === 'this' && (
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border flex-wrap">
              <button
                onClick={() => { setThumbFilter(f => f === 'up' ? null : 'up'); setActiveIdx(0) }}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-0.5 rounded-full text-sm transition-colors border',
                  thumbFilter === 'up'
                    ? 'text-white border-[#00ae60] bg-[#00ae60]'
                    : 'text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground',
                )}
              >
                <ThumbsUp className="w-3.5 h-3.5" />
                Loved
              </button>
              <button
                onClick={() => { setThumbFilter(f => f === 'down' ? null : 'down'); setActiveIdx(0) }}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-0.5 rounded-full text-sm transition-colors border',
                  thumbFilter === 'down'
                    ? 'text-white border-[#e95a32] bg-[#e95a32]'
                    : 'text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground',
                )}
              >
                <ThumbsDown className="w-3.5 h-3.5" />
                Dropped
              </button>
              <button
                onClick={() => { setUndecidedFilter(f => !f); setActiveIdx(0) }}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-0.5 rounded-full text-sm transition-colors border',
                  undecidedFilter
                    ? 'text-white border-foreground bg-foreground'
                    : 'text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground',
                )}
              >
                Undecided
              </button>
              {hasAnyFilter && (
                <button
                  onClick={() => { setTypeFilter(new Set()); setThumbFilter(null); setUndecidedFilter(false); setActiveIdx(0) }}
                  className="ml-auto text-sm text-muted-foreground underline decoration-dotted hover:text-foreground transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">No nodes found</div>
            ) : filtered.map(({ node, boardId, boardName }, i) => (
              <button
                key={`${boardId ?? ''}:${node.id}`}
                onClick={() => handleSelect({ node, boardId, boardName })}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  node.resolved && 'opacity-40',
                  i === activeIdx ? 'bg-accent' : 'hover:bg-muted',
                )}
              >
                <span className={cn('w-2 h-2 rounded-full shrink-0', TYPE_DOT[node.type] ?? 'bg-muted')} />
                <span className="flex-1 min-w-0">
                  <span className="text-sm truncate block">
                    {node.title || <span className="italic text-muted-foreground">Untitled</span>}
                  </span>
                  {boardName && (
                    <span className="text-xs text-muted-foreground truncate block">{boardName}</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground capitalize shrink-0">{node.type}</span>
              </button>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
