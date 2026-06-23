import React, { useEffect, useRef } from 'react'
import { MessageCirclePlus, TriangleAlert, StickyNote, Search, ZoomIn, ZoomOut, Maximize2, ClipboardPaste } from 'lucide-react'
import { BulbIcon } from '@/components/icons/BulbIcon'
import type { ThonkNode } from '@/store/types'

interface CanvasContextMenuProps {
  x: number
  y: number
  copiedNode: ThonkNode | null
  onClose: () => void
  onAddIdea: () => void
  onAddQuestion: () => void
  onAddProblem: () => void
  onAddNote: () => void
  onPaste: () => void
  onSearch: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
}

export function CanvasContextMenu({
  x, y, copiedNode, onClose,
  onAddIdea, onAddQuestion, onAddProblem, onAddNote,
  onPaste, onSearch, onZoomIn, onZoomOut, onFitView,
}: CanvasContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onMouse, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onMouse, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const menuW = 196
  const menuH = 330
  const left = x + menuW > window.innerWidth  ? x - menuW : x
  const top  = y + menuH > window.innerHeight ? y - menuH : y

  function Item({ icon, label, shortcut, onClick, disabled }: {
    icon: React.ReactNode
    label: string
    shortcut?: string
    onClick: () => void
    disabled?: boolean
  }) {
    return (
      <button
        disabled={disabled}
        onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
        onClick={() => { if (!disabled) { onClick(); onClose() } }}
        className={[
          'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm rounded-sm text-left transition-colors',
          disabled ? 'opacity-35 cursor-not-allowed' : 'hover:bg-accent cursor-pointer',
        ].join(' ')}
      >
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="flex-1">{label}</span>
        {shortcut && <kbd className="text-xs text-muted-foreground/50 font-mono ml-2">{shortcut}</kbd>}
      </button>
    )
  }

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left, top, zIndex: 9999 }}
      className="bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[184px]"
      onContextMenu={e => e.preventDefault()}
    >
      <Item icon={<BulbIcon className="w-3.5 h-3.5" />}          label="Add Idea"     shortcut="I" onClick={onAddIdea} />
      <Item icon={<MessageCirclePlus className="w-3.5 h-3.5" />} label="Add Question" shortcut="Q" onClick={onAddQuestion} />
      <Item icon={<TriangleAlert className="w-3.5 h-3.5" />}     label="Add Problem"  shortcut="P" onClick={onAddProblem} />
      <Item icon={<StickyNote className="w-3.5 h-3.5" />}        label="Add Note"     shortcut="N" onClick={onAddNote} />
      <hr className="my-1 border-border/40" />
      <Item icon={<ClipboardPaste className="w-3.5 h-3.5" />} label="Paste" shortcut="Ctrl+V" onClick={onPaste} disabled={!copiedNode} />
      <hr className="my-1 border-border/40" />
      <Item icon={<Search className="w-3.5 h-3.5" />} label="Search Nodes" shortcut="Ctrl+K" onClick={onSearch} />
      <hr className="my-1 border-border/40" />
      <Item icon={<ZoomIn className="w-3.5 h-3.5" />}   label="Zoom In"  shortcut="+" onClick={onZoomIn} />
      <Item icon={<ZoomOut className="w-3.5 h-3.5" />}  label="Zoom Out" shortcut="−" onClick={onZoomOut} />
      <Item icon={<Maximize2 className="w-3.5 h-3.5" />} label="Fit View" shortcut="0" onClick={onFitView} />
    </div>
  )
}
