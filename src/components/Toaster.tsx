import { useState, useEffect } from 'react'

interface ToastItem { id: number; message: string; type: 'error' | 'success' }

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    const handler = (e: Event) => {
      const raw = (e as CustomEvent).detail
      const message: string = typeof raw === 'string' ? raw : raw.message
      const type: 'error' | 'success' = typeof raw === 'string' ? 'error' : (raw.type ?? 'error')
      const id = Date.now()
      setToasts(prev => [...prev, { id, message, type }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), type === 'success' ? 3000 : 10000)
    }
    window.addEventListener('thonk:toast', handler)
    return () => window.removeEventListener('thonk:toast', handler)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-16 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
          className={`text-white text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-xs leading-snug pointer-events-auto cursor-pointer ${t.type === 'success' ? 'bg-gray-800' : 'bg-red-600'}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
