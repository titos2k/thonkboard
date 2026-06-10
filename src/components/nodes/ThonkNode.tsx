import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { NodeToolbar, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import {
  Angry,
  MessageCircleQuestionMark,
  MessageCirclePlus,
  Lightbulb,
  CircleCheckBig,
  Check,
  CheckCheck,
  MessageCircle,
  MessageCircleReply,
  Trash2,
  Pencil,
  Loader2,
  FileText,
  TriangleAlert,
  Globe,
  ArrowDownUp,
  CirclePlus,
  Brain,
  RotateCcw,
  CircleX,
} from 'lucide-react'
import { NodeShell } from './NodeShell'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { ThonkNode as TNode } from '@/store/types'
import { assembleContext, contextToPrompt } from '@/ai/context'
import { critiqueNode, questionNode, proposeIdeas, integrateQA, integrateAllQA, detectConflicts, findRelatedNodes, answerQuestion, correctAnswer } from '@/ai/gemini'
import type { ThonkGraph, ConflictEntry } from '@/store/types'
import { showToast } from '@/lib/toast'

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
  onAddEdge: (source: string, target: string, relation: import('@/store/types').EdgeRelation) => void
  onUpdate: (id: string, patch: Partial<Pick<TNode, 'title' | 'body' | 'summary' | 'resolved' | 'resolvedAs' | 'conflicts' | 'type'>> & { meta?: Partial<TNode['meta']> }) => void
  onDelete: (id: string) => void
  onVersionCore: (oldId: string, newTitle: string, newBody: string, pos: { x: number; y: number }) => TNode
  panelOpen: boolean
  onOpenPanel: (id: string | null) => void
  onAutoEdit: (id: string) => void
  onBatchStart: () => void
  onBatchEnd: () => void
}

type ActionState = 'idle' | 'loading' | 'answering' | 'correcting'

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

    const qEdge = graph.edges.find(e => e.target === currentId && (e.relation === 'answers' || e.relation === 'fixes'))
    if (!qEdge) return { pairs, anchor: null }
    const qNode = graph.nodes.find(n => n.id === qEdge.source)
    if (!qNode) return { pairs, anchor: null }

    if (!aNode.resolved && !qNode.resolved) pairs.unshift({ qNode, aNode })

    const parentEdge = graph.edges.find(e => e.target === qNode.id && (e.relation === 'questions' || e.relation === 'argues'))
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
// Handles: answer→question→parent, answer→fixes→problem→argues→parent
function findChainRoot(graph: ThonkGraph, nodeId: string): import('@/store/types').ThonkNode | null {
  const node = graph.nodes.find(n => n.id === nodeId)
  if (!node) return null
  if (node.type === 'core' || node.type === 'idea') return node
  if (node.type === 'problem') {
    // walk up via argues edge to the core/idea that raised this problem
    const argEdge = graph.edges.find(e => e.target === nodeId && e.relation === 'argues')
    if (!argEdge) return node
    return findChainRoot(graph, argEdge.source)
  }
  // node is 'answer' — find its parent (question or problem) then recurse
  const aEdge = graph.edges.find(e => e.target === nodeId && (e.relation === 'answers' || e.relation === 'fixes'))
  if (!aEdge) return node
  const qEdge = graph.edges.find(e => e.target === aEdge.source && (e.relation === 'questions' || e.relation === 'argues'))
  if (!qEdge) return node
  return findChainRoot(graph, qEdge.source)
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

// Find a position near `origin + (dx, dy)` that doesn't collide with existing nodes.
function findFreePos(
  nodes: { position: { x: number; y: number } }[],
  origin: { x: number; y: number },
  dx = 0,
  dy = 220,
): { x: number; y: number } {
  const W = 260  // approx node width + gap
  const H = 100  // approx node height + gap
  const preferred = { x: origin.x + dx, y: origin.y + dy }
  const candidates: { x: number; y: number }[] = []
  for (let row = 0; row <= 4; row++) {
    for (let col = -4; col <= 4; col++) {
      candidates.push({ x: preferred.x + col * W, y: preferred.y + row * H })
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
  const { getNode } = useReactFlow()

  const [editing, setEditing] = useState(() => !!d.autoEdit)
  const [editTitle, setEditTitle] = useState(thonk.title)
  const [actionState, setActionState] = useState<ActionState>('idle')
  const [answerText, setAnswerText] = useState('')
  const [correctionText, setCorrectionText] = useState('')

  const titleInputRef = useRef<HTMLTextAreaElement>(null)
  const answerRef = useRef<HTMLTextAreaElement>(null)
  const correctionRef = useRef<HTMLTextAreaElement>(null)

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

  useEffect(() => {
    if (isAnswering) requestAnimationFrame(() => answerRef.current?.focus())
  }, [isAnswering])

  useEffect(() => {
    if (isCorrecting) requestAnimationFrame(() => correctionRef.current?.focus())
  }, [isCorrecting])

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
      d.onUpdate(thonk.id, { title: newTitle, ...bodyPatch, meta: { aiGenerated: false } })
    } else if (thonk.meta.aiGenerated) {
      d.onUpdate(thonk.id, { meta: { aiGenerated: false } })
    }
    setEditing(false)
  }, [editTitle, thonk.title, thonk.id, thonk.meta.aiGenerated, d])

  const enterEdit = () => {
    setEditTitle(thonk.title)
    setEditing(true)
    requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })
  }

  const handleArgue = () =>
    withLoading(async () => {
      const problems = await critiqueNode(ctx())
      let i = 0
      for (const p of problems) {
        const node = d.onAddNode('problem', p.content, p.content, spawnPos(280 + i * 20, -40 + i * 80), { severity: p.severity })
        d.onAddEdge(thonk.id, node.id, 'argues')
        i++
      }
      if (problems.length === 0) showToast('No significant problems found — idea holds up.')
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
      const { question } = await questionNode(prompt)
      const pos = findFreePos(graphRef.current.nodes, livePos(), 0, nodeH())
      const qNode = d.onAddNode('question', question, question, pos, { aiGenerated: true })
      d.onAddEdge(thonk.id, qNode.id, 'questions')
      setActionState('answering')
    })

  const handleAddQuestion = () => {
    const pos = findFreePos(graphRef.current.nodes, livePos(), 0, nodeH())
    const qNode = d.onAddNode('question', '', '', pos)
    d.onAddEdge(thonk.id, qNode.id, 'questions')
    d.onAutoEdit(qNode.id)
  }

  const handlePropose = () =>
    withLoading(async () => {
      const ideas = await proposeIdeas(ctx())
      let i = 0
      for (const idea of ideas) {
        const node = d.onAddNode('idea', idea.title, idea.body, spawnPos(-200 + i * 220, nodeH()))
        d.onAddEdge(thonk.id, node.id, 'spawns')
        i++
      }
    })

  const handleAnswer = () => {
    if (!answerText.trim()) return
    const raw = answerText.trim()
    const relation = thonk.type === 'problem' ? 'fixes' : 'answers'
    const aNode = d.onAddNode('answer', raw, raw, spawnPos(0, nodeH()))
    d.onAddEdge(thonk.id, aNode.id, relation)
    setAnswerText('')
    setActionState('idle')
  }

  const handleIdeateAnswer = () =>
    withLoading(async () => {
      const { answer, sources } = await answerQuestion(ctx())
      const aNode = d.onAddNode('answer', answer, answer, spawnPos(0, nodeH()), {
        aiGenerated: true,
        sources: sources.length > 0 ? sources : undefined,
      })
      d.onAddEdge(thonk.id, aNode.id, 'answers')
    })

  const handleGenerateFix = () =>
    withLoading(async () => {
      const { answer, sources } = await answerQuestion(ctx())
      const aNode = d.onAddNode('answer', answer, answer, spawnPos(0, nodeH()), {
        aiGenerated: true,
        sources: sources.length > 0 ? sources : undefined,
      })
      d.onAddEdge(thonk.id, aNode.id, 'fixes')
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
    const pos = findFreePos(graphRef.current.nodes, livePos(), -200, nodeH())
    const node = d.onAddNode('idea', '', '', pos)
    d.onAddEdge(thonk.id, node.id, 'spawns')
    d.onAutoEdit(node.id)
  }

  const handleAddProblem = () => {
    const pos = findFreePos(graphRef.current.nodes, livePos(), 280, -40)
    const node = d.onAddNode('problem', '', '', pos, { severity: 0.5 })
    d.onAddEdge(thonk.id, node.id, 'argues')
    d.onAutoEdit(node.id)
  }

  const handleTransform = (newType: TNode['type']) => {
    d.onUpdate(thonk.id, { type: newType })
  }

  const handleApprove = () =>
    withLoading(async () => {
      const qEdge = graphRef.current.edges.find(e => e.target === thonk.id && (e.relation === 'answers' || e.relation === 'fixes'))
      if (!qEdge) return
      const qNode = graphRef.current.nodes.find(n => n.id === qEdge.source)
      if (!qNode) return

      // Walk all the way up to find the topmost core/idea ancestor to sync into.
      // Always resolve only the closest Q+A pair visually.
      const rootNode = findChainRoot(graphRef.current, thonk.id)
      const syncTarget = rootNode && (rootNode.type === 'core' || rootNode.type === 'idea') ? rootNode : null

      let integratedBody = syncTarget?.body ?? ''
      let integratedTitle: string | undefined

      if (syncTarget) {
        const ctx = assembleContext(graphRef.current, syncTarget.id)
        if (ctx) {
          const res = await integrateQA(contextToPrompt(ctx), qNode.title, thonk.title)
          integratedBody = res.body
          integratedTitle = res.title?.trim() || undefined
          d.onUpdate(syncTarget.id, {
            body: integratedBody,
            ...(integratedTitle ? { title: integratedTitle } : {}),
            conflicts: [],
          })
        }
      } else {
        // No direct ancestor — find related core/ideas via semantic search and propagate
        const coreIdeas = graphRef.current.nodes.filter(n =>
          !n.resolved && (n.type === 'core' || n.type === 'idea')
        )
        if (coreIdeas.length > 0) {
          const relatedIds = await findRelatedNodes(
            qNode.title, thonk.title, qNode.id,
            coreIdeas.map(n => ({ id: n.id, type: n.type, title: n.title, summary: n.summary }))
          )
          for (const nodeId of relatedIds.slice(0, 2)) {
            const ctx = assembleContext(graphRef.current, nodeId)
            if (!ctx) continue
            const res = await integrateQA(contextToPrompt(ctx), qNode.title, thonk.title)
            const target = coreIdeas.find(n => n.id === nodeId)
            d.onUpdate(nodeId, { body: res.body, ...(res.title?.trim() && (target?.type === 'core' || target?.type === 'idea') ? { title: res.title.trim() } : {}), conflicts: [] })
          }
        }
      }

      // Always resolve just the closest question/problem + answer pair
      d.onUpdate(qNode.id,  { resolved: true, resolvedAs: 'approved' })
      d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'approved' })

      // Background: scan other nodes for contradictions and related updates
      if (syncTarget) {
        const targetId    = syncTarget.id
        const targetTitle = integratedTitle ?? syncTarget.title
        const candidates  = graphRef.current.nodes.filter(n =>
          n.id !== targetId && n.id !== qNode.id && n.id !== thonk.id &&
          !n.resolved && (n.type === 'core' || n.type === 'idea' || n.type === 'problem')
        )
        detectConflicts(targetTitle, integratedBody, candidates.map(n => ({
          id: n.id, type: n.type, title: n.title, body: n.body, summary: n.summary,
        }))).then(conflicts => {
          for (const c of conflicts) {
            if (candidates.some(n => n.id === c.nodeId))
              d.onUpdate(c.nodeId, { conflicts: [{ nodeId: targetId, description: c.description }] })
          }
        }).catch(() => {})
        findRelatedNodes(
          qNode.title, thonk.title, targetId,
          candidates.map(n => ({ id: n.id, type: n.type, title: n.title, summary: n.summary }))
        ).then(async nodeIds => {
          for (const nodeId of nodeIds.filter(id => candidates.some(n => n.id === id)).slice(0, 3)) {
            const ctx = assembleContext(graphRef.current, nodeId)
            if (!ctx) continue
            const res = await integrateQA(contextToPrompt(ctx), qNode.title, thonk.title)
            const cNode = candidates.find(n => n.id === nodeId)
            d.onUpdate(nodeId, { body: res.body, ...(res.title?.trim() && (cNode?.type === 'core' || cNode?.type === 'idea') ? { title: res.title.trim() } : {}) })
          }
        }).catch(() => {})
      }
    })

  const handleApproveAll = () =>
    withLoading(async () => {
      const { pairs, anchor } = collectChainPairs(graphRef.current, thonk.id)
      if (pairs.length === 0 || !anchor) return
      const c = assembleContext(graphRef.current, anchor.id)
      if (!c) return
      const { body, title } = await integrateAllQA(
        contextToPrompt(c),
        pairs.map(p => ({ question: p.qNode.title, answer: p.aNode.title })),
      )
      d.onUpdate(anchor.id, { body, ...(title?.trim() && (anchor.type === 'core' || anchor.type === 'idea') ? { title: title.trim() } : {}), conflicts: [] })
      for (const { qNode: q, aNode: a } of pairs) {
        d.onUpdate(q.id, { resolved: true, resolvedAs: 'approved' })
        d.onUpdate(a.id, { resolved: true, resolvedAs: 'approved' })
      }

      // Background conflict detection
      const allPairIds = new Set(pairs.flatMap(p => [p.qNode.id, p.aNode.id]))
      const candidates = graphRef.current.nodes.filter(n =>
        n.id !== anchor.id && !allPairIds.has(n.id) && !n.resolved &&
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

  const handleDismiss = useCallback(() => {
    const qEdge = graphRef.current.edges.find(e => e.target === thonk.id && (e.relation === 'answers' || e.relation === 'fixes'))
    if (qEdge) d.onUpdate(qEdge.source, { resolved: true, resolvedAs: 'dismissed' })
    d.onUpdate(thonk.id, { resolved: true, resolvedAs: 'dismissed' })
  }, [thonk.id, d, graphRef])

  const handleReopenAndAnswer = useCallback(() => {
    const aEdge = graphRef.current.edges.find(e => e.source === thonk.id && (e.relation === 'answers' || e.relation === 'fixes'))
    if (aEdge) d.onUpdate(aEdge.target, { resolved: false })
    d.onUpdate(thonk.id, { resolved: false })
    setActionState('answering')
  }, [thonk.id, d, graphRef])

  const approveAllCount = thonk.type === 'answer'
    ? collectChainPairs(graphRef.current, thonk.id).pairs.length
    : 0

  const isLoading = actionState === 'loading'
  const isLight = thonk.type === 'question' || thonk.type === 'idea'

  const showEdit         = !editing
  const showExpandDetail = thonk.type !== 'question' && thonk.type !== 'answer'

  return (
    <NodeShell nodeType={thonk.type} selected={selected} resolved={thonk.resolved} aiGenerated={thonk.meta.aiGenerated}>
      {/* Floating toolbar above node — inside NodeShell so RF drag registration stays on NodeShell root */}
      <NodeToolbar isVisible={selected && !dragging && !isLoading && !isAnswering && !isCorrecting && !editing} position={Position.Top} offset={8}>
        <div className="nodrag flex items-center gap-0.5 bg-gray-900 rounded-lg px-1.5 py-1 shadow-xl border border-white/10">

          {thonk.resolved ? (
            /* Resolved: edit, details, reopen (+ answer shortcut for questions), delete */
            <>
              {showEdit         && <ToolBtn icon={<Pencil className="w-5 h-5" />} label="Edit" onClick={enterEdit} />}
              {showExpandDetail && <ToolBtn icon={<FileText className="w-5 h-5" />} label={d.panelOpen ? 'Close Details' : 'Open Details'} active={d.panelOpen} onClick={() => d.onOpenPanel(d.panelOpen ? null : thonk.id)} />}
              <Sep />
              {(thonk.type === 'question' || thonk.type === 'problem') && (
                <button
                  onClick={handleReopenAndAnswer}
                  className="nodrag flex items-center gap-1.5 h-8 px-3 rounded-sm text-sm font-medium bg-emerald-400 hover:bg-emerald-500 text-emerald-950 transition-colors cursor-pointer"
                >
                  <MessageCircleReply className="w-5 h-5" />
                  {thonk.type === 'problem' ? 'Reply' : 'Answer'}
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
                    onClick={() => setActionState('answering')}
                    className="nodrag flex items-center gap-1.5 h-8 px-3 rounded-sm text-sm font-medium bg-emerald-400 hover:bg-emerald-500 text-emerald-950 transition-colors cursor-pointer"
                  >
                    <MessageCircleReply className="w-5 h-5" />
                    {thonk.type === 'problem' ? 'Reply' : 'Answer'}
                  </button>
                  <Sep />
                </>
              )}

              {/* Section 1: AI */}
              {(thonk.type === 'core' || thonk.type === 'idea') && (
                <>
                  <ToolBtn icon={<MessageCircleQuestionMark className="w-5 h-5" />} label="Ask me" onClick={handleQuestion} disabled={!hasContent} className="text-green-400" />
                  <ToolBtn icon={<Angry className="w-5 h-5" />} label="Find Problems" onClick={handleArgue} disabled={!hasContent} className="text-red-400" />
                  <ToolBtn icon={<Lightbulb className="w-5 h-5" />} label="Generate Ideas" onClick={handlePropose} disabled={!hasContent} className="text-yellow-400" />
                </>
              )}
              {thonk.type === 'problem' && (
                <ToolBtn icon={<Lightbulb className="w-5 h-5" />} label="Generate Solution" onClick={handleGenerateFix} disabled={!hasContent} className="text-green-400" />
              )}
              {thonk.type === 'question' && (
                <ToolBtn icon={<Lightbulb className="w-5 h-5" />} label="Generate Answer" onClick={handleIdeateAnswer} className="text-emerald-300" />
              )}
              {thonk.type === 'answer' && (
                <>
                  <ToolBtn icon={<MessageCircleQuestionMark className="w-5 h-5" />} label="Ask me" onClick={handleQuestion} disabled={!hasContent} className="text-green-400" />
                  <ToolBtn icon={<Angry className="w-5 h-5" />} label="Find Problems" onClick={handleArgue} disabled={!hasContent} className="text-red-400" />
                </>
              )}

              {/* Section 2: Human actions */}
              <Sep />
              {showEdit         && <ToolBtn icon={<Pencil className="w-5 h-5" />} label="Edit" onClick={enterEdit} />}
              {showExpandDetail && <ToolBtn icon={<FileText className="w-5 h-5" />} label={d.panelOpen ? 'Close Details' : 'Open Details'} active={d.panelOpen} onClick={() => d.onOpenPanel(d.panelOpen ? null : thonk.id)} />}
              <AddDropdown nodeType={thonk.type} onAddQuestion={handleAddQuestion} onAddIdea={handleAddIdea} onAddProblem={handleAddProblem} />
              {thonk.type === 'answer' && thonk.meta.aiGenerated && (
                <ToolBtn icon={<TriangleAlert className="w-5 h-5" />} label="Correct This" onClick={() => setActionState('correcting')} disabled={!hasContent} />
              )}
              <TransformBtn currentType={thonk.type} onTransform={handleTransform} />
              {thonk.type === 'answer' && (
                <>
                  <Sep />
                  <ToolBtn icon={<CircleCheckBig className="w-5 h-5" />} label="Resolve & Sync Ideas" onClick={handleApprove} />
                  {approveAllCount > 1 && (
                    <ToolBtn icon={<CheckCheck className="w-5 h-5" />} label={`Resolve All & Sync (${approveAllCount})`} onClick={handleApproveAll} className="text-green-400" />
                  )}
                  <ToolBtn icon={<CircleX className="w-5 h-5" />} label="Dismiss" onClick={handleDismiss} />
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
            <div className={`absolute -bottom-2.5 -right-2.5 w-6 h-6 rounded-full flex items-center justify-center z-10 shadow-sm ring-1 ring-white/50 ${thonk.resolvedAs === 'dismissed' ? 'bg-red-400' : 'bg-green-500'}`}>
              {thonk.resolvedAs === 'dismissed'
                ? <CircleX className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                : <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="z-[9999] text-sm">
            {thonk.resolvedAs === 'dismissed' ? 'Dismissed' : 'Approved'}
          </TooltipContent>
        </Tooltip>
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
                thonk.type === 'core'     ? 'What\'s the core idea?' :
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
              onDoubleClick={thonk.type === 'question' ? () => setActionState('answering') : enterEdit}
            >
              {thonk.title ? linkifyText(thonk.title) : <span className="opacity-40 italic">Untitled</span>}
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
              <CirclePlus className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={10} className="text-sm">Add Node</TooltipContent>
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
          {(Object.keys(NODE_TYPE_LABELS) as import('@/store/types').NodeType[]).map(type => (
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

function ToolBtn({
  icon, label, onClick, disabled, active, className,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded text-white/80 transition-colors',
            disabled ? 'opacity-25 cursor-not-allowed' : 'hover:bg-white/15 hover:text-white cursor-pointer',
            active && 'bg-white/20 text-white',
            className,
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={10} className="text-sm">
        {disabled ? `${label} — add content first` : label}
      </TooltipContent>
    </Tooltip>
  )
}
