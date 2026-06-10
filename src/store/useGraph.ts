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

export function useGraph() {
  const [graph, setGraphRaw] = useState<ThonkGraph>(loadGraph)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const persist = useCallback(
    debounce((g: ThonkGraph) => saveGraph(g), 500),
    [],
  )

  const setGraph = useCallback(
    (updater: ThonkGraph | ((prev: ThonkGraph) => ThonkGraph)) => {
      setGraphRaw(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        persist(next)
        return next
      })
    },
    [persist],
  )

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
    (source: string, target: string, relation: EdgeRelation): ThonkEdge => {
      const edge: ThonkEdge = { id: uuidv4(), source, target, relation }
      setGraph(g => ({ ...g, edges: [...g.edges, edge] }))
      return edge
    },
    [setGraph],
  )

  const updateNode = useCallback(
    (id: string, patch: Partial<Pick<ThonkNode, 'title' | 'body' | 'summary' | 'resolved' | 'resolvedAs' | 'conflicts' | 'type'>> & { meta?: Partial<ThonkNode['meta']> }) => {
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
        nodes: g.nodes.filter(n => n.id !== id),
        edges: g.edges.filter(e => e.source !== id && e.target !== id),
      }))
    },
    [setGraph],
  )

  /** Version a core node: creates a new core with revisionOf=oldId */
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
    setGraph(makeInitialGraph())
  }, [setGraph])

  return {
    graph,
    setGraph,
    addNode,
    addEdge,
    updateNode,
    updateNodePosition,
    deleteNode,
    deleteEdge,
    reconnectEdge,
    versionCore,
    resetGraph,
  }
}

// ── Shared selected-node state ─────────────────────────────────────────────────
// Not in the hook above since it doesn't need persistence.
export type SelectedNodeId = string | null

// Debounce ref utility (stable across renders without useCallback tricks)
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
