export interface ToastAction { label: string; onClick: () => void }

export function showToast(message: string, type: 'error' | 'success' = 'error', action?: ToastAction) {
  window.dispatchEvent(new CustomEvent('thonk:toast', { detail: { message, type, action } }))
}
