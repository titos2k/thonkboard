import { Dialog, DialogContent } from './ui/dialog'
import { Button } from './ui/button'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { ExampleDef } from '@/examples'

interface WelcomeModalProps {
  open: boolean
  onConnectAI: () => void
  onSkip: () => void
  onSeeExample?: () => void
  templates?: ExampleDef[]
  onLoadTemplate?: (raw: string, name: string) => void
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
            className="absolute top-1/2 -translate-y-1/2 -left-[156px] h-[410px] w-auto pointer-events-none select-none"
          />
        )}

        <div className={`flex flex-col gap-5 p-8${!isMobile ? ' pl-[200px]' : ''}`}>
          <div>
            <p className="text-2xl font-semibold leading-none tracking-tight mb-4 pb-2">Welcome to ThonkBoard!</p>
            <p className="text-sm text-muted-foreground">
              A spatial canvas for thinking, with AI that questions and expands your ideas - not replaces them.
            </p>
          </div>

          <ul className="space-y-2 text-sm">
            <li className="flex gap-2">
              <span className="text-primary">✦</span>
              <span>Add a <strong>Core</strong> idea, then grow it with Ideas, Problems, and Questions</span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary">✦</span>
              <span>AI asks hard questions and proposes angles - you decide what sticks</span>
            </li>
            <li className="flex gap-2 mb-1">
              <span className="text-primary">✦</span>
              <span><strong>100% local</strong> - your data never leaves your browser</span>
            </li>
          </ul>

          <div className="flex flex-col gap-2">
            <Button size="sm" onClick={onConnectAI} className="w-full h-9 text-sm cursor-pointer">
              Connect AI to get started
            </Button>
            {onSeeExample && (
              <Button size="sm" variant="outline" onClick={onSeeExample} className="w-full h-9 text-sm cursor-pointer">
                See example project
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onSkip} className="w-full h-9 text-sm cursor-pointer">
              Start blank
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
