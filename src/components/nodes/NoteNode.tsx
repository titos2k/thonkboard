import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { Trash2, ArrowDownUp, Brain, Lightbulb, TriangleAlert, MessageCircleQuestion, MessageCircle, SpellCheck, Loader2, GripHorizontal, Pencil } from 'lucide-react'
import { NodeShell } from './NodeShell'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ThonkNodeData } from './ThonkNode'
import type { NodeType } from '@/store/types'
import { fixGrammar } from '@/ai/gemini'
import { showToast } from '@/lib/toast'

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
  const [editing, setEditing] = useState(() => !!d.autoEdit)
  const [fixing, setFixing] = useState(false)

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing) {
      const id = setTimeout(() => {
        textareaRef.current?.focus()
        autoResize()
      }, 0)
      return () => clearTimeout(id)
    }
  }, [editing])

  // Keep textRef in sync when store updates externally (while not editing)
  useEffect(() => {
    if (!editing) textRef.current = thonk.title
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thonk.title])

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  // Initial resize on first mount (when autoEdit starts in edit mode)
  useLayoutEffect(() => {
    autoResize()
  }, [])

  const enterEdit = () => {
    textRef.current = thonk.title
    setEditing(true)
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    textRef.current = e.target.value
    autoResize()
  }

  const handleBlur = () => {
    const val = textRef.current
    if (val !== thonk.title) {
      d.onUpdate(thonk.id, { title: val, body: val })
    }
    setEditing(false)
  }

  const handleTransform = (newType: NodeType) => {
    d.onUpdate(thonk.id, { type: newType })
  }

  const handleFixGrammar = async () => {
    const text = textRef.current.trim()
    if (!text) return
    setFixing(true)
    try {
      const { fixed } = await fixGrammar(text)
      if (fixed && fixed !== text) {
        if (textareaRef.current) {
          textareaRef.current.value = fixed
          textRef.current = fixed
          autoResize()
        }
        d.onUpdate(thonk.id, { title: fixed, body: fixed })
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e))
    } finally {
      setFixing(false)
    }
  }

  return (
    <NodeShell nodeType="note" selected={selected} handles={false} className="cursor-default active:cursor-default">
      <NodeToolbar isVisible={selected && !dragging} position={Position.Top} offset={8}>
        <div className="nodrag flex items-center gap-0.5 bg-gray-900 rounded-lg px-1.5 py-1 shadow-xl border border-white/10">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={enterEdit}
                className="w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer"
              >
                <Pencil className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={10} className="text-sm">Edit</TooltipContent>
          </Tooltip>
          <div className="w-px h-4 bg-white/20 mx-0.5 shrink-0" />
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
                onClick={handleFixGrammar}
                disabled={fixing}
                className="nodrag w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
              >
                {fixing ? <Loader2 className="w-5 h-5 animate-spin" /> : <SpellCheck className="w-5 h-5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={10} className="text-sm">Fix Grammar</TooltipContent>
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
        <GripHorizontal className="w-4 h-4" style={{ color: '#ddcba3' }} />
      </div>

      <div className="px-3 pb-2.5 flex items-center justify-center min-h-[102px]">
        {editing ? (
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
              'nodrag w-full bg-transparent outline-none border-none text-sm font-medium leading-snug',
              'text-gray-700 placeholder:text-gray-400 resize-none overflow-hidden p-0 m-0',
              'cursor-text text-center',
            )}
          />
        ) : (
          <p
            onDoubleClick={enterEdit}
            className="w-full text-sm font-medium leading-snug text-gray-700 text-center select-none cursor-default"
          >
            {thonk.title || <span className="text-gray-400">Type a note…</span>}
          </p>
        )}
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
