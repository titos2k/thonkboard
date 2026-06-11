import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ConflictOption } from '@/ai/gemini'

interface MergeConflictModalProps {
  open: boolean
  options: [ConflictOption, ConflictOption]
  onChoose: (body: string) => void
  onCancel: () => void
}

export function MergeConflictModal({ open, options, onChoose, onCancel }: MergeConflictModalProps) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onCancel()}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="pb-2">
          <DialogTitle>Conflict detected!</DialogTitle>
          <DialogDescription className="text-sm">Choose which direction to take, or cancel to leave things unchanged.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {options.map((opt, i) => (
            <Button
              key={i}
              variant="outline"
              className="h-auto py-4 px-5 flex flex-col items-start gap-1 whitespace-normal text-left cursor-pointer"
              onClick={() => onChoose(opt.body)}
            >
              <span className="text-xs font-semibold uppercase tracking-wide opacity-60">{i === 0 ? 'Option A' : 'Option B'}</span>
              <span className="text-sm font-medium leading-snug">{opt.summary}</span>
            </Button>
          ))}
        </div>

        <Button variant="outline" className="w-full cursor-pointer mt-1" onClick={onCancel}>
          Don't apply yet
        </Button>
      </DialogContent>
    </Dialog>
  )
}
