import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { Trash2, ArrowDownUp, Brain, Lightbulb, TriangleAlert, MessageCircleQuestion, MessageCircle } from 'lucide-react'
import { NodeShell } from './NodeShell'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ThonkNodeData } from './ThonkNode'
import type { NodeType } from '@/store/types'

const NOTE_TRANSFORM_TARGETS: { type: NodeType; label: string; icon: React.ReactNode }[] = [
  { type: 'core',     label: 'Core',     icon: <Brain className="w-4 h-4" /> },
  { type: 'idea',     label: 'Idea',     icon: <Lightbulb className="w-4 h-4 text-yellow-400" /> },
  { type: 'problem',  label: 'Problem',  icon: <TriangleAlert className="w-4 h-4 text-red-400" /> },
  { type: 'question', label: 'Question', icon: <MessageCircleQuestion className="w-4 h-4 text-gray-400" /> },
  { type: 'answer',   label: 'Answer',   icon: <MessageCircle className="w-4 h-4 text-emerald-400" /> },
]

function stopDeletePropagation(e: React.KeyboardEvent) {
  if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation()
}

function NoteNodeFn({ data, selected, dragging }: NodeProps) {
  const d = data as ThonkNodeData
  const { thonk } = d
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textRef = useRef(thonk.title)

  // Focus textarea on auto-edit (newly created note)
  useEffect(() => {
    if (d.autoEdit) {
      const id = setTimeout(() => textareaRef.current?.focus(), 0)
      return () => clearTimeout(id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync from store when title changes externally
  useEffect(() => {
    if (textareaRef.current && textareaRef.current !== document.activeElement) {
      textareaRef.current.value = thonk.title
      textRef.current = thonk.title
      autoResize()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thonk.title])

  // Min content height keeps the note square (128px wide − 16px handle − 10px padding = 102px)
  const MIN_H = 102

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.max(el.scrollHeight, MIN_H) + 'px'
  }

  // Initial resize after mount
  useLayoutEffect(() => {
    autoResize()
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    textRef.current = e.target.value
    autoResize()
  }

  const handleBlur = () => {
    const val = textRef.current
    if (val !== thonk.title) {
      d.onUpdate(thonk.id, { title: val, body: val })
    }
  }

  const handleTransform = (newType: NodeType) => {
    d.onUpdate(thonk.id, { type: newType })
  }

  return (
    <NodeShell nodeType="note" selected={selected} handles={false} className="cursor-default active:cursor-default !rounded-none">
      <NodeToolbar isVisible={selected && !dragging} position={Position.Top} offset={8}>
        <div className="nodrag flex items-center gap-0.5 bg-gray-900 rounded-lg px-1.5 py-1 shadow-xl border border-white/10">
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button className="w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer">
                    <ArrowDownUp className="w-5 h-5" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={10} className="text-sm">Convert to…</TooltipContent>
              <DropdownMenuContent side="top" align="center" sideOffset={10} className="min-w-[120px]" onCloseAutoFocus={e => e.preventDefault()}>
                {NOTE_TRANSFORM_TARGETS.map(({ type, label, icon }) => (
                  <DropdownMenuItem key={type} onClick={() => handleTransform(type)}>
                    {icon}
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </Tooltip>
          <div className="w-px h-4 bg-white/20 mx-0.5 shrink-0" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => d.onDelete(thonk.id)}
                className="nodrag w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={10} className="text-sm">Delete</TooltipContent>
          </Tooltip>
        </div>
      </NodeToolbar>

      {/* Drag handle — the only grabbable area on a note */}
      <div className="h-4 flex items-center justify-center cursor-grab active:cursor-grabbing">
        <div className="w-8 h-0.5 rounded-full bg-yellow-600/30" />
      </div>

      <div className="px-3 pb-2.5">
        <textarea
          ref={textareaRef}
          defaultValue={thonk.title}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={e => {
            stopDeletePropagation(e)
            if (e.key === 'Escape') textareaRef.current?.blur()
          }}
          placeholder="Type a note…"
          className={cn(
            'nodrag w-full bg-transparent outline-none border-none text-sm leading-snug',
            'text-gray-800 placeholder:text-yellow-700/40 resize-none overflow-hidden p-0 m-0',
            'cursor-text',
          )}
        />
      </div>
    </NodeShell>
  )
}

export const NoteNodeComponent = React.memo(
  NoteNodeFn,
  (prev, next) => {
    const pd = prev.data as ThonkNodeData
    const nd = next.data as ThonkNodeData
    return (
      pd.thonk === nd.thonk &&
      pd.autoEdit === nd.autoEdit &&
      pd.onUpdate === nd.onUpdate &&
      pd.onDelete === nd.onDelete &&
      prev.selected === next.selected &&
      prev.dragging === next.dragging
    )
  }
)
