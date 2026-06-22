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

export function WelcomeModal({ open, onConnectAI, onSkip, templates, onLoadTemplate }: WelcomeModalProps) {
  const isMobile = useIsMobile()
  const visibleTemplates = templates?.filter(t => t.id !== 'thonkboard').slice(0, 4) ?? []
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

          {visibleTemplates.length > 0 && onLoadTemplate && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Start from a template</p>
              <div className="grid grid-cols-2 gap-1.5">
                {visibleTemplates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => onLoadTemplate(t.raw, t.name)}
                    className="text-left px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted hover:border-foreground/20 transition-colors"
                  >
                    <div className="text-sm font-medium leading-snug">{t.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-1">{t.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button size="sm" onClick={onConnectAI} className="w-full h-9 text-sm cursor-pointer">
              Connect AI to get started
            </Button>
            <Button size="sm" variant="outline" onClick={onSkip} className="w-full h-9 text-sm cursor-pointer">
              Start blank
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
