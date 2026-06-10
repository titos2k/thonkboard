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
  type NodeChange,
  type EdgeChange,
  type Connection,
  type Node,
  type Edge,
  type Viewport,
  type ReactFlowInstance,
} from '@xyflow/react'
import { Plus, Minus, Scan, LockKeyhole, LockKeyholeOpen, Undo2, Redo2 } from 'lucide-react'
import '@xyflow/react/dist/style.css'

import { useGraph } from '@/store/useGraph'
import type { ThonkNode, ThonkEdge, ThonkGraph } from '@/store/types'
import { ThonkNodeComponent, type ThonkNodeData } from '@/components/nodes/ThonkNode'
import { EditorPanel } from '@/components/EditorPanel'
import { TopBar } from '@/components/TopBar'
import { Toaster } from '@/components/Toaster'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const NODE_TYPES = { thonk: ThonkNodeComponent }

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
        <ControlButton onClick={onClick} style={disabled ? { opacity: 0.35, pointerEvents: 'none' } : undefined}>
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
        <ControlButton onClick={onClick} style={disabled ? { opacity: 0.35, pointerEvents: 'none' } : undefined}>
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

const VIEWPORT_KEY = 'thonk.viewport'

function loadViewport(): Viewport | null {
  try {
    const raw = localStorage.getItem(VIEWPORT_KEY)
    if (raw) return JSON.parse(raw) as Viewport
  } catch {}
  return null
}

function saveViewport(vp: Viewport) {
  localStorage.setItem(VIEWPORT_KEY, JSON.stringify(vp))
}

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
): Node {
  return {
    id: n.id,
    type: 'thonk',
    position: n.position,
    selected,
    data: { thonk: n, graphRef, autoEdit, panelOpen, hasAnswer, ...cb } as ThonkNodeData,
  }
}

function toRFEdge(e: ThonkEdge, nodes: ThonkNode[]): Edge {
  const target   = nodes.find(n => n.id === e.target)
  const source   = nodes.find(n => n.id === e.source)
  const resolved = target?.resolved || source?.resolved
  const stroke   = NODE_EDGE_COLOR[target?.type ?? ''] ?? '#94a3b8'
  const dash     = target?.meta.aiGenerated ? '5 3' : undefined
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    style: { stroke, strokeDasharray: dash, strokeWidth: 1.5, opacity: resolved ? 0.25 : 1 },
    className: `edge-rel-${e.relation}`,
    data: { relation: e.relation },
    reconnectable: true,
  }
}

export default function App() {
  const {
    graph,
    addNode,
    addEdge: addGraphEdge,
    updateNode,
    updateNodePosition,
    deleteNode,
    deleteEdge: deleteGraphEdge,
    reconnectEdge,
    versionCore,
    resetGraph,
    undo,
    redo,
    canUndo,
    canRedo,
    onBatchStart,
    onBatchEnd,
  } = useGraph()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [autoEditId, setAutoEditId] = useState<string | null>(null)
  const [panelNodeId, setPanelNodeId] = useState<string | null>(null)
  const [hideResolved, setHideResolved] = useState(false)
  const [showLegend, setShowLegend] = useState(true)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const savedViewport = useMemo(() => loadViewport(), [])

  const rfInstance = useRef<ReactFlowInstance | null>(null)

  // Stable ref to current graph — passed to nodes instead of graph itself so
  // node components don't re-render on unrelated graph mutations.
  const graphRef = useRef<ThonkGraph>(graph)
  useLayoutEffect(() => { graphRef.current = graph }, [graph])

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const openPanel = useCallback((id: string | null) => setPanelNodeId(id), [])

  const miniMapNodeColor = useCallback((n: Node) => {
    const t = (n.data as ThonkNodeData)?.thonk?.type
    if (t === 'core')     return '#392946'
    if (t === 'problem')  return '#e95a32'
    if (t === 'question') return '#f4f6f6'
    if (t === 'answer')   return '#00ae60'
    return '#f5c44a'
  }, [])

  const navigateToNode = useCallback((nodeId: string) => {
    setPanelNodeId(nodeId)
    setSelectedIds(new Set([nodeId]))
    rfInstance.current?.fitView({
      nodes: [{ id: nodeId }],
      duration: 600,
      padding: 0.6,
      maxZoom: 1.2,
    })
  }, [])

  const callbacks: GraphCallbacks = useMemo(
    () => ({
      onAddNode:     addNode,
      onAddEdge:     addGraphEdge,
      onUpdate:      updateNode,
      onDelete:      deleteNode,
      onVersionCore: versionCore,
      onOpenPanel:   openPanel,
      onAutoEdit:    setAutoEditId,
      onBatchStart,
      onBatchEnd,
    }),
    [addNode, addGraphEdge, updateNode, deleteNode, versionCore, openPanel, onBatchStart, onBatchEnd],
  )

  // Compute nodes from store (used to sync into rfNodes when not dragging)
  const visibleNodes = useMemo(() => {
    if (!hideResolved) return graph.nodes

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

    return graph.nodes.filter(n => !hidden.has(n.id))
  }, [graph.nodes, graph.edges, hideResolved])
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes])

  const storeNodes = useMemo(
    () => visibleNodes.map(n => toRFNode(
      n, selectedIds.has(n.id), n.id === autoEditId, n.id === panelNodeId,
      graph.edges.some(e => e.source === n.id && e.relation === 'answers'),
      graphRef, callbacks,
    )),
    [visibleNodes, selectedIds, autoEditId, panelNodeId, graph.edges, callbacks],
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
      return graph.edges
        .filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
        .map(e => {
          const existing = prevById.get(e.id)
          return { ...toRFEdge(e, graph.nodes), selected: existing?.selected ?? false }
        })
    })
  }, [graph.edges, visibleNodeIds])

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

  const viewCenter = () => {
    const wrap = document.getElementById('rf-wrap')
    const rect = wrap?.getBoundingClientRect() ?? { width: 800, height: 600, left: 0, top: 0 }
    return rfInstance.current?.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }) ?? { x: 400, y: 300 }
  }

  const handleAddCore     = () => { const n = addNode('core',     '', '', viewCenter());                        setAutoEditId(n.id) }
  const handleAddIdea     = () => { const n = addNode('idea',     '', '', viewCenter());                        setAutoEditId(n.id) }
  const handleAddProblem  = () => { const n = addNode('problem',  '', '', viewCenter(), { severity: 0.5 });     setAutoEditId(n.id) }
  const handleAddQuestion = () => { const n = addNode('question', '', '', viewCenter());                        setAutoEditId(n.id) }

  const panelNode = panelNodeId ? graph.nodes.find(n => n.id === panelNodeId) : null

  return (
    <TooltipProvider delayDuration={0}>
      <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
        <TopBar
          onAddCore={handleAddCore}
          onAddIdea={handleAddIdea}
          onAddProblem={handleAddProblem}
          onAddQuestion={handleAddQuestion}
          hideResolved={hideResolved}
          onToggleHideResolved={() => setHideResolved(v => !v)}
          onReset={() => { resetGraph(); saveViewport({ x: 0, y: 0, zoom: 1 }); rfInstance.current?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 300 }) }}
          showLegend={showLegend}
          onToggleLegend={() => setShowLegend(v => !v)}
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
            onMoveEnd={(_e, vp) => { document.getElementById('rf-wrap')?.classList.remove('is-panning'); saveViewport(vp) }}
            panOnDrag={[1, 2]}
            minZoom={0.1}
            maxZoom={2}
            zoomOnDoubleClick={false}
            deleteKeyCode="Delete"
            proOptions={{ hideAttribution: false }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showZoom={false} showFitView={false} showInteractive={false}>
              <UndoButton onClick={undo} disabled={!canUndo} />
              <RedoButton onClick={redo} disabled={!canRedo} />
              <ZoomInButton />
              <ZoomOutButton />
              <FitViewButton />
              <LockButton />
              <ZoomDisplay />
            </Controls>
            <MiniMap
              nodeColor={miniMapNodeColor}
              maskColor="rgba(200,195,190,0.3)"
            />
          </ReactFlow>
        </div>

        {panelNode && (
          <EditorPanel
            node={panelNode}
            nodes={graph.nodes}
            onSave={(id, patch) => updateNode(id, { ...patch, meta: { aiGenerated: false } })}
            onClose={() => setPanelNodeId(null)}
            onNavigateToNode={navigateToNode}
          />
        )}

        {showLegend && <div
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
      <Toaster />
    </TooltipProvider>
  )
}
