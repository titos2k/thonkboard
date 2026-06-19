import { useState, useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { ThonkGraph, ThonkNode, ThonkEdge, NodeType, EdgeRelation } from './types'
import { loadGraph, saveGraph, makeInitialGraph } from './graph'

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

const MAX_HISTORY = 21 // 20 undo steps

export function useGraph(boardId: string) {
  const [graph, setGraphRaw] = useState<ThonkGraph>(() => loadGraph(boardId))

  const graphRef    = useRef<ThonkGraph>(graph)
  const boardIdRef  = useRef<string>(boardId)
  const historyRef  = useRef<ThonkGraph[]>([graph])
  const historyIdx  = useRef(0)
  const [histVer, setHistVer] = useState(0)
  const isBatching  = useRef(false)

  // persist always saves to whichever board is current at fire time
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const persist = useCallback(
    debounce((g: ThonkGraph) => saveGraph(g, boardIdRef.current), 500),
    [],
  )

  // Call this to switch boards. Flushes current board, loads (or accepts) the new graph,
  // resets history. Pass preloadedGraph to avoid a redundant localStorage read on import.
  const switchToBoard = useCallback((newBoardId: string, preloadedGraph?: ThonkGraph) => {
    saveGraph(graphRef.current, boardIdRef.current)
    boardIdRef.current = newBoardId
    const next = preloadedGraph ?? loadGraph(newBoardId)
    graphRef.current = next
    setGraphRaw(next)
    historyRef.current = [next]
    historyIdx.current = 0
    setHistVer(v => v + 1)
  }, [])

  const pushHistory = useCallback((next: ThonkGraph) => {
    const h = historyRef.current
    h.splice(historyIdx.current + 1)
    h.push(next)
    if (h.length > MAX_HISTORY) h.shift()
    else historyIdx.current = h.length - 1
    setHistVer(v => v + 1)
  }, [])

  const setGraph = useCallback(
    (updater: ThonkGraph | ((prev: ThonkGraph) => ThonkGraph)) => {
      const next = typeof updater === 'function' ? updater(graphRef.current) : updater
      graphRef.current = next
      setGraphRaw(next)
      persist(next)
      if (!isBatching.current) pushHistory(next)
    },
    [persist, pushHistory],
  )

  const onBatchStart = useCallback(() => { isBatching.current = true }, [])

  const onBatchEnd = useCallback(() => {
    isBatching.current = false
    pushHistory(graphRef.current)
  }, [pushHistory])

  const undo = useCallback(() => {
    if (historyIdx.current <= 0) return
    historyIdx.current--
    const prev = historyRef.current[historyIdx.current]
    graphRef.current = prev
    setGraphRaw(prev)
    saveGraph(prev, boardIdRef.current)
    setHistVer(v => v + 1)
  }, [])

  const redo = useCallback(() => {
    if (historyIdx.current >= historyRef.current.length - 1) return
    historyIdx.current++
    const next = historyRef.current[historyIdx.current]
    graphRef.current = next
    setGraphRaw(next)
    saveGraph(next, boardIdRef.current)
    setHistVer(v => v + 1)
  }, [])

  const addNode = useCallback(
    (
      type: NodeType,
      title: string,
      body: string,
      position: { x: number; y: number },
      meta?: Partial<ThonkNode['meta']>,
    ): ThonkNode => {
      const node: ThonkNode = {
        id: uuidv4(),
        type,
        title,
        body,
        summary: '',
        resolved: false,
        conflicts: [],
        position,
        meta: {
          createdAt: new Date().toISOString(),
          severity: null,
          revisionOf: null,
          ...meta,
        },
      }
      setGraph(g => ({ ...g, nodes: [...g.nodes, node] }))
      return node
    },
    [setGraph],
  )

  const addEdge = useCallback(
    (source: string, target: string, relation: EdgeRelation, sourceHandle?: string, targetHandle?: string): ThonkEdge => {
      const edge: ThonkEdge = { id: uuidv4(), source, target, relation, sourceHandle, targetHandle }
      setGraph(g => ({ ...g, edges: [...g.edges, edge] }))
      return edge
    },
    [setGraph],
  )

  const updateNode = useCallback(
    (id: string, patch: Partial<Pick<ThonkNode, 'title' | 'body' | 'summary' | 'resolved' | 'resolvedAs' | 'unread' | 'bodyBeforeMerge' | 'conflicts' | 'type' | 'placeholder'>> & { meta?: Partial<ThonkNode['meta']> }) => {
      setGraph(g => ({
        ...g,
        nodes: g.nodes.map(n => {
          if (n.id !== id) return n
          const { meta: metaPatch, ...rest } = patch
          return { ...n, ...rest, ...(metaPatch ? { meta: { ...n.meta, ...metaPatch } } : {}) }
        }),
      }))
    },
    [setGraph],
  )

  const updateNodePosition = useCallback(
    (id: string, position: { x: number; y: number }) => {
      setGraph(g => ({
        ...g,
        nodes: g.nodes.map(n => (n.id === id ? { ...n, position } : n)),
      }))
    },
    [setGraph],
  )

  const deleteNode = useCallback(
    (id: string) => {
      setGraph(g => ({
        nodes: g.nodes
          .filter(n => n.id !== id)
          .map(n => n.conflicts?.some(c => c.nodeId === id)
            ? { ...n, conflicts: n.conflicts.filter(c => c.nodeId !== id) }
            : n),
        edges: g.edges.filter(e => e.source !== id && e.target !== id),
      }))
    },
    [setGraph],
  )

  const versionCore = useCallback(
    (oldId: string, newTitle: string, newBody: string, position: { x: number; y: number }): ThonkNode => {
      const newNode: ThonkNode = {
        id: uuidv4(),
        type: 'core',
        title: newTitle,
        body: newBody,
        summary: '',
        resolved: false,
        conflicts: [],
        position: { x: position.x + 40, y: position.y + 60 },
        meta: {
          createdAt: new Date().toISOString(),
          severity: null,
          revisionOf: oldId,
        },
      }
      const linkEdge: ThonkEdge = { id: uuidv4(), source: oldId, target: newNode.id, relation: 'expands' }
      setGraph(g => ({ nodes: [...g.nodes, newNode], edges: [...g.edges, linkEdge] }))
      return newNode
    },
    [setGraph],
  )

  const deleteEdge = useCallback(
    (id: string) => {
      setGraph(g => ({ ...g, edges: g.edges.filter(e => e.id !== id) }))
    },
    [setGraph],
  )

  const reconnectEdge = useCallback(
    (oldId: string, newSource: string, newTarget: string, relation: EdgeRelation, sourceHandle?: string | null, targetHandle?: string | null): ThonkEdge => {
      const newEdge: ThonkEdge = { id: uuidv4(), source: newSource, target: newTarget, relation, sourceHandle, targetHandle }
      setGraph(g => ({ ...g, edges: [...g.edges.filter(e => e.id !== oldId), newEdge] }))
      return newEdge
    },
    [setGraph],
  )

  const resetGraph = useCallback(() => {
    const initial = makeInitialGraph()
    setGraph(initial)
    return initial.nodes[0].id
  }, [setGraph])

  const canUndo = historyIdx.current > 0
  const canRedo = historyIdx.current < historyRef.current.length - 1

  void histVer

  return {
    graph,
    graphRef,
    setGraph,
    switchToBoard,
    addNode,
    addEdge,
    updateNode,
    updateNodePosition,
    deleteNode,
    deleteEdge,
    reconnectEdge,
    versionCore,
    resetGraph,
    undo,
    redo,
    canUndo,
    canRedo,
    onBatchStart,
    onBatchEnd,
  }
}

// ── Shared selected-node state ─────────────────────────────────────────────────
export type SelectedNodeId = string | null

export function useDebouncedRef<T>(fn: (v: T) => void, ms: number) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback(
    (v: T) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => fn(v), ms)
    },
    [fn, ms],
  )
}
