import { useState, useEffect } from 'react'

interface ToastItem { id: number; message: string }

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    const handler = (e: Event) => {
      const message = (e as CustomEvent<string>).detail
      const id = Date.now()
      setToasts(prev => [...prev, { id, message }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
    }
    window.addEventListener('thonk:toast', handler)
    return () => window.removeEventListener('thonk:toast', handler)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-16 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="bg-red-600 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-xs leading-snug">
          {t.message}
        </div>
      ))}
    </div>
  )
}
