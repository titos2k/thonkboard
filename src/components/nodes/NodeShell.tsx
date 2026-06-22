import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { NodeType } from '@/store/types'

interface NodeShellProps {
  nodeType: NodeType
  children: React.ReactNode
  selected?: boolean
  resolved?: boolean
  aiGenerated?: boolean
  highlighted?: boolean
  dimmed?: boolean
  className?: string
  handles?: boolean
  onPointerDown?: (e: React.PointerEvent) => void
}

const TYPE_STYLES: Record<NodeType, string> = {
  core:     'border border-black/20 bg-[#392946] text-white shadow-lg',
  idea:     'border border-black/10 bg-[#f5c44a] text-gray-900 shadow',
  problem:  'border border-black/10 bg-[#e95a32] text-white shadow',
  question: 'border border-black/10 bg-[#f4f6f6] text-gray-900 shadow-md',
  answer:   'border border-black/10 bg-[#00ae60] text-white shadow',
  note:     'border-0 bg-[#f7efd0] text-gray-700 shadow-md rounded-[3px]',
  source:   'border border-black/10 bg-[#4a6fa5] text-white shadow-md',
}

const TYPE_SELECTED: Record<NodeType, string> = {
  core:     'ring-2 ring-purple-300 ring-offset-1',
  idea:     'ring-2 ring-yellow-400 ring-offset-1',
  problem:  'ring-2 ring-orange-300 ring-offset-1',
  question: 'ring-2 ring-sky-400 ring-offset-1',
  answer:   'ring-2 ring-emerald-300 ring-offset-1',
  note:     'ring-2 ring-yellow-400 ring-offset-1',
  source:   'ring-2 ring-blue-300 ring-offset-1',
}

function NodeShellBase({ nodeType, children, selected, resolved: _resolved, aiGenerated, highlighted, dimmed, className, handles = true, onPointerDown }: NodeShellProps) {
  const isLight = nodeType === 'question' || nodeType === 'idea' || nodeType === 'note'
  const handleClass = isLight
    ? '!bg-sky-300 !border-sky-400 !w-2 !h-2'
    : '!bg-white/60 !border-white/40 !w-2 !h-2'

  const baseStyle =
    aiGenerated && nodeType === 'answer'   ? 'border border-black/10 bg-[#00836d] text-white shadow' :
    aiGenerated && nodeType === 'question' ? 'border border-dashed border-black/20 bg-[#f4f6f6] text-gray-900 shadow-md' :
    TYPE_STYLES[nodeType]

  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        'rounded-lg text-sm relative cursor-grab active:cursor-grabbing transition-opacity',
        dimmed && 'opacity-60',
        nodeType === 'question' ? 'w-fit max-w-[300px]' : nodeType === 'note' ? 'w-[128px]' : nodeType === 'source' ? 'w-[240px]' : 'w-fit max-w-[220px]',
        baseStyle,
        highlighted ? 'ring-4 ring-purple-400 ring-offset-1' : (selected && TYPE_SELECTED[nodeType]),
        className,
      )}
    >
      {handles && (
        <>
          {/* Primary handles — listed first so unspecified edges route bottom→top by default */}
          <Handle id="s-bottom" type="source" position={Position.Bottom} className={handleClass} />
          <Handle id="t-top"    type="target" position={Position.Top}    className={handleClass} />
          {/* Secondary handles — enable reconnecting to any side */}
          <Handle id="s-top"    type="source" position={Position.Top}    className={handleClass} />
          <Handle id="s-left"   type="source" position={Position.Left}   className={handleClass} />
          <Handle id="s-right"  type="source" position={Position.Right}  className={handleClass} />
          <Handle id="t-bottom" type="target" position={Position.Bottom} className={handleClass} />
          <Handle id="t-left"   type="target" position={Position.Left}   className={handleClass} />
          <Handle id="t-right"  type="target" position={Position.Right}  className={handleClass} />
        </>
      )}
      {children}
    </div>
  )
}

export const NodeShell = React.memo(NodeShellBase)
