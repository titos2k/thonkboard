import { useRef, useState } from 'react'
import { Astroid, HelpCircle, Map, Brain, Lightbulb, TriangleAlert, MessageCircleQuestion, ChevronDown, Plus, Menu, FilePlus, Save, FolderOpen, Sparkles } from 'lucide-react'
import thonkLogo from '@/assets/thonk.webp'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from './ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from './ui/dropdown-menu'
import { getApiKey, setApiKey, getHighIQ, setHighIQ } from '@/ai/gemini'
import { SummarizeModal, type SummarizeCache } from './SummarizeModal'
import type { ThonkGraph } from '@/store/types'

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
  onExport: () => void
  onImport: (file: File) => void
  graph: ThonkGraph
}

export function TopBar({ onAddCore, onAddIdea, onAddProblem, onAddQuestion, hideResolved, onToggleHideResolved, onReset, showLegend, onToggleLegend, onExport, onImport, graph }: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [keyOpen, setKeyOpen] = useState(() => !getApiKey())
  const [key, setKey] = useState(getApiKey)
  const [saved, setSaved] = useState(false)
  const [highIQ, setHighIQState] = useState(getHighIQ)
  const [summarizeOpen, setSummarizeOpen] = useState(false)
  const summarizeCache = useRef<SummarizeCache | null>(null)

  const hasContent = graph.nodes.some(n => n.type === 'core' || n.type === 'idea')

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
    <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-4 py-2 bg-white border-b border-border" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <img src={thonkLogo} alt="Thonk" className="h-7 w-auto mr-1" />

      {/* Hamburger menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-9 w-9 p-0 cursor-pointer">
            <Menu className="w-5 h-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={e => e.preventDefault()}>
          <DropdownMenuItem onClick={() => setResetOpen(true)}>
            <FilePlus className="w-4 h-4 text-muted-foreground" /> New board
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onExport}>
            <Save className="w-4 h-4 text-muted-foreground" /> Save board
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
            <FolderOpen className="w-4 h-4 text-muted-foreground" /> Load board
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!hasContent} onClick={() => setSummarizeOpen(true)}>
            <Sparkles className="w-4 h-4 text-muted-foreground" /> Summarize
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInputRef}
        type="file" accept=".json" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '' }}
      />

      {/* Add Node dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-9 text-sm gap-1.5 cursor-pointer bg-white">
            <Plus className="w-4 h-4" /> Add Node <ChevronDown className="w-4 h-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={e => e.preventDefault()}>
          <DropdownMenuItem onClick={onAddCore}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-[#392946]" />
            <Brain className="w-4 h-4 text-muted-foreground" /> Core
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddIdea}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-[#f5c44a]" />
            <Lightbulb className="w-4 h-4 text-muted-foreground" /> Idea
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddProblem}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-[#e95a32]" />
            <TriangleAlert className="w-4 h-4 text-muted-foreground" /> Problem
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddQuestion}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-[#e2e4e4] border border-black/10" />
            <MessageCircleQuestion className="w-4 h-4 text-muted-foreground" /> Question
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        size="sm" variant="outline"
        className="h-9 text-sm gap-1.5 cursor-pointer bg-white"
        disabled={!hasContent}
        onClick={() => setSummarizeOpen(true)}
      >
        <Sparkles className="w-4 h-4" /> Summarize
      </Button>

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
              <div className={`relative w-8 h-4 rounded-full transition-colors ${highIQ ? 'bg-gray-700' : 'bg-gray-300'}`}>
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
            <Button
              size="sm" variant="ghost"
              className={`h-9 text-sm gap-2 ${!getApiKey() ? 'text-red-500 hover:text-red-600' : ''}`}
            >
              <Astroid className="w-5 h-5" />
              {getApiKey() ? 'API Key ✓' : 'Set API Key'}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="pb-2">Gemini API Key</DialogTitle>
              <DialogDescription>
                For THONK to think, it needs a Gemini API key. It's free and takes 30 seconds to get. Your key is stored only in your browser. We never see it or send it anywhere.
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
              <Button type="submit" size="sm" disabled={!key.trim()} className="shrink-0 h-9 text-sm cursor-pointer">
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
              className={`h-9 w-9 p-0 ${showLegend ? '' : 'text-gray-400'}`}
              onClick={onToggleLegend}
            >
              <Map className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{showLegend ? 'Hide legend' : 'Show legend'}</TooltipContent>
        </Tooltip>

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

      <SummarizeModal
        open={summarizeOpen}
        onClose={() => setSummarizeOpen(false)}
        graph={graph}
        cache={summarizeCache}
      />

      {/* New board confirm dialog — controlled via resetOpen state */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="pb-2">Reset board?</DialogTitle>
            <DialogDescription>
              This will delete all nodes and edges. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" className="h-9 text-sm cursor-pointer" onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button variant="destructive" className="h-9 text-sm cursor-pointer" onClick={() => { onReset(); setResetOpen(false) }}>Reset</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
