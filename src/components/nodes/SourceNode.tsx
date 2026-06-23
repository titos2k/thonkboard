import React, { useState, useEffect, useRef } from 'react'
import { Handle, NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { Trash2, Database, Pencil, ScrollText } from 'lucide-react'
import { NodeShell } from './NodeShell'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { ThonkNodeData } from './ThonkNode'

function stopDeletePropagation(e: React.KeyboardEvent) {
  if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation()
}

function SourceNodeFn({ data, selected, dragging }: NodeProps) {
  const d = data as ThonkNodeData
  const { thonk } = d
  const [digestOpen, setDigestOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const titleRef = useRef(thonk.title)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      const id = setTimeout(() => {
        textareaRef.current?.focus()
        textareaRef.current?.select()
      }, 0)
      return () => clearTimeout(id)
    }
  }, [editing])

  useEffect(() => {
    if (!editing) titleRef.current = thonk.title
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thonk.title])

  const handleTitleBlur = () => {
    const val = titleRef.current.trim()
    if (val && val !== thonk.title) {
      d.onUpdate(thonk.id, { title: val, userTitleEdited: true })
    }
    setEditing(false)
  }

  const kindLabel = thonk.sourceKind === 'md' ? 'Markdown' : 'Text'

  return (
    <>
      <NodeShell nodeType="source" selected={selected} handles={false} className="cursor-default active:cursor-default" resizable={true} nodeWidth={thonk.nodeWidth} onResized={(w) => d.onUpdate(thonk.id, { nodeWidth: w })} minWidth={160} minHeight={60} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); d.onContextMenuSelect(thonk.id) }}>
        {/* Source-only handles — connect outward to core */}
        <Handle id="s-bottom" type="source" position={Position.Bottom} className="!bg-blue-300 !border-blue-400 !w-2 !h-2" />
        <Handle id="s-top"    type="source" position={Position.Top}    className="!bg-blue-300 !border-blue-400 !w-2 !h-2" />
        <Handle id="s-left"   type="source" position={Position.Left}   className="!bg-blue-300 !border-blue-400 !w-2 !h-2" />
        <Handle id="s-right"  type="source" position={Position.Right}  className="!bg-blue-300 !border-blue-400 !w-2 !h-2" />

        <NodeToolbar isVisible={selected && !d.isMultiSelected && !dragging} position={Position.Top} offset={8}>
          <div className="nodrag flex items-center gap-0.5 bg-gray-900 rounded-lg px-1.5 py-1 shadow-xl border border-white/10">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setEditing(true)}
                  className="w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer"
                >
                  <Pencil className="w-[18px] h-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={10} className="text-sm">Rename</TooltipContent>
            </Tooltip>
            {thonk.body && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setDigestOpen(true)}
                    className="w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer"
                  >
                    <ScrollText className="w-[18px] h-[18px]" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={10} className="text-sm">Read digest</TooltipContent>
              </Tooltip>
            )}
            <div className="w-px h-4 bg-white/20 mx-0.5 shrink-0" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => d.onDelete(thonk.id)}
                  className="nodrag w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer"
                >
                  <Trash2 className="w-[18px] h-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={10} className="text-sm">Delete source</TooltipContent>
            </Tooltip>
          </div>
        </NodeToolbar>

        {/* Header */}
        <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1">
          <Database className="w-3.5 h-3.5 shrink-0 opacity-70" />
          <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">{kindLabel} Source</span>
        </div>

        {/* Title */}
        <div className="px-3 pb-2.5">
          {editing ? (
            <textarea
              ref={textareaRef}
              defaultValue={thonk.title}
              onChange={e => { titleRef.current = e.target.value }}
              onBlur={handleTitleBlur}
              onKeyDown={e => {
                stopDeletePropagation(e)
                if (e.key === 'Enter' || e.key === 'Escape') textareaRef.current?.blur()
              }}
              rows={1}
              className={cn(
                'nodrag w-full bg-transparent outline-none border-none text-sm font-semibold leading-snug',
                'text-white placeholder:text-white/40 resize-none overflow-hidden p-0 m-0',
              )}
            />
          ) : (
            <p
              onDoubleClick={() => setEditing(true)}
              className="text-sm font-semibold leading-snug text-white break-words cursor-default select-none"
            >
              {thonk.title || <span className="opacity-40">Untitled source</span>}
            </p>
          )}
        </div>


      </NodeShell>

      {/* Digest dialog — rendered outside NodeShell to avoid clipping */}
      <Dialog open={digestOpen} onOpenChange={setDigestOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="pb-2">{thonk.title || 'Source digest'}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground leading-relaxed max-h-[60vh] overflow-y-auto whitespace-pre-wrap pr-1">
            {thonk.body}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export const SourceNodeComponent = React.memo(
  SourceNodeFn,
  (prev, next) => {
    const pd = prev.data as ThonkNodeData
    const nd = next.data as ThonkNodeData
    return (
      pd.thonk === nd.thonk &&
      pd.onUpdate === nd.onUpdate &&
      pd.onDelete === nd.onDelete &&
      pd.isMultiSelected === nd.isMultiSelected &&
      prev.selected === next.selected &&
      prev.dragging === next.dragging
    )
  }
)
