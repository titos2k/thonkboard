export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent('thonk:toast', { detail: message }))
}
