import { v4 as uuidv4 } from 'uuid'
import type { ThonkGraph, ThonkNode, ThonkEdge, NodeType, EdgeRelation, BoardMeta } from './types'

export type ViewportData = { x: number; y: number; zoom: number }

// ── Storage key helpers ────────────────────────────────────────────────────────

const BOARDS_KEY       = 'thonk.boards'
const ACTIVE_BOARD_KEY = 'thonk.activeBoardId'

function graphKey(boardId: string)    { return `thonk.graph.${boardId}` }
function viewportKey(boardId: string) { return `thonk.viewport.${boardId}` }

// ── One-time migration from single-board to multi-board ───────────────────────

export function migrateToMultiBoard(): void {
  if (localStorage.getItem(BOARDS_KEY)) return // already migrated
  try {
    const boardId = uuidv4()
    const board: BoardMeta = { id: boardId, name: 'Board 1', createdAt: new Date().toISOString() }
    localStorage.setItem(BOARDS_KEY, JSON.stringify([board]))
    localStorage.setItem(ACTIVE_BOARD_KEY, boardId)
    const raw = localStorage.getItem('thonk.graph')
    if (raw) {
      localStorage.setItem(graphKey(boardId), raw)
      localStorage.removeItem('thonk.graph')
    }
    const vp = localStorage.getItem('thonk.viewport')
    if (vp) {
      localStorage.setItem(viewportKey(boardId), vp)
      localStorage.removeItem('thonk.viewport')
    }
  } catch {
    // ignore — app will start fresh
  }
}

// ── Board metadata ─────────────────────────────────────────────────────────────

export function loadBoards(): BoardMeta[] {
  try {
    const raw = localStorage.getItem(BOARDS_KEY)
    if (raw) return JSON.parse(raw) as BoardMeta[]
  } catch {}
  return []
}

export function saveBoards(boards: BoardMeta[]): void {
  try {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(boards))
  } catch {
    window.dispatchEvent(new CustomEvent('thonk:toast', { detail: 'Storage full — export or delete boards to free up space' }))
  }
}

export function getActiveBoardId(): string {
  const id = localStorage.getItem(ACTIVE_BOARD_KEY)
  if (id) return id
  return loadBoards()[0]?.id ?? ''
}

export function setActiveBoardId(id: string): void {
  try { localStorage.setItem(ACTIVE_BOARD_KEY, id) } catch {}
}

export function deleteBoard(boardId: string): void {
  localStorage.removeItem(graphKey(boardId))
  localStorage.removeItem(viewportKey(boardId))
}

// ── Graph persistence ──────────────────────────────────────────────────────────

declare global {
  interface Window {
    showSaveFilePicker(options?: {
      suggestedName?: string
      excludeAcceptAllOption?: boolean
      types?: Array<{ description?: string; accept: Record<string, string[]> }>
    }): Promise<FileSystemFileHandle>
  }
}

export const fsaSupported = 'showSaveFilePicker' in window

export function exportGraphToFile(graph: ThonkGraph, boardId: string, boardName: string): void {
  const slug = boardName.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40) || 'board'
  const date = new Date().toISOString().slice(0, 10)
  const payload = { boardId, boardName, ...graph }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `thonk-${slug}-${date}.thonk`
  a.click()
  URL.revokeObjectURL(url)
}

export async function saveGraphToFileHandle(
  handle: FileSystemFileHandle,
  graph: ThonkGraph,
  boardId: string,
  boardName: string,
): Promise<void> {
  const payload = { boardId, boardName, ...graph }
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(payload, null, 2))
  await writable.close()
}

function migrateNode(n: ThonkNode): ThonkNode {
  const base = {
    ...(n.summary == null ? { ...n, summary: '' } : n),
    resolved:  (n as ThonkNode & { resolved?: boolean }).resolved  ?? false,
    conflicts: (n as ThonkNode & { conflicts?: ThonkNode['conflicts'] }).conflicts ?? [],
  }
  if ((base.resolvedAs as string) === 'approved')  base.resolvedAs = 'merged'
  if ((base.resolvedAs as string) === 'dismissed') base.resolvedAs = 'closed'
  return base
}

export function parseImportedGraph(json: string): { graph: ThonkGraph; boardId?: string; boardName?: string } {
  const raw = JSON.parse(json) as ThonkGraph & { boardId?: string; boardName?: string }
  raw.nodes = raw.nodes.map(migrateNode)
  const { boardId, boardName, ...graph } = raw
  return { graph, boardId, boardName }
}

export function makeInitialGraph(): ThonkGraph {
  const coreId = uuidv4()
  return {
    nodes: [
      {
        id: coreId,
        type: 'core',
        title: '',
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

export function loadGraph(boardId: string): ThonkGraph {
  try {
    const raw = localStorage.getItem(graphKey(boardId))
    if (raw) {
      const g = JSON.parse(raw) as ThonkGraph
      g.nodes = g.nodes.map(migrateNode)
      const nodeIds = new Set(g.nodes.map(n => n.id))
      g.nodes = g.nodes.map(n =>
        n.conflicts?.some(c => !nodeIds.has(c.nodeId))
          ? { ...n, conflicts: n.conflicts.filter(c => nodeIds.has(c.nodeId)) }
          : n,
      )
      return g
    }
  } catch {
    // corrupted — start fresh
  }
  return makeInitialGraph()
}

export function saveGraph(graph: ThonkGraph, boardId: string): void {
  try {
    localStorage.setItem(graphKey(boardId), JSON.stringify(graph))
  } catch {
    window.dispatchEvent(new CustomEvent('thonk:toast', { detail: 'Storage full — export or delete boards to free up space' }))
  }
}

// ── Viewport persistence ───────────────────────────────────────────────────────

export function loadViewport(boardId: string): ViewportData | null {
  try {
    const raw = localStorage.getItem(viewportKey(boardId))
    if (raw) return JSON.parse(raw) as ViewportData
  } catch {}
  return null
}

export function saveViewport(vp: ViewportData, boardId: string): void {
  try {
    localStorage.setItem(viewportKey(boardId), JSON.stringify(vp))
  } catch {}
}

// ── Graph mutation helpers ─────────────────────────────────────────────────────

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
  patch: Partial<Pick<ThonkNode, 'title' | 'body' | 'summary' | 'resolved' | 'resolvedAs' | 'conflicts'>>,
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
