import React, { useState } from 'react'
import { useNodes, useReactFlow, useViewport } from '@xyflow/react'
import { Trash2, SpellCheck } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'
import { fixGrammar } from '@/ai/gemini'
import { showToast } from '@/lib/toast'
import type { ThonkGraph, ThonkNode } from '@/store/types'

const PAD = 12
const TOOLBAR_GAP = 8

interface Props {
  selectedIds: Set<string>
  graphRef: React.MutableRefObject<ThonkGraph>
  onBatchStart: () => void
  onBatchEnd: () => void
  onDelete: (id: string) => void
  onUpdate: (id: string, patch: Partial<Pick<ThonkNode, 'title' | 'body'>>) => void
  onClearSelection: () => void
  aiConnected: boolean
}

export function MultiSelectToolbar({ selectedIds, graphRef, onBatchStart, onBatchEnd, onDelete, onUpdate, onClearSelection, aiConnected }: Props) {
  const { flowToScreenPosition } = useReactFlow()
  const rfNodes = useNodes()
  useViewport() // re-render on zoom/pan so screen positions stay in sync
  const [fixing, setFixing] = useState(false)

  if (selectedIds.size <= 1) return null

  const selectedRFNodes = rfNodes.filter(n => selectedIds.has(n.id))
  if (selectedRFNodes.length === 0) return null

  const minX = Math.min(...selectedRFNodes.map(n => n.position.x))
  const maxX = Math.max(...selectedRFNodes.map(n => n.position.x + (n.measured?.width ?? 200)))
  const minY = Math.min(...selectedRFNodes.map(n => n.position.y))
  const maxY = Math.max(...selectedRFNodes.map(n => n.position.y + (n.measured?.height ?? 80)))

  const topLeft     = flowToScreenPosition({ x: minX, y: minY })
  const bottomRight = flowToScreenPosition({ x: maxX, y: maxY })

  const rectLeft   = topLeft.x - PAD
  const rectTop    = topLeft.y - PAD
  const rectWidth  = bottomRight.x - topLeft.x + PAD * 2
  const rectHeight = bottomRight.y - topLeft.y + PAD * 2

  const selectedThonks = graphRef.current.nodes.filter(n => selectedIds.has(n.id))

  const handleDelete = () => {
    onBatchStart()
    selectedIds.forEach(id => onDelete(id))
    onBatchEnd()
    onClearSelection()
  }

  const handleFixGrammar = async () => {
    setFixing(true)
    onBatchStart()
    try {
      for (const thonk of selectedThonks) {
        const text = thonk.title.trim()
        if (!text) continue
        const { fixed } = await fixGrammar(text)
        if (fixed && fixed !== text) {
          const bodyPatch = thonk.type === 'question' || thonk.type === 'note' ? { body: fixed } : {}
          onUpdate(thonk.id, { title: fixed, ...bodyPatch })
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e))
    } finally {
      onBatchEnd()
      setFixing(false)
    }
  }

  return (
    <>
      {/* Bounding box outline */}
      <div
        className="fixed pointer-events-none z-40 rounded-xl border-dashed border-gray-400/80"
        style={{ left: rectLeft, top: rectTop, width: rectWidth, height: rectHeight, borderWidth: 1.5 }}
      />

      {/* Toolbar anchored to top-center of bbox */}
      <div
        className="nodrag fixed z-50 flex items-center gap-0.5 bg-gray-900 rounded-lg px-1.5 py-1 shadow-xl border border-white/10"
        style={{ left: rectLeft + rectWidth / 2, top: rectTop - TOOLBAR_GAP, transform: 'translate(-50%, -100%)' }}
      >
        {aiConnected && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleFixGrammar}
                  disabled={fixing}
                  className="w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
                >
                  {fixing ? <Spinner className="w-5 h-5 opacity-60" /> : <SpellCheck className="w-5 h-5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={10} className="text-sm">Fix grammar ({selectedIds.size})</TooltipContent>
            </Tooltip>
            <div className="w-px h-4 bg-white/20 mx-0.5 shrink-0" />
          </>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleDelete}
              className="w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={10} className="text-sm">Delete all ({selectedIds.size})</TooltipContent>
        </Tooltip>
      </div>
    </>
  )
}
