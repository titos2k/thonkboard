import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  useViewport,
  useReactFlow,
  useStore,
  useStoreApi,
  MiniMap,
  BackgroundVariant,
  applyNodeChanges,
  applyEdgeChanges,
  getNodesBounds,
  getViewportForBounds,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react'
import { toPng } from 'html-to-image'
import { Plus, Minus, Scan, LockKeyhole, LockKeyholeOpen, Undo2, Redo2 } from 'lucide-react'
import '@xyflow/react/dist/style.css'

import { useGraph } from '@/store/useGraph'
import { useIsMobile } from '@/hooks/useIsMobile'
import {
  exportGraphToFile, parseImportedGraph, saveGraph, loadGraph,
  migrateToMultiBoard,
  loadBoards, saveBoards, getActiveBoardId, setActiveBoardId as persistActiveBoardId, deleteBoard,
  loadViewport, saveViewport,
  fsaSupported, saveGraphToFileHandle,
} from '@/store/graph'
import { persistFileHandle, restoreFileHandle, dropFileHandle, ensureWritePermission } from '@/store/fileHandleStore'
import type { ThonkNode, ThonkEdge, ThonkGraph, BoardMeta } from '@/store/types'
import { v4 as uuidv4 } from 'uuid'
import { ThonkNodeComponent, type ThonkNodeData } from '@/components/nodes/ThonkNode'
import { NoteNodeComponent } from '@/components/nodes/NoteNode'
import { EditorPanel } from '@/components/EditorPanel'
import { TopBar } from '@/components/TopBar'
import { WelcomeModal } from '@/components/WelcomeModal'
import { Toaster } from '@/components/Toaster'
import { hasActiveKey } from '@/ai/gemini'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { showToast } from '@/lib/toast'

const NODE_TYPES = { thonk: ThonkNodeComponent, note: NoteNodeComponent }

const ZoomInButton = React.memo(function ZoomInButton() {
  const { zoomIn } = useReactFlow()
  return (
    <Tooltip>
      <TooltipTrigger asChild><ControlButton onClick={() => zoomIn({ duration: 200 })}><Plus className="w-[18px] h-[18px]" /></ControlButton></TooltipTrigger>
      <TooltipContent side="right">Zoom in</TooltipContent>
    </Tooltip>
  )
})

const ZoomOutButton = React.memo(function ZoomOutButton() {
  const { zoomOut } = useReactFlow()
  return (
    <Tooltip>
      <TooltipTrigger asChild><ControlButton onClick={() => zoomOut({ duration: 200 })}><Minus className="w-[18px] h-[18px]" /></ControlButton></TooltipTrigger>
      <TooltipContent side="right">Zoom out</TooltipContent>
    </Tooltip>
  )
})

const FitViewButton = React.memo(function FitViewButton() {
  const { fitView } = useReactFlow()
  return (
    <Tooltip>
      <TooltipTrigger asChild><ControlButton onClick={() => fitView({ padding: 0.5, duration: 400 })}><Scan className="w-[18px] h-[18px]" /></ControlButton></TooltipTrigger>
      <TooltipContent side="right">Fit view</TooltipContent>
    </Tooltip>
  )
})

const LockButton = React.memo(function LockButton() {
  const store = useStoreApi()
  const nodesDraggable = useStore(s => s.nodesDraggable)
  const toggle = () => {
    const next = !nodesDraggable
    store.setState({ nodesDraggable: next, nodesConnectable: next, elementsSelectable: next })
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ControlButton onClick={toggle}>
          {nodesDraggable ? <LockKeyholeOpen className="w-[18px] h-[18px]" /> : <LockKeyhole className="w-[18px] h-[18px]" />}
        </ControlButton>
      </TooltipTrigger>
      <TooltipContent side="right">{nodesDraggable ? 'Lock canvas' : 'Unlock canvas'}</TooltipContent>
    </Tooltip>
  )
})

const UndoButton = React.memo(function UndoButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ControlButton onClick={onClick} style={disabled ? { color: 'var(--color-border)', pointerEvents: 'none' } : undefined}>
          <Undo2 className="w-[18px] h-[18px]" />
        </ControlButton>
      </TooltipTrigger>
      <TooltipContent side="right">Undo (Ctrl+Z)</TooltipContent>
    </Tooltip>
  )
})

const RedoButton = React.memo(function RedoButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ControlButton onClick={onClick} style={disabled ? { color: 'var(--color-border)', pointerEvents: 'none' } : undefined}>
          <Redo2 className="w-[18px] h-[18px]" />
        </ControlButton>
      </TooltipTrigger>
      <TooltipContent side="right">Redo (Ctrl+Y)</TooltipContent>
    </Tooltip>
  )
})

const ZoomDisplay = React.memo(function ZoomDisplay() {
  const { zoom } = useViewport()
  const { zoomTo } = useReactFlow()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ControlButton onClick={() => zoomTo(1, { duration: 300 })}>
          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'system-ui', letterSpacing: '-0.02em' }}>
            {Math.round(zoom * 100)}%
          </span>
        </ControlButton>
      </TooltipTrigger>
      <TooltipContent side="right">Reset zoom to 100%</TooltipContent>
    </Tooltip>
  )
})

migrateToMultiBoard()

const NODE_EDGE_COLOR: Record<string, string> = {
  core:     '#392946',
  idea:     '#f5c44a',
  problem:  '#e95a32',
  question: '#858783',
  answer:   '#00ae60',
}

type GraphCallbacks = {
  onAddNode:     ThonkNodeData['onAddNode']
  onAddEdge:     ThonkNodeData['onAddEdge']
  onUpdate:      ThonkNodeData['onUpdate']
  onDelete:      ThonkNodeData['onDelete']
  onVersionCore: ThonkNodeData['onVersionCore']
  onOpenPanel:   ThonkNodeData['onOpenPanel']
  onAutoEdit:    ThonkNodeData['onAutoEdit']
  onBatchStart:  ThonkNodeData['onBatchStart']
  onBatchEnd:    ThonkNodeData['onBatchEnd']
}

function toRFNode(
  n: ThonkNode,
  selected: boolean,
  autoEdit: boolean,
  panelOpen: boolean,
  hasAnswer: boolean,
  graphRef: React.MutableRefObject<ThonkGraph>,
  cb: GraphCallbacks,
  aiConnected: boolean,
  hiddenNodeIds: Set<string>,
): Node {
  return {
    id: n.id,
    type: n.type === 'note' ? 'note' : 'thonk',
    position: n.position,
    selected,
    data: { thonk: n, graphRef, autoEdit, panelOpen, hasAnswer, aiConnected, hiddenNodeIds, ...cb } as ThonkNodeData,
  }
}

function toRFEdge(e: ThonkEdge, nodes: ThonkNode[]): Edge {
  const target   = nodes.find(n => n.id === e.target)
  const source   = nodes.find(n => n.id === e.source)
  const resolved = target?.resolved || source?.resolved
  const stroke   = NODE_EDGE_COLOR[target?.type ?? ''] ?? '#94a3b8'
  const aiDepth  = Math.max(target?.meta.aiDepth ?? 0, source?.meta.aiDepth ?? 0)
  const dash     = (target?.meta.aiGenerated && source?.meta.aiGenerated) ? `5 ${3 + aiDepth * 4}` : undefined
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    style: { stroke, strokeDasharray: dash, strokeWidth: 1.5, opacity: resolved ? 0.5 : 1 },
    className: `edge-rel-${e.relation}`,
    data: { relation: e.relation },
    interactionWidth: 20,
    reconnectable: true,
  }
}

export default function App() {
  const [boards, setBoards] = useState<BoardMeta[]>(loadBoards)
  const [activeBoardId, setActiveBoardIdState] = useState<string>(getActiveBoardId)

  const {
    graph,
    graphRef,
    switchToBoard,
    addNode,
    addEdge: addGraphEdge,
    updateNode,
    updateNodePosition,
    deleteNode,
    deleteEdge: deleteGraphEdge,
    reconnectEdge,
    versionCore,
    undo,
    redo,
    canUndo,
    canRedo,
    onBatchStart,
    onBatchEnd,
  } = useGraph(activeBoardId)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [autoEditId, setAutoEditId] = useState<string | null>(null)
  const [panelNodeId, setPanelNodeId] = useState<string | null>(null)
  const [hideResolved, setHideResolved] = useState(() => localStorage.getItem('hideResolved') === 'true')

  const [welcomed, setWelcomed] = useState(() => !!localStorage.getItem('thonk.welcomed'))
  const [aiConnected, setAiConnected] = useState(hasActiveKey)
  const [keyOpen, setKeyOpen] = useState(() => {
    const alreadyWelcomed = !!localStorage.getItem('thonk.welcomed')
    return alreadyWelcomed && !hasActiveKey()
  })
  const [showLegend, setShowLegend] = useState(true)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [replaceConfirm, setReplaceConfirm] = useState<{ board: BoardMeta; graph: ThonkGraph; incomingHandle?: FileSystemFileHandle } | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const savedViewport = useMemo(() => loadViewport(activeBoardId), [])

  const isMobile = useIsMobile()
  const rfInstance = useRef<ReactFlowInstance | null>(null)
  const fileHandlesRef = useRef<Map<string, FileSystemFileHandle>>(new Map())
  const [linkedFileName, setLinkedFileName] = useState<string | null>(null)
  const savedGraphJsonRef = useRef<Map<string, string>>(new Map())
  const [fileDirty, setFileDirty] = useState(false)

  // Restore file handle name from IDB on mount so the UI reflects the link after a page refresh
  useEffect(() => {
    restoreFileHandle(activeBoardId).then(h => {
      if (h) {
        fileHandlesRef.current.set(activeBoardId, h)
        savedGraphJsonRef.current.set(activeBoardId, JSON.stringify(graph))
        setLinkedFileName(h.name)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dirty flag — true when current graph differs from what was last saved to the linked file
  useEffect(() => {
    if (!linkedFileName) { setFileDirty(false); return }
    const baseline = savedGraphJsonRef.current.get(activeBoardId)
    if (baseline === undefined) { setFileDirty(false); return }
    setFileDirty(JSON.stringify(graph) !== baseline)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, linkedFileName, activeBoardId])

  // Local RF node/edge state — lets React Flow manage selection/drag internally.
  const [rfNodes, setRfNodes] = useState<Node[]>([])
  const [rfEdges, setRfEdges] = useState<Edge[]>([])
  const isDraggingRef = useRef(false)
  const positionUpdateRef = useRef(false)

  // Close panel if its node is deleted
  useEffect(() => {
    if (panelNodeId && !graph.nodes.find(n => n.id === panelNodeId)) {
      setPanelNodeId(null)
    }
  }, [graph.nodes, panelNodeId])

  // Clear unread dot when the Details panel opens for a node
  useEffect(() => {
    if (!panelNodeId) return
    const node = graph.nodes.find(n => n.id === panelNodeId)
    if (node?.unread) updateNode(panelNodeId, { unread: false })
  }, [panelNodeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow selection: if panel is already open, switch it to the newly selected node
  useEffect(() => {
    if (panelNodeId !== null && selectedIds.size === 1) {
      setPanelNodeId([...selectedIds][0])
    }
  }, [selectedIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear autoEditId after one render cycle
  useEffect(() => {
    if (autoEditId) {
      const id = setTimeout(() => setAutoEditId(null), 0)
      return () => clearTimeout(id)
    }
  }, [autoEditId])

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && e.target === document.body) setSpaceHeld(true) }
    const up   = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup',   up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  const handleCtrlSSave = useCallback(async () => {
    const boardName = boards.find(b => b.id === activeBoardId)?.name ?? 'Board'
    if (!fsaSupported) {
      exportGraphToFile(graph, activeBoardId, boardName)
      return
    }

    // 1. Get handle from memory, fall back to IDB
    let handle = fileHandlesRef.current.get(activeBoardId)
    if (!handle) {
      const stored = await restoreFileHandle(activeBoardId)
      if (stored) {
        handle = stored
        fileHandlesRef.current.set(activeBoardId, stored)
      }
    }

    // 2. Verify/request write permission for restored handle
    if (handle) {
      const ok = await ensureWritePermission(handle)
      if (!ok) {
        fileHandlesRef.current.delete(activeBoardId)
        await dropFileHandle(activeBoardId)
        setLinkedFileName(null)
        handle = undefined
      }
    }

    // 3. No handle — open picker
    if (!handle) {
      const slug = boardName.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40) || 'board'
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: `${slug}.thonk`,
          types: [{ description: 'ThonkBoard', accept: { 'application/octet-stream': ['.thonk'] } }],
        })
        fileHandlesRef.current.set(activeBoardId, handle)
        await persistFileHandle(activeBoardId, handle)
        setLinkedFileName(handle.name)
      } catch {
        return
      }
    }

    const h = handle
    try {
      await saveGraphToFileHandle(h, graph, activeBoardId, boardName)
      savedGraphJsonRef.current.set(activeBoardId, JSON.stringify(graph))
      setFileDirty(false)
      setLinkedFileName(h.name)
      showToast(`Saved: ${h.name}`, 'success')
    } catch {
      fileHandlesRef.current.delete(activeBoardId)
      await dropFileHandle(activeBoardId)
      setLinkedFileName(null)
      showToast('Save failed — file may have been moved or deleted. Choose a new location.', 'error')
    }
  }, [graph, activeBoardId, boards])

  const handleSaveAs = useCallback(async () => {
    const boardName = boards.find(b => b.id === activeBoardId)?.name ?? 'Board'
    const slug = boardName.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40) || 'board'
    let handle: FileSystemFileHandle
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: `${slug}.thonk`,
        types: [{ description: 'ThonkBoard', accept: { 'application/octet-stream': ['.thonk'] } }],
      })
      fileHandlesRef.current.set(activeBoardId, handle)
      await persistFileHandle(activeBoardId, handle)
      setLinkedFileName(handle.name)
    } catch {
      return
    }
    try {
      await saveGraphToFileHandle(handle, graph, activeBoardId, boardName)
      savedGraphJsonRef.current.set(activeBoardId, JSON.stringify(graph))
      setFileDirty(false)
      setLinkedFileName(handle.name)
      showToast(`Saved: ${handle.name}`, 'success')
    } catch {
      fileHandlesRef.current.delete(activeBoardId)
      await dropFileHandle(activeBoardId)
      setLinkedFileName(null)
      showToast('Save failed — file may have been moved or deleted.', 'error')
    }
  }, [graph, activeBoardId, boards])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo() }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') { e.preventDefault(); handleCtrlSSave() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, handleCtrlSSave])

  const openPanel = useCallback((id: string | null) => setPanelNodeId(id), [])

  // Update page title to reflect active board name
  useEffect(() => {
    const name = boards.find(b => b.id === activeBoardId)?.name
    document.title = name ? `ThonkBoard - ${name}` : 'ThonkBoard - Spatial Thinking Canvas'
  }, [activeBoardId, boards])

  // Restore viewport when active board changes; fit view if no saved viewport
  useEffect(() => {
    if (!rfInstance.current) return
    const vp = loadViewport(activeBoardId)
    if (vp) {
      rfInstance.current.setViewport(vp, { duration: 300 })
    } else {
      setTimeout(() => rfInstance.current?.fitView({ padding: 0.5, duration: 400 }), 50)
    }
    setSelectedIds(new Set())
    setPanelNodeId(null)
  }, [activeBoardId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSwitchBoard = useCallback((id: string) => {
    if (id === activeBoardId) return
    const currentVp = rfInstance.current?.getViewport()
    if (currentVp) saveViewport(currentVp, activeBoardId)
    persistActiveBoardId(id)
    setActiveBoardIdState(id)
    switchToBoard(id)
    // Reflect file link for the new board (memory first, IDB fallback)
    const memHandle = fileHandlesRef.current.get(id)
    if (memHandle) {
      setLinkedFileName(memHandle.name)
    } else {
      setLinkedFileName(null)
      restoreFileHandle(id).then(h => {
        if (h) {
          fileHandlesRef.current.set(id, h)
          savedGraphJsonRef.current.set(id, JSON.stringify(loadGraph(id)))
        }
        setLinkedFileName(h?.name ?? null)
      })
    }
  }, [activeBoardId, switchToBoard])

  const handleCreateBoard = useCallback(() => {
    const id = uuidv4()
    const board: BoardMeta = { id, name: `Board ${boards.length + 1}`, createdAt: new Date().toISOString() }
    const next = [...boards, board]
    setBoards(next)
    saveBoards(next)
    persistActiveBoardId(id)
    setActiveBoardIdState(id)
    switchToBoard(id)
  }, [boards, switchToBoard])

  const handleDeleteBoard = useCallback((id: string) => {
    if (boards.length <= 1) return
    const idx = boards.findIndex(b => b.id === id)
    const next = boards.filter(b => b.id !== id)
    setBoards(next)
    saveBoards(next)
    deleteBoard(id)
    dropFileHandle(id)
    if (id === activeBoardId) {
      const newActive = next[Math.max(0, idx - 1)].id
      persistActiveBoardId(newActive)
      setActiveBoardIdState(newActive)
      switchToBoard(newActive)
    }
  }, [boards, activeBoardId, switchToBoard])

  const handleRenameBoard = useCallback((id: string, name: string) => {
    const next = boards.map(b => b.id === id ? { ...b, name } : b)
    setBoards(next)
    saveBoards(next)
  }, [boards])

  const miniMapNodeColor = useCallback((n: Node) => {
    const t = (n.data as ThonkNodeData)?.thonk?.type
    if (t === 'core')     return '#392946'
    if (t === 'problem')  return '#e95a32'
    if (t === 'question') return '#f4f6f6'
    if (t === 'answer')   return '#00ae60'
    if (t === 'note')     return '#ffffff'
    return '#f5c44a'
  }, [])

  const navigateToNode = useCallback((nodeId: string) => {
    setPanelNodeId(nodeId)
    setSelectedIds(new Set([nodeId]))
    const n = rfInstance.current?.getNode(nodeId)
    if (n) {
      const cx = n.position.x + (n.measured?.width ?? 200) / 2
      const cy = n.position.y + (n.measured?.height ?? 80) / 2
      const zoom = rfInstance.current?.getZoom() ?? 1
      rfInstance.current?.setCenter(cx, cy, { duration: 500, zoom })
    }
  }, [])

  const handleAiConnected = useCallback(() => {
    setAiConnected(true)
    const core = graph.nodes.find(n => n.type === 'core')
    if (core) {
      setSelectedIds(new Set([core.id]))
      setAutoEditId(core.id)
      const n = rfInstance.current?.getNode(core.id)
      if (n) {
        const cx = n.position.x + (n.measured?.width ?? 200) / 2
        const cy = n.position.y + (n.measured?.height ?? 80) / 2
        const zoom = rfInstance.current?.getZoom() ?? 1
        rfInstance.current?.setCenter(cx, cy, { duration: 500, zoom })
      }
    }
  }, [graph.nodes])

  const handleWelcomeConnectAI = useCallback(() => {
    localStorage.setItem('thonk.welcomed', '1')
    setWelcomed(true)
    setKeyOpen(true)
  }, [])

  const handleWelcomeSkip = useCallback(() => {
    localStorage.setItem('thonk.welcomed', '1')
    setWelcomed(true)
  }, [])

  const handleUpdateNode: GraphCallbacks['onUpdate'] = useCallback((id, patch) => {
    updateNode(id, patch)
    if ('title' in patch && patch.title) {
      const node = graph.nodes.find(n => n.id === id)
      if (node?.type === 'core') {
        const board = boards.find(b => b.id === activeBoardId)
        if (board && /^Board \d+$/.test(board.name)) {
          handleRenameBoard(activeBoardId, patch.title)
        }
      }
    }
  }, [updateNode, graph.nodes, boards, activeBoardId, handleRenameBoard])

  const callbacks: GraphCallbacks = useMemo(
    () => ({
      onAddNode:     addNode,
      onAddEdge:     addGraphEdge,
      onUpdate:      handleUpdateNode,
      onDelete:      deleteNode,
      onVersionCore: versionCore,
      onOpenPanel:   openPanel,
      onAutoEdit:    setAutoEditId,
      onBatchStart,
      onBatchEnd,
    }),
    [addNode, addGraphEdge, handleUpdateNode, deleteNode, versionCore, openPanel, onBatchStart, onBatchEnd],
  )

  // Compute which node IDs are hidden when hideResolved is active
  const hiddenNodeIds = useMemo(() => {
    if (!hideResolved) return new Set<string>()

    // Build undirected adjacency map
    const adj = new Map<string, string[]>(graph.nodes.map(n => [n.id, []]))
    graph.edges.forEach(e => {
      adj.get(e.source)?.push(e.target)
      adj.get(e.target)?.push(e.source)
    })

    const hidden = new Set(graph.nodes.filter(n => n.resolved).map(n => n.id))

    // Cascade: hide unresolved nodes whose every neighbor is already hidden
    let changed = true
    while (changed) {
      changed = false
      for (const node of graph.nodes) {
        if (hidden.has(node.id)) continue
        const neighbors = adj.get(node.id) ?? []
        if (neighbors.length > 0 && neighbors.every(id => hidden.has(id))) {
          hidden.add(node.id)
          changed = true
        }
      }
    }

    return hidden
  }, [graph.nodes, graph.edges, hideResolved])

  // Compute nodes from store (used to sync into rfNodes when not dragging)
  const visibleNodes = useMemo(
    () => graph.nodes.filter(n => !hiddenNodeIds.has(n.id)),
    [graph.nodes, hiddenNodeIds],
  )
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes])

  // Ghost connectors: grey dotted edges bridging visible nodes through hidden-node gaps
  const ghostEdges = useMemo((): Edge[] => {
    if (!hideResolved || hiddenNodeIds.size === 0) return []

    const visited = new Set<string>()
    const result: Edge[] = []

    for (const hiddenId of hiddenNodeIds) {
      if (visited.has(hiddenId)) continue

      // BFS over connected component of hidden nodes
      const component = new Set<string>()
      const queue = [hiddenId]
      const connectedVisible = new Set<string>()

      while (queue.length) {
        const curr = queue.shift()!
        if (component.has(curr)) continue
        component.add(curr)
        visited.add(curr)

        for (const edge of graph.edges) {
          const neighbor = edge.source === curr ? edge.target
                         : edge.target === curr ? edge.source
                         : null
          if (neighbor === null) continue
          if (hiddenNodeIds.has(neighbor)) {
            if (!component.has(neighbor)) queue.push(neighbor)
          } else {
            connectedVisible.add(neighbor)
          }
        }
      }

      // One ghost edge per pair of visible nodes linked through this hidden component
      const visArr = [...connectedVisible]
      for (let i = 0; i < visArr.length; i++) {
        for (let j = i + 1; j < visArr.length; j++) {
          const [src, tgt] = [visArr[i], visArr[j]]
          result.push({
            id: `ghost-${src}-${tgt}`,
            source: src,
            target: tgt,
            style: { stroke: '#64748b', strokeWidth: 1.5, opacity: 0.3 },
            label: component.size === 1 ? '1 hidden' : `${component.size} hidden`,
            labelStyle: { fill: '#64748b', fontSize: 11 },
            labelBgStyle: { fill: 'hsl(42, 15%, 92%)' },
            labelBgPadding: [4, 2] as [number, number],
            selectable: false,
            focusable: false,
            interactionWidth: 0,
          })
        }
      }
    }
    return result
  }, [hideResolved, hiddenNodeIds, graph.edges])

  const storeNodes = useMemo(
    () => visibleNodes.map(n => toRFNode(
      n, selectedIds.has(n.id), n.id === autoEditId, n.id === panelNodeId,
      graph.edges.some(e => e.source === n.id && e.relation === 'answers'),
      graphRef, callbacks, aiConnected, hiddenNodeIds,
    )),
    [visibleNodes, selectedIds, autoEditId, panelNodeId, graph.edges, callbacks, aiConnected, hiddenNodeIds],
  )

  // Sync store → local RF state whenever it changes, but only when not mid-drag.
  // Skip when the only change was a position persistence update — rfNodes already
  // has the correct position from applyNodeChanges during the drag.
  useEffect(() => {
    if (positionUpdateRef.current) {
      positionUpdateRef.current = false
      return
    }
    if (!isDraggingRef.current) setRfNodes(storeNodes)
  }, [storeNodes])

  // Sync graph edges → local RF state (preserve selection state of existing edges)
  useEffect(() => {
    setRfEdges(prev => {
      const prevById = new Map(prev.map(e => [e.id, e]))
      const realEdges = graph.edges
        .filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
        .map(e => {
          const existing = prevById.get(e.id)
          return { ...toRFEdge(e, graph.nodes), selected: existing?.selected ?? false }
        })
      return [...realEdges, ...ghostEdges]
    })
  }, [graph.edges, visibleNodeIds, ghostEdges])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Track drag state
      for (const c of changes) {
        if (c.type === 'position') isDraggingRef.current = c.dragging ?? false
      }

      // Apply to local RF state immediately — smooth drag with no store re-renders
      setRfNodes(prev => applyNodeChanges(changes, prev))

      // Persist to store only on drag end + handle remove
      changes.forEach(change => {
        if (change.type === 'position' && !change.dragging && change.position) {
          positionUpdateRef.current = true
          updateNodePosition(change.id, change.position)
        }
        if (change.type === 'remove') deleteNode(change.id)
      })

      setSelectedIds(prev => {
        let next = prev
        changes.forEach(change => {
          if (change.type === 'select') {
            if (next === prev) next = new Set(prev)
            if (change.selected) next.add(change.id)
            else next.delete(change.id)
          }
          if (change.type === 'remove') {
            if (next === prev) next = new Set(prev)
            next.delete(change.id)
          }
        })
        return next
      })
    },
    [updateNodePosition, deleteNode],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setRfEdges(prev => applyEdgeChanges(changes, prev))
      for (const c of changes) {
        if (c.type === 'remove') deleteGraphEdge(c.id)
      }
    },
    [deleteGraphEdge],
  )

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      const relation = (oldEdge.data as { relation: string })?.relation ?? 'spawns'
      if (newConnection.source && newConnection.target)
        reconnectEdge(
          oldEdge.id,
          newConnection.source,
          newConnection.target,
          relation as import('@/store/types').EdgeRelation,
          newConnection.sourceHandle,
          newConnection.targetHandle,
        )
    },
    [reconnectEdge],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target)
        addGraphEdge(connection.source, connection.target, 'spawns')
    },
    [addGraphEdge],
  )

  const viewCenter = useCallback(() => {
    const wrap = document.getElementById('rf-wrap')
    const rect = wrap?.getBoundingClientRect() ?? { width: 800, height: 600, left: 0, top: 0 }
    return rfInstance.current?.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }) ?? { x: 400, y: 300 }
  }, [])

  const handleAddCore     = useCallback(() => { const n = addNode('core',     '', '', viewCenter());                    setAutoEditId(n.id) }, [addNode, setAutoEditId, viewCenter])
  const handleAddIdea     = useCallback(() => { const n = addNode('idea',     '', '', viewCenter());                    setAutoEditId(n.id) }, [addNode, setAutoEditId, viewCenter])
  const handleAddProblem  = useCallback(() => { const n = addNode('problem',  '', '', viewCenter(), { severity: 0.5 }); setAutoEditId(n.id) }, [addNode, setAutoEditId, viewCenter])
  const handleAddQuestion = useCallback(() => { const n = addNode('question', '', '', viewCenter());                    setAutoEditId(n.id) }, [addNode, setAutoEditId, viewCenter])
  const handleAddNote     = useCallback(() => { const n = addNode('note',     '', '', viewCenter());                    setAutoEditId(n.id) }, [addNode, setAutoEditId, viewCenter])

  const handleImport = useCallback((file: File, incomingHandle?: FileSystemFileHandle) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const { graph: imported, boardId: fileBoardId, boardName: fileBoardName } = parseImportedGraph(e.target!.result as string)

        // If file was exported from a board that still exists, confirm before replacing
        const existing = fileBoardId ? boards.find(b => b.id === fileBoardId) : null
        if (existing) {
          setReplaceConfirm({ board: existing, graph: imported, incomingHandle })
          return
        }

        // Create a new board, deriving the name from the file
        const core = imported.nodes.find(n => n.type === 'core')
        const nameFromFile = file.name
          .replace(/^thonk-/, '').replace(/-\d{4}-\d{2}-\d{2}\.json$/, '').replace(/-/g, ' ').trim()
        const boardName = fileBoardName || core?.title?.trim() || nameFromFile || 'Imported Board'
        const id = fileBoardId ?? uuidv4()
        const board: BoardMeta = { id, name: boardName, createdAt: new Date().toISOString() }
        const nextBoards = [...boards, board]

        // React state first — these cannot throw, UI always updates
        setBoards(nextBoards)
        setActiveBoardIdState(id)
        switchToBoard(id, imported)

        // Persist after — best-effort, failures show toasts
        saveBoards(nextBoards)
        saveGraph(imported, id)
        persistActiveBoardId(id)
        if (incomingHandle) {
          fileHandlesRef.current.set(id, incomingHandle)
          persistFileHandle(id, incomingHandle)
          savedGraphJsonRef.current.set(id, JSON.stringify(imported))
        }
      } catch {
        // malformed file — ignore
      }
    }
    reader.readAsText(file)
  }, [boards, switchToBoard])

  // PWA File Handling API — open .thonk files launched from the OS
  const handleImportRef = useRef(handleImport)
  useEffect(() => { handleImportRef.current = handleImport }, [handleImport])
  useEffect(() => {
    if (!('launchQueue' in window)) return
    ;(window as { launchQueue?: { setConsumer: (fn: (p: { files: FileSystemFileHandle[] }) => void) => void } }).launchQueue!
      .setConsumer(async ({ files }) => {
        if (!files.length) return
        const fileHandle = files[0]
        const file = await fileHandle.getFile()
        handleImportRef.current(file, fileHandle)
      })
  }, [])

  const handleExportPng = useCallback(() => {
    const nodes = rfInstance.current?.getNodes() ?? []
    if (!nodes.length) return
    const bounds = getNodesBounds(nodes)
    const PADDING = 40
    const scale = 2
    const imgW = Math.min(Math.round((bounds.width  + PADDING * 2) * scale), 4096)
    const imgH = Math.min(Math.round((bounds.height + PADDING * 2) * scale), 4096)
    const viewport = getViewportForBounds(bounds, imgW, imgH, 0.5, 2, PADDING * scale)
    const el = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!el) return
    const boardName = boards.find(b => b.id === activeBoardId)?.name ?? 'Board'
    const slug = boardName.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40) || 'board'
    const date = new Date().toISOString().slice(0, 10)
    toPng(el, {
      width: imgW,
      height: imgH,
      style: {
        width: `${imgW}px`,
        height: `${imgH}px`,
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      },
    }).then(url => {
      const a = document.createElement('a')
      a.download = `thonk-${slug}-${date}.png`
      a.href = url
      a.click()
    })
  }, [boards, activeBoardId])

  const panelNode = useMemo(
    () => panelNodeId ? graph.nodes.find(n => n.id === panelNodeId) : null,
    [panelNodeId, graph.nodes],
  )

  const handleToggleHideResolved = useCallback(() => setHideResolved(v => {
    const next = !v
    localStorage.setItem('hideResolved', String(next))
    return next
  }), [])
  const handleToggleLegend = useCallback(() => setShowLegend(v => !v), [])

  const handlePanelSave  = useCallback((id: string, patch: { title?: string; body?: string; summary?: string }) => updateNode(id, { ...patch, meta: { aiGenerated: false } }), [updateNode])
  const handlePanelClose = useCallback(() => setPanelNodeId(null), [])

  return (
    <TooltipProvider delayDuration={0} disableHoverableContent>
      <div style={{ width: '100vw', height: '100dvh', position: 'relative' }}>
        <WelcomeModal open={!welcomed} onConnectAI={handleWelcomeConnectAI} onSkip={handleWelcomeSkip} />
        <TopBar
          onAddCore={handleAddCore}
          onAddIdea={handleAddIdea}
          onAddProblem={handleAddProblem}
          onAddQuestion={handleAddQuestion}
          onAddNote={handleAddNote}
          hideResolved={hideResolved}
          onToggleHideResolved={handleToggleHideResolved}
          showLegend={showLegend}
          onToggleLegend={handleToggleLegend}
          onExport={handleCtrlSSave}
          onExportAs={handleSaveAs}
          onExportPng={handleExportPng}
          onImport={handleImport}
          linkedFileName={linkedFileName}
          fileDirty={fileDirty}
          graph={graph}
          boards={boards}
          activeBoardId={activeBoardId}
          onSwitchBoard={handleSwitchBoard}
          onCreateBoard={handleCreateBoard}
          onDeleteBoard={handleDeleteBoard}
          onRenameBoard={handleRenameBoard}
          keyOpen={keyOpen}
          onKeyOpenChange={setKeyOpen}
          onAiConnected={handleAiConnected}
        />
        <div style={{ width: '100%', height: '100%', paddingTop: 44 }} className={[spaceHeld ? 'space-held' : '', 'rf-wrap'].filter(Boolean).join(' ')} id="rf-wrap">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            onReconnectStart={() => document.getElementById('rf-wrap')?.classList.add('edge-dragging')}
            onReconnectEnd={() => document.getElementById('rf-wrap')?.classList.remove('edge-dragging')}
            onInit={inst => { rfInstance.current = inst }}
            fitView={!savedViewport && graph.nodes.length > 0}
            fitViewOptions={{ padding: 0.5, maxZoom: 1 }}
            defaultViewport={savedViewport ?? { x: 0, y: 0, zoom: 1 }}
            onMoveStart={() => document.getElementById('rf-wrap')?.classList.add('is-panning')}
            onMoveEnd={(_e, vp) => { document.getElementById('rf-wrap')?.classList.remove('is-panning'); saveViewport(vp, activeBoardId) }}
            panOnDrag={[1, 2]}
            minZoom={0.1}
            maxZoom={2}
            zoomOnDoubleClick={false}
            deleteKeyCode="Delete"
            elevateEdgesOnSelect
            proOptions={{ hideAttribution: false }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showZoom={false} showFitView={false} showInteractive={false} style={isMobile ? { bottom: 4, left: 4 } : { bottom: 24, left: 16 }}>
              <UndoButton onClick={undo} disabled={!canUndo} />
              <RedoButton onClick={redo} disabled={!canRedo} />
              <ZoomInButton />
              <ZoomOutButton />
              <FitViewButton />
              <LockButton />
              <ZoomDisplay />
            </Controls>
            {!isMobile && (
              <MiniMap
                nodeColor={miniMapNodeColor}
                maskColor="rgba(200,195,190,0.3)"
              />
            )}
          </ReactFlow>
        </div>

        {panelNode && (
          <EditorPanel
            node={panelNode}
            nodes={graph.nodes}
            onSave={handlePanelSave}
            onClose={handlePanelClose}
            onNavigateToNode={navigateToNode}
          />
        )}

        {!isMobile && (
          <div
            className="absolute pointer-events-none z-10 font-semibold text-sm text-foreground/60 bg-(--background)/80 px-1 rounded-sm"
            style={{ top: 44 + 16, left: 12 }}
          >
            {boards.find(b => b.id === activeBoardId)?.name ?? ''}
          </div>
        )}

        {showLegend && !isMobile && <div
          className="absolute bg-white border border-border rounded-lg px-4 py-3 text-sm shadow-sm pointer-events-none z-10"
          style={{ top: 44 + 16, right: panelNode ? 576 + 16 : 16 }}
        >
          <div className="font-semibold text-sm mb-2">Nodes</div>
          <div className="space-y-1.5 mb-4">
            {[
              { color: 'bg-[#392946]',                          label: 'Core'         },
              { color: 'bg-[#f5c44a]',                          label: 'Idea'         },
              { color: 'bg-[#e95a32]',                          label: 'Problem'      },
              { color: 'bg-[#f4f6f6] border border-black/10',   label: 'Question'     },
              { color: 'bg-[#00ae60]',                          label: 'Answer'       },
              { color: 'bg-[#00836d]',                          label: 'Answer AI'    },
              { color: 'bg-[#ffffff]',                          label: 'Note'         },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2.5">
                <span className={`inline-block w-3 h-3 rounded shrink-0 ${color}`} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="font-semibold text-sm mb-2">Connections</div>
          <div className="space-y-1.5">
            {[
              { dash: false, label: 'Manual' },
              { dash: true,  label: 'AI'     },
            ].map(({ dash, label }) => (
              <div key={label} className="flex items-center gap-2.5">
                <svg width="24" height="10" className="shrink-0">
                  <line x1="0" y1="5" x2="24" y2="5"
                    stroke="#94a3b8" strokeWidth="1.5"
                    strokeDasharray={dash ? '5 3' : undefined}
                  />
                </svg>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>}
      </div>
        <Dialog open={!!replaceConfirm} onOpenChange={open => { if (!open) setReplaceConfirm(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg pb-1">Replace "{replaceConfirm?.board.name}"?</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                This file contains an older version of this board. Loading it will overwrite your current work.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="outline" className="h-9 text-sm cursor-pointer bg-white shadow-sm" onClick={async () => {
                if (!replaceConfirm) return
                const boardId = replaceConfirm.board.id
                const boardName = replaceConfirm.board.name
                const currentGraph = boardId === activeBoardId ? graph : loadGraph(boardId)
                // Save to the CURRENT linked file (before switching to the incoming one)
                const currentHandle = fileHandlesRef.current.get(boardId) ?? await restoreFileHandle(boardId)
                if (currentHandle && await ensureWritePermission(currentHandle)) {
                  try {
                    await saveGraphToFileHandle(currentHandle, currentGraph, boardId, boardName)
                    showToast(`Saved: ${currentHandle.name}`, 'success')
                  } catch { /* non-critical */ }
                }
                // Switch file association to the newly opened file
                if (replaceConfirm.incomingHandle) {
                  fileHandlesRef.current.set(boardId, replaceConfirm.incomingHandle)
                  await persistFileHandle(boardId, replaceConfirm.incomingHandle)
                }
                setLinkedFileName(fileHandlesRef.current.get(boardId)?.name ?? null)
                savedGraphJsonRef.current.set(boardId, JSON.stringify(replaceConfirm.graph))
                saveGraph(replaceConfirm.graph, boardId)
                persistActiveBoardId(boardId)
                setActiveBoardIdState(boardId)
                switchToBoard(boardId, replaceConfirm.graph)
                setReplaceConfirm(null)
              }}>Save current & replace</Button>
              <Button variant="destructive" className="h-9 text-sm cursor-pointer" onClick={async () => {
                if (!replaceConfirm) return
                // Switch file association to the newly opened file
                if (replaceConfirm.incomingHandle) {
                  fileHandlesRef.current.set(replaceConfirm.board.id, replaceConfirm.incomingHandle)
                  await persistFileHandle(replaceConfirm.board.id, replaceConfirm.incomingHandle)
                }
                setLinkedFileName(fileHandlesRef.current.get(replaceConfirm.board.id)?.name ?? null)
                savedGraphJsonRef.current.set(replaceConfirm.board.id, JSON.stringify(replaceConfirm.graph))
                saveGraph(replaceConfirm.graph, replaceConfirm.board.id)
                persistActiveBoardId(replaceConfirm.board.id)
                setActiveBoardIdState(replaceConfirm.board.id)
                switchToBoard(replaceConfirm.board.id, replaceConfirm.graph)
                setReplaceConfirm(null)
              }}>Replace</Button>
              <Button variant="outline" className="h-9 text-sm cursor-pointer" onClick={() => setReplaceConfirm(null)}>Cancel</Button>
            </div>
          </DialogContent>
        </Dialog>
      <Toaster />
    </TooltipProvider>
  )
}
