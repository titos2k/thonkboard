import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

// Module-level store: tracks which node was most recently touched.
// useSyncExternalStore ensures ALL node instances re-render synchronously
// in the same commit when it changes — no batching gaps.
let _touchId: string | null = null
const _listeners = new Set<() => void>()
const touchStore = {
  subscribe:   (cb: () => void) => { _listeners.add(cb); return () => _listeners.delete(cb) },
  getSnapshot: () => _touchId,
  set: (id: string | null) => { _touchId = id; _listeners.forEach(l => l()) },
}

// Module-level store: tracks whether the canvas is currently being panned.
let _panning = false
const _panListeners = new Set<() => void>()
export const canvasPanStore = {
  subscribe:   (cb: () => void) => { _panListeners.add(cb); return () => _panListeners.delete(cb) },
  getSnapshot: () => _panning,
  set: (v: boolean) => { if (_panning === v) return; _panning = v; _panListeners.forEach(l => l()) },
}
import { NodeToolbar, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import {
  Angry,
  MessageCircleQuestionMark,
  MessageCirclePlus,
  Lightbulb,
  MessageCircle,
  MessageCircleReply,
  Trash2,
  Pencil,
  TriangleAlert,
  ArrowDownUp,
  GitBranchPlus,
  Brain,
  MessagesSquare,
  MoreHorizontal,
  SpellCheck,
  Copy,
  Sparkles,
  Smile,
  ExternalLink,
  FileInput,
} from 'lucide-react'

function ThumbUpIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" className={className} fill="currentColor">
      <path d="M840-640q32 0 56 24t24 56v80q0 7-1.5 15t-4.5 15L794-168q-9 20-30 34t-44 14H400q-33 0-56.5-23.5T320-200v-407q0-16 6.5-30.5T344-663l217-216q15-14 35.5-17t39.5 7q19 10 27.5 28t3.5 37l-45 184h218ZM160-120q-33 0-56.5-23.5T80-200v-360q0-33 23.5-56.5T160-640q33 0 56.5 23.5T240-560v360q0 33-23.5 56.5T160-120Z"/>
    </svg>
  )
}

function ThumbDownIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" className={className} fill="currentColor">
      <path d="M120-320q-32 0-56-24t-24-56v-80q0-7 1.5-15t4.5-15l120-282q9-20 30-34t44-14h320q33 0 56.5 23.5T640-760v407q0 16-6.5 30.5T616-297L399-81q-15 14-35.5 17T324-71q-19-10-27.5-28t-3.5-37l45-184H120Zm680-520q33 0 56.5 23.5T880-760v360q0 33-23.5 56.5T800-320q-33 0-56.5-23.5T720-400v-360q0-33 23.5-56.5T800-840Z"/>
    </svg>
  )
}
import { NodeShell } from './NodeShell'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ThonkNode as TNode } from '@/store/types'
import { assembleContext, contextToPrompt, assembleContextSemantic } from '@/ai/context'
import { critiqueNode, questionNode, proposeIdeas, pushThinking, detectConflicts, hintConflictResolution, answerQuestion, generateSolution, correctAnswer, fixGrammar } from '@/ai/gemini'
import type { ConflictEntry } from '@/store/types'
import { showToast } from '@/lib/toast'
import { EmojiPickerPopover } from '@/components/EmojiPickerPopover'

const MAX_AI_DEPTH = 3
const CONFLICT_COOLDOWN_MS = 30_000

function mergeConflicts(existing: ConflictEntry[], entry: ConflictEntry): ConflictEntry[] {
  return [...existing.filter(e => e.nodeId !== entry.nodeId), entry]
}

export interface ThonkNodeData extends Record<string, unknown> {
  thonk: TNode
  graphRef: React.MutableRefObject<import('@/store/types').ThonkGraph>
  autoEdit?: boolean
  onAddNode: (
    type: TNode['type'],
    title: string,
    body: string,
    position: { x: number; y: number },
    meta?: Partial<TNode['meta']>,
  ) => TNode
  onAddEdge: (source: string, target: string, relation: import('@/store/types').EdgeRelation, sourceHandle?: string, targetHandle?: string) => void
  onUpdate: (id: string, patch: Partial<Pick<TNode, 'title' | 'body' | 'summary' | 'resolved' | 'resolvedAs' | 'conflicts' | 'type' | 'placeholder' | 'thumb' | 'emoji' | 'userTitleEdited' | 'nodeWidth' | 'nodeHeight'>> & { meta?: Partial<TNode['meta']> }) => void
  onDelete: (id: string) => void
  onOpenAsNewBoard?: (node: TNode) => void
  onResetBoard?: () => void
  onVersionCore: (oldId: string, newTitle: string, newBody: string, pos: { x: number; y: number }) => TNode
  hasAnswer: boolean
  aiConnected: boolean
  hiddenNodeIds?: Set<string>
  isCollapsed?: boolean
  hasChildren?: boolean
  hiddenDescendantCount?: number
  hiddenConflictCount?: number
  onExpand?: (id: string) => void
  onCollapse?: (id: string) => void
  onAutoEdit: (id: string) => void
  onBatchStart: () => void
  onBatchEnd: () => void
  isMultiSelected?: boolean
  highlighted?: boolean
}

type ActionState = 'idle' | 'loading' | 'searching' | 'answering' | 'correcting' | 'asking' | 'pushing'

function stopDeletePropagation(e: React.KeyboardEvent) {
  if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation()
}

function autoWidth(text: string): number {
  const len = text.trim().length
  return Math.round(Math.max(150, Math.min(280, 80 + Math.sqrt(len) * 13)) / 10) * 10
}

const URL_RE = /https?:\/\/[^\s)>\],"']+|(?<!\w)(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s)>\],"']*)?/gi
function linkifyText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const url = m[0].replace(/[.,;:!?)"']+$/, '')
    const href = url.startsWith('http') ? url : `https://${url}`
    parts.push(
      <a key={m.index} href={href}
        className="underline text-blue-300 hover:text-blue-200 break-all cursor-pointer"
        onClick={e => { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new CustomEvent('thonk:openlink', { detail: { url: href, x: e.clientX, y: e.clientY } })) }}
      >{url}</a>
    )
    last = m.index + url.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length > 1 ? <>{parts}</> : text
}

type Dir = 'down' | 'up' | 'left' | 'right'


function nodeSpawnDir(
  nodeId: string,
  graph: { nodes: { id: string; position: { x: number; y: number } }[]; edges: { source: string; target: string }[] },
): Dir {
  const node = graph.nodes.find(n => n.id === nodeId)
  if (!node) return 'down'

  // If this node has a parent, use the direction from parent → this node
  const parentEdge = graph.edges.find(e => e.target === nodeId)
  if (parentEdge) {
    const parent = graph.nodes.find(n => n.id === parentEdge.source)
    if (parent) {
      const vx = node.position.x - parent.position.x
      const vy = node.position.y - parent.position.y
      if (Math.abs(vx) > Math.abs(vy)) return vx > 0 ? 'right' : 'left'
      return vy >= 0 ? 'down' : 'up'
    }
  }

  // No parent (root node): pick the direction with the fewest existing children
  const children = graph.edges
    .filter(e => e.source === nodeId)
    .map(e => graph.nodes.find(n => n.id === e.target))
    .filter(Boolean) as { id: string; position: { x: number; y: number } }[]
  if (children.length > 0) {
    const counts: Record<Dir, number> = { right: 0, left: 0, down: 0, up: 0 }
    for (const c of children) {
      const vx = c.position.x - node.position.x
      const vy = c.position.y - node.position.y
      const d: Dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : (vy >= 0 ? 'down' : 'up')
      counts[d]++
    }
    const min = Math.min(...Object.values(counts))
    return (Object.entries(counts) as [Dir, number][]).find(([, v]) => v === min)![0]
  }

  return 'down'
}

function dirOffset(dir: Dir, vertDist: number, horizDist = 300): { dx: number; dy: number } {
  switch (dir) {
    case 'up':    return { dx: 0, dy: -vertDist }
    case 'left':  return { dx: -horizDist, dy: 0 }
    case 'right': return { dx: horizDist, dy: 0 }
    default:      return { dx: 0, dy: vertDist }
  }
}

function dirHandles(dir: Dir): { sourceHandle: string; targetHandle: string } {
  switch (dir) {
    case 'up':    return { sourceHandle: 's-top',    targetHandle: 't-bottom' }
    case 'left':  return { sourceHandle: 's-left',   targetHandle: 't-right'  }
    case 'right': return { sourceHandle: 's-right',  targetHandle: 't-left'   }
    default:      return { sourceHandle: 's-bottom', targetHandle: 't-top'    }
  }
}

function computeDir(from: { x: number; y: number }, to: { x: number; y: number }): Dir {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy >= 0 ? 'down' : 'up'
}

// Pre-compute N spread positions perpendicular to dir, centered on origin + primary offset.
// For down/up directions, nodes fan out left-right. For left/right, they fan out up-down.
function spawnFan(
  origin: { x: number; y: number },
  dir: Dir,
  count: number,
  primaryDist: number,
  spacing = 300,
): { x: number; y: number }[] {
  const half = (count - 1) / 2
  return Array.from({ length: count }, (_, i) => {
    const perp = (i - half) * spacing
    switch (dir) {
      case 'up':    return { x: origin.x + perp, y: origin.y - primaryDist }
      case 'left':  return { x: origin.x - primaryDist, y: origin.y + perp }
      case 'right': return { x: origin.x + primaryDist, y: origin.y + perp }
      default:      return { x: origin.x + perp, y: origin.y + primaryDist }
    }
  })
}

// Find a position near `origin + (dx, dy)` that doesn't collide with existing nodes.
function findFreePos(
  nodes: { position: { x: number; y: number } }[],
  origin: { x: number; y: number },
  dx = 0,
  dy = 220,
  dir: Dir = 'down',
): { x: number; y: number } {
  const W = 260  // approx node width + gap
  const H = 100  // approx node height + gap
  const preferred = { x: origin.x + dx, y: origin.y + dy }
  const candidates: { x: number; y: number }[] = []
  for (let primary = 0; primary <= 4; primary++) {
    for (let secondary = -4; secondary <= 4; secondary++) {
      switch (dir) {
        case 'up':    candidates.push({ x: preferred.x + secondary * W, y: preferred.y - primary * H }); break
        case 'left':  candidates.push({ x: preferred.x - primary * W,   y: preferred.y + secondary * H }); break
        case 'right': candidates.push({ x: preferred.x + primary * W,   y: preferred.y + secondary * H }); break
        default:      candidates.push({ x: preferred.x + secondary * W, y: preferred.y + primary * H })
      }
    }
  }
  candidates.sort((a, b) =>
    Math.hypot(a.x - preferred.x, a.y - preferred.y) -
    Math.hypot(b.x - preferred.x, b.y - preferred.y),
  )
  for (const pos of candidates) {
    if (!nodes.some(n => Math.abs(n.position.x - pos.x) < W && Math.abs(n.position.y - pos.y) < H))
      return pos
  }
  return preferred
}

function ThonkNodeComponentFn({ data, selected, dragging }: NodeProps) {
  const d = data as ThonkNodeData
  const { thonk, graphRef } = d
  const { getNode, setCenter, getZoom } = useReactFlow()

  const panToSpawned = useCallback((ids: string[]) => {
    requestAnimationFrame(() => {
      const rects = ids.map(id => getNode(id)).filter(Boolean)
      if (!rects.length) return
      const cx = rects.reduce((s, n) => s + n!.position.x + (n!.measured?.width ?? 200) / 2, 0) / rects.length
      const cy = rects.reduce((s, n) => s + n!.position.y + (n!.measured?.height ?? 80) / 2, 0) / rects.length
      setCenter(cx, cy, { duration: 400, zoom: getZoom() })
    })
  }, [getNode, setCenter, getZoom])

  const [editing, setEditing] = useState(() => !!d.autoEdit)
  const [editTitle, setEditTitle] = useState(thonk.title)
  const [actionState, setActionState] = useState<ActionState>('idle')
  const activeTouchId = useSyncExternalStore(touchStore.subscribe, touchStore.getSnapshot)

  // Once React Flow propagates selection for THIS node, release the touch lock.
  useEffect(() => {
    if (touchStore.getSnapshot() === thonk.id) touchStore.set(null)
  }, [selected, thonk.id])
  const [answerText, setAnswerText] = useState('')
  const [correctionText, setCorrectionText] = useState('')

  const [askText, setAskText] = useState('')
  const [pushText, setPushText] = useState('')

  // Close answer/correction/ask/push input on outside tap/click
  useEffect(() => {
    if (actionState !== 'answering' && actionState !== 'correcting' && actionState !== 'asking' && actionState !== 'pushing') return
    const handler = (e: PointerEvent) => {
      const nodeEl = document.querySelector(`[data-id="${thonk.id}"]`)
      if (nodeEl && !nodeEl.contains(e.target as Node)) {
        setAnswerText('')
        setCorrectionText('')
        setAskText('')
        setPushText('')
        setActionState('idle')
      }
    }
    window.addEventListener('pointerdown', handler)
    return () => window.removeEventListener('pointerdown', handler)
  }, [actionState, thonk.id])

  // Bidirectional conflict attribution: writes conflict entries on BOTH the updated node and
  // each node it conflicts with, fixes array-overwrite bug, and fetches resolution hints async.
  const applyConflicts = useCallback((
    updatedId: string,
    updatedTitle: string,
    cs: import('@/ai/gemini').ConflictItem[],
    candidates: TNode[],
  ) => {
    const graph = graphRef.current
    const valid = cs.filter(c => candidates.some(n => n.id === c.nodeId))
    if (valid.length === 0) return
    let updatedNodeConflicts = [...(graph.nodes.find(n => n.id === updatedId)?.conflicts ?? [])]
    for (const c of valid) {
      const otherNode = graph.nodes.find(n => n.id === c.nodeId)
      if (!otherNode) continue
      d.onUpdate(c.nodeId, { conflicts: mergeConflicts(otherNode.conflicts ?? [], { nodeId: updatedId, description: c.description }) })
      updatedNodeConflicts = mergeConflicts(updatedNodeConflicts, { nodeId: c.nodeId, description: c.description })
      hintConflictResolution(updatedTitle, otherNode.title, c.description)
        .then(hint => {
          const patch = (targetId: string, partnerId: string) => {
            const node = graphRef.current.nodes.find(n => n.id === targetId)
            if (!node) return
            d.onUpdate(targetId, { conflicts: node.conflicts.map(e => e.nodeId === partnerId ? { ...e, hint } : e) })
          }
          patch(c.nodeId, updatedId)
          patch(updatedId, c.nodeId)
        }).catch(() => {})
    }
    d.onUpdate(updatedId, { conflicts: updatedNodeConflicts })
  }, [d, graphRef])

  const titleInputRef = useRef<HTMLTextAreaElement>(null)
  const answerRef = useRef<HTMLTextAreaElement>(null)
  const correctionRef = useRef<HTMLTextAreaElement>(null)
  const askRef = useRef<HTMLTextAreaElement>(null)
  const pushRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      // setTimeout instead of rAF so we run after Radix dropdown's onCloseAutoFocus
      // focus-restore, which fires asynchronously and would steal focus back.
      const id = setTimeout(() => {
        titleInputRef.current?.focus()
        titleInputRef.current?.select()
      }, 0)
      return () => clearTimeout(id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    if (!editing || !titleInputRef.current) return
    const el = titleInputRef.current
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [editing, editTitle])

  // Only sync editTitle from store when the store title actually changes externally.
  // Do NOT include `editing` — resetting on editing→false would clobber a pending save
  // before the store catches up, causing AI actions to see the old title.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editing) setEditTitle(thonk.title)
  }, [thonk.title])

  const isAnswering  = actionState === 'answering'
  const isCorrecting = actionState === 'correcting'
  const isAsking     = actionState === 'asking'
  const isPushing    = actionState === 'pushing'

  useEffect(() => {
    if (isAnswering) requestAnimationFrame(() => answerRef.current?.focus())
  }, [isAnswering])

  useEffect(() => {
    if (isCorrecting) requestAnimationFrame(() => correctionRef.current?.focus())
  }, [isCorrecting])

  useEffect(() => {
    if (isAsking) requestAnimationFrame(() => askRef.current?.focus())
  }, [isAsking])

  useEffect(() => {
    if (isPushing) requestAnimationFrame(() => pushRef.current?.focus())
  }, [isPushing])

  const hasContent = thonk.body.trim().length > 0 || thonk.title.trim().length > 0

  // Read position from graphRef (always reflects latest store) rather than thonk.position
  // (data prop), which can lag after a drag due to the positionUpdateRef skip in App.tsx.
  const livePos = useCallback(
    () => graphRef.current.nodes.find(n => n.id === thonk.id)?.position ?? thonk.position,
    [thonk.id, thonk.position, graphRef],
  )
  const spawnPos = useCallback(
    (dx: number, dy: number) => { const p = livePos(); return { x: p.x + dx, y: p.y + dy } },
    [livePos],
  )
  // Height of this node as rendered, used to place children below the actual bottom edge.
  const nodeH = useCallback(
    () => (getNode(thonk.id)?.measured?.height ?? 120) + 60,
    [getNode, thonk.id],
  )

  const withLoading = useCallback(async (fn: () => Promise<void>) => {
    setActionState('loading')
    d.onBatchStart()
    try { await fn() }
    catch (e) { showToast(e instanceof Error ? e.message : String(e)) }
    finally {
      d.onBatchEnd()
      setActionState('idle')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const withSearchLoading = useCallback(async (fn: () => Promise<void>) => {
    setActionState('searching')
    d.onBatchStart()
    try { await fn() }
    catch (e) { showToast(e instanceof Error ? e.message : String(e)) }
    finally {
      d.onBatchEnd()
      setActionState('idle')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = (opts?: Parameters<typeof contextToPrompt>[1]) => {
    const c = assembleContext(graphRef.current, thonk.id)
    if (!c) throw new Error('Node not found in graph')
    const liveTitle = editTitle.trim() || c.target.title
    if (liveTitle === c.target.title) return contextToPrompt(c, opts)
    return contextToPrompt({
      ...c,
      target: { ...c.target, title: liveTitle, body: liveTitle },
      neighbors: c.neighbors.map(n => n.id === thonk.id ? { ...n, title: liveTitle } : n),
      skeleton: { ...c.skeleton, nodes: c.skeleton.nodes.map(n => n.id === thonk.id ? { ...n, title: liveTitle } : n) },
    }, opts)
  }

  const ctxSemantic = () => {
    const prompt = assembleContextSemantic(graphRef.current, thonk.id)
    if (!prompt) throw new Error('Node not found in graph')
    return prompt
  }

  const saveTitle = useCallback(() => {
    if (editTitle.trim() !== thonk.title) {
      const newTitle = editTitle.trim() || thonk.title
      // For question nodes body mirrors the title (no sidebar to edit it separately)
      const bodyPatch = thonk.type === 'question' ? { body: newTitle } : {}
      d.onUpdate(thonk.id, { title: newTitle, ...bodyPatch, placeholder: false, meta: { aiGenerated: false, yesNo: false } })
      if (
        (thonk.type === 'core' || thonk.type === 'idea' || thonk.type === 'problem') &&
        newTitle
      ) {
        const graph = graphRef.current
        const candidates = graph.nodes.filter(n =>
          n.id !== thonk.id &&
          (n.resolvedAs === 'merged' || !n.resolved) &&
          (n.type === 'core' || n.type === 'idea' || n.type === 'problem')
        )
        const checkedAt = graph.nodes.find(n => n.id === thonk.id)?.meta.conflictCheckedAt ?? 0
        if (candidates.length > 0 && Date.now() - checkedAt >= CONFLICT_COOLDOWN_MS) {
          detectConflicts(newTitle, thonk.body, candidates.map(n => ({
            id: n.id, type: n.type, title: n.title, body: n.body, summary: n.summary,
          }))).then(cs => applyConflicts(thonk.id, newTitle, cs, candidates)).catch(() => {})
        }
      }
    } else if (thonk.meta.aiGenerated || thonk.meta.yesNo) {
      d.onUpdate(thonk.id, { meta: { aiGenerated: false, yesNo: false } })
    }
    setEditing(false)
  }, [editTitle, thonk.title, thonk.type, thonk.body, thonk.id, thonk.meta.aiGenerated, thonk.meta.yesNo, d, graphRef, applyConflicts])

  const enterEdit = () => {
    // flushSync renders the textarea into the DOM synchronously so focus() is
    // called within the same user-gesture stack — required for iOS keyboard.
    flushSync(() => {
      setEditTitle(thonk.title)
      setEditing(true)
    })
    titleInputRef.current?.focus()
    titleInputRef.current?.select()
  }

  const handleArgue = () =>
    withLoading(async () => {
      const problems = await critiqueNode(ctx({ omitSource: true }))
      const dir = nodeSpawnDir(thonk.id, graphRef.current)
      const { sourceHandle, targetHandle } = dirHandles(dir)
      const childDepth = thonk.meta.aiGenerated ? (thonk.meta.aiDepth ?? 0) + 1 : 0
      const anchors = spawnFan(livePos(), dir, problems.length, nodeH())
      const placed: { position: { x: number; y: number } }[] = []
      const ids: string[] = []
      for (let i = 0; i < problems.length; i++) {
        const p = problems[i]
        const pos = findFreePos([...graphRef.current.nodes, ...placed], anchors[i], 0, 0, dir)
        placed.push({ position: pos })
        const node = d.onAddNode('problem', p.content, p.content, pos, { severity: p.severity, aiGenerated: true, aiDepth: childDepth })
        d.onUpdate(node.id, { nodeWidth: autoWidth(p.content) })
        d.onAddEdge(thonk.id, node.id, 'argues', sourceHandle, targetHandle)
        ids.push(node.id)
      }
      if (problems.length === 0) showToast('No significant problems found — idea holds up.')
      else panToSpawned(ids)
    })

  const handleQuestion = () =>
    withLoading(async () => {
      const semanticCtx = ctxSemantic()
      const connectedIds = new Set(
        graphRef.current.edges
          .filter(e => e.source === thonk.id || e.target === thonk.id)
          .flatMap(e => [e.source, e.target]),
      )
      const existingQs = graphRef.current.nodes
        .filter(n => n.type === 'question' && connectedIds.has(n.id))
        .map(n => n.title)
        .filter(Boolean) as string[]
      const prompt = existingQs.length > 0
        ? `${semanticCtx}\n\nALREADY ASKED (do not repeat or rephrase): ${existingQs.join(' / ')}`
        : semanticCtx
      const result = await questionNode(prompt)
      const dir = nodeSpawnDir(thonk.id, graphRef.current)
      const { dx, dy } = dirOffset(dir, nodeH())
      const { sourceHandle, targetHandle } = dirHandles(dir)
      const pos = findFreePos(graphRef.current.nodes, livePos(), dx, dy, dir)
      const qNode = d.onAddNode('question', result.question, result.question, pos, { aiGenerated: true, yesNo: result.yesNo === true })
      d.onUpdate(qNode.id, { nodeWidth: autoWidth(result.question) })
      d.onAddEdge(thonk.id, qNode.id, 'questions', sourceHandle, targetHandle)
      panToSpawned([qNode.id])
      setActionState('answering')
    })

  const handleAddQuestion = () => {
    const dir = nodeSpawnDir(thonk.id, graphRef.current)
    const { dx, dy } = dirOffset(dir, nodeH())
    const { sourceHandle, targetHandle } = dirHandles(dir)
    const pos = findFreePos(graphRef.current.nodes, livePos(), dx, dy, dir)
    const qNode = d.onAddNode('question', '', '', pos)
    d.onAddEdge(thonk.id, qNode.id, 'questions', sourceHandle, targetHandle)
    panToSpawned([qNode.id])
    d.onAutoEdit(qNode.id)
  }

  const handlePropose = () =>
    withLoading(async () => {
      const ideas = await proposeIdeas(ctx())
      const dir = nodeSpawnDir(thonk.id, graphRef.current)
      const { sourceHandle, targetHandle } = dirHandles(dir)
      const anchors = spawnFan(livePos(), dir, ideas.length, nodeH())
      const placed: { position: { x: number; y: number } }[] = []
      const ids: string[] = []
      for (let i = 0; i < ideas.length; i++) {
        const idea = ideas[i]
        const pos = findFreePos([...graphRef.current.nodes, ...placed], anchors[i], 0, 0, dir)
        placed.push({ position: pos })
        const node = d.onAddNode('idea', idea.title, idea.body, pos, { aiGenerated: true, aiDepth: thonk.meta.aiGenerated ? (thonk.meta.aiDepth ?? 0) + 1 : 0 })
        d.onUpdate(node.id, { nodeWidth: autoWidth(idea.title) })
        d.onAddEdge(thonk.id, node.id, 'spawns', sourceHandle, targetHandle)
        ids.push(node.id)
      }
      panToSpawned(ids)
    })

  const handlePushThinking = (hint?: string) =>
    withLoading(async () => {
      const contextPrompt = hint ? `${ctx()}\n\nFOCUS DIRECTION: ${hint}` : ctx()
      const items = await pushThinking(contextPrompt)
      const src = livePos()
      const DIRS: Dir[] = ['right', 'down', 'left', 'up']
      const primaryIdx = DIRS.indexOf(nodeSpawnDir(thonk.id, graphRef.current))
      const typeDirs: Record<string, Dir> = {
        idea:     DIRS[primaryIdx],
        question: DIRS[(primaryIdx + 1) % 4],
        problem:  DIRS[(primaryIdx + 3) % 4],
      }
      const byType: Record<string, typeof items> = { idea: [], question: [], problem: [] }
      for (const item of items) byType[item.type].push(item)

      const placed: { position: { x: number; y: number } }[] = []
      const ids: string[] = []
      const aiDepth = thonk.meta.aiGenerated ? (thonk.meta.aiDepth ?? 0) + 1 : 0

      for (const type of ['idea', 'question', 'problem'] as const) {
        const group = byType[type]
        if (!group.length) continue
        const dir = typeDirs[type]
        const anchors = spawnFan(src, dir, group.length, nodeH())
        for (let i = 0; i < group.length; i++) {
          const item = group[i]
          const pos = findFreePos([...graphRef.current.nodes, ...placed], anchors[i], 0, 0, dir)
          placed.push({ position: pos })
          const actualDir = computeDir(src, pos)
          const { sourceHandle, targetHandle } = dirHandles(actualDir)
          const relation = type === 'question' ? 'questions' : type === 'problem' ? 'argues' : 'spawns'
          const node = d.onAddNode(type, item.title, item.body, pos, { aiGenerated: true, aiDepth })
          d.onUpdate(node.id, { nodeWidth: autoWidth(item.title) })
          d.onAddEdge(thonk.id, node.id, relation, sourceHandle, targetHandle)
          ids.push(node.id)
        }
      }
      panToSpawned(ids)
      setPushText('')
      setActionState('idle')
    })

  const handleAskAndAnswer = () => {
    const question = askText.trim()
    if (!question) return
    setAskText('')
    withSearchLoading(async () => {
      const semanticCtx = assembleContextSemantic(graphRef.current, thonk.id)
      if (!semanticCtx) return
      const { answer } = await answerQuestion(`${semanticCtx}\n\nQUESTION: ${question}`)
      const dir = nodeSpawnDir(thonk.id, graphRef.current)
      const { dx, dy } = dirOffset(dir, nodeH())
      const { sourceHandle, targetHandle } = dirHandles(dir)
      const qPos = findFreePos(graphRef.current.nodes, livePos(), dx, dy, dir)
      const qNode = d.onAddNode('question', question, question, qPos)
      d.onUpdate(qNode.id, { nodeWidth: autoWidth(question) })
      d.onAddEdge(thonk.id, qNode.id, 'questions', sourceHandle, targetHandle)
      const { dx: adx, dy: ady } = dirOffset(dir, 140)
      const aPos = findFreePos(graphRef.current.nodes, { x: qPos.x + adx, y: qPos.y + ady }, adx, ady, dir)
      const aNode = d.onAddNode('answer', answer, answer, aPos, {
        aiGenerated: true,
      })
      d.onUpdate(aNode.id, { nodeWidth: autoWidth(answer) })
      d.onAddEdge(qNode.id, aNode.id, 'answers', sourceHandle, targetHandle)
      panToSpawned([qNode.id, aNode.id])
    })
  }

  const handleAnswer = () => {
    if (!answerText.trim()) return
    const raw = answerText.trim()
    const relation = thonk.type === 'problem' ? 'fixes' : 'answers'
    const dir = nodeSpawnDir(thonk.id, graphRef.current)
    const { dx, dy } = dirOffset(dir, nodeH())
    const { sourceHandle, targetHandle } = dirHandles(dir)
    const aNode = d.onAddNode('answer', raw, raw, spawnPos(dx, dy))
    d.onAddEdge(thonk.id, aNode.id, relation, sourceHandle, targetHandle)
    panToSpawned([aNode.id])
    setAnswerText('')
    setActionState('idle')
    if (raw.slice(-4).includes('?')) {
      showToast('That looks like a question - convert it?', 'success', {
        label: 'Convert',
        onClick: () => d.onUpdate(aNode.id, { type: 'question' }),
      })
    }
  }

  const handleQuickAnswer = (text: 'Yes' | 'No') => {
    const dir = nodeSpawnDir(thonk.id, graphRef.current)
    const { dx, dy } = dirOffset(dir, nodeH())
    const { sourceHandle, targetHandle } = dirHandles(dir)
    const aNode = d.onAddNode('answer', text, text, spawnPos(dx, dy))
    d.onAddEdge(thonk.id, aNode.id, 'answers', sourceHandle, targetHandle)
    panToSpawned([aNode.id])
  }

  const handleIdeateAnswer = () =>
    withSearchLoading(async () => {
      const { answer } = await answerQuestion(ctxSemantic())
      const dir = nodeSpawnDir(thonk.id, graphRef.current)
      const { dx, dy } = dirOffset(dir, nodeH())
      const { sourceHandle, targetHandle } = dirHandles(dir)
      const aNode = d.onAddNode('answer', answer, answer, spawnPos(dx, dy), {
        aiGenerated: true,
      })
      d.onUpdate(aNode.id, { nodeWidth: autoWidth(answer) })
      d.onAddEdge(thonk.id, aNode.id, 'answers', sourceHandle, targetHandle)
      panToSpawned([aNode.id])
    })

  const handleGenerateFix = () =>
    withSearchLoading(async () => {
      const { answer } = await generateSolution(ctxSemantic())
      const dir = nodeSpawnDir(thonk.id, graphRef.current)
      const { dx, dy } = dirOffset(dir, nodeH())
      const { sourceHandle, targetHandle } = dirHandles(dir)
      const aNode = d.onAddNode('answer', answer, answer, spawnPos(dx, dy), {
        aiGenerated: true,
        aiDepth: thonk.meta.aiGenerated ? (thonk.meta.aiDepth ?? 0) + 1 : 0,
      })
      d.onUpdate(aNode.id, { nodeWidth: autoWidth(answer) })
      d.onAddEdge(thonk.id, aNode.id, 'fixes', sourceHandle, targetHandle)
      panToSpawned([aNode.id])
    })

  const handleCorrect = () => {
    const text = correctionText.trim()
    if (!text) return
    setCorrectionText('')
    withLoading(async () => {
      const { answer } = await correctAnswer(ctxSemantic(), thonk.title, text)
      d.onUpdate(thonk.id, { title: answer, body: answer })
    })
  }

  const handleAddIdea = () => {
    const dir = nodeSpawnDir(thonk.id, graphRef.current)
    const h = nodeH()
    const isVertical = dir === 'down' || dir === 'up'
    const spreadDx = isVertical ? -200 : dirOffset(dir, h).dx
    const spreadDy = isVertical ? dirOffset(dir, h).dy : -200
    const { sourceHandle, targetHandle } = dirHandles(dir)
    const pos = findFreePos(graphRef.current.nodes, livePos(), spreadDx, spreadDy, dir)
    const node = d.onAddNode('idea', '', '', pos)
    d.onAddEdge(thonk.id, node.id, 'spawns', sourceHandle, targetHandle)
    panToSpawned([node.id])
    d.onAutoEdit(node.id)
  }

  const handleAddProblem = () => {
    const dir = nodeSpawnDir(thonk.id, graphRef.current)
    const { dx, dy } = dirOffset(dir, nodeH())
    const { sourceHandle, targetHandle } = dirHandles(dir)
    const pos = findFreePos(graphRef.current.nodes, livePos(), dx, dy, dir)
    const node = d.onAddNode('problem', '', '', pos, { severity: 0.5 })
    d.onAddEdge(thonk.id, node.id, 'argues', sourceHandle, targetHandle)
    panToSpawned([node.id])
    d.onAutoEdit(node.id)
  }

  const handleTransform = (newType: TNode['type']) => {
    d.onUpdate(thonk.id, { type: newType })
  }

  const handleFixGrammar = () =>
    withLoading(async () => {
      const text = thonk.title.trim()
      if (!text) return
      const { fixed } = await fixGrammar(text)
      if (fixed && fixed !== text) {
        const bodyPatch = thonk.type === 'question' ? { body: fixed } : {}
        d.onUpdate(thonk.id, { title: fixed, ...bodyPatch })
      }
    })

  const handleCopyText = () => {
    const parts = [thonk.title, thonk.body].map(s => s?.trim()).filter(Boolean)
    navigator.clipboard.writeText(parts.join('\n\n'))
    showToast('Copied', 'success')
  }

  const handleThumbUp   = () => d.onUpdate(thonk.id, { thumb: thonk.thumb === 'up'   ? undefined : 'up'   })
  const handleThumbDown = () => d.onUpdate(thonk.id, { thumb: thonk.thumb === 'down' ? undefined : 'down' })

  const [emojiAnchor, setEmojiAnchor] = useState<DOMRect | null>(null)
  const canSetEmoji = thonk.type === 'core' || thonk.type === 'idea'

  const isLoading = actionState === 'loading' || actionState === 'searching'
  const isLight = thonk.type === 'question' || thonk.type === 'idea'

  const aiDepth = thonk.meta.aiDepth ?? 0
  const depthHeat = aiDepth > 0 ? Math.min(aiDepth / MAX_AI_DEPTH, 1) : 0
  const argueLabel = depthHeat >= 1 ? 'Find Problems (AI Fatigue)' : depthHeat > 0 ? 'Find Problems (AI Fatigue Warning)' : 'Find Problems'
  const fixLabel   = depthHeat >= 1 ? 'Suggest Solution (AI Fatigue)' : depthHeat > 0 ? 'Suggest Solution (AI Fatigue Warning)' : 'Suggest Solution'

  const showEdit         = !editing

  // Collapsed nodes stay in React Flow's layout (so edges can still route to them)
  // but are visually invisible and non-interactive.
  if (d.isCollapsed) {
    return (
      <div style={{ opacity: 0, pointerEvents: 'none' }} className="[&_.react-flow__handle]:!pointer-events-none">
        <NodeShell nodeType={thonk.type}>
          <div className="px-3 py-2.5 font-medium text-sm">{thonk.title || ' '}</div>
        </NodeShell>
      </div>
    )
  }

  return (
    <>
    <NodeShell nodeType={thonk.type} selected={selected} resolved={thonk.resolved} aiGenerated={thonk.meta.aiGenerated} highlighted={d.highlighted} dimmed={thonk.thumb === 'down'} onPointerDown={e => { if (e.pointerType === 'touch') touchStore.set(thonk.id) }} resizable={true} nodeWidth={thonk.nodeWidth} onResized={(w) => d.onUpdate(thonk.id, { nodeWidth: w })} minWidth={120} minHeight={40}>
      {/* Floating toolbar above node — inside NodeShell so RF drag registration stays on NodeShell root */}
      <NodeToolbar isVisible={(activeTouchId === null ? selected : activeTouchId === thonk.id) && !d.isMultiSelected && !thonk.placeholder && !dragging && !isLoading && !isAnswering && !isCorrecting && !isAsking && !isPushing && !editing} position={Position.Top} offset={8}>
        <div className="nodrag flex items-center gap-0.5 bg-gray-900 rounded-lg px-1.5 py-1 shadow-xl border border-white/10">

          <>
            {/* Primary action button — Answer for questions, Reply for problems */}
            {(thonk.type === 'question' || thonk.type === 'problem') && (
              <>
                <button
                  onClick={() => thonk.title.trim() ? setActionState('answering') : enterEdit()}
                  className="nodrag flex items-center gap-1.5 h-8 px-3 rounded-sm text-sm font-medium bg-emerald-400 hover:bg-emerald-500 text-emerald-950 transition-colors cursor-pointer"
                >
                  <MessageCircleReply className="w-5 h-5" />
                  {thonk.type === 'problem' ? 'Reply' : 'Answer'}
                </button>
                {thonk.type === 'question' && thonk.meta.yesNo && !d.hasAnswer && (
                  <>
                    <button onClick={() => handleQuickAnswer('Yes')}
                      className="nodrag h-8 px-2.5 rounded-sm text-sm font-medium bg-emerald-400 hover:bg-emerald-500 text-emerald-950 transition-colors cursor-pointer">
                      Yes
                    </button>
                    <button onClick={() => handleQuickAnswer('No')}
                      className="nodrag h-8 px-2.5 rounded-sm text-sm font-medium bg-emerald-400 hover:bg-emerald-500 text-emerald-950 transition-colors cursor-pointer">
                      No
                    </button>
                  </>
                )}
                <Sep />
              </>
            )}

            {/* Section 1: AI */}
            {(thonk.type === 'core' || thonk.type === 'idea') && (
              <>
                <ToolBtn icon={<Sparkles className="w-5 h-5" />} label="Push Thinking" onClick={() => setActionState('pushing')} disabled={!hasContent} aiDisabled={!d.aiConnected} className="text-purple-400" />
                <ToolBtn icon={<MessageCircleQuestionMark className="w-5 h-5" />} label="Ask me" onClick={handleQuestion} disabled={!hasContent} aiDisabled={!d.aiConnected} className="text-green-400" />
                <ToolBtn icon={<MessagesSquare className="w-5 h-5" />} label="Answer me..." onClick={() => setActionState('asking')} disabled={!hasContent} aiDisabled={!d.aiConnected} className="text-blue-300" />
                <ToolBtn icon={<Angry className="w-5 h-5" />} label={argueLabel} onClick={handleArgue} disabled={!hasContent} aiDisabled={!d.aiConnected} className="text-red-400" heat={depthHeat} />
                <ToolBtn icon={<Lightbulb className="w-5 h-5" />} label="Generate Ideas" onClick={handlePropose} disabled={!hasContent} aiDisabled={!d.aiConnected} className="text-yellow-400" />
              </>
            )}
            {thonk.type === 'problem' && (
              <>
                <ToolBtn icon={<MessagesSquare className="w-5 h-5" />} label="Answer me..." onClick={() => setActionState('asking')} disabled={!hasContent} aiDisabled={!d.aiConnected} className="text-blue-300" />
                <ToolBtn icon={<Lightbulb className="w-5 h-5" />} label={fixLabel} onClick={handleGenerateFix} disabled={!hasContent} aiDisabled={!d.aiConnected} className="text-green-400" heat={depthHeat} />
              </>
            )}
            {thonk.type === 'question' && (
              <ToolBtn icon={<Lightbulb className="w-5 h-5" />} label="Generate Answer" onClick={handleIdeateAnswer} aiDisabled={!d.aiConnected} className="text-emerald-300" />
            )}
            {thonk.type === 'answer' && (
              <>
                <ToolBtn icon={<MessageCircleQuestionMark className="w-5 h-5" />} label="Ask me" onClick={handleQuestion} disabled={!hasContent} aiDisabled={!d.aiConnected} className="text-green-400" />
                <ToolBtn icon={<MessagesSquare className="w-5 h-5" />} label="Answer me..." onClick={() => setActionState('asking')} disabled={!hasContent} aiDisabled={!d.aiConnected} className="text-blue-300" />
                <ToolBtn icon={<Angry className="w-5 h-5" />} label={argueLabel} onClick={handleArgue} disabled={!hasContent} aiDisabled={!d.aiConnected} className="text-red-400" heat={depthHeat} />
                {thonk.meta.aiGenerated && <ToolBtn icon={<TriangleAlert className="w-5 h-5" />} label="Correct This..." onClick={() => setActionState('correcting')} disabled={!hasContent} aiDisabled={!d.aiConnected} className="text-orange-400" />}
              </>
            )}

            {/* Section 2: Human actions */}
            <Sep />
            {showEdit && <ToolBtn icon={<Pencil className="w-5 h-5" />} label="Edit" onClick={enterEdit} />}
            <AddDropdown nodeType={thonk.type} onAddQuestion={handleAddQuestion} onAddIdea={handleAddIdea} onAddProblem={handleAddProblem} />
            {thonk.type !== 'core' && <TransformBtn currentType={thonk.type} onTransform={handleTransform} />}
            <NodeMoreMenu onFixGrammar={handleFixGrammar} onCopyText={handleCopyText} hasContent={hasContent} onSetIcon={canSetEmoji ? setEmojiAnchor : undefined} nodeType={thonk.type} onOpenAsNewBoard={d.onOpenAsNewBoard ? () => d.onOpenAsNewBoard!(thonk) : undefined} onResetBoard={d.onResetBoard} />

            {/* Section 3: Vote + Delete (not shown for core) */}
            {thonk.type !== 'core' && (
              <>
                <Sep />
                {(thonk.type === 'idea' || thonk.type === 'problem' || thonk.type === 'question' || thonk.type === 'answer') && (
                  <>
                    <ToolBtn icon={<ThumbUpIcon className="w-5 h-5" />} label="Love it" onClick={handleThumbUp} className={thonk.thumb === 'up' ? 'text-[#00ae60]' : ''} />
                    <ToolBtn icon={<ThumbDownIcon className="w-5 h-5" />} label="Drop it" onClick={handleThumbDown} className={thonk.thumb === 'down' ? 'text-[#e95a32]' : ''} />
                    <Sep />
                  </>
                )}
                <ToolBtn icon={<Trash2 className="w-5 h-5" />} label="Delete" onClick={() => d.onDelete(thonk.id)} />
              </>
            )}

          </>
        </div>
      </NodeToolbar>

      {/* Title — inline edit with blur-to-save */}
        <div
          className={cn('px-3 py-2.5', canSetEmoji && thonk.emoji ? 'flex items-start gap-2' : '')}
          onBlur={(e) => {
            if (editing && !e.currentTarget.contains(e.relatedTarget as Node)) {
              saveTitle()
            }
          }}
        >
          {canSetEmoji && thonk.emoji && (
            <span className="text-xl leading-snug shrink-0 select-none mt-px">{thonk.emoji}</span>
          )}
          <div className={cn(canSetEmoji && thonk.emoji ? 'flex-1 min-w-0' : '')}>
            {editing ? (
              <textarea
                ref={titleInputRef}
                value={editTitle}
                rows={1}
                onChange={e => setEditTitle(e.target.value.replace(/[\r\n]+/g, ' '))}
                onKeyDown={e => {
                  stopDeletePropagation(e)
                  if (e.key === 'Enter') { e.preventDefault(); saveTitle() }
                  if (e.key === 'Escape') { setEditTitle(thonk.title); setEditing(false) }
                }}
                placeholder={
                  thonk.placeholderText ?? (
                  thonk.type === 'core'     ? 'Your core idea, problem, or topic…' :
                  thonk.type === 'idea'     ? 'Describe the idea…' :
                  thonk.type === 'problem'  ? 'What\'s the problem?' :
                  thonk.type === 'question' ? 'Ask a question…' :
                                              'Write your answer…')
                }
                className={cn(
                  'nodrag w-full bg-transparent outline-none border-none font-medium text-sm leading-snug text-inherit p-0 m-0 resize-none overflow-hidden break-words',
                  thonk.type === 'core' && 'text-[17.5px] text-center',
                  isLight ? 'placeholder:text-gray-400/60' : 'placeholder:text-white/40',
                )}
              />
            ) : (
              <p
                className={cn(
                  'select-none font-medium text-sm leading-snug cursor-grab active:cursor-grabbing text-pretty break-words',
                  thonk.type === 'core' && 'text-[17.5px] text-center',
                )}
                onDoubleClick={thonk.type === 'question' ? (thonk.title.trim() ? () => setActionState('answering') : enterEdit) : enterEdit}
              >
                {thonk.title
                  ? linkifyText(thonk.title)
                  : <span className="opacity-40">{thonk.placeholderText ?? (thonk.type === 'core' ? 'Your core idea, problem, or topic…' : 'Untitled')}</span>
                }
              </p>
            )}
          </div>

        </div>


        {/* Answer input for question nodes */}
        {(thonk.type === 'question' || thonk.type === 'problem') && isAnswering && (
          <div className="nodrag px-3 pb-2">
            <Textarea
              ref={answerRef}
              placeholder="Your answer…"
              value={answerText}
              onChange={e => setAnswerText(e.target.value)}
              onKeyDown={e => {
                stopDeletePropagation(e)
                if (e.key === 'Escape') { setAnswerText(''); setActionState('idle') }
              }}
              className="nodrag text-sm min-h-[60px] text-gray-800 bg-gray-50 border-gray-300 placeholder:text-gray-400 px-2 py-1 rounded-sm shadow-none"
              rows={3}
            />
            <div className="mt-1 flex gap-1">
              <button
                onClick={handleAnswer}
                disabled={!answerText.trim()}
                className="flex-1 text-sm px-2 py-1 rounded-sm bg-gray-800 hover:bg-gray-700 text-white disabled:opacity-30 transition-colors"
              >
                Submit Answer
              </button>
              <button
                onClick={() => { setAnswerText(''); setActionState('idle') }}
                className="text-sm px-2 py-1 rounded-sm bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Correction input for AI answer nodes */}
        {thonk.type === 'answer' && isCorrecting && (
          <div className="nodrag px-3 pb-2">
            <Textarea
              ref={correctionRef}
              placeholder="What's wrong? Describe the mistake…"
              value={correctionText}
              onChange={e => setCorrectionText(e.target.value)}
              onKeyDown={stopDeletePropagation}
              className="nodrag text-sm min-h-[60px] text-gray-800 bg-gray-50 border-gray-300 placeholder:text-gray-400 px-2 py-1 rounded-sm shadow-none"
              rows={3}
            />
            <div className="mt-1 flex flex-wrap gap-1">
              <button
                onClick={handleCorrect}
                disabled={!correctionText.trim()}
                className="flex-1 min-w-[80px] text-sm px-2 py-1 rounded-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-30 transition-colors"
              >
                Revise Answer
              </button>
              <button
                onClick={() => { setCorrectionText(''); setActionState('idle') }}
                className="flex-1 min-w-[60px] text-sm px-2 py-1 rounded-sm bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Ask & Answer input */}
        {(thonk.type === 'core' || thonk.type === 'idea' || thonk.type === 'answer' || thonk.type === 'problem') && isAsking && (
          <div className="nodrag px-3 pb-2">
            <Textarea
              ref={askRef}
              placeholder="Type your question…"
              value={askText}
              onChange={e => setAskText(e.target.value)}
              onKeyDown={e => {
                stopDeletePropagation(e)
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAskAndAnswer() }
                if (e.key === 'Escape') { setAskText(''); setActionState('idle') }
              }}
              className="nodrag text-sm min-h-[60px] text-gray-800 bg-gray-50 border-gray-300 placeholder:text-gray-400 px-2 py-1 rounded-sm shadow-none"
              rows={3}
            />
            <div className="mt-1 flex gap-1">
              <button
                onClick={handleAskAndAnswer}
                disabled={!askText.trim()}
                className="flex-1 text-sm px-2 py-1 rounded-sm bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-30 transition-colors"
              >
                Get AI Answer
              </button>
              <button
                onClick={() => { setAskText(''); setActionState('idle') }}
                className="text-sm px-2 py-1 rounded-sm bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {(thonk.type === 'core' || thonk.type === 'idea') && isPushing && (
          <div className="nodrag px-3 pb-2">
            <Textarea
              ref={pushRef}
              placeholder="Steer the thinking… (optional)"
              value={pushText}
              onChange={e => setPushText(e.target.value)}
              onKeyDown={e => {
                stopDeletePropagation(e)
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePushThinking(pushText.trim() || undefined) }
                if (e.key === 'Escape') { setPushText(''); setActionState('idle') }
              }}
              className="nodrag text-sm min-h-[60px] text-gray-800 bg-gray-50 border-gray-300 placeholder:text-gray-400 px-2 py-1 rounded-sm shadow-none"
              rows={3}
            />
            <div className="mt-1 flex gap-1">
              <button
                onClick={() => handlePushThinking(pushText.trim() || undefined)}
                className="flex-1 text-sm px-2 py-1 rounded-sm bg-black hover:bg-gray-800 text-white transition-colors"
              >
                Push
              </button>
              <button
                onClick={() => { setPushText(''); setActionState('idle') }}
                className="text-sm px-2 py-1 rounded-sm bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-1.5 px-3 pb-2 text-sm opacity-60">
            <Spinner className="w-5 h-5 opacity-60" /> {actionState === 'searching' ? 'Researching…' : 'Thinking…'}
          </div>
        )}
    </NodeShell>

    {/* Conflict badge — outside NodeShell so opacity-60 dimming doesn't apply */}
    {(thonk.conflicts ?? []).filter(c => !c.ignored).length > 0 && (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => {
              e.stopPropagation()
              d.onUpdate(thonk.id, { conflicts: thonk.conflicts.map(c => ({ ...c, ignored: true })) })
            }}
            className="nodrag cursor-pointer absolute -top-2.5 -right-2.5 w-6 h-6 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center z-10 transition-colors shadow-sm ring-2 ring-(--background)"
          >
            <span className="text-[10px] font-bold text-white leading-none">
              {(thonk.conflicts ?? []).filter(c => !c.ignored).length > 1 ? (thonk.conflicts ?? []).filter(c => !c.ignored).length : '!'}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-[280px] z-[9999] p-3 rounded-xl bg-red-50 text-foreground border-2 border-red-400 dark:bg-red-950 dark:border-red-700">
          {(thonk.conflicts ?? []).filter(c => !c.ignored).map((c: ConflictEntry, i: number) => {
            const other = graphRef.current.nodes.find(n => n.id === c.nodeId)
            return (
              <div key={i} className={i > 0 ? 'mt-3 pt-3 border-t border-red-200 dark:border-red-800/40' : ''}>
                <div className="text-xs font-semibold uppercase tracking-wide text-red-500 mb-1">Conflicts with</div>
                <div className="font-semibold text-sm flex items-start gap-1.5">
                  {other && <span className="w-2 h-2 rounded-full shrink-0 inline-block mt-1.5" style={{ backgroundColor: ({ core: '#392946', idea: '#f5c44a', problem: '#e95a32', question: '#c8cac8', answer: '#00ae60', note: '#f7efd0', source: '#4a6fa5' } as Record<string, string>)[other.type] ?? '#888' }} />}
                  <span>
                    {other?.title ?? 'Unknown node'}
                    {d.hiddenNodeIds?.has(c.nodeId) && <span className="ml-1 text-xs font-normal opacity-60">(hidden)</span>}
                  </span>
                </div>
                {c.description && (
                  <div className="text-sm text-muted-foreground mt-1.5">{c.description}</div>
                )}
                <div className="text-xs text-red-400 mt-2">Click badge to dismiss</div>
              </div>
            )
          })}
        </TooltipContent>
      </Tooltip>
    )}
    {thonk.thumb && (
      <div className={`absolute -top-3 -left-3 w-7 h-7 rounded-full flex items-center justify-center shadow-lg nodrag select-none ring-2 ring-(--background) ${thonk.thumb === 'up' ? 'bg-[#00ae60]' : 'bg-[#e95a32]'}`}>
        {thonk.thumb === 'up'
          ? <ThumbUpIcon className="w-4 h-4 text-white" />
          : <ThumbDownIcon className="w-4 h-4 text-white" />
        }
      </div>
    )}
    {emojiAnchor && (
      <EmojiPickerPopover
        anchorRect={emojiAnchor}
        onSelect={emoji => d.onUpdate(thonk.id, { emoji })}
        onClose={() => setEmojiAnchor(null)}
        onClear={() => d.onUpdate(thonk.id, { emoji: undefined })}
      />
    )}
    </>
  )
}

export const ThonkNodeComponent = React.memo(
  ThonkNodeComponentFn,
  (prev, next) => {
    const pd = prev.data as ThonkNodeData
    const nd = next.data as ThonkNodeData
    return (
      pd.thonk === nd.thonk &&
      pd.graphRef === nd.graphRef &&
      pd.autoEdit === nd.autoEdit &&
      pd.onAddNode === nd.onAddNode &&
      pd.onAddEdge === nd.onAddEdge &&
      pd.onUpdate === nd.onUpdate &&
      pd.onDelete === nd.onDelete &&
      pd.onOpenAsNewBoard === nd.onOpenAsNewBoard &&
      pd.onResetBoard === nd.onResetBoard &&
      pd.onVersionCore === nd.onVersionCore &&
      pd.hasAnswer === nd.hasAnswer &&
      pd.isMultiSelected === nd.isMultiSelected &&
      pd.highlighted === nd.highlighted &&
      pd.thonk.placeholder === nd.thonk.placeholder &&
      pd.isCollapsed === nd.isCollapsed &&
      pd.hasChildren === nd.hasChildren &&
      pd.hiddenDescendantCount === nd.hiddenDescendantCount &&
      pd.hiddenConflictCount === nd.hiddenConflictCount &&
      pd.hiddenNodeIds === nd.hiddenNodeIds &&
      pd.onExpand === nd.onExpand &&
      pd.onCollapse === nd.onCollapse &&
      prev.selected === next.selected &&
      prev.dragging === next.dragging
    )
  }
)

function Sep() {
  return <div className="w-px h-4 bg-white/20 mx-0.5 shrink-0" />
}

type AddAction = { label: string; icon: React.ReactNode; onClick: () => void; shortcut?: string }

function AddDropdown({ nodeType, onAddQuestion, onAddIdea, onAddProblem }: {
  nodeType: string
  onAddQuestion: () => void
  onAddIdea: () => void
  onAddProblem: () => void
}) {
  const items: AddAction[] = []

  if (nodeType === 'core' || nodeType === 'idea' || nodeType === 'answer') {
    items.push(
      { label: 'Add Idea',     icon: <Lightbulb className="w-4 h-4 text-yellow-400" />,       onClick: onAddIdea,     shortcut: '(I)' },
      { label: 'Add Question', icon: <MessageCirclePlus className="w-4 h-4 text-gray-400" />, onClick: onAddQuestion, shortcut: '(Q)' },
      { label: 'Add Problem',  icon: <TriangleAlert className="w-4 h-4 text-red-400" />,      onClick: onAddProblem,  shortcut: '(P)' },
    )
  }
  if (nodeType === 'problem' || nodeType === 'question') {
    items.push(
      { label: 'Add Question', icon: <MessageCirclePlus className="w-4 h-4 text-gray-400" />, onClick: onAddQuestion, shortcut: '(Q)' },
    )
  }

  if (items.length === 0) return null

  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button className="w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer">
              <GitBranchPlus className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={10} className="text-sm">Add Node...</TooltipContent>
        <DropdownMenuContent side="top" align="center" sideOffset={10} className="min-w-[130px]" onCloseAutoFocus={e => e.preventDefault()}>
          {items.map(item => (
            <DropdownMenuItem key={item.label} onClick={item.onClick} className="justify-between">
              <span className="flex items-center gap-2">{item.icon}{item.label}</span>
              {item.shortcut && <kbd className="text-xs text-muted-foreground/50 font-mono ml-3">{item.shortcut}</kbd>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Tooltip>
  )
}

const NODE_TYPE_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  core:     { label: 'Core',     color: '#392946', icon: <Brain className="w-4 h-4" /> },
  idea:     { label: 'Idea',     color: '#f5c44a', icon: <Lightbulb className="w-4 h-4 text-yellow-400" /> },
  problem:  { label: 'Problem',  color: '#e95a32', icon: <TriangleAlert className="w-4 h-4 text-red-400" /> },
  question: { label: 'Question', color: '#c8cac8', icon: <MessageCircleQuestionMark className="w-4 h-4 text-gray-400" /> },
  answer:   { label: 'Answer',   color: '#00ae60', icon: <MessageCircle className="w-4 h-4 text-emerald-400" /> },
}

function TransformBtn({ currentType, onTransform }: { currentType: string; onTransform: (t: import('@/store/types').NodeType) => void }) {
  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button className="w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer">
              <ArrowDownUp className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={10} className="text-sm">Convert to…</TooltipContent>
        <DropdownMenuContent side="top" align="center" sideOffset={10} className="min-w-[120px]">
          {(Object.keys(NODE_TYPE_LABELS) as import('@/store/types').NodeType[]).filter(t => t !== 'note' && t !== 'core').map(type => (
            <DropdownMenuItem
              key={type}
              onClick={() => onTransform(type)}
              className={type === currentType ? 'opacity-30 pointer-events-none' : ''}
            >
              {NODE_TYPE_LABELS[type].icon}
              {NODE_TYPE_LABELS[type].label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Tooltip>
  )
}

function NodeMoreMenu({ onFixGrammar, onCopyText, hasContent, onSetIcon, nodeType, onOpenAsNewBoard, onResetBoard }: {
  onFixGrammar: () => void
  onCopyText: () => void
  hasContent: boolean
  onSetIcon?: (rect: DOMRect) => void
  nodeType: import('@/store/types').NodeType
  onOpenAsNewBoard?: () => void
  onResetBoard?: () => void
}) {
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  return (
    <Tooltip>
      <DropdownMenu onOpenChange={open => { if (!open) setConfirmReset(false) }}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button ref={triggerRef} className="nodrag w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer">
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={10} className="text-sm">More options</TooltipContent>
        <DropdownMenuContent side="top" align="center" sideOffset={10} className="min-w-[160px]" onCloseAutoFocus={e => e.preventDefault()}>
          <DropdownMenuItem onClick={onCopyText} disabled={!hasContent}>
            <Copy className="w-4 h-4" />
            Copy Text
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onFixGrammar} disabled={!hasContent}>
            <SpellCheck className="w-4 h-4" />
            Fix Grammar
          </DropdownMenuItem>
          {onSetIcon && (
            <DropdownMenuItem onClick={() => triggerRef.current && onSetIcon(triggerRef.current.getBoundingClientRect())}>
              <Smile className="w-4 h-4" />
              Set Icon
            </DropdownMenuItem>
          )}
          {nodeType === 'idea' && onOpenAsNewBoard && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onOpenAsNewBoard}>
                <ExternalLink className="w-4 h-4" />
                Open as new board
              </DropdownMenuItem>
            </>
          )}
          {nodeType === 'core' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('thonk:open-source-import'))}>
                <FileInput className="w-4 h-4" />
                Import source…
              </DropdownMenuItem>
            </>
          )}
          {nodeType === 'core' && onResetBoard && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={e => { e.preventDefault(); setConfirmReset(true) }} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                <Trash2 className="w-4 h-4" />
                Reset Core & Board
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirmReset} onOpenChange={open => { if (!open) setConfirmReset(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="pb-2">Reset Core & Board?</DialogTitle>
            <DialogDescription>
              This will clear the core idea and remove all nodes and edges from the board. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" className="h-9 text-sm cursor-pointer" onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button variant="destructive" className="h-9 text-sm cursor-pointer" onClick={() => { onResetBoard!(); setConfirmReset(false) }}>Reset</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Tooltip>
  )
}

function ToolBtn({
  icon, label, onClick, disabled, aiDisabled, active, className, heat, dot,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  aiDisabled?: boolean
  active?: boolean
  className?: string
  heat?: number   // 0–1; >= 1 hard-disables the button and shows a red dot
  dot?: boolean   // shows a small purple dot indicator
}) {
  const isHeatBlocked = !!heat && heat >= 1
  const showHeatBadge = !!heat && heat > 0
  const isDisabled = disabled || aiDisabled || isHeatBlocked

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={isDisabled}
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded text-white/80 transition-colors relative',
            isDisabled      ? 'opacity-25 cursor-not-allowed' :
                              'hover:bg-white/15 hover:text-white cursor-pointer',
            active && 'bg-white/20 text-white',
            className,
          )}
        >
          <span>{icon}</span>
          {showHeatBadge && (
            <span className={cn('absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full', heat >= 1 ? 'bg-red-400' : heat >= 2/3 ? 'bg-orange-400' : 'bg-yellow-400')} />
          )}
          {dot && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-purple-400" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={10} className="text-sm">
        {aiDisabled ? 'Connect AI in the top bar' : disabled ? `${label} — add content first` : label}
      </TooltipContent>
    </Tooltip>
  )
}
