import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  anchorRect: DOMRect
  onSelect: (emoji: string) => void
  onClose: () => void
  onClear?: () => void
}

export function EmojiPickerPopover({ anchorRect, onSelect, onClose, onClear }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    import('emoji-picker-element').then(() => setReady(true))
  }, [])

  const isDark = document.documentElement.classList.contains('dark')
  const GAP = 6
  const PICKER_H = 300 + (onClear ? 36 : 0)
  const PICKER_W = 280
  const spaceBelow = window.innerHeight - anchorRect.bottom
  const top = spaceBelow >= PICKER_H + GAP
    ? anchorRect.bottom + GAP
    : anchorRect.top - PICKER_H - GAP
  const left = Math.min(anchorRect.left, window.innerWidth - PICKER_W - 8)

  useEffect(() => {
    if (!ready) return
    const picker = containerRef.current?.querySelector('emoji-picker')
    if (!picker) return
    const handlePick = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.unicode) { onSelect(detail.unicode); onClose() }
    }
    picker.addEventListener('emoji-click', handlePick)
    const search = picker.shadowRoot?.querySelector<HTMLInputElement>('input[type="search"]')
    search?.focus()
    return () => picker.removeEventListener('emoji-click', handlePick)
  }, [ready, onSelect, onClose])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const handlePointer = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('pointerdown', handlePointer)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('pointerdown', handlePointer)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={containerRef}
      className="nodrag"
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 99999,
        filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.18))',
        borderRadius: 12,
        overflow: 'hidden',
        padding: 6,
        background: isDark ? '#1e2130' : '#fff',
      }}
    >
      {ready && (
        // @ts-expect-error custom element
        <emoji-picker
          class={isDark ? 'dark' : 'light'}
          style={{
            width: PICKER_W,
            height: 300,
            '--num-columns': 7,
            '--emoji-size': '24px',
            '--emoji-padding': '4px',
            '--border-size': '0px',
            '--background': 'transparent',
            '--input-border-radius': '8px',
          } as React.CSSProperties}
        />
      )}
      {ready && onClear && (
        <button
          onClick={() => { onClear(); onClose() }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: 36,
            background: isDark ? '#1e2130' : '#fff',
            border: 'none',
            borderTop: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
            borderRadius: '0 0 8px 8px',
            fontSize: 13,
            color: isDark ? '#9ca3af' : '#6b7280',
            cursor: 'pointer',
            gap: 6,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = isDark ? '#2d3348' : '#f9fafb'
            e.currentTarget.style.color = isDark ? '#f3f4f6' : '#111'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = isDark ? '#1e2130' : '#fff'
            e.currentTarget.style.color = isDark ? '#9ca3af' : '#6b7280'
          }}
        >
          <span style={{ fontSize: 15 }}>✕</span>
          Remove icon
        </button>
      )}
    </div>,
    document.body,
  )
}
