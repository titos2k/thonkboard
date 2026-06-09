import { useState } from 'react'
import { Astroid, HelpCircle, Trash2, Map, Brain, Lightbulb, TriangleAlert, MessageCircleQuestion } from 'lucide-react'
import thonkLogo from '@/assets/thonk.webp'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from './ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { getApiKey, setApiKey, getHighIQ, setHighIQ } from '@/ai/gemini'

interface TopBarProps {
  onAddCore: () => void
  onAddIdea: () => void
  onAddProblem: () => void
  onAddQuestion: () => void
  hideResolved: boolean
  onToggleHideResolved: () => void
  onReset: () => void
  showLegend: boolean
  onToggleLegend: () => void
}

export function TopBar({ onAddCore, onAddIdea, onAddProblem, onAddQuestion, hideResolved, onToggleHideResolved, onReset, showLegend, onToggleLegend }: TopBarProps) {
  const [resetOpen, setResetOpen] = useState(false)
  const [keyOpen, setKeyOpen] = useState(() => !getApiKey())
  const [key, setKey] = useState(getApiKey)
  const [saved, setSaved] = useState(false)
  const [highIQ, setHighIQState] = useState(getHighIQ)

  const toggleHighIQ = () => {
    const next = !highIQ
    setHighIQ(next)
    setHighIQState(next)
  }

  const handleSave = () => {
    setApiKey(key)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-4 py-2 bg-white border-b border-border shadow-sm">
      <img src={thonkLogo} alt="Thonk" className="h-7 w-auto mr-1" />

      <div className="flex items-center gap-1">
        <Button size="sm" onClick={onAddCore} className="h-9 text-sm gap-2 bg-[#392946] hover:bg-[#2a1d37] text-white border-0 cursor-pointer">
          <Brain className="w-5 h-5" /> Core
        </Button>
        <Button size="sm" onClick={onAddIdea} className="h-9 text-sm gap-2 bg-[#f5c44a] hover:bg-[#e6b33b] text-gray-900 border-0 cursor-pointer">
          <Lightbulb className="w-5 h-5" /> Idea
        </Button>
        <Button size="sm" onClick={onAddProblem} className="h-9 text-sm gap-2 bg-[#e95a32] hover:bg-[#d44a23] text-white border-0 cursor-pointer">
          <TriangleAlert className="w-5 h-5" /> Problem
        </Button>
        <Button size="sm" onClick={onAddQuestion} className="h-9 text-sm gap-2 bg-[#f4f6f6] hover:bg-[#e4e6e6] text-gray-900 border border-black/10 cursor-pointer">
          <MessageCircleQuestion className="w-5 h-5" /> Question
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggleHideResolved}
              className="flex items-center gap-2 h-9 px-2 rounded-md hover:bg-black/5 transition-colors"
            >
              <span className="text-sm font-medium text-muted-foreground select-none">Hide resolved</span>
              <div className={`relative w-8 h-4 rounded-full transition-colors ${hideResolved ? 'bg-gray-700' : 'bg-gray-300'}`}>
                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${hideResolved ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {hideResolved ? 'Showing only active nodes' : 'Toggle to hide approved Q&A pairs'}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleHighIQ}
              className="flex items-center gap-2 h-9 px-2 rounded-md hover:bg-black/5 transition-colors"
            >
              <span className="text-sm font-medium text-muted-foreground select-none">Turbo Thonking</span>
              <div className={`relative w-8 h-4 rounded-full transition-colors ${highIQ ? 'bg-violet-600' : 'bg-gray-300'}`}>
                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${highIQ ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[200px] text-center">
            {highIQ
              ? 'Using gemini-3.5-flash — smarter, slower, costs more'
              : 'Using gemini-3.1-flash-lite — fast and cheap. Enable for deeper reasoning.'}
          </TooltipContent>
        </Tooltip>

        <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost" className="h-9 text-sm gap-2">
              <Astroid className="w-5 h-5" />
              {getApiKey() ? 'API Key ✓' : 'Set API Key'}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="pb-2">Gemini API Key</DialogTitle>
              <DialogDescription>
                For THONK to think, it needs a Gemini API key. It's free, takes 30 seconds to get, and never leaves your browser.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={e => { e.preventDefault(); handleSave() }} className="flex gap-2">
              <Input
                type="password"
                placeholder="Paste your API key…"
                autoComplete="off"
                value={key}
                onChange={e => setKey(e.target.value)}
                className="text-sm"
              />
              <Button type="submit" size="sm" className="shrink-0 h-9 text-sm cursor-pointer">
                {saved ? 'Saved!' : 'Save'}
              </Button>
            </form>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline hover:opacity-70 transition-opacity"
            >
              Get a free API key from Google AI Studio →
            </a>
          </DialogContent>
        </Dialog>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm" variant="ghost"
              className={`h-9 w-9 p-0 ${showLegend ? 'text-primary' : 'text-muted-foreground'}`}
              onClick={onToggleLegend}
            >
              <Map className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{showLegend ? 'Hide legend' : 'Show legend'}</TooltipContent>
        </Tooltip>

        <Dialog open={resetOpen} onOpenChange={setResetOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive">
              <Trash2 className="w-5 h-5" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Reset board?</DialogTitle>
              <DialogDescription>
                This will delete all nodes and edges. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="outline" size="sm" onClick={() => setResetOpen(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={() => { onReset(); setResetOpen(false) }}>Reset</Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0">
              <HelpCircle className="w-5 h-5" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>How to use THONK</DialogTitle>
            </DialogHeader>
            <div className="text-sm text-muted-foreground space-y-2">
              <p><strong>Click a node</strong> to select it and reveal its actions.</p>
              <p><strong>Argue</strong> — AI critique pass. Finds real problems with severity scoring.</p>
              <p><strong>Question</strong> — Generates one sharp question. Answer it to refine your idea.</p>
              <p><strong>Expand</strong> — Generates child ideas that build on the target.</p>
              <p><strong>Ideate</strong> — Generates sibling ideas in the same domain.</p>
              <p><strong>Approve</strong> — On an Answer node: merges it back into the Core as a new version.</p>
              <p className="pt-1"><strong>Drag</strong> to move nodes. <strong>Scroll</strong> to zoom. <strong>Drag background</strong> to pan.</p>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
