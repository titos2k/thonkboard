import { MoveRight } from 'lucide-react'
import { Dialog, DialogContent } from './ui/dialog'
import { Button } from './ui/button'
import { useIsMobile } from '@/hooks/useIsMobile'

interface WelcomeModalProps {
  open: boolean
  onConnectAI: () => void
  onSkip: () => void
  onSeeExample?: () => void
}

export function WelcomeModal({ open, onConnectAI, onSkip, onSeeExample }: WelcomeModalProps) {
  const isMobile = useIsMobile()
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onSkip() }}>
      <DialogContent
        className="max-w-[580px] p-0"
        onInteractOutside={e => e.preventDefault()}
      >
        {!isMobile && (
          <img
            src="/thonk-wizard-welcome.png"
            alt=""
            aria-hidden="true"
            className="absolute bottom-[4px] -left-[156px] h-[410px] w-auto pointer-events-none select-none"
          />
        )}

        <div className={`flex flex-col gap-5 p-6${!isMobile ? ' pl-[200px]' : ''}`}>
          <div>
            <p className="text-2xl font-semibold tracking-tight mb-3">Welcome to ThonkBoard!</p>
            <p className="text-sm text-muted-foreground leading-snug">
              A spatial canvas for thinking, with AI that questions and expands your ideas - not replaces them.
            </p>
          </div>

          <ul className="space-y-2 text-sm">
            <li className="flex gap-2">
              <span className="text-muted-foreground mt-0.5">✦</span>
              <span>Add a <strong>Core</strong> idea, then grow it with Ideas, Problems, and Questions</span>
            </li>
            <li className="flex gap-2">
              <span className="text-muted-foreground mt-0.5">✦</span>
              <span>AI asks hard questions and proposes angles - you decide what sticks</span>
            </li>
            <li className="flex gap-2">
              <span className="text-muted-foreground mt-0.5">✦</span>
              <span><strong>100% local</strong> - your data never leaves your browser</span>
            </li>
          </ul>

          <div className="flex flex-col gap-2">
            <Button size="sm" onClick={onConnectAI} className="w-full h-9 text-sm cursor-pointer">
              Connect AI to get started
            </Button>
            <Button size="sm" variant="ghost" onClick={onSkip} className="w-full h-9 text-sm text-muted-foreground cursor-pointer gap-2">
              Try without AI <MoveRight className="w-4 h-4" />
            </Button>
            {onSeeExample && (
              <Button size="sm" variant="ghost" onClick={onSeeExample} className="w-full h-9 text-sm text-muted-foreground cursor-pointer gap-2">
                See example board <MoveRight className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
