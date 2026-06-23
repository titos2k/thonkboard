import React, { useCallback, useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react'
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
import { Plus, Minus, Scan, LockKeyhole, LockKeyholeOpen, Undo2, Redo2, X, Star } from 'lucide-react'
import '@xyflow/react/dist/style.css'

import { useGraph } from '@/store/useGraph'
import { useIsMobile } from '@/hooks/useIsMobile'
import {
  exportGraphToFile, parseImportedGraph, saveGraph, loadGraph, makeInitialGraph,
  migrateToMultiBoard,
  loadBoards, saveBoards, getActiveBoardId, setActiveBoardId as persistActiveBoardId, deleteBoard,
  loadViewport, saveViewport,
  fsaSupported, saveGraphToFileHandle,
} from '@/store/graph'
import { persistFileHandle, restoreFileHandle, dropFileHandle, ensureWritePermission } from '@/store/fileHandleStore'
import type { ThonkNode, ThonkEdge, ThonkGraph, BoardMeta } from '@/store/types'
import { v4 as uuidv4 } from 'uuid'
import { ThonkNodeComponent, canvasPanStore, type ThonkNodeData } from '@/components/nodes/ThonkNode'
import { ThonkEdgeComponent } from '@/components/edges/ThonkEdge'
import { NoteNodeComponent } from '@/components/nodes/NoteNode'
import { SourceNodeComponent } from '@/components/nodes/SourceNode'
import { ingestSource } from '@/ai/sourceIngest'
import { deleteSource } from '@/store/sourceDb'
import { CommandPalette } from '@/components/CommandPalette'
import { TopBar } from '@/components/TopBar'
import { WelcomeModal } from '@/components/WelcomeModal'
import { OnboardingPopover } from '@/components/OnboardingPopover'
import { Toaster } from '@/components/Toaster'
import { hasActiveKey } from '@/ai/gemini'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { showToast } from '@/lib/toast'
import { EXAMPLES } from '@/examples'
import { MultiSelectToolbar } from '@/components/MultiSelectToolbar'
import { CanvasContextMenu } from '@/components/CanvasContextMenu'

const NODE_TYPES = { thonk: ThonkNodeComponent, note: NoteNodeComponent, source: SourceNodeComponent }
const EDGE_TYPES = { thonk: ThonkEdgeComponent }

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
  source:   '#4a6fa5',
}

function loadCollapsed(boardId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`thonk.collapsed.${boardId}`)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch { return new Set() }
}

function saveCollapsed(boardId: string, ids: Set<string>) {
  if (ids.size === 0) localStorage.removeItem(`thonk.collapsed.${boardId}`)
  else localStorage.setItem(`thonk.collapsed.${boardId}`, JSON.stringify([...ids]))
}

function getDescendants(nodeId: string, edges: ThonkEdge[]): Set<string> {
  const result = new Set<string>()
  const stack = [nodeId]
  while (stack.length > 0) {
    const id = stack.pop()!
    for (const e of edges) {
      if (e.source === id && !result.has(e.target)) {
        result.add(e.target)
        stack.push(e.target)
      }
    }
  }
  return result
}

function getCollapsedAncestors(nodeId: string, edges: ThonkEdge[], collapsedNodeIds: Set<string>): Set<string> {
  const result = new Set<string>()
  const queue = [nodeId]
  const visited = new Set<string>()
  while (queue.length) {
    const cur = queue.shift()!
    if (visited.has(cur)) continue
    visited.add(cur)
    for (const e of edges) {
      if (e.target === cur && !visited.has(e.source)) {
        if (collapsedNodeIds.has(e.source)) result.add(e.source)
        queue.push(e.source)
      }
    }
  }
  return result
}

type GraphCallbacks = {
  onAddNode:              ThonkNodeData['onAddNode']
  onAddEdge:              ThonkNodeData['onAddEdge']
  onUpdate:               ThonkNodeData['onUpdate']
  onDelete:               ThonkNodeData['onDelete']
  onOpenAsNewBoard?:      ThonkNodeData['onOpenAsNewBoard']
  onResetBoard?:          ThonkNodeData['onResetBoard']
  onVersionCore:          ThonkNodeData['onVersionCore']
  onAutoEdit:             ThonkNodeData['onAutoEdit']
  onBatchStart:           ThonkNodeData['onBatchStart']
  onBatchEnd:             ThonkNodeData['onBatchEnd']
  onCopyNode:             ThonkNodeData['onCopyNode']
  onDuplicateNode:        ThonkNodeData['onDuplicateNode']
  onContextMenuSelect:    ThonkNodeData['onContextMenuSelect']
}

type CollapseProps = {
  isCollapsed: boolean
  hasChildren: boolean
  hiddenDescendantCount: number
  hiddenConflictCount: number
  hiddenNodeIds: Set<string>
  onExpand: (id: string) => void
  onCollapse: (id: string) => void
}

function toRFNode(
  n: ThonkNode,
  selected: boolean,
  autoEdit: boolean,
  hasAnswer: boolean,
  graphRef: React.MutableRefObject<ThonkGraph>,
  cb: GraphCallbacks,
  aiConnected: boolean,
  isMultiSelected: boolean,
  highlighted: boolean,
  collapse: CollapseProps,
): Node {
  const isCollapsed = collapse.isCollapsed
  const defaultWidth = n.type === 'note' ? 128 : n.type === 'source' ? 240 : n.type === 'question' ? 220 : 200
  return {
    id: n.id,
    type: n.type === 'note' ? 'note' : n.type === 'source' ? 'source' : 'thonk',
    position: n.position,
    selected: isCollapsed ? false : selected,
    data: { thonk: n, graphRef, autoEdit: isCollapsed ? false : autoEdit, hasAnswer, aiConnected, isMultiSelected, highlighted: isCollapsed ? false : highlighted, ...collapse, ...cb } as ThonkNodeData,
    width: n.nodeWidth ?? defaultWidth,
    // Invisible but still rendered — keeps handle positions stable so labelX/labelY
    // in edges stays the same whether the node is collapsed or not.
    ...(isCollapsed ? { selectable: false, draggable: false, focusable: false, style: { opacity: 0, pointerEvents: 'none' as const } } : {}),
  }
}

function toRFEdge(
  e: ThonkEdge,
  nodes: ThonkNode[],
  isTargetCollapsed: boolean,
  targetHasChildren: boolean,
  isSourceSelected: boolean,
  isTargetSelected: boolean,
  hiddenCount: number,
  onCollapse: (id: string) => void,
  onExpand: (id: string) => void,
): Edge {
  const target   = nodes.find(n => n.id === e.target)
  const source   = nodes.find(n => n.id === e.source)
  const isSourceEdge = e.relation === 'sources'
  const stroke   = isSourceEdge ? '#6b8fc4'
    : (target?.type === 'answer' && target?.meta.aiGenerated) ? '#00836d'
    : (NODE_EDGE_COLOR[target?.type ?? ''] ?? '#94a3b8')
  const aiDepth  = Math.max(target?.meta.aiDepth ?? 0, source?.meta.aiDepth ?? 0)
  const dash     = isSourceEdge ? undefined : (target?.meta.aiGenerated ? `5 ${3 + aiDepth * 4}` : undefined)
  const width    = isSourceEdge ? 1 : 1.5
  return {
    id: e.id,
    type: 'thonk',
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: isTargetCollapsed ? undefined : (e.targetHandle ?? undefined),
    style: { stroke, strokeDasharray: dash, strokeWidth: width },
    className: `edge-rel-${e.relation}`,
    data: { relation: e.relation, isTargetCollapsed, targetHasChildren, isSourceSelected, isTargetSelected, hiddenCount, targetType: target?.type, targetTitle: target?.title, onCollapse, onExpand },
    interactionWidth: 20,
    reconnectable: !isTargetCollapsed,
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
  const selectedIdsRef = useRef<Set<string>>(new Set())
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => loadCollapsed(getActiveBoardId()))
  const [autoEditId, setAutoEditId] = useState<string | null>(null)
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteScope, setPaletteScope] = useState<'this' | 'all'>('this')
  const [examplePreview, setExamplePreview] = useState<{ name: string } | null>(null)
  const examplePrevBoardIdRef = useRef<string | null>(null)
  const examplePrevViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null)

  const [pendingLink, setPendingLink] = useState<{ url: string; x: number; y: number } | null>(null)
  const [welcomed, setWelcomed] = useState(() => !!localStorage.getItem('thonk.welcomed'))
  const [aiConnected, setAiConnected] = useState(hasActiveKey)
  const [keyOpen, setKeyOpen] = useState(() => {
    const alreadyWelcomed = !!localStorage.getItem('thonk.welcomed')
    return alreadyWelcomed && !hasActiveKey()
  })
  const [showLegend, setShowLegend] = useState(true)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('thonk.darkmode') === '1')
  const [spaceHeld, setSpaceHeld] = useState(false)
  const copiedNodeRef = useRef<ThonkNode | null>(null)
  const [copiedNode, setCopiedNodeState] = useState<ThonkNode | null>(null)
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number; flowPos: { x: number; y: number } } | null>(null)
  const [replaceConfirm, setReplaceConfirm] = useState<{ board: BoardMeta; graph: ThonkGraph; incomingHandle?: FileSystemFileHandle } | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const savedViewport = useMemo(() => loadViewport(activeBoardId), [])

  const isMobile = useIsMobile()
  const rfInstance = useRef<ReactFlowInstance | null>(null)

  const captureMinimap = (boardId: string) => {
    try {
      const svgEl = document.querySelector('.react-flow__minimap svg')
      if (!svgEl) return
      // Strip the viewport mask path — its fill comes from CSS, defaults to black outside context.
      // Also inject the canvas background color so the SVG renders correctly standalone.
      const bg = darkMode ? '#1a1a2e' : '#f5f4f0'
      const svg = svgEl.outerHTML
        .replace(/<path[^>]*minimap-mask[^>]*>/g, '')
        .replace(/^<svg /, `<svg style="background:${bg}" `)
      if (svg.length < 20_000) localStorage.setItem(`thonk.minimap.${boardId}`, svg)
    } catch { /* non-critical */ }
  }
  const fileHandlesRef = useRef<Map<string, FileSystemFileHandle>>(new Map())
  const [linkedFileName, setLinkedFileName] = useState<string | null>(null)
  const savedGraphJsonRef = useRef<Map<string, string>>(new Map())
  const [fileDirty, setFileDirty] = useState(false)

  // Restore file handle name from IDB on mount so the UI reflects the link after a page refresh
  useEffect(() => {
    const handler = (e: Event) => setPendingLink((e as CustomEvent<{ url: string; x: number; y: number }>).detail)
    window.addEventListener('thonk:openlink', handler)
    return () => window.removeEventListener('thonk:openlink', handler)
  }, [])

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

  // Clear autoEditId after one render cycle
  useEffect(() => {
    if (autoEditId) {
      const id = setTimeout(() => setAutoEditId(null), 0)
      return () => clearTimeout(id)
    }
  }, [autoEditId])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('thonk.darkmode', darkMode ? '1' : '0')
  }, [darkMode])

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && e.target === document.body) setSpaceHeld(true) }
    const up   = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup',   up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  const handleCtrlSSave = useCallback(async () => {
    const boardName = boards.find(b => b.id === activeBoardId)?.name ?? 'Board'
    captureMinimap(activeBoardId)
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
      captureMinimap(activeBoardId)
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
      captureMinimap(activeBoardId)
      showToast(`Saved: ${handle.name}`, 'success')
    } catch {
      fileHandlesRef.current.delete(activeBoardId)
      await dropFileHandle(activeBoardId)
      setLinkedFileName(null)
      showToast('Save failed — file may have been moved or deleted.', 'error')
    }
  }, [graph, activeBoardId, boards])

  const viewCenter = useCallback(() => {
    const wrap = document.getElementById('rf-wrap')
    const rect = wrap?.getBoundingClientRect() ?? { width: 800, height: 600, left: 0, top: 0 }
    return rfInstance.current?.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }) ?? { x: 400, y: 300 }
  }, [])

  const handleAddIdea     = useCallback(() => { const n = addNode('idea',     '', '', viewCenter());                    setAutoEditId(n.id) }, [addNode, viewCenter])
  const handleAddProblem  = useCallback(() => { const n = addNode('problem',  '', '', viewCenter(), { severity: 0.5 }); setAutoEditId(n.id) }, [addNode, viewCenter])
  const handleAddQuestion = useCallback(() => { const n = addNode('question', '', '', viewCenter());                    setAutoEditId(n.id) }, [addNode, viewCenter])
  const handleAddNote     = useCallback(() => { const n = addNode('note',     '', '', viewCenter());                    setAutoEditId(n.id) }, [addNode, viewCenter])

  const setCopiedNode = useCallback((node: ThonkNode | null) => {
    copiedNodeRef.current = node
    setCopiedNodeState(node)
  }, [])

  const handleCopyNode = useCallback((node: ThonkNode) => {
    setCopiedNode({ ...node })
    showToast('Node copied', 'success')
  }, [setCopiedNode])

  const handleDuplicateNode = useCallback((node: ThonkNode) => {
    const extra = node.type === 'problem' ? { severity: node.meta.severity ?? 0.5 } : undefined
    const newNode = addNode(node.type, node.title, node.body, { x: node.position.x + 30, y: node.position.y + 30 }, extra)
    if (node.emoji) updateNode(newNode.id, { emoji: node.emoji })
    setTimeout(() => {
      const n = rfInstance.current?.getNode(newNode.id)
      if (n) {
        const zoom = rfInstance.current?.getZoom() ?? 1
        rfInstance.current?.setCenter(n.position.x + (n.measured?.width ?? 200) / 2, n.position.y + (n.measured?.height ?? 80) / 2, { duration: 300, zoom })
      }
    }, 50)
  }, [addNode, updateNode])

  const handleContextMenuSelect = useCallback((id: string) => {
    setRfNodes(prev => prev.map(n => ({ ...n, selected: n.id === id })))
    setSelectedIds(new Set([id]))
    selectedIdsRef.current = new Set([id])
  }, [])

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (!rfInstance.current) return
    const flowPos = rfInstance.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    setCanvasMenu({ x: e.clientX, y: e.clientY, flowPos })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo() }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') {
        e.preventDefault()
        if (examplePreview) { showToast('Viewing an example — click Keep to add it to your boards'); return }
        handleCtrlSSave()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setPaletteOpen(true) }

      // Node creation shortcuts — only when no modifier, no dialog/palette open
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (paletteOpen) return
        if (document.querySelector('[role="dialog"]')) return
        const typeKey = e.key === 'i' ? 'idea' : e.key === 'q' ? 'question' : e.key === 'p' ? 'problem' : e.key === 'n' ? 'note' : null
        if (typeKey) {
          e.preventDefault()
          const attachId = selectedIdsRef.current.size === 1 ? [...selectedIdsRef.current][0] : null
          const sourceNode = attachId ? graphRef.current.nodes.find(n => n.id === attachId) : null
          const pos = sourceNode
            ? { x: sourceNode.position.x + (sourceNode.nodeWidth ?? 200) + 60, y: sourceNode.position.y }
            : viewCenter()
          const extra = typeKey === 'problem' ? { severity: 0.5 } : undefined
          const n = addNode(typeKey, '', '', pos, extra)
          if (attachId) {
            addGraphEdge(attachId, n.id, 'spawns')
            setRfNodes(prev => prev.map(nd => nd.id === attachId ? { ...nd, selected: false } : nd))
            setSelectedIds(new Set())
            selectedIdsRef.current = new Set()
          }
          setAutoEditId(n.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, handleCtrlSSave, examplePreview, paletteOpen, addNode, addGraphEdge, viewCenter])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (paletteOpen || document.querySelector('[role="dialog"]')) return

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'c') {
        const selId = selectedIdsRef.current.size === 1 ? [...selectedIdsRef.current][0] : null
        const selNode = selId ? graphRef.current.nodes.find(n => n.id === selId) : null
        if (selNode && selNode.type !== 'core') { e.preventDefault(); setCopiedNode({ ...selNode }); showToast('Node copied', 'success') }
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'v') {
        e.preventDefault()
        const node = copiedNodeRef.current
        if (node) {
          const extra = node.type === 'problem' ? { severity: node.meta.severity ?? 0.5 } : undefined
          const n = addNode(node.type, node.title, node.body, viewCenter(), extra)
          if (node.emoji) updateNode(n.id, { emoji: node.emoji })
        }
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); rfInstance.current?.zoomIn({ duration: 200 }) }
        if (e.key === '-')                  { e.preventDefault(); rfInstance.current?.zoomOut({ duration: 200 }) }
        if (e.key === '0')                  { e.preventDefault(); rfInstance.current?.fitView({ padding: 0.5, duration: 400 }) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, addNode, updateNode, viewCenter, setCopiedNode])

  // Update page title to reflect active board name (only once explicitly named)
  useEffect(() => {
    const board = boards.find(b => b.id === activeBoardId)
    const name = board?.isNamed ? board.name : undefined
    const isPwa = window.matchMedia('(display-mode: standalone)').matches || !!(navigator as any).standalone
    document.title = name ? (isPwa ? name : `${name} - ThonkBoard`) : 'ThonkBoard'
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
    setCollapsedNodeIds(loadCollapsed(activeBoardId))
  }, [activeBoardId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep board meta emoji in sync with the active board's core node emoji.
  // Runs on board switch and whenever the core node changes.
  useEffect(() => {
    const coreEmoji = graph.nodes.find(n => n.type === 'core')?.emoji ?? undefined
    setBoards(prev => {
      const board = prev.find(b => b.id === activeBoardId)
      if (!board || board.emoji === coreEmoji) return prev
      const next = prev.map(b => b.id === activeBoardId ? { ...b, emoji: coreEmoji } : b)
      saveBoards(next)
      return next
    })
  }, [activeBoardId, graph.nodes]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSwitchBoard = useCallback((id: string) => {
    if (id === activeBoardId) return
    captureMinimap(activeBoardId)
    setExamplePreview(null)
    const currentVp = rfInstance.current?.getViewport()
    if (currentVp) saveViewport(currentVp, activeBoardId)
    persistActiveBoardId(id)
    setActiveBoardIdState(id)
    switchToBoard(id)
    setBoards(prev => {
      const next = prev.map(b => b.id === id ? { ...b, lastUsedAt: new Date().toISOString() } : b)
      saveBoards(next)
      return next
    })
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
    const initialGraph = makeInitialGraph()
    const coreId = initialGraph.nodes[0].id
    const now = new Date().toISOString()
    const board: BoardMeta = { id, name: `Board ${boards.length + 1}`, createdAt: now, lastUsedAt: now }
    const next = [...boards, board]
    setBoards(next)
    saveBoards(next)
    persistActiveBoardId(id)
    setActiveBoardIdState(id)
    switchToBoard(id, initialGraph)
    setAutoEditId(coreId)
  }, [boards, switchToBoard])

  const handleOpenAsNewBoard = useCallback((ideaNode: ThonkNode) => {
    const id = uuidv4()
    const initialGraph = makeInitialGraph()
    initialGraph.nodes[0] = { ...initialGraph.nodes[0], title: ideaNode.title, body: ideaNode.body }
    const boardName = ideaNode.title || `Board ${boards.length + 1}`
    const now = new Date().toISOString()
    const board: BoardMeta = { id, name: boardName, createdAt: now, lastUsedAt: now }
    const next = [...boards, board]
    setBoards(next)
    saveBoards(next)
    persistActiveBoardId(id)
    setActiveBoardIdState(id)
    switchToBoard(id, initialGraph)
    setAutoEditId(initialGraph.nodes[0].id)
  }, [boards, switchToBoard])

  const handleResetBoard = useCallback(() => {
    const core = graph.nodes.find(n => n.type === 'core')
    if (!core) return
    const freshGraph = makeInitialGraph()
    freshGraph.nodes[0] = { ...freshGraph.nodes[0], id: core.id, position: core.position }
    switchToBoard(activeBoardId, freshGraph)
    setAutoEditId(core.id)
  }, [graph.nodes, activeBoardId, switchToBoard])

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
    const next = boards.map(b => b.id === id ? { ...b, name, isNamed: true } : b)
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
    if (t === 'source')   return '#4a6fa5'
    return '#f5c44a'
  }, [])

  const navigateToNode = useCallback((nodeId: string, opts?: { highlight?: boolean }) => {
    const { highlight = false } = opts ?? {}
    // Uncollapse any collapsed ancestors so the node becomes visible.
    // Also uncollapse the node itself — it may be the collapsed root (not an ancestor of itself).
    setCollapsedNodeIds(prev => {
      const toRemove = getCollapsedAncestors(nodeId, graphRef.current.edges, prev)
      if (prev.has(nodeId)) toRemove.add(nodeId)
      if (toRemove.size === 0) return prev
      const next = new Set(prev)
      for (const id of toRemove) next.delete(id)
      return next
    })
    setSelectedIds(new Set([nodeId]))
    // Use graphRef for position — rfNodes may not have updated yet after uncollapse
    const graphNode = graphRef.current.nodes.find(n => n.id === nodeId)
    if (graphNode) {
      const rfNode = rfInstance.current?.getNode(nodeId)
      const w = rfNode?.measured?.width ?? 200
      const h = rfNode?.measured?.height ?? 80
      const zoom = rfInstance.current?.getZoom() ?? 1
      rfInstance.current?.setCenter(graphNode.position.x + w / 2, graphNode.position.y + h / 2, { duration: 500, zoom })
    }
    if (highlight) {
      setHighlightedNodeId(nodeId)
      setTimeout(() => setHighlightedNodeId(null), 1500)
    }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeId } = (e as CustomEvent<{ nodeId: string }>).detail
      navigateToNode(nodeId, { highlight: true })
    }
    window.addEventListener('thonk:navigate', handler)
    return () => window.removeEventListener('thonk:navigate', handler)
  }, [navigateToNode])

  useEffect(() => {
    const handler = () => {
      const first = graph.nodes.find(n => (n.conflicts ?? []).some(c => !c.ignored))
      if (first) navigateToNode(first.id, { highlight: true })
    }
    window.addEventListener('thonk:navigate-first-conflict', handler)
    return () => window.removeEventListener('thonk:navigate-first-conflict', handler)
  }, [graph.nodes, navigateToNode])

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
    const node = graph.nodes.find(n => n.id === id)
    if (node?.type === 'core') {
      if ('title' in patch && patch.title) {
        handleRenameBoard(activeBoardId, patch.title)
      }
      if ('emoji' in patch) {
        setBoards(prev => {
          const next = prev.map(b => b.id === activeBoardId ? { ...b, emoji: patch.emoji || undefined } : b)
          saveBoards(next)
          return next
        })
      }
    }
  }, [updateNode, graph.nodes, activeBoardId, handleRenameBoard])

  const callbacks: GraphCallbacks = useMemo(
    () => ({
      onAddNode:            addNode,
      onAddEdge:            addGraphEdge,
      onUpdate:             handleUpdateNode,
      onDelete:             deleteNode,
      onOpenAsNewBoard:     handleOpenAsNewBoard,
      onResetBoard:         handleResetBoard,
      onVersionCore:        versionCore,
      onAutoEdit:           setAutoEditId,
      onBatchStart,
      onBatchEnd,
      onCopyNode:           handleCopyNode,
      onDuplicateNode:      handleDuplicateNode,
      onContextMenuSelect:  handleContextMenuSelect,
    }),
    [addNode, addGraphEdge, handleUpdateNode, deleteNode, handleOpenAsNewBoard, handleResetBoard, versionCore, onBatchStart, onBatchEnd, handleCopyNode, handleDuplicateNode, handleContextMenuSelect],
  )

  const conflictCount = useMemo(() => {
    const pairs = new Set<string>()
    for (const node of graph.nodes) {
      for (const c of node.conflicts ?? []) {
        if (c.ignored) continue
        const key = [node.id, c.nodeId].sort().join('|')
        pairs.add(key)
      }
    }
    return pairs.size
  }, [graph.nodes])

  const hiddenNodeIds = useMemo(() => {
    if (collapsedNodeIds.size === 0) return new Set<string>()
    const hidden = new Set<string>()
    for (const id of collapsedNodeIds) {
      hidden.add(id) // the collapsed node itself disappears; edge to it becomes a stub
      for (const descId of getDescendants(id, graph.edges)) {
        hidden.add(descId)
      }
    }
    return hidden
  }, [collapsedNodeIds, graph.edges])

  useEffect(() => {
    saveCollapsed(activeBoardId, collapsedNodeIds)
  }, [activeBoardId, collapsedNodeIds])

  // Remove ghost IDs from selectedIds when nodes are deleted outside RF's onNodesChange
  useEffect(() => {
    if (selectedIds.size === 0) return
    const validIds = new Set(graph.nodes.map(n => n.id))
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => validIds.has(id)))
      if (next.size === prev.size) return prev
      selectedIdsRef.current = next
      return next
    })
  }, [graph.nodes])

  // Deselect nodes that become hidden when a branch is collapsed
  useEffect(() => {
    if (hiddenNodeIds.size === 0 || selectedIds.size === 0) return
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => !hiddenNodeIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [hiddenNodeIds]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCollapse = useCallback((nodeId: string) => {
    setCollapsedNodeIds(prev => new Set([...prev, nodeId]))
  }, [])

  const handleExpand = useCallback((nodeId: string) => {
    setCollapsedNodeIds(prev => {
      const next = new Set(prev)
      next.delete(nodeId)
      return next
    })
  }, [])

  const storeNodes = useMemo(() => {
    const isMultiSelected = selectedIds.size > 1
    return graph.nodes.map(n => {
      const isCollapsed = collapsedNodeIds.has(n.id)
      let hiddenDescendantCount = 0
      let hiddenConflictCount = 0
      if (isCollapsed) {
        const descs = getDescendants(n.id, graph.edges)
        hiddenDescendantCount = descs.size
        const conflictPairs = new Set<string>()
        for (const descId of descs) {
          const descNode = graph.nodes.find(nd => nd.id === descId)
          for (const c of descNode?.conflicts ?? []) {
            if (!c.ignored) conflictPairs.add([descId, c.nodeId].sort().join('|'))
          }
        }
        hiddenConflictCount = conflictPairs.size
      }
      const hasChildren = graph.edges.some(e => e.source === n.id)
      return toRFNode(
        n, selectedIds.has(n.id), n.id === autoEditId,
        graph.edges.some(e => e.source === n.id && e.relation === 'answers'),
        graphRef, callbacks, aiConnected, isMultiSelected,
        n.id === highlightedNodeId,
        { isCollapsed, hasChildren, hiddenDescendantCount, hiddenConflictCount, hiddenNodeIds, onExpand: handleExpand, onCollapse: handleCollapse },
      )
    })
  }, [graph.nodes, selectedIds, autoEditId, graph.edges, callbacks, aiConnected, highlightedNodeId, collapsedNodeIds, hiddenNodeIds, handleExpand, handleCollapse])

  // Sync store → local RF state whenever it changes, but only when not mid-drag.
  // Skip when the only change was a position persistence update — rfNodes already
  // has the correct position from applyNodeChanges during the drag.
  // useLayoutEffect (vs useEffect) runs before paint, collapsing this sync and RF's
  // own prop-sync into the same frame — eliminates the one-frame toolbar show/hide delay.
  useLayoutEffect(() => {
    if (positionUpdateRef.current) {
      positionUpdateRef.current = false
      return
    }
    if (!isDraggingRef.current) {
      // Collapsed nodes stay in rfNodes as invisible real nodes — this keeps their
      // handle positions intact so edges compute the same labelX/labelY in both states.
      setRfNodes(
        hiddenNodeIds.size === 0
          ? storeNodes
          : storeNodes.filter(n => !hiddenNodeIds.has(n.id) || collapsedNodeIds.has(n.id)),
      )
    }
  }, [storeNodes, hiddenNodeIds, collapsedNodeIds])

  // Sync graph edges → local RF state (preserve selection state of existing edges)
  useEffect(() => {
    setRfEdges(prev => {
      const prevById = new Map(prev.map(e => [e.id, e]))
      return graph.edges
        .filter(e =>
          !hiddenNodeIds.has(e.source) &&
          (!hiddenNodeIds.has(e.target) || collapsedNodeIds.has(e.target)),
        )
        .map(e => {
          const existing = prevById.get(e.id)
          const isTargetCollapsed = collapsedNodeIds.has(e.target)
          const targetHasChildren = graph.edges.some(e2 => e2.source === e.target)
          const hiddenCount = isTargetCollapsed ? 1 + getDescendants(e.target, graph.edges).size : 0
          return {
            ...toRFEdge(
              e, graph.nodes,
              isTargetCollapsed,
              targetHasChildren,
              selectedIds.has(e.source),
              selectedIds.has(e.target),
              hiddenCount,
              handleCollapse, handleExpand,
            ),
            selected: existing?.selected ?? false,
          }
        })
    })
  }, [graph.edges, graph.nodes, hiddenNodeIds, collapsedNodeIds, selectedIds, handleCollapse, handleExpand])

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
        if (change.type === 'remove') {
          setCollapsedNodeIds(prev => {
            if (!prev.has(change.id)) return prev
            const next = new Set(prev); next.delete(change.id); return next
          })
          const removing = graph.nodes.find(n => n.id === change.id)
          if (removing?.type !== 'core') {
            if (removing?.type === 'source' && removing.sourceId) {
              deleteSource(removing.sourceId).catch(() => {/* non-critical */})
            }
            deleteNode(change.id)
          }
        }
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
        selectedIdsRef.current = next
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
      if (!newConnection.source || !newConnection.target) return
      const relation = (oldEdge.data as { relation: string })?.relation ?? 'spawns'
      if (relation === 'sources') {
        const tgtNode = graph.nodes.find(n => n.id === newConnection.target)
        if (tgtNode?.type !== 'core') {
          showToast('Source nodes can only connect to the core', 'error')
          return
        }
      }
      reconnectEdge(
        oldEdge.id,
        newConnection.source,
        newConnection.target,
        relation as import('@/store/types').EdgeRelation,
        newConnection.sourceHandle,
        newConnection.targetHandle,
      )
    },
    [reconnectEdge, graph.nodes],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      const srcNode = graph.nodes.find(n => n.id === connection.source)
      const tgtNode = graph.nodes.find(n => n.id === connection.target)
      if (srcNode?.type === 'source') {
        if (tgtNode?.type !== 'core') {
          showToast('Source nodes can only connect to the core', 'error')
          return
        }
        addGraphEdge(connection.source, connection.target, 'sources', connection.sourceHandle ?? undefined, connection.targetHandle ?? undefined)
        return
      }
      if (tgtNode?.type === 'source') {
        showToast('Cannot connect to a source node', 'error')
        return
      }
      addGraphEdge(connection.source, connection.target, 'spawns', connection.sourceHandle ?? undefined, connection.targetHandle ?? undefined)
    },
    [addGraphEdge, graph.nodes],
  )

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

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

  const [importingSource, setImportingSource] = useState(false)

  const handleImportSource = useCallback(async (file: File) => {
    if (importingSource) return
    setImportingSource(true)
    try {
      const { title, digest, sourceId, kind } = await ingestSource(file)
      const core = graph.nodes.find(n => n.type === 'core')
      const corePos = core?.position ?? { x: 400, y: 300 }
      const pos = { x: corePos.x - 320, y: corePos.y - 60 }
      const node = addNode('source', title, digest, pos, undefined, { sourceKind: kind, sourceId, userTitleEdited: false })
      if (core) addGraphEdge(node.id, core.id, 'sources')
      showToast(`Source "${title}" imported`, 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to import source', 'error')
    } finally {
      setImportingSource(false)
    }
  }, [importingSource, graph.nodes, addNode, addGraphEdge])

  const handleLoadExample = useCallback((raw: string, name: string) => {
    try {
      const { graph: imported } = parseImportedGraph(raw)
      examplePrevBoardIdRef.current = activeBoardId
      examplePrevViewportRef.current = rfInstance.current?.getViewport() ?? null
      switchToBoard('__example__', imported)
      setExamplePreview({ name })
      setSelectedIds(new Set())
      setTimeout(() => rfInstance.current?.fitView({ padding: 0.15, duration: 400 }), 50)
    } catch {
      showToast('Failed to load example', 'error')
    }
  }, [activeBoardId, switchToBoard])

  const handleExitExample = useCallback(() => {
    const prev = examplePrevBoardIdRef.current ?? activeBoardId
    switchToBoard(prev)
    setActiveBoardIdState(prev)
    persistActiveBoardId(prev)
    const vp = examplePrevViewportRef.current
    if (vp) setTimeout(() => rfInstance.current?.setViewport(vp, { duration: 0 }), 0)
    examplePrevBoardIdRef.current = null
    examplePrevViewportRef.current = null
    setExamplePreview(null)
  }, [activeBoardId, switchToBoard])

  const handleCloneExample = useCallback(() => {
    if (!examplePreview) return
    const id = uuidv4()
    const board: BoardMeta = { id, name: examplePreview.name, createdAt: new Date().toISOString() }
    const next = [...boards, board]
    setBoards(next)
    saveBoards(next)
    saveGraph(graph, id)
    persistActiveBoardId(id)
    setActiveBoardIdState(id)
    switchToBoard(id, graph)
    examplePrevBoardIdRef.current = null
    examplePrevViewportRef.current = null
    setExamplePreview(null)
  }, [examplePreview, boards, graph, switchToBoard])

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

  const handleToggleLegend = useCallback(() => setShowLegend(v => !v), [])

  return (
    <TooltipProvider delayDuration={0} disableHoverableContent>
      <div style={{ width: '100vw', height: '100dvh', position: 'relative' }}>
        <WelcomeModal
          open={!welcomed}
          onConnectAI={handleWelcomeConnectAI}
          onSkip={handleWelcomeSkip}
          onSeeExample={EXAMPLES.length ? () => { handleWelcomeSkip(); handleLoadExample(EXAMPLES[0].raw, EXAMPLES[0].name) } : undefined}
        />
        {welcomed && !keyOpen && !examplePreview && <OnboardingPopover />}
        <TopBar
          onAddIdea={handleAddIdea}
          onAddProblem={handleAddProblem}
          onAddQuestion={handleAddQuestion}
          onAddNote={handleAddNote}
          showLegend={showLegend}
          onToggleLegend={handleToggleLegend}
          onExport={handleCtrlSSave}
          onExportAs={handleSaveAs}
          onExportPng={handleExportPng}
          onImport={handleImport}
          onImportSource={handleImportSource}
          linkedFileName={linkedFileName}
          fileDirty={fileDirty}
          graph={graph}
          boards={boards}
          activeBoardId={activeBoardId}
          onSwitchBoard={handleSwitchBoard}
          onCreateBoard={handleCreateBoard}
          onDeleteBoard={handleDeleteBoard}
          keyOpen={keyOpen}
          onKeyOpenChange={setKeyOpen}
          onAiConnected={handleAiConnected}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode(d => !d)}
          onLoadExample={handleLoadExample}
          exampleMode={!!examplePreview}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenPaletteAllBoards={() => { setPaletteScope('all'); setPaletteOpen(true) }}
          conflictCount={conflictCount}
        />
        <div style={{ width: '100%', height: '100%', paddingTop: 53 }} className={[spaceHeld ? 'space-held' : '', 'rf-wrap'].filter(Boolean).join(' ')} id="rf-wrap" onContextMenu={handleCanvasContextMenu}>
        {examplePreview && (
          <div className="absolute top-[60px] left-2 z-50 flex items-center gap-2 bg-foreground text-background rounded-md px-3 py-2 shadow-md nodrag">
            <Star className="w-4 h-4 text-background/60 shrink-0" />
            <span className="font-medium text-sm">{examplePreview.name}</span>
            <span className="text-background/50 text-sm">example</span>
            <Button className="ml-1 cursor-pointer" onClick={handleCloneExample}>Keep</Button>
            <Button size="icon" variant="ghost" className="h-9 w-9 text-background/70 hover:text-background hover:bg-white/10 cursor-pointer" onClick={handleExitExample}><X className="w-4 h-4" /></Button>
          </div>
        )}
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
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
            onMoveStart={() => { document.getElementById('rf-wrap')?.classList.add('is-panning'); canvasPanStore.set(true) }}
            onMoveEnd={(_e, vp) => { document.getElementById('rf-wrap')?.classList.remove('is-panning'); canvasPanStore.set(false); saveViewport(vp, activeBoardId) }}
            panOnDrag={[1]}
            minZoom={0.1}
            maxZoom={2}
            zoomOnDoubleClick={false}
            deleteKeyCode="Delete"
            multiSelectionKeyCode="Shift"
            elevateEdgesOnSelect
            proOptions={{ hideAttribution: false }}
          >
            {selectedIds.size > 1 && (
              <MultiSelectToolbar
                selectedIds={selectedIds}
                graphRef={graphRef}
                onBatchStart={onBatchStart}
                onBatchEnd={onBatchEnd}
                onDelete={deleteNode}
                onUpdate={(id, patch) => updateNode(id, patch)}
                onClearSelection={clearSelection}
                aiConnected={aiConnected}
              />
            )}
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={darkMode ? 'hsl(240, 8%, 38%)' : undefined} />
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
                maskColor={darkMode ? 'rgba(10,12,20,0.5)' : 'rgba(200,195,190,0.3)'}
              />
            )}
          </ReactFlow>
        </div>

        {canvasMenu && (
          <CanvasContextMenu
            x={canvasMenu.x}
            y={canvasMenu.y}
            copiedNode={copiedNode}
            onClose={() => setCanvasMenu(null)}
            onAddIdea={() => { const n = addNode('idea', '', '', canvasMenu.flowPos); setAutoEditId(n.id) }}
            onAddQuestion={() => { const n = addNode('question', '', '', canvasMenu.flowPos); setAutoEditId(n.id) }}
            onAddProblem={() => { const n = addNode('problem', '', '', canvasMenu.flowPos, { severity: 0.5 }); setAutoEditId(n.id) }}
            onAddNote={() => { const n = addNode('note', '', '', canvasMenu.flowPos); setAutoEditId(n.id) }}
            onPaste={() => {
              const node = copiedNode
              if (!node) return
              const extra = node.type === 'problem' ? { severity: node.meta.severity ?? 0.5 } : undefined
              const n = addNode(node.type, node.title, node.body, canvasMenu.flowPos, extra)
              if (node.emoji) updateNode(n.id, { emoji: node.emoji })
            }}
            onSearch={() => setPaletteOpen(true)}
            onZoomIn={() => rfInstance.current?.zoomIn({ duration: 200 })}
            onZoomOut={() => rfInstance.current?.zoomOut({ duration: 200 })}
            onFitView={() => rfInstance.current?.fitView({ padding: 0.5, duration: 400 })}
          />
        )}

        <CommandPalette
          open={paletteOpen}
          onClose={() => { setPaletteOpen(false); setPaletteScope('this') }}
          nodes={graph.nodes}
          edges={graph.edges}
          onNavigate={id => navigateToNode(id, { highlight: true })}
          initialScope={paletteScope}
          otherBoards={boards.filter(b => b.id !== activeBoardId)}
          onLoadBoardNodes={id => loadGraph(id).nodes}
          onNavigateBoard={(boardId, nodeId) => {
            handleSwitchBoard(boardId)
            setTimeout(() => navigateToNode(nodeId, { highlight: true }), 350)
          }}
        />

        {!isMobile && (
          <div
            className="absolute pointer-events-none z-10 font-semibold text-sm text-foreground/60 bg-(--background)/80 px-1 rounded-sm"
            style={{ top: 44 + 16, left: 12 }}
          >
            {boards.find(b => b.id === activeBoardId)?.name ?? ''}
          </div>
        )}

        {showLegend && !isMobile && <div
          className="absolute bg-card border border-border rounded-lg px-4 py-3 text-sm shadow-sm pointer-events-none z-10"
          style={{ top: 44 + 16, right: 16 }}
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
              { color: 'bg-[#f7efd0] border border-black/10',   label: 'Note'         },
              { color: 'bg-[#4a6fa5]',                          label: 'Source'       },
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
              <Button variant="outline" className="h-9 text-sm cursor-pointer bg-card shadow-sm" onClick={async () => {
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
      {pendingLink && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setPendingLink(null)} />
          <div
            className="fixed z-[9999] px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 shadow-xl text-sm max-w-xs"
            style={{ left: pendingLink.x, top: pendingLink.y - 48, transform: 'translateX(-50%)' }}
          >
            <a
              href={pendingLink.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setPendingLink(null)}
              className="text-neutral-200 truncate block decoration-dotted underline underline-offset-2 hover:text-white"
            >{pendingLink.url}</a>
          </div>
        </>
      )}
      <Toaster />
    </TooltipProvider>
  )
}
