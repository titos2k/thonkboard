import type { EmojiClickEvent } from 'emoji-picker-element/shared'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'emoji-picker': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        class?: string
      }
    }
  }
}

export {}
