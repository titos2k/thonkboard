import React, { useEffect, useRef } from 'react'
import { StickyNote, Search, ZoomIn, ZoomOut, Maximize2, ClipboardPaste } from 'lucide-react'
import { IdeaIcon } from '@/components/icons/IdeaIcon'
import { QuestionIcon } from '@/components/icons/QuestionIcon'
import { ProblemIcon } from '@/components/icons/ProblemIcon'
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

  function Item({ icon, label, shortcut, onClick, disabled, iconSpanClass }: {
    icon: React.ReactNode
    label: string
    shortcut?: string
    onClick: () => void
    disabled?: boolean
    iconSpanClass?: string
  }) {
    return (
      <button
        disabled={disabled}
        onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
        onClick={() => { if (!disabled) { onClick(); onClose() } }}
        className={[
          'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm text-left transition-colors text-[var(--menu-text)]',
          disabled ? 'opacity-35 cursor-default' : 'hover:bg-[var(--menu-item-hover)] cursor-pointer',
        ].join(' ')}
      >
        <span className={iconSpanClass ?? 'shrink-0 opacity-60'}>{icon}</span>
        <span className="flex-1">{label}</span>
        {shortcut && <kbd className="text-xs text-muted-foreground/50 font-mono ml-2">{shortcut}</kbd>}
      </button>
    )
  }

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left, top, zIndex: 9999 }}
      className="bg-[var(--menu-bg)] border border-[var(--menu-border)] text-[var(--menu-text)] rounded-lg shadow-xl p-1 min-w-[184px]"
      onContextMenu={e => e.preventDefault()}
    >
      <Item icon={<IdeaIcon className="w-4 h-4" />}     label="Add Idea"     shortcut="I" onClick={onAddIdea}     iconSpanClass="shrink-0" />
      <Item icon={<QuestionIcon className="w-4 h-4" />} label="Add Question" shortcut="Q" onClick={onAddQuestion} iconSpanClass="shrink-0" />
      <Item icon={<ProblemIcon className="w-4 h-4" />}  label="Add Problem"  shortcut="P" onClick={onAddProblem}  iconSpanClass="shrink-0" />
      <Item icon={<StickyNote className="w-4 h-4" />}        label="Add Note"     shortcut="N" onClick={onAddNote} />
      <hr className="-mx-1 my-1 border-[var(--menu-border)]/40" />
      <Item icon={<ClipboardPaste className="w-4 h-4" />} label="Paste" shortcut="Ctrl+V" onClick={onPaste} disabled={!copiedNode} />
      <hr className="-mx-1 my-1 border-[var(--menu-border)]/40" />
      <Item icon={<Search className="w-4 h-4" />} label="Search Nodes" shortcut="Ctrl+K" onClick={onSearch} />
      <hr className="-mx-1 my-1 border-[var(--menu-border)]/40" />
      <Item icon={<ZoomIn className="w-4 h-4" />}   label="Zoom In"  shortcut="+" onClick={onZoomIn} />
      <Item icon={<ZoomOut className="w-4 h-4" />}  label="Zoom Out" shortcut="−" onClick={onZoomOut} />
      <Item icon={<Maximize2 className="w-4 h-4" />} label="Fit View" shortcut="0" onClick={onFitView} />
    </div>
  )
}
