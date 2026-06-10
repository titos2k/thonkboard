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
import { Plus, Minus, Scan, LockKeyhole, LockKeyholeOpen } from 'lucide-react'
import '@xyflow/react/dist/style.css'

import { useGraph } from '@/store/useGraph'
import type { ThonkNode, ThonkEdge, ThonkGraph } from '@/store/types'
import { ThonkNodeComponent, type ThonkNodeData } from '@/components/nodes/ThonkNode'
import { EditorPanel } from '@/components/EditorPanel'
import { TopBar } from '@/components/TopBar'
import { Toaster } from '@/components/Toaster'
import { TooltipProvider } from '@/components/ui/tooltip'

const NODE_TYPES = { thonk: ThonkNodeComponent }

const ZoomInButton = React.memo(function ZoomInButton() {
  const { zoomIn } = useReactFlow()
  return <ControlButton onClick={() => zoomIn({ duration: 200 })} title="Zoom in"><Plus className="w-[18px] h-[18px]" /></ControlButton>
})

const ZoomOutButton = React.memo(function ZoomOutButton() {
  const { zoomOut } = useReactFlow()
  return <ControlButton onClick={() => zoomOut({ duration: 200 })} title="Zoom out"><Minus className="w-[18px] h-[18px]" /></ControlButton>
})

const FitViewButton = React.memo(function FitViewButton() {
  const { fitView } = useReactFlow()
  return <ControlButton onClick={() => fitView({ padding: 0.5, duration: 400 })} title="Fit view"><Scan className="w-[18px] h-[18px]" /></ControlButton>
})

const LockButton = React.memo(function LockButton() {
  const store = useStoreApi()
  const nodesDraggable = useStore(s => s.nodesDraggable)
  const toggle = () => {
    const next = !nodesDraggable
    store.setState({ nodesDraggable: next, nodesConnectable: next, elementsSelectable: next })
  }
  return (
    <ControlButton onClick={toggle} title={nodesDraggable ? 'Lock canvas' : 'Unlock canvas'}>
      {nodesDraggable ? <LockKeyholeOpen className="w-[18px] h-[18px]" /> : <LockKeyhole className="w-[18px] h-[18px]" />}
    </ControlButton>
  )
})

const ZoomDisplay = React.memo(function ZoomDisplay() {
  const { zoom } = useViewport()
  const { zoomTo } = useReactFlow()
  return (
    <ControlButton onClick={() => zoomTo(1, { duration: 300 })} title="Reset to 100%">
      <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'system-ui', letterSpacing: '-0.02em' }}>
        {Math.round(zoom * 100)}%
      </span>
    </ControlButton>
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

const EDGE_STYLES: Record<string, { stroke: string; strokeDasharray: string; strokeWidth: number }> = {
  spawns:    { stroke: '#f59e0b', strokeDasharray: '0',   strokeWidth: 1.5 },
  questions: { stroke: '#858783', strokeDasharray: '4 3', strokeWidth: 1.5 },
  answers:   { stroke: '#34d399', strokeDasharray: '0',   strokeWidth: 1.5 },
  argues:    { stroke: '#f87171', strokeDasharray: '5 3', strokeWidth: 1.5 },
  fixes:     { stroke: '#858783', strokeDasharray: '0',   strokeWidth: 1.5 },
  expands:   { stroke: '#94a3b8', strokeDasharray: '3 3', strokeWidth: 1.5 },
}

type GraphCallbacks = {
  onAddNode:     ThonkNodeData['onAddNode']
  onAddEdge:     ThonkNodeData['onAddEdge']
  onUpdate:      ThonkNodeData['onUpdate']
  onDelete:      ThonkNodeData['onDelete']
  onVersionCore: ThonkNodeData['onVersionCore']
  onOpenPanel:   ThonkNodeData['onOpenPanel']
  onAutoEdit:    ThonkNodeData['onAutoEdit']
}

function toRFNode(
  n: ThonkNode,
  selected: boolean,
  autoEdit: boolean,
  graphRef: React.MutableRefObject<ThonkGraph>,
  cb: GraphCallbacks,
): Node {
  return {
    id: n.id,
    type: 'thonk',
    position: n.position,
    selected,
    data: { thonk: n, graphRef, autoEdit, ...cb } as ThonkNodeData,
  }
}

function toRFEdge(e: ThonkEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    style: EDGE_STYLES[e.relation] ?? {},
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

  const openPanel = useCallback((id: string) => setPanelNodeId(id), [])

  const miniMapNodeColor = useCallback((n: Node) => {
    const t = (n.data as ThonkNodeData)?.thonk?.type
    if (t === 'core')     return '#392946'
    if (t === 'problem')  return '#e95a32'
    if (t === 'question') return '#f4f6f6'
    if (t === 'answer')   return '#00ae60'
    return '#f5c44a'
  }, [])

  const navigateToNode = useCallback((nodeId: string) => {
    if (!rfInstance.current) return
    rfInstance.current.fitView({
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
    }),
    [addNode, addGraphEdge, updateNode, deleteNode, versionCore, openPanel],
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
    () => visibleNodes.map(n => toRFNode(n, selectedIds.has(n.id), n.id === autoEditId, graphRef, callbacks)),
    [visibleNodes, selectedIds, autoEditId, callbacks],
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
          return { ...toRFEdge(e), selected: existing?.selected ?? false }
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
          className="absolute bg-white border border-border rounded-lg px-4 py-3 text-sm space-y-1.5 shadow-sm pointer-events-none z-10"
          style={{ top: 44 + 16, right: panelNode ? 576 + 16 : 16 }}
        >
          <div className="font-semibold text-sm mb-2">Legend</div>
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
        </div>}
      </div>
      <Toaster />
    </TooltipProvider>
  )
}
