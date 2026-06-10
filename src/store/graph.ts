import { v4 as uuidv4 } from 'uuid'
import type { ThonkGraph, ThonkNode, ThonkEdge, NodeType, EdgeRelation } from './types'

export function exportGraphToFile(graph: ThonkGraph): void {
  const core = graph.nodes.find(n => n.type === 'core')
  const slug = (core?.title ?? 'board').replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40)
  const date = new Date().toISOString().slice(0, 10)
  const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `thonk-${slug}-${date}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function parseImportedGraph(json: string): ThonkGraph {
  const g = JSON.parse(json) as ThonkGraph
  g.nodes = g.nodes.map(n => ({
    ...(n.summary == null ? { ...n, summary: '' } : n),
    resolved: (n as ThonkNode & { resolved?: boolean }).resolved ?? false,
    conflicts: (n as ThonkNode & { conflicts?: ThonkNode['conflicts'] }).conflicts ?? [],
  }))
  return g
}

const STORAGE_KEY = 'thonk.graph'

export function makeInitialGraph(): ThonkGraph {
  const coreId = uuidv4()
  return {
    nodes: [
      {
        id: coreId,
        type: 'core',
        title: 'Name your core idea',
        body: '',
        summary: '',
        resolved: false,
        conflicts: [],
        position: { x: 400, y: 300 },
        meta: { createdAt: new Date().toISOString(), severity: null, revisionOf: null },
      },
    ],
    edges: [],
  }
}

export function loadGraph(): ThonkGraph {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const g = JSON.parse(raw) as ThonkGraph
      // Migrate: ensure every node has required fields
      g.nodes = g.nodes.map(n => ({
        ...(n.summary == null ? { ...n, summary: '' } : n),
        resolved:  (n as ThonkNode & { resolved?: boolean }).resolved  ?? false,
        conflicts: (n as ThonkNode & { conflicts?: ThonkNode['conflicts'] }).conflicts ?? [],
      }))
      return g
    }
  } catch {
    // corrupted — start fresh
  }
  return makeInitialGraph()
}

export function saveGraph(graph: ThonkGraph): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(graph))
}

export function addNode(
  graph: ThonkGraph,
  type: NodeType,
  title: string,
  body: string,
  position: { x: number; y: number },
  meta?: Partial<ThonkNode['meta']>,
): { graph: ThonkGraph; node: ThonkNode } {
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
  return { graph: { ...graph, nodes: [...graph.nodes, node] }, node }
}

export function addEdge(
  graph: ThonkGraph,
  source: string,
  target: string,
  relation: EdgeRelation,
): { graph: ThonkGraph; edge: ThonkEdge } {
  const edge: ThonkEdge = { id: uuidv4(), source, target, relation }
  return { graph: { ...graph, edges: [...graph.edges, edge] }, edge }
}

export function updateNode(
  graph: ThonkGraph,
  id: string,
  patch: Partial<Pick<ThonkNode, 'title' | 'body' | 'summary' | 'resolved' | 'conflicts'>>,
): ThonkGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(n => (n.id === id ? { ...n, ...patch } : n)),
  }
}

export function updateNodePosition(
  graph: ThonkGraph,
  id: string,
  position: { x: number; y: number },
): ThonkGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(n => (n.id === id ? { ...n, position } : n)),
  }
}

export function deleteNode(graph: ThonkGraph, id: string): ThonkGraph {
  return {
    nodes: graph.nodes.filter(n => n.id !== id),
    edges: graph.edges.filter(e => e.source !== id && e.target !== id),
  }
}

export function versionCore(
  graph: ThonkGraph,
  oldId: string,
  newTitle: string,
  newBody: string,
  position: { x: number; y: number },
): { graph: ThonkGraph; newNode: ThonkNode } {
  const newId = uuidv4()
  const newNode: ThonkNode = {
    id: newId,
    type: 'core',
    title: newTitle,
    body: newBody,
    summary: '',
    resolved: false,
    conflicts: [],
    position: { x: position.x + 40, y: position.y + 40 },
    meta: {
      createdAt: new Date().toISOString(),
      severity: null,
      revisionOf: oldId,
    },
  }
  const newEdge: ThonkEdge = { id: uuidv4(), source: oldId, target: newId, relation: 'expands' }
  return {
    graph: {
      nodes: [...graph.nodes, newNode],
      edges: [...graph.edges, newEdge],
    },
    newNode,
  }
}
