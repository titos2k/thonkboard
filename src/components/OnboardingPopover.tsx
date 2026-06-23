import { useState, useEffect } from 'react'
import { X, Star } from 'lucide-react'

const STORAGE_KEY = 'thonk.onboarding-tip-dismissed'

function isDismissed() {
  return !!localStorage.getItem(STORAGE_KEY)
}

function dismiss() {
  localStorage.setItem(STORAGE_KEY, '1')
}

export function OnboardingPopover() {
  const [visible, setVisible] = useState(!isDismissed())

  useEffect(() => {
    const handler = () => {
      dismiss()
      setVisible(false)
    }
    window.addEventListener('thonk:hamburger-open', handler)
    return () => window.removeEventListener('thonk:hamburger-open', handler)
  }, [])

  if (!visible) return null

  const handleClose = () => {
    dismiss()
    setVisible(false)
  }

  return (
    <div
      className="fixed z-[9000] flex items-start gap-4 bg-popover border border-border rounded-xl shadow-xl p-4 pr-8 max-w-[310px]"
      style={{ top: 58, left: 8 }}
    >
      {/* Arrow pointing up toward hamburger */}
      <div
        className="absolute -top-[7px] w-3 h-3 rotate-45 bg-popover border-l border-t border-border"
        style={{ left: 60 }}
      />

      <button
        onClick={handleClose}
        className="absolute top-2.5 right-2.5 w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <Star className="w-6 h-6 text-primary shrink-0 mt-0.5" />

      <div>
        <p className="text-base font-semibold leading-snug mb-1.5">Start with a template</p>
        <p className="text-sm text-muted-foreground leading-snug">
          Pick one from the <strong>Examples</strong> menu to see how a real board develops.
        </p>
      </div>
    </div>
  )
}
