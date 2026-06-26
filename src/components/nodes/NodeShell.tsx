import React from 'react'
import { Handle, Position, NodeResizeControl } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { NodeType } from '@/store/types'

document.addEventListener('keydown', e => { if (e.key === 'Shift') document.body.classList.add('is-shift') })
document.addEventListener('keyup',   e => { if (e.key === 'Shift') document.body.classList.remove('is-shift') })

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
  onContextMenu?: (e: React.MouseEvent) => void
  resizable?: boolean
  nodeWidth?: number
  onResized?: (w: number, h: number) => void
  minWidth?: number
  minHeight?: number
}

const TYPE_STYLES: Record<NodeType, string> = {
  core:     'border border-black/20 bg-[var(--thonk-core)] text-white shadow-lg',
  idea:     'border border-black/10 bg-[var(--thonk-idea)] text-gray-900 shadow',
  problem:  'border border-black/10 bg-[var(--thonk-problem)] text-white shadow',
  question: 'border border-black/10 bg-[var(--thonk-question)] text-gray-900 shadow-md',
  answer:   'border border-black/10 bg-[var(--thonk-answer)] text-white shadow',
  note:     'border-0 bg-[var(--thonk-note)] text-gray-700 shadow-md rounded-[3px]',
  source:   'border border-black/10 bg-[var(--thonk-source)] text-white shadow-md',
}

const SELECTED    = 'ring-2 ring-[#1E1C24] dark:ring-[#EEECE8] ring-offset-1'
const HANDLE_CLASS = '!bg-white !border-0 !w-2 !h-2 !shadow-md'

function NodeShellBase({ nodeType, children, selected, resolved: _resolved, aiGenerated, highlighted, dimmed, className, handles = true, onPointerDown, onContextMenu, resizable, nodeWidth: _nodeWidth, onResized, minWidth, minHeight }: NodeShellProps) {
  const baseStyle =
    aiGenerated && nodeType === 'answer'   ? 'border border-black/10 bg-[var(--thonk-answer-dark)] text-white shadow' :
    aiGenerated && nodeType === 'question' ? 'border border-dashed border-black/20 bg-[var(--thonk-question)] text-gray-900 shadow-md' :
    TYPE_STYLES[nodeType]

  // Use w-full when resizable (RF wrapper controls width). For unresized thonk nodes,
  // fall back to original auto-width classes until user explicitly resizes.
  const widthClass = resizable
    ? 'w-full'
    : nodeType === 'question' ? 'w-fit max-w-[300px]'
    : nodeType === 'note' ? 'w-[128px]'
    : nodeType === 'source' ? 'w-[240px]'
    : 'w-fit max-w-[220px]'

  return (
    <div
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      className={cn(
        'rounded-lg text-sm relative cursor-grab active:cursor-grabbing transition-opacity',
        dimmed && 'opacity-60',
        widthClass,
        baseStyle,
        highlighted ? 'ring-4 ring-purple-400 ring-offset-1' : (selected && SELECTED),
        className,
      )}
    >
      {resizable && (
        <>
          <NodeResizeControl
            position="bottom-right"
            minWidth={minWidth ?? 80}
            minHeight={minHeight ?? 40}
            onResizeEnd={(_, params) => onResized?.(params.width, params.height)}
            style={{ background: 'transparent', border: 'none', width: 20, height: 20 }}
          />
          {/* Visual indicator — bottom-right corner */}
          <svg width="10" height="10" viewBox="0 0 10 10" className="absolute pointer-events-none opacity-30" style={{ bottom: 3, right: 3 }}>
            <line x1="3" y1="10" x2="10" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="6" y1="10" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </>
      )}
      {handles && (
        <>
          {/* Primary handles — listed first so unspecified edges route bottom→top by default */}
          <Handle id="s-bottom" type="source" position={Position.Bottom} className={HANDLE_CLASS} />
          <Handle id="t-top"    type="target" position={Position.Top}    className={HANDLE_CLASS} />
          {/* Secondary handles — enable reconnecting to any side */}
          <Handle id="s-top"    type="source" position={Position.Top}    className={HANDLE_CLASS} />
          <Handle id="s-left"   type="source" position={Position.Left}   className={HANDLE_CLASS} />
          <Handle id="s-right"  type="source" position={Position.Right}  className={HANDLE_CLASS} />
          <Handle id="t-bottom" type="target" position={Position.Bottom} className={HANDLE_CLASS} />
          <Handle id="t-left"   type="target" position={Position.Left}   className={HANDLE_CLASS} />
          <Handle id="t-right"  type="target" position={Position.Right}  className={HANDLE_CLASS} />
        </>
      )}
      {children}
    </div>
  )
}

export const NodeShell = React.memo(NodeShellBase)
