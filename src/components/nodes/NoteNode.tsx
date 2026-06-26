import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { Trash2, ArrowDownUp, SpellCheck, GripHorizontal, Pencil } from 'lucide-react'
import { IdeaIcon } from '@/components/icons/IdeaIcon'
import { ProblemIcon } from '@/components/icons/ProblemIcon'
import { QuestionIcon } from '@/components/icons/QuestionIcon'
import { AnswerIcon } from '@/components/icons/AnswerIcon'
import { Spinner } from '@/components/ui/spinner'
import { NodeShell } from './NodeShell'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ThonkNodeData } from './ThonkNode'
import type { NodeType } from '@/store/types'
import { fixGrammar } from '@/ai/gemini'
import { showToast } from '@/lib/toast'

const NOTE_TRANSFORM_TARGETS: { type: NodeType; label: string; dot: React.ReactNode; icon: React.ReactNode }[] = [
  { type: 'idea',     label: 'Idea',     dot: null,                                    icon: <IdeaIcon className="w-4 h-4" /> },
  { type: 'problem',  label: 'Problem',  dot: null,                                    icon: <ProblemIcon className="w-4 h-4" /> },
  { type: 'question', label: 'Question', dot: null,             icon: <QuestionIcon className="w-4 h-4" /> },
  { type: 'answer',   label: 'Answer',   dot: null,                                    icon: <AnswerIcon className="w-4 h-4" /> },
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

  const handlePaste = () => {
    requestAnimationFrame(() => {
      autoResize()
      const el = textareaRef.current
      if (!el) return
      // height is content-driven — no need to store it
    })
  }

  return (
    <NodeShell
      nodeType="note"
      selected={selected}
      handles={false}
      className="cursor-default active:cursor-default"
      resizable={true}
      nodeWidth={thonk.nodeWidth}
      onResized={(w) => d.onUpdate(thonk.id, { nodeWidth: w })}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); d.onContextMenuSelect(thonk.id) }}
      minWidth={80}
      minHeight={40}
    >
      <NodeToolbar isVisible={selected && !d.isMultiSelected && !dragging} position={Position.Top} offset={8}>
        <div className="nodrag flex items-center gap-0.5 rounded-lg px-1.5 py-1 shadow-xl" style={{ backgroundColor: 'var(--toolbar-bg)', border: '1px solid var(--toolbar-border)' }}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={enterEdit} className="toolbar-btn">
                <Pencil className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={10} className="text-sm">Edit</TooltipContent>
          </Tooltip>
          <div className="toolbar-sep" />
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button className="toolbar-btn">
                    <ArrowDownUp className="w-5 h-5" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={10} className="text-sm">Convert to…</TooltipContent>
              <DropdownMenuContent side="top" align="center" sideOffset={10} className="min-w-[120px]" onCloseAutoFocus={e => e.preventDefault()}>
                {NOTE_TRANSFORM_TARGETS.map(({ type, label, dot, icon }) => (
                  <DropdownMenuItem key={type} onClick={() => handleTransform(type)}>
                    <span className="flex items-center gap-2">{dot}{icon}</span>
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </Tooltip>
          <div className="toolbar-sep" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={handleFixGrammar} disabled={fixing} className="nodrag toolbar-btn">
                {fixing ? <Spinner className="w-5 h-5 opacity-60" /> : <SpellCheck className="w-5 h-5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={10} className="text-sm">Fix Grammar</TooltipContent>
          </Tooltip>
          <div className="toolbar-sep" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => d.onDelete(thonk.id)} className="nodrag toolbar-btn">
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
            onPaste={handlePaste}
            onKeyDown={e => {
              stopDeletePropagation(e)
              if (e.key === 'Escape') textareaRef.current?.blur()
            }}
            placeholder="Type a note…"
            className={cn(
              'nodrag w-full bg-transparent outline-none border-none text-sm font-medium leading-snug',
              'text-gray-700 placeholder:text-current placeholder:opacity-40 resize-none overflow-hidden p-0 m-0',
              'cursor-text text-center break-words',
            )}
          />
        ) : (
          <p
            onDoubleClick={enterEdit}
            className="w-full text-sm font-medium leading-snug text-gray-700 text-center select-none cursor-default break-words"
          >
            {thonk.title || <span className="opacity-40">Type a note…</span>}
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
      pd.isMultiSelected === nd.isMultiSelected &&
      prev.selected === next.selected &&
      prev.dragging === next.dragging
    )
  }
)
