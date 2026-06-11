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
import { NodeToolbar, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import {
  Angry,
  MessageCircleQuestionMark,
  MessageCirclePlus,
  Lightbulb,
  CheckCheck,
  CircleCheck,
  CircleSlash,
  MessageCircle,
  MessageCircleReply,
  Trash2,
  Pencil,
  Loader2,
  FileText,
  TriangleAlert,
  Globe,
  ArrowDownUp,
  GitBranch,
  Brain,
  RotateCcw,
  MessagesSquare,
  CircleCheckBig,
  Ban,
} from 'lucide-react'
import { NodeShell } from './NodeShell'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { ThonkNode as TNode } from '@/store/types'
import { assembleContext, contextToPrompt } from '@/ai/context'
import { critiqueNode, questionNode, proposeIdeas, integrateQA, integrateAllQA, integrateRejection, integrateIdea, rejectIdea, acknowledgeProblem, detectConflicts, findRelatedNodes, answerQuestion, generateSolution, correctAnswer } from '@/ai/gemini'
import type { ThonkGraph, ConflictEntry } from '@/store/types'
import { showToast } from '@/lib/toast'

const MAX_AI_DEPTH = 3

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
  onUpdate: (id: string, patch: Partial<Pick<TNode, 'title' | 'body' | 'summary' | 'resolved' | 'resolvedAs' | 'unread' | 'conflicts' | 'type'>> & { meta?: Partial<TNode['meta']> }) => void
  onDelete: (id: string) => void
  onVersionCore: (oldId: string, newTitle: string, newBody: string, pos: { x: number; y: number }) => TNode
  panelOpen: boolean
  hasAnswer: boolean
  onOpenPanel: (id: string | null) => void
  onAutoEdit: (id: string) => void
  onBatchStart: () => void
  onBatchEnd: () => void
}

type ActionState = 'idle' | 'loading' | 'answering' | 'correcting' | 'asking'

type QAPair = { qNode: import('@/store/types').ThonkNode; aNode: import('@/store/types').ThonkNode }

// Walk UP from a specific answer, collecting unresolved Q→A pairs in this single branch.
// Stops when it hits a core/idea/problem anchor or a branching point (answer with >1 question child).
function collectChainPairs(
  graph: ThonkGraph,
  answerId: string,
): { pairs: QAPair[]; anchor: import('@/store/types').ThonkNode | null } {
  const pairs: QAPair[] = []
  let currentId = answerId

  while (true) {
    const aNode = graph.nodes.find(n => n.id === currentId)
    if (!aNode) return { pairs, anchor: null }

    const qEdge =
      graph.edges.find(e => e.target === currentId && (e.relation === 'answers' || e.relation === 'fixes')) ??
      graph.edges.find(e => e.target === currentId && e.relation === 'spawns')
    if (!qEdge) return { pairs, anchor: null }
    const qNode = graph.nodes.find(n => n.id === qEdge.source)
    if (!qNode) return { pairs, anchor: null }

    if (!aNode.resolved && !qNode.resolved) pairs.unshift({ qNode, aNode })

    const parentEdge =
      graph.edges.find(e => e.target === qNode.id && (e.relation === 'questions' || e.relation === 'argues')) ??
      graph.edges.find(e => e.target === qNode.id && e.relation === 'spawns')
    if (!parentEdge) return { pairs, anchor: null }
    const parentNode = graph.nodes.find(n => n.id === parentEdge.source)
    if (!parentNode) return { pairs, anchor: null }

    if (parentNode.type === 'core' || parentNode.type === 'idea' || parentNode.type === 'problem')
      return { pairs, anchor: parentNode }

    if (parentNode.type === 'answer') { currentId = parentNode.id; continue }
    return { pairs, anchor: null }
  }
}

// Walk up the chain to find the topmost core/idea ancestor.
// Falls back to spawns edges so manually-drawn connections still resolve.
// Returns null if no core/idea can be reached.
function findChainRoot(graph: ThonkGraph, nodeId: string): import('@/store/types').ThonkNode | null {
  const node = graph.nodes.find(n => n.id === nodeId)
  if (!node) return null
  if (node.type === 'core' || node.type === 'idea') return node

  if (node.type === 'problem') {
    const e =
      graph.edges.find(e => e.target === nodeId && e.relation === 'argues') ??
      graph.edges.find(e => e.target === nodeId && (e.relation === 'answers' || e.relation === 'fixes')) ??
      graph.edges.find(e => e.target === nodeId && e.relation === 'spawns')
    return e ? findChainRoot(graph, e.source) : null
  }

  if (node.type === 'question') {
    const e =
      graph.edges.find(e => e.target === nodeId && (e.relation === 'questions' || e.relation === 'argues')) ??
      graph.edges.find(e => e.target === nodeId && (e.relation === 'answers' || e.relation === 'fixes')) ??
      graph.edges.find(e => e.target === nodeId && e.relation === 'spawns')
    return e ? findChainRoot(graph, e.source) : null
  }

  // answer — find parent (question or direct core/idea), then recurse
  const aEdge =
    graph.edges.find(e => e.target === nodeId && (e.relation === 'answers' || e.relation === 'fixes')) ??
    graph.edges.find(e => e.target === nodeId && e.relation === 'spawns')
  if (!aEdge) return null
  const parent = graph.nodes.find(n => n.id === aEdge.source)
  if (!parent) return null
  if (parent.type === 'core' || parent.type === 'idea') return parent
  return findChainRoot(graph, parent.id)
}


// Find the direct parent of an idea via spawns edge (core --spawns--> idea)
function findSpawnParent(graph: ThonkGraph, nodeId: string): import('@/store/types').ThonkNode | null {
  const e = graph.edges.find(e => e.target === nodeId && e.relation === 'spawns')
  if (!e) return null
  return graph.nodes.find(n => n.id === e.source) ?? null
}

// Find the parent of a problem via argues edge (core/idea --argues--> problem)
function findArguesParent(graph: ThonkGraph, nodeId: string): import('@/store/types').ThonkNode | null {
  const e = graph.edges.find(e => e.target === nodeId && e.relation === 'argues')
  if (!e) return null
  return graph.nodes.find(n => n.id === e.source) ?? null
}

// Walk DOWN from a node and collect all Q&A descendant IDs
// (follow-up questions their answers, recursively — used for cascade dismissal)
function collectQADescendants(graph: ThonkGraph, nodeId: string): string[] {
  const result: string[] = []
  const visited = new Set<string>()
  function walk(id: string) {
    if (visited.has(id)) return
    visited.add(id)
    for (const e of graph.edges) {
      if (e.source === id && e.relation === 'questions') {
        result.push(e.target)
        for (const ae of graph.edges) {
          if (ae.source === e.target && ae.relation === 'answers') {
            result.push(ae.target)
            walk(ae.target)
          }
        }
      }
    }
  }
  walk(nodeId)
  return result
}

function stopDeletePropagation(e: React.KeyboardEvent) {
  if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation()
}

const URL_RE = /https?:\/\/[^\s)>\],"']+/g
function linkifyText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const url = m[0]
    parts.push(
      <a key={m.index} href={url} target="_blank" rel="noopener noreferrer"
        className="underline text-blue-300 hover:text-blue-200 break-all"
        onClick={e => e.stopPropagation()}
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

  // No parent (root node): infer direction from where existing children already sit
  const children = graph.edges
    .filter(e => e.source === nodeId)
    .map(e => graph.nodes.find(n => n.id === e.target))
    .filter(Boolean) as { id: string; position: { x: number; y: number } }[]
  if (children.length > 0) {
    const avgVx = children.reduce((s, c) => s + (c.position.x - node.position.x), 0) / children.length
    const avgVy = children.reduce((s, c) => s + (c.position.y - node.position.y), 0) / children.length
    if (Math.abs(avgVx) > Math.abs(avgVy)) return avgVx > 0 ? 'right' : 'left'
    return avgVy >= 0 ? 'down' : 'up'
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

  // Close answer/correction input on outside tap/click
  useEffect(() => {
    if (actionState !== 'answering' && actionState !== 'correcting') return
    const handler = (e: PointerEvent) => {
      const nodeEl = document.querySelector(`[data-id="${thonk.id}"]`)
      if (nodeEl && !nodeEl.contains(e.target as Node)) {
        setAnswerText('')
        setCorrectionText('')
        setActionState('idle')
      }
    }
    window.addEventListener('pointerdown', handler)
    return () => window.removeEventListener('pointerdown', handler)
  }, [actionState, thonk.id])

  const titleInputRef = useRef<HTMLTextAreaElement>(null)
  const answerRef = useRef<HTMLTextAreaElement>(null)
  const correctionRef = useRef<HTMLTextAreaElement>(null)
  const askRef = useRef<HTMLTextAreaElement>(null)

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

  useEffect(() => {
    if (isAnswering) requestAnimationFrame(() => answerRef.current?.focus())
  }, [isAnswering])

  useEffect(() => {
    if (isCorrecting) requestAnimationFrame(() => correctionRef.current?.focus())
  }, [isCorrecting])

  useEffect(() => {
    if (isAsking) requestAnimationFrame(() => askRef.current?.focus())
  }, [isAsking])

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

  const ctx = () => {
    const c = assembleContext(graphRef.current, thonk.id)
    if (!c) throw new Error('Node not found in graph')
    const liveTitle = editTitle.trim() || c.target.title
    if (liveTitle === c.target.title) return contextToPrompt(c)
    return contextToPrompt({
      ...c,
      target: { ...c.target, title: liveTitle, body: liveTitle },
      neighbors: c.neighbors.map(n => n.id === thonk.id ? { ...n, title: liveTitle } : n),
      skeleton: { ...c.skeleton, nodes: c.skeleton.nodes.map(n => n.id === thonk.id ? { ...n, title: liveTitle } : n) },
    })
  }

  const saveTitle = useCallback(() => {
    if (editTitle.trim() !== thonk.title) {
      const newTitle = editTitle.trim() || thonk.title
      // For question nodes body mirrors the title (no sidebar to edit it separately)
      const bodyPatch = thonk.type === 'question' ? { body: newTitle } : {}
      d.onUpdate(thonk.id, { title: newTitle, ...bodyPatch, meta: { aiGenerated: false, yesNo: false } })
    } else if (thonk.meta.aiGenerated || thonk.meta.yesNo) {
      d.onUpdate(thonk.id, { meta: { aiGenerated: false, yesNo: false } })
    }
    setEditing(false)
  }, [editTitle, thonk.title, thonk.id, thonk.meta.aiGenerated, thonk.meta.yesNo, d])

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
      const problems = await critiqueNode(ctx())
      const childDepth = thonk.meta.aiGenerated ? (thonk.meta.aiDepth ?? 0) + 1 : 0
      const ids: string[] = []
      let i = 0
      for (const p of problems) {
        const node = d.onAddNode('problem', p.content, p.content, spawnPos(280 + i * 20, -40 + i * 80), { severity: p.severity, aiGenerated: true, aiDepth: childDepth })
        d.onAddEdge(thonk.id, node.id, 'argues', 's-right', 't-left')
        ids.push(node.id)
        i++
      }
      if (problems.length === 0) showToast('No significant problems found — idea holds up.')
      else panToSpawned(ids)
    })

  const handleQuestion = () =>
    withLoading(async () => {
      const c = assembleContext(graphRef.current, thonk.id)
      if (!c) throw new Error('Node not found in graph')
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
        ? `${contextToPrompt(c)}\n\nALREADY ASKED (do not repeat or rephrase): ${existingQs.join(' / ')}`
        : contextToPrompt(c)
      const result = await questionNode(prompt)
      const dir = nodeSpawnDir(thonk.id, graphRef.current)
      const { dx, dy } = dirOffset(dir, nodeH())
      const { sourceHandle, targetHandle } = dirHandles(dir)
      const pos = findFreePos(graphRef.current.nodes, livePos(), dx, dy, dir)
      const qNode = d.onAddNode('question', result.question, result.question, pos, { aiGenerated: true, yesNo: result.yesNo === true })
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
      const { dx, dy } = dirOffset(dir, nodeH())
      const placed: { position: { x: number; y: number } }[] = []
      const ids: string[] = []
      for (const idea of ideas) {
        const pos = findFreePos([...graphRef.current.nodes, ...placed], livePos(), dx, dy, dir)
        placed.push({ position: pos })
        const node = d.onAddNode('idea', idea.title, idea.body, pos, { aiGenerated: true, aiDepth: thonk.meta.aiGenerated ? (thonk.meta.aiDepth ?? 0) + 1 : 0 })
        d.onAddEdge(thonk.id, node.id, 'spawns', sourceHandle, targetHandle)
        ids.push(node.id)
      }
      panToSpawned(ids)
    })

  const handleAskAndAnswer = () => {
    const question = askText.trim()
    if (!question) return
    setAskText('')
    withLoading(async () => {
      const c = assembleContext(graphRef.current, thonk.id)
      if (!c) return
      const { answer, sources } = await answerQuestion(`${contextToPrompt(c)}\n\nQUESTION: ${question}`)
      const dir = nodeSpawnDir(thonk.id, graphRef.current)
      const { dx, dy } = dirOffset(dir, nodeH())
      const { sourceHandle, targetHandle } = dirHandles(dir)
      const qPos = findFreePos(graphRef.current.nodes, livePos(), dx, dy, dir)
      const qNode = d.onAddNode('question', question, question, qPos)
      d.onAddEdge(thonk.id, qNode.id, 'questions', sourceHandle, targetHandle)
      const { dx: adx, dy: ady } = dirOffset(dir, 140)
      const aPos = findFreePos(graphRef.current.nodes, { x: qPos.x + adx, y: qPos.y + ady }, adx, ady, dir)
      const aNode = d.onAddNode('answer', answer, answer, aPos, {
        aiGenerated: true,
        sources: sources.length > 0 ? sources : undefined,
      })
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
    withLoading(async () => {
      const { answer, sources } = await answerQuestion(ctx())
      const dir = nodeSpawnDir(thonk.id, graphRef.current)
      const { dx, dy } = dirOffset(dir, nodeH())
      const { sourceHandle, targetHandle } = dirHandles(dir)
      const aNode = d.onAddNode('answer', answer, answer, spawnPos(dx, dy), {
        aiGenerated: true,
        sources: sources.length > 0 ? sources : undefined,
      })
      d.onAddEdge(thonk.id, aNode.id, 'answers', sourceHandle, targetHandle)
      panToSpawned([aNode.id])
    })

  const handleGenerateFix = () =>
    withLoading(async () => {
      const { answer, sources } = await generateSolution(ctx())
      const dir = nodeSpawnDir(thonk.id, graphRef.current)
      const { dx, dy } = dirOffset(dir, nodeH())
      const { sourceHandle, targetHandle } = dirHandles(dir)
      const aNode = d.onAddNode('answer', answer, answer, spawnPos(dx, dy), {
        aiGenerated: true,
        aiDepth: thonk.meta.aiGenerated ? (thonk.meta.aiDepth ?? 0) + 1 : 0,
        sources: sources.length > 0 ? sources : undefined,
      })
      d.onAddEdge(thonk.id, aNode.id, 'fixes', sourceHandle, targetHandle)
      panToSpawned([aNode.id])
    })

  const handleCorrect = () => {
    const text = correctionText.trim()
    if (!text) return
    setCorrectionText('')
    withLoading(async () => {
      const { answer } = await correctAnswer(ctx(), thonk.title, text)
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
    const pos = findFreePos(graphRef.current.nodes, livePos(), 280, -40)
    const node = d.onAddNode('problem', '', '', pos, { severity: 0.5 })
    d.onAddEdge(thonk.id, node.id, 'argues', 's-right', 't-left')
    panToSpawned([node.id])
    d.onAutoEdit(node.id)
  }

  const handleTransform = (newType: TNode['type']) => {
    d.onUpdate(thonk.id, { type: newType })
  }

  // Merges just this Q→A pair into the ancestor.
  const handleApply = () =>
    withLoading(async () => {
      const qEdge = graphRef.current.edges.find(e => e.target === thonk.id && (e.relation === 'answers' || e.relation === 'fixes'))
      if (!qEdge) return
      const qNode = graphRef.current.nodes.find(n => n.id === qEdge.source)
      if (!qNode) return
      const rootNode = findChainRoot(graphRef.current, thonk.id)
      const syncTarget = rootNode && (rootNode.type === 'core' || rootNode.type === 'idea') ? rootNode : null

      if (syncTarget) {
        const ctx = assembleContext(graphRef.current, syncTarget.id)
        if (ctx) {
          const res = await integrateQA(contextToPrompt(ctx), qNode.title, thonk.title)
          const integratedTitle = res.title?.trim() || undefined
          d.onUpdate(syncTarget.id, {
            body: res.body,
            ...(integratedTitle ? { title: integratedTitle } : {}),
            conflicts: [],
            unread: true,
          })
          // Background conflict detection
          const candidates = graphRef.current.nodes.filter(n =>
            n.id !== syncTarget.id && n.id !== qNode.id && n.id !== thonk.id &&
            (n.resolvedAs === 'merged' || !n.resolved) && (n.type === 'core' || n.type === 'idea' || n.type === 'problem')
          )
          detectConflicts(integratedTitle ?? syncTarget.title, res.body, candidates.map(n => ({
            id: n.id, type: n.type, title: n.title, body: n.body, summary: n.summary,
          }))).then(conflicts => {
            for (const c of conflicts)
              if (candidates.some(n => n.id === c.nodeId))
                d.onUpdate(c.nodeId, { conflicts: [{ nodeId: syncTarget.id, description: c.description }] })
          }).catch(() => {})
        }
      }

      d.onUpdate(qNode.id,  { resolved: true, resolvedAs: 'merged' })
      d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'merged' })
    })

  // Merges the full Q→A chain into the ancestor in one AI call.
  const handleApplyBranch = () =>
    withLoading(async () => {
      const { pairs, anchor } = collectChainPairs(graphRef.current, thonk.id)
      if (pairs.length === 0 || !anchor) {
        // No chain above — fall back to applying this single answer
        const qEdge = graphRef.current.edges.find(e => e.target === thonk.id && (e.relation === 'answers' || e.relation === 'fixes' || e.relation === 'spawns'))
        if (!qEdge) return
        const qNode = graphRef.current.nodes.find(n => n.id === qEdge.source)
        if (!qNode) return
        const rootNode = findChainRoot(graphRef.current, thonk.id)
        const syncTarget = rootNode && (rootNode.type === 'core' || rootNode.type === 'idea') ? rootNode : null
        if (syncTarget) {
          const ctx = assembleContext(graphRef.current, syncTarget.id)
          if (ctx) {
            const res = await integrateQA(contextToPrompt(ctx), qNode.title, thonk.title)
            d.onUpdate(syncTarget.id, { body: res.body, ...(res.title?.trim() ? { title: res.title.trim() } : {}), conflicts: [], unread: true })
          }
        }
        d.onUpdate(qNode.id, { resolved: true, resolvedAs: 'merged' })
        d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'merged' })
        return
      }
      const c = assembleContext(graphRef.current, anchor.id)
      if (!c) return
      const { body, title } = await integrateAllQA(
        contextToPrompt(c),
        pairs.map(p => ({ question: p.qNode.title, answer: p.aNode.title })),
      )
      d.onUpdate(anchor.id, { body, ...(title?.trim() && (anchor.type === 'core' || anchor.type === 'idea') ? { title: title.trim() } : {}), conflicts: [], unread: true })
      for (const { qNode: q, aNode: a } of pairs) {
        d.onUpdate(q.id, { resolved: true, resolvedAs: 'merged' })
        d.onUpdate(a.id, { resolved: true, resolvedAs: 'merged' })
      }

      // Background conflict detection
      const allPairIds = new Set(pairs.flatMap(p => [p.qNode.id, p.aNode.id]))
      const candidates = graphRef.current.nodes.filter(n =>
        n.id !== anchor.id && !allPairIds.has(n.id) &&
        (n.resolvedAs === 'merged' || !n.resolved) &&
        (n.type === 'core' || n.type === 'idea' || n.type === 'problem')
      )
      detectConflicts(title?.trim() || anchor.title, body, candidates.map(n => ({
        id: n.id, type: n.type, title: n.title, body: n.body, summary: n.summary,
      }))).then(conflicts => {
        for (const cf of conflicts) {
          if (candidates.some(n => n.id === cf.nodeId))
            d.onUpdate(cf.nodeId, { conflicts: [{ nodeId: anchor.id, description: cf.description }] })
        }
      }).catch(() => {})
    })

  const handleReopen = useCallback(() => {
    const qEdge = graphRef.current.edges.find(e => e.target === thonk.id && (e.relation === 'answers' || e.relation === 'fixes'))
    if (qEdge) d.onUpdate(qEdge.source, { resolved: false })
    d.onUpdate(thonk.id, { resolved: false })
  }, [thonk.id, d, graphRef])

  // Close only this answer; parent question stays open
  const handleClose = useCallback(() => {
    const graph = graphRef.current
    d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'closed' })
    collectQADescendants(graph, thonk.id).forEach(childId =>
      d.onUpdate(childId, { resolved: true, resolvedAs: 'closed' })
    )
  }, [thonk.id, d, graphRef])

  // Close this answer + parent question + all descendants
  const handleCloseBranch = useCallback(() => {
    const graph = graphRef.current
    const qEdge = graph.edges.find(e => e.target === thonk.id && (e.relation === 'answers' || e.relation === 'fixes'))
    if (qEdge) d.onUpdate(qEdge.source, { resolved: true, resolvedAs: 'closed' })
    d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'closed' })
    collectQADescendants(graph, thonk.id).forEach(childId =>
      d.onUpdate(childId, { resolved: true, resolvedAs: 'closed' })
    )
  }, [thonk.id, d, graphRef])

  // Close question + all answer children + their descendants
  const handleCloseQuestion = useCallback(() => {
    const graph = graphRef.current
    d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'closed' })
    graph.edges
      .filter(e => e.source === thonk.id && (e.relation === 'answers'))
      .forEach(e => {
        d.onUpdate(e.target, { resolved: true, resolvedAs: 'closed' })
        collectQADescendants(graph, e.target).forEach(childId =>
          d.onUpdate(childId, { resolved: true, resolvedAs: 'closed' })
        )
      })
  }, [thonk.id, d, graphRef])

  const handleCloseProblem = useCallback(() => {
    const graph = graphRef.current
    d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'closed' })
    graph.edges
      .filter(e => e.source === thonk.id && e.relation === 'fixes')
      .forEach(e => {
        d.onUpdate(e.target, { resolved: true, resolvedAs: 'closed' })
        collectQADescendants(graph, e.target).forEach(childId =>
          d.onUpdate(childId, { resolved: true, resolvedAs: 'closed' })
        )
      })
  }, [thonk.id, d, graphRef])

  const handleApplyProblem = () =>
    withLoading(async () => {
      const graph = graphRef.current
      const parentNode = findChainRoot(graph, thonk.id)
      if (!parentNode) return
      const ctx = assembleContext(graph, parentNode.id)
      if (!ctx) return
      const res = await acknowledgeProblem(contextToPrompt(ctx), thonk.title, thonk.body)
      const integratedTitle = res.title?.trim() || undefined
      d.onUpdate(parentNode.id, { body: res.body, ...(integratedTitle ? { title: integratedTitle } : {}), unread: true })
      d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'merged' })
      // Background conflict detection — acknowledging a problem can create new contradictions
      const candidates = graph.nodes.filter(n =>
        n.id !== parentNode.id && n.id !== thonk.id &&
        (n.resolvedAs === 'merged' || !n.resolved) &&
        (n.type === 'core' || n.type === 'idea' || n.type === 'problem')
      )
      detectConflicts(integratedTitle ?? parentNode.title, res.body, candidates.map(n => ({
        id: n.id, type: n.type, title: n.title, body: n.body, summary: n.summary,
      }))).then(conflicts => {
        for (const c of conflicts)
          if (candidates.some(n => n.id === c.nodeId))
            d.onUpdate(c.nodeId, { conflicts: [{ nodeId: parentNode.id, description: c.description }] })
      }).catch(() => {})
    })

  const handleApplyProblemBranch = () =>
    withLoading(async () => {
      const graph = graphRef.current
      const parentNode = findChainRoot(graph, thonk.id)
      if (!parentNode) return
      const ctx = assembleContext(graph, parentNode.id)
      if (!ctx) return
      const res = await acknowledgeProblem(contextToPrompt(ctx), thonk.title, thonk.body)
      const integratedTitle = res.title?.trim() || undefined
      d.onUpdate(parentNode.id, { body: res.body, ...(integratedTitle ? { title: integratedTitle } : {}), unread: true })
      d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'merged' })
      graph.edges
        .filter(e => e.source === thonk.id && e.relation === 'fixes')
        .forEach(e => {
          d.onUpdate(e.target, { resolved: true, resolvedAs: 'merged' })
          collectQADescendants(graph, e.target).forEach(childId =>
            d.onUpdate(childId, { resolved: true, resolvedAs: 'merged' })
          )
        })
      // Background conflict detection
      const candidates = graph.nodes.filter(n =>
        n.id !== parentNode.id && n.id !== thonk.id &&
        (n.resolvedAs === 'merged' || !n.resolved) &&
        (n.type === 'core' || n.type === 'idea' || n.type === 'problem')
      )
      detectConflicts(integratedTitle ?? parentNode.title, res.body, candidates.map(n => ({
        id: n.id, type: n.type, title: n.title, body: n.body, summary: n.summary,
      }))).then(conflicts => {
        for (const c of conflicts)
          if (candidates.some(n => n.id === c.nodeId))
            d.onUpdate(c.nodeId, { conflicts: [{ nodeId: parentNode.id, description: c.description }] })
      }).catch(() => {})
    })

  const handleApplyIdea = () =>
    withLoading(async () => {
      const graph = graphRef.current
      const parentNode = findSpawnParent(graph, thonk.id)
      if (!parentNode) return
      const ctx = assembleContext(graph, parentNode.id)
      if (!ctx) return
      const res = await integrateIdea(contextToPrompt(ctx), thonk.title, thonk.body)
      const mergeTitle = res.title?.trim() || undefined
      d.onUpdate(parentNode.id, { body: res.body, ...(mergeTitle ? { title: mergeTitle } : {}), unread: true })
      d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'merged' })
      const candidates = graph.nodes.filter(n =>
        n.id !== parentNode.id && n.id !== thonk.id &&
        (n.resolvedAs === 'merged' || !n.resolved) &&
        (n.type === 'core' || n.type === 'idea' || n.type === 'problem')
      )
      // When re-applying a previously-merged idea, check if it contradicts the pre-existing target content
      if (thonk.resolvedAs === 'merged') {
        detectConflicts(thonk.title, thonk.body, [{
          id: parentNode.id, type: parentNode.type, title: parentNode.title, body: parentNode.body, summary: parentNode.summary,
        }]).then(pre => {
          for (const c of pre)
            if (c.nodeId === parentNode.id)
              d.onUpdate(parentNode.id, { conflicts: [{ nodeId: thonk.id, description: c.description }] })
        }).catch(() => {})
      }
      // Check if new body conflicts with other nodes
      detectConflicts(mergeTitle ?? parentNode.title, res.body, candidates.map(n => ({
        id: n.id, type: n.type, title: n.title, body: n.body, summary: n.summary,
      }))).then(conflicts => {
        for (const c of conflicts)
          if (candidates.some(n => n.id === c.nodeId))
            d.onUpdate(c.nodeId, { conflicts: [{ nodeId: parentNode.id, description: c.description }] })
      }).catch(() => {})
    })

  const handleApplyIdeaBranch = () =>
    withLoading(async () => {
      const graph = graphRef.current
      const parentNode = findSpawnParent(graph, thonk.id)
      if (!parentNode) return
      const ctx = assembleContext(graph, parentNode.id)
      if (!ctx) return
      const res = await integrateIdea(contextToPrompt(ctx), thonk.title, thonk.body)
      const mergeTitle = res.title?.trim() || undefined
      d.onUpdate(parentNode.id, { body: res.body, ...(mergeTitle ? { title: mergeTitle } : {}), unread: true })
      d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'merged' })
      const descendantIds = collectQADescendants(graph, thonk.id)
      descendantIds.forEach(id => d.onUpdate(id, { resolved: true, resolvedAs: 'merged' }))
      const branchIds = new Set([thonk.id, ...descendantIds])
      const candidates = graph.nodes.filter(n =>
        n.id !== parentNode.id && !branchIds.has(n.id) &&
        (n.resolvedAs === 'merged' || !n.resolved) &&
        (n.type === 'core' || n.type === 'idea' || n.type === 'problem')
      )
      // When re-applying, check if the idea contradicts the pre-existing target content
      if (thonk.resolvedAs === 'merged') {
        detectConflicts(thonk.title, thonk.body, [{
          id: parentNode.id, type: parentNode.type, title: parentNode.title, body: parentNode.body, summary: parentNode.summary,
        }]).then(pre => {
          for (const c of pre)
            if (c.nodeId === parentNode.id)
              d.onUpdate(parentNode.id, { conflicts: [{ nodeId: thonk.id, description: c.description }] })
        }).catch(() => {})
      }
      // Check if new body conflicts with other nodes
      detectConflicts(mergeTitle ?? parentNode.title, res.body, candidates.map(n => ({
        id: n.id, type: n.type, title: n.title, body: n.body, summary: n.summary,
      }))).then(conflicts => {
        for (const c of conflicts)
          if (candidates.some(n => n.id === c.nodeId))
            d.onUpdate(c.nodeId, { conflicts: [{ nodeId: parentNode.id, description: c.description }] })
      }).catch(() => {})
    })

  const handleCloseIdeaBranch = useCallback(() => {
    const graph = graphRef.current
    d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'closed' })
    collectQADescendants(graph, thonk.id).forEach(id =>
      d.onUpdate(id, { resolved: true, resolvedAs: 'closed' })
    )
  }, [thonk.id, d, graphRef])

  const handleRejectIdea = () =>
    withLoading(async () => {
      const graph = graphRef.current
      const parentNode = findSpawnParent(graph, thonk.id)
      if (!parentNode) return
      const ctx = assembleContext(graph, parentNode.id)
      if (!ctx) return
      const res = await rejectIdea(contextToPrompt(ctx), thonk.title, thonk.body)
      d.onUpdate(parentNode.id, { body: res.body, unread: true })
      d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'rejected' })
    })

  const handleNoteRejection = () =>
    withLoading(async () => {
      const qEdge = graphRef.current.edges.find(e => e.target === thonk.id && (e.relation === 'answers' || e.relation === 'fixes'))
      if (!qEdge) return
      const qNode = graphRef.current.nodes.find(n => n.id === qEdge.source)
      if (!qNode) return
      const rootNode = findChainRoot(graphRef.current, thonk.id)
      const noteTarget = rootNode && (rootNode.type === 'core' || rootNode.type === 'idea') ? rootNode : null
      if (!noteTarget) return
      const ctx = assembleContext(graphRef.current, noteTarget.id)
      if (!ctx) return
      const res = await integrateRejection(contextToPrompt(ctx), qNode.title, thonk.title)
      d.onUpdate(noteTarget.id, { body: res.body, unread: true })
      d.onUpdate(qNode.id,  { resolved: true, resolvedAs: 'rejected' })
      d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'rejected' })
    })

  const handleReopenAndAnswer = useCallback(() => {
    const aEdge = graphRef.current.edges.find(e => e.source === thonk.id && (e.relation === 'answers' || e.relation === 'fixes'))
    if (aEdge) d.onUpdate(aEdge.target, { resolved: false })
    d.onUpdate(thonk.id, { resolved: false })
    setActionState('answering')
  }, [thonk.id, d, graphRef])

  // Computed for answer resolution dropdown labels
  const answerDescCount = thonk.type === 'answer'
    ? collectQADescendants(graphRef.current, thonk.id).length
    : 0
  const ideaDescCount = thonk.type === 'idea'
    ? collectQADescendants(graphRef.current, thonk.id).length
    : 0
  const ideaParentNode = thonk.type === 'idea' ? findSpawnParent(graphRef.current, thonk.id) : null
  const ideaParentName = ideaParentNode?.title
    ? (ideaParentNode.title.length > 22 ? ideaParentNode.title.slice(0, 22) + '…' : ideaParentNode.title)
    : undefined
  const problemParentNode = thonk.type === 'problem' ? findChainRoot(graphRef.current, thonk.id) : null
  const problemParentName = problemParentNode?.title
    ? (problemParentNode.title.length > 22 ? problemParentNode.title.slice(0, 22) + '…' : problemParentNode.title)
    : undefined
  const mergeTargetNode = thonk.type === 'answer' ? findChainRoot(graphRef.current, thonk.id) : null
  const applyTargetName = mergeTargetNode?.title
    ? (mergeTargetNode.title.length > 22 ? mergeTargetNode.title.slice(0, 22) + '…' : mergeTargetNode.title)
    : 'canvas'

  // Count for question close label
  const questionChildCount = thonk.type === 'question'
    ? graphRef.current.edges.filter(e => e.source === thonk.id && e.relation === 'answers').reduce((acc, e) => {
        return acc + 1 + collectQADescendants(graphRef.current, e.target).length
      }, 0)
    : 0

  // Count for problem close label
  const problemChildCount = thonk.type === 'problem'
    ? graphRef.current.edges.filter(e => e.source === thonk.id && e.relation === 'fixes').reduce((acc, e) => {
        return acc + 1 + collectQADescendants(graphRef.current, e.target).length
      }, 0)
    : 0

  const isLoading = actionState === 'loading'
  const isLight = thonk.type === 'question' || thonk.type === 'idea'

  const aiDepth = thonk.meta.aiDepth ?? 0
  const depthHeat = aiDepth > 0 ? Math.min(aiDepth / MAX_AI_DEPTH, 1) : 0
  const argueLabel = depthHeat >= 1 ? 'Find Problems (AI Fatigue)' : depthHeat > 0 ? 'Find Problems (AI Fatigue Warning)' : 'Find Problems'
  const fixLabel   = depthHeat >= 1 ? 'Suggest Solution (AI Fatigue)' : depthHeat > 0 ? 'Suggest Solution (AI Fatigue Warning)' : 'Suggest Solution'

  const showEdit         = !editing
  const showExpandDetail = thonk.type !== 'question' && thonk.type !== 'answer'

  return (
    <NodeShell nodeType={thonk.type} selected={selected} resolved={thonk.resolved} aiGenerated={thonk.meta.aiGenerated} onPointerDown={e => { if (e.pointerType === 'touch') touchStore.set(thonk.id) }}>
      {/* Floating toolbar above node — inside NodeShell so RF drag registration stays on NodeShell root */}
      <NodeToolbar isVisible={(activeTouchId === null ? selected : activeTouchId === thonk.id) && !dragging && !isLoading && !isAnswering && !isCorrecting && !isAsking && !editing} position={Position.Top} offset={8}>
        <div className="nodrag flex items-center gap-0.5 bg-gray-900 rounded-lg px-1.5 py-1 shadow-xl border border-white/10">

          {thonk.resolved ? (
            /* Resolved: edit, details, reopen (+ answer shortcut for questions only), delete */
            <>
              {showEdit && thonk.type !== 'problem' && <ToolBtn icon={<Pencil className="w-5 h-5" />} label="Edit" onClick={enterEdit} />}
              {showExpandDetail && <ToolBtn icon={<FileText className="w-5 h-5" />} label={d.panelOpen ? 'Close Details' : 'Open Details'} active={d.panelOpen} dot={!!thonk.unread && !d.panelOpen} onClick={() => d.onOpenPanel(d.panelOpen ? null : thonk.id)} />}
              <Sep />
              {thonk.type === 'question' && (
                <button
                  onClick={handleReopenAndAnswer}
                  className="nodrag flex items-center gap-1.5 h-8 px-3 rounded-sm text-sm font-medium bg-emerald-400 hover:bg-emerald-500 text-emerald-950 transition-colors cursor-pointer"
                >
                  <MessageCircleReply className="w-5 h-5" />
                  Answer
                </button>
              )}
              <ToolBtn icon={<RotateCcw className="w-5 h-5" />} label="Reopen" onClick={handleReopen} />
              <Sep />
              <ToolBtn icon={<Trash2 className="w-5 h-5" />} label="Delete" onClick={() => d.onDelete(thonk.id)} />
            </>
          ) : (
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
                  <ToolBtn icon={<MessageCircleQuestionMark className="w-5 h-5" />} label="Ask me" onClick={handleQuestion} disabled={!hasContent} className="text-green-400" />
                  <ToolBtn icon={<MessagesSquare className="w-5 h-5" />} label="Answer me..." onClick={() => setActionState('asking')} disabled={!hasContent} className="text-blue-300" />
                  <ToolBtn icon={<Angry className="w-5 h-5" />} label={argueLabel} onClick={handleArgue} disabled={!hasContent} className="text-red-400" heat={depthHeat} />
                  <ToolBtn icon={<Lightbulb className="w-5 h-5" />} label="Generate Ideas" onClick={handlePropose} disabled={!hasContent} className="text-yellow-400" />
                </>
              )}
              {thonk.type === 'problem' && (
                <>
                  <ToolBtn icon={<MessagesSquare className="w-5 h-5" />} label="Answer me..." onClick={() => setActionState('asking')} disabled={!hasContent} className="text-blue-300" />
                  <ToolBtn icon={<Lightbulb className="w-5 h-5" />} label={fixLabel} onClick={handleGenerateFix} disabled={!hasContent} className="text-green-400" heat={depthHeat} />
                </>
              )}
              {thonk.type === 'question' && (
                <ToolBtn icon={<Lightbulb className="w-5 h-5" />} label="Generate Answer" onClick={handleIdeateAnswer} className="text-emerald-300" />
              )}
              {thonk.type === 'answer' && (
                <>
                  <ToolBtn icon={<MessageCircleQuestionMark className="w-5 h-5" />} label="Ask me" onClick={handleQuestion} disabled={!hasContent} className="text-green-400" />
                  <ToolBtn icon={<MessagesSquare className="w-5 h-5" />} label="Answer me..." onClick={() => setActionState('asking')} disabled={!hasContent} className="text-blue-300" />
                  <ToolBtn icon={<Angry className="w-5 h-5" />} label={argueLabel} onClick={handleArgue} disabled={!hasContent} className="text-red-400" heat={depthHeat} />
                  {thonk.meta.aiGenerated && <ToolBtn icon={<TriangleAlert className="w-5 h-5" />} label="Correct This..." onClick={() => setActionState('correcting')} disabled={!hasContent} className="text-orange-400" />}
                </>
              )}

              {/* Section 2: Human actions */}
              <Sep />
              {showEdit         && <ToolBtn icon={<Pencil className="w-5 h-5" />} label="Edit" onClick={enterEdit} />}
              {showExpandDetail && <ToolBtn icon={<FileText className="w-5 h-5" />} label={d.panelOpen ? 'Close Details' : 'Open Details'} active={d.panelOpen} dot={!!thonk.unread && !d.panelOpen} onClick={() => d.onOpenPanel(d.panelOpen ? null : thonk.id)} />}
              <AddDropdown nodeType={thonk.type} onAddQuestion={handleAddQuestion} onAddIdea={handleAddIdea} onAddProblem={handleAddProblem} />
              <TransformBtn currentType={thonk.type} onTransform={handleTransform} />
              {thonk.type === 'answer' && (
                <>
                  <Sep />
                  <ResolutionDropdown
                    closeBranchCount={answerDescCount + 2}
                    onClose={handleClose}
                    onCloseBranch={handleCloseBranch}
                    onApply={mergeTargetNode ? handleApply : undefined}
                    onApplyBranch={mergeTargetNode ? handleApplyBranch : undefined}
                    applyTargetName={applyTargetName}
                    onNoteRejection={mergeTargetNode ? handleNoteRejection : undefined}
                    noteRejectionTarget={applyTargetName}
                  />
                </>
              )}
              {thonk.type === 'question' && (
                <>
                  <Sep />
                  <ToolBtn
                    icon={<CircleSlash className="w-5 h-5" />}
                    label={questionChildCount > 0 ? `Close (${questionChildCount + 1})` : 'Close question'}
                    onClick={handleCloseQuestion}
                  />
                </>
              )}
              {thonk.type === 'problem' && (
                <>
                  <Sep />
                  <ResolutionDropdown
                    closeBranchCount={problemChildCount + 1}
                    onClose={() => d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'closed' })}
                    onCloseBranch={handleCloseProblem}
                    onApply={problemParentNode ? handleApplyProblem : undefined}
                    onApplyBranch={problemParentNode ? handleApplyProblemBranch : undefined}
                    applyTargetName={problemParentName}
                  />
                </>
              )}
              {thonk.type === 'idea' && (
                <>
                  <Sep />
                  <ResolutionDropdown
                    closeBranchCount={ideaDescCount + 1}
                    onClose={() => d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'closed' })}
                    onCloseBranch={handleCloseIdeaBranch}
                    onApply={ideaParentNode ? handleApplyIdea : undefined}
                    onApplyBranch={ideaParentNode ? handleApplyIdeaBranch : undefined}
                    applyTargetName={ideaParentName}
                    onNoteRejection={ideaParentNode ? handleRejectIdea : undefined}
                    noteRejectionTarget={ideaParentName}
                  />
                </>
              )}

              {/* Section 3: Delete */}
              <Sep />
              <ToolBtn icon={<Trash2 className="w-5 h-5" />} label="Delete" onClick={() => d.onDelete(thonk.id)} />
            </>
          )}
        </div>
      </NodeToolbar>

      {/* Resolved dot — bottom-right corner */}
      {thonk.resolved && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={`absolute -bottom-2.5 -right-2.5 w-6 h-6 rounded-full flex items-center justify-center z-10 shadow-sm ring-1 ring-white/50 ${thonk.resolvedAs === 'merged' ? 'bg-[#00ae60]' : thonk.resolvedAs === 'rejected' ? 'bg-[#e95a32]' : 'bg-gray-400'}`}>
              {thonk.resolvedAs === 'merged'
                ? <CircleCheck className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                : thonk.resolvedAs === 'rejected'
                ? <Ban className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                : <CircleSlash className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="z-[9999] text-sm">
            {thonk.resolvedAs === 'merged' ? 'Applied' : thonk.resolvedAs === 'rejected' ? 'Rejected' : 'Closed'}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Unread dot — top-right corner: appears when AI has updated this node's body */}
      {thonk.unread && !thonk.resolved && (
        <div className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-purple-500 z-10 shadow-sm ring-1 ring-white/40 pointer-events-none" />
      )}

      {/* Conflict badge — top-right corner, click to dismiss */}
      {(thonk.conflicts ?? []).length > 0 && (thonk.type === 'core' || thonk.type === 'idea' || thonk.type === 'answer') && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => d.onUpdate(thonk.id, { conflicts: [] })}
              className="nodrag absolute -top-2.5 -right-2.5 w-6 h-6 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center z-10 transition-colors shadow-sm ring-1 ring-white/50"
            >
              <span className="text-[11px] font-bold text-white leading-none">!</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[220px] z-[9999]">
            <div className="font-semibold text-sm mb-1">Contradiction detected</div>
            {(thonk.conflicts ?? []).map((c: ConflictEntry, i: number) => {
              const other = graphRef.current.nodes.find(n => n.id === c.nodeId)
              return (
                <div key={i} className="text-sm mb-1 last:mb-0">
                  {other && <span className="opacity-60">{other.title}: </span>}
                  {c.description}
                </div>
              )
            })}
            <div className="text-sm opacity-40 mt-1">Click to dismiss</div>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Title — inline edit with blur-to-save */}
        <div
          className="px-3 py-2.5"
          onBlur={(e) => {
            if (editing && !e.currentTarget.contains(e.relatedTarget as Node)) {
              saveTitle()
            }
          }}
        >
          {editing ? (
            <textarea
              ref={titleInputRef}
              value={editTitle}
              rows={1}
              onChange={e => setEditTitle(e.target.value)}
              onKeyDown={e => {
                stopDeletePropagation(e)
                if (e.key === 'Enter') { e.preventDefault(); saveTitle() }
                if (e.key === 'Escape') { setEditTitle(thonk.title); setEditing(false) }
              }}
              placeholder={
                thonk.type === 'core'     ? 'Your idea, core problem, topic, plan…' :
                thonk.type === 'idea'     ? 'Describe the idea…' :
                thonk.type === 'problem'  ? 'What\'s the problem?' :
                thonk.type === 'question' ? 'Ask a question…' :
                                            'Write your answer…'
              }
              className={cn(
                'nodrag w-full bg-transparent outline-none border-none font-medium text-sm leading-snug text-inherit p-0 m-0 resize-none overflow-hidden',
                thonk.type === 'core' && 'text-[17.5px]',
                isLight ? 'placeholder:text-gray-400/60' : 'placeholder:text-white/40',
              )}
            />
          ) : (
            <p
              className={cn(
                'select-none font-medium text-sm leading-snug cursor-grab active:cursor-grabbing text-pretty',
                thonk.type === 'core' && 'text-[17.5px]',
              )}
              onDoubleClick={thonk.type === 'question' ? (thonk.title.trim() ? () => setActionState('answering') : enterEdit) : enterEdit}
            >
              {thonk.title ? linkifyText(thonk.title) : <span className="opacity-40">{thonk.type === 'core' ? 'Your idea, core problem, topic, plan…' : 'Untitled'}</span>}
            </p>
          )}

          {thonk.type === 'answer' && (thonk.meta.sources ?? []).length > 0 && (
            <div className="pt-1 flex flex-wrap gap-1">
              {(thonk.meta.sources ?? []).map((s, i) => (
                <a
                  key={i}
                  href={s.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={s.title}
                  className="nodrag inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-200 hover:bg-emerald-900/60 transition-colors max-w-[160px] overflow-hidden"
                  onClick={e => e.stopPropagation()}
                >
                  <Globe className="w-3 h-3 shrink-0" />
                  <span className="truncate">{s.title || (() => { try { return new URL(s.uri).hostname } catch { return s.uri } })()}</span>
                </a>
              ))}
            </div>
          )}

        </div>


        {/* Answer input for question nodes */}
        {(thonk.type === 'question' || thonk.type === 'problem') && isAnswering && (
          <div className="nodrag px-3 pb-2">
            <Textarea
              ref={answerRef}
              placeholder="Your answer…"
              value={answerText}
              onChange={e => setAnswerText(e.target.value)}
              onKeyDown={stopDeletePropagation}
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
            <div className="mt-1 flex gap-1">
              <button
                onClick={handleCorrect}
                disabled={!correctionText.trim()}
                className="flex-1 text-sm px-2 py-1 rounded-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-30 transition-colors"
              >
                Revise Answer
              </button>
              <button
                onClick={() => { setCorrectionText(''); setActionState('idle') }}
                className="text-sm px-2 py-1 rounded-sm bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Ask & Answer input */}
        {(thonk.type === 'core' || thonk.type === 'idea' || thonk.type === 'answer') && isAsking && (
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

        {isLoading && (
          <div className="flex items-center gap-1.5 px-3 pb-2 text-sm opacity-60">
            <Loader2 className="w-5 h-5 animate-spin" /> Thinking…
          </div>
        )}
    </NodeShell>
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
      pd.onVersionCore === nd.onVersionCore &&
      pd.onOpenPanel === nd.onOpenPanel &&
      pd.panelOpen === nd.panelOpen &&
      pd.hasAnswer === nd.hasAnswer &&
      prev.selected === next.selected &&
      prev.dragging === next.dragging
    )
  }
)

function Sep() {
  return <div className="w-px h-4 bg-white/20 mx-0.5 shrink-0" />
}

type AddAction = { label: string; icon: React.ReactNode; onClick: () => void }

function AddDropdown({ nodeType, onAddQuestion, onAddIdea, onAddProblem }: {
  nodeType: string
  onAddQuestion: () => void
  onAddIdea: () => void
  onAddProblem: () => void
}) {
  const items: AddAction[] = []

  if (nodeType === 'core' || nodeType === 'idea' || nodeType === 'answer') {
    items.push(
      { label: 'Add Question', icon: <MessageCirclePlus className="w-4 h-4 text-gray-400" />, onClick: onAddQuestion },
      { label: 'Add Idea',     icon: <Lightbulb className="w-4 h-4 text-yellow-400" />,       onClick: onAddIdea },
      { label: 'Add Problem',  icon: <TriangleAlert className="w-4 h-4 text-red-400" />,      onClick: onAddProblem },
    )
  }
  if (nodeType === 'problem' || nodeType === 'question') {
    items.push(
      { label: 'Add Question', icon: <MessageCirclePlus className="w-4 h-4 text-gray-400" />, onClick: onAddQuestion },
    )
  }

  if (items.length === 0) return null

  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button className="w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer">
              <GitBranch className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={10} className="text-sm">Add Node...</TooltipContent>
        <DropdownMenuContent side="top" align="center" sideOffset={10} className="min-w-[130px]" onCloseAutoFocus={e => e.preventDefault()}>
          {items.map(item => (
            <DropdownMenuItem key={item.label} onClick={item.onClick}>
              {item.icon}
              {item.label}
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
          {(Object.keys(NODE_TYPE_LABELS) as import('@/store/types').NodeType[]).filter(t => t !== 'note').map(type => (
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

function ResolutionDropdown({
  closeBranchCount,
  onClose,
  onCloseBranch,
  onApply,
  onApplyBranch,
  applyTargetName,
  onNoteRejection,
  noteRejectionTarget,
}: {
  closeBranchCount: number
  onClose: () => void
  onCloseBranch: () => void
  onApply?: () => void
  onApplyBranch?: () => void
  applyTargetName?: string
  onNoteRejection?: () => void
  noteRejectionTarget?: string
}) {
  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button className="w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer">
              <CircleCheck className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={10} className="text-sm">Resolve…</TooltipContent>
        <DropdownMenuContent side="top" align="center" sideOffset={10} className="min-w-[200px]" onCloseAutoFocus={e => e.preventDefault()}>
          {onApply && applyTargetName && (
            <>
              <DropdownMenuItem onClick={onApply}>
                <CircleCheckBig className="w-4 h-4 text-[#00ae60]" />
                {`Apply to "${applyTargetName}"`}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onApplyBranch}>
                <CheckCheck className="w-4 h-4 text-[#00ae60]" />
                {`Apply branch to "${applyTargetName}"`}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {onNoteRejection && (
            <>
              <DropdownMenuItem onClick={onNoteRejection}>
                <Ban className="w-4 h-4 text-[#e95a32]" />
                {`Reject in "${noteRejectionTarget}"`}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={onClose}>
            <CircleSlash className="w-4 h-4 text-gray-400" />
            Close
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCloseBranch}>
            <CircleSlash className="w-4 h-4 text-gray-400" />
            {closeBranchCount > 1 ? `Close branch (${closeBranchCount})` : 'Close branch'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Tooltip>
  )
}

function ToolBtn({
  icon, label, onClick, disabled, active, className, heat, dot,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  className?: string
  heat?: number   // 0–1; >= 1 hard-disables the button and shows a red dot
  dot?: boolean   // shows a small purple dot indicator
}) {
  const isHeatBlocked = !!heat && heat >= 1
  const showHeatBadge = !!heat && heat > 0

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled || isHeatBlocked}
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded text-white/80 transition-colors relative',
            disabled        ? 'opacity-25 cursor-not-allowed' :
            isHeatBlocked   ? 'cursor-not-allowed' :
                              'hover:bg-white/15 hover:text-white cursor-pointer',
            active && 'bg-white/20 text-white',
            className,
          )}
        >
          <span className={isHeatBlocked ? 'opacity-25' : undefined}>{icon}</span>
          {showHeatBadge && (
            <span className={cn('absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full', heat >= 1 ? 'bg-red-400' : heat >= 2/3 ? 'bg-orange-400' : 'bg-yellow-400')} />
          )}
          {dot && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-purple-400" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={10} className="text-sm">
        {disabled ? `${label} — add content first` : label}
      </TooltipContent>
    </Tooltip>
  )
}
