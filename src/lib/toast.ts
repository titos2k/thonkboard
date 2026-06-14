export function showToast(message: string, type: 'error' | 'success' = 'error') {
  window.dispatchEvent(new CustomEvent('thonk:toast', { detail: { message, type } }))
}
