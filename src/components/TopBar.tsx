import { useRef, useState } from 'react'
import { Astroid, HelpCircle, Map, Brain, Lightbulb, TriangleAlert, MessageCircleQuestion, ChevronDown, Plus, Menu, Save, FolderOpen, Sparkles, Zap, EyeOff, StickyNote, Check, Pencil, Trash2, Coffee, ImageDown, Scale } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from './ui/dropdown-menu'
import { getApiKey, setApiKey, getHighIQ, setHighIQ } from '@/ai/gemini'
import { SummarizeModal, type SummarizeCache } from './SummarizeModal'
import type { ThonkGraph, BoardMeta } from '@/store/types'
import { useIsMobile } from '@/hooks/useIsMobile'

interface TopBarProps {
  onAddCore: () => void
  onAddIdea: () => void
  onAddProblem: () => void
  onAddQuestion: () => void
  onAddNote: () => void
  hideResolved: boolean
  onToggleHideResolved: () => void
  showLegend: boolean
  onToggleLegend: () => void
  onExport: () => void
  onExportPng: () => void
  onImport: (file: File) => void
  graph: ThonkGraph
  boards: BoardMeta[]
  activeBoardId: string
  onSwitchBoard: (id: string) => void
  onCreateBoard: () => void
  onDeleteBoard: (id: string) => void
  onRenameBoard: (id: string, name: string) => void
}

function MiniToggle({ on }: { on: boolean }) {
  return (
    <div className={`relative w-7 h-3.5 rounded-full ml-2 shrink-0 transition-colors ${on ? 'bg-gray-700' : 'bg-gray-300'}`}>
      <div className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </div>
  )
}

export function TopBar({ onAddCore, onAddIdea, onAddProblem, onAddQuestion, onAddNote, hideResolved, onToggleHideResolved, showLegend, onToggleLegend, onExport, onExportPng, onImport, graph, boards, activeBoardId, onSwitchBoard, onCreateBoard, onDeleteBoard, onRenameBoard }: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [keyOpen, setKeyOpen] = useState(() => !getApiKey())
  const [key, setKey] = useState(getApiKey)
  const [saved, setSaved] = useState(false)
  const [highIQ, setHighIQState] = useState(getHighIQ)
  const [summarizeOpen, setSummarizeOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const summarizeCache = useRef<SummarizeCache | null>(null)
  const isMobile = useIsMobile()
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [legalOpen, setLegalOpen] = useState(false)

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
      <img src="/thonkboard-logo.svg" alt="Thonk" className="h-7 w-auto mr-1" />

      {/* Hamburger menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-9 w-9 p-0 cursor-pointer">
            <Menu className="w-5 h-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={e => e.preventDefault()}>
          {/* Boards section */}
          <div className="flex items-center justify-between pl-2 pr-1 py-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Boards</span>
            <button
              onClick={e => { e.stopPropagation(); onCreateBoard() }}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/10 transition-colors"
              title="New board"
            >
              <Plus className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          {boards.map(board => {
            const isActive = board.id === activeBoardId
            return (
              <DropdownMenuItem
                key={board.id}
                onClick={() => onSwitchBoard(board.id)}
                className="flex items-center justify-between gap-1 pr-1"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {isActive
                    ? <Check className="w-4 h-4 shrink-0 text-foreground" />
                    : <span className="w-4 shrink-0" />}
                  <span className="truncate max-w-[140px]">{board.name}</span>
                </span>
                <span className="flex items-center gap-0.5 shrink-0">
                  {isActive && (
                    <button
                      onClick={e => { e.stopPropagation(); setRenameName(board.name); setRenameOpen(true) }}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/10 transition-colors"
                      title="Rename"
                    >
                      <Pencil className="w-4 h-4 text-muted-foreground" />
                    </button>
                  )}
                  {boards.length > 1 && (
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteConfirmId(board.id) }}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-100 transition-colors"
                      title="Delete board"
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                    </button>
                  )}
                </span>
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onExport}>
            <Save className="w-4 h-4 text-muted-foreground" /> Save board
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
            <FolderOpen className="w-4 h-4 text-muted-foreground" /> Load board
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExportPng}>
            <ImageDown className="w-4 h-4 text-muted-foreground" /> Export as PNG
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!hasContent} onClick={() => setSummarizeOpen(true)}>
            <Sparkles className="w-4 h-4 text-muted-foreground" /> Summarize
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href="https://buymeacoffee.com/titos2k" target="_blank" rel="noopener noreferrer">
              <Coffee className="w-4 h-4 text-muted-foreground" /> Buy me a coffee
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLegalOpen(true)}>
            <Scale className="w-4 h-4 text-muted-foreground" /> Privacy & Terms
          </DropdownMenuItem>

          {isMobile && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleHighIQ} className="justify-between">
                <span className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-muted-foreground" /> Turbo Thonking
                </span>
                <MiniToggle on={highIQ} />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleHideResolved} className="justify-between">
                <span className="flex items-center gap-2">
                  <EyeOff className="w-4 h-4 text-muted-foreground" /> Hide resolved
                </span>
                <MiniToggle on={hideResolved} />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setKeyOpen(true)}>
                <Astroid className="w-4 h-4 text-muted-foreground" />
                {getApiKey() ? 'API Key ✓' : 'Set API Key'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setHelpOpen(true)}>
                <HelpCircle className="w-4 h-4 text-muted-foreground" /> Help
              </DropdownMenuItem>
            </>
          )}
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

      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="outline" className="h-9 w-9 p-0 cursor-pointer bg-white" onClick={onAddNote}>
            <StickyNote className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Add Note</TooltipContent>
      </Tooltip>

      {!isMobile && (
        <Button
          size="sm" variant="outline"
          className="h-9 text-sm gap-1.5 cursor-pointer bg-white"
          disabled={!hasContent}
          onClick={() => setSummarizeOpen(true)}
        >
          <Sparkles className="w-4 h-4" /> Summarize
        </Button>
      )}

      {/* Right-side controls — hidden on mobile */}
      <div className={`ml-auto items-center gap-2 ${isMobile ? 'hidden' : 'flex'}`}>
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

        <Button
          size="sm" variant="ghost"
          className={`h-9 text-sm gap-2 ${!getApiKey() ? 'text-red-500 hover:text-red-600' : ''}`}
          onClick={() => setKeyOpen(true)}
        >
          <Astroid className="w-5 h-5" />
          {getApiKey() ? 'API Key ✓' : 'Set API Key'}
        </Button>

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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0 bg-[#F5C44A] hover:bg-[#e8b73e] text-[#664500]" asChild>
              <a href="https://buymeacoffee.com/titos2k" target="_blank" rel="noopener noreferrer">
                <Coffee className="w-5 h-5" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Buy me a coffee</TooltipContent>
        </Tooltip>

        <Button size="sm" variant="ghost" className="h-9 w-9 p-0" onClick={() => setHelpOpen(true)}>
          <HelpCircle className="w-5 h-5" />
        </Button>
      </div>

      {/* API Key dialog (controlled) */}
      <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="pb-2">Gemini API Key</DialogTitle>
            <DialogDescription>
              For ThonkBoard to think, it needs a Gemini API key. It's free and takes 30 seconds to get. Your key is stored only in your browser. We never see it or send it anywhere.
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

      {/* Help dialog (controlled) */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md sm:max-w-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>How to use ThonkBoard</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            <p>ThonkBoard is a thinking canvas. Its job is to help <strong>you</strong> think - not to think for you. Use AI to pressure-test your ideas, not to replace your reasoning.</p>

            <div>
              <p className="font-semibold text-foreground mb-1">No backend, fully private</p>
              <p>ThonkBoard has no server. Nothing you type is stored anywhere outside your browser - no account, no sync, no telemetry. The flip side: if you clear your browser data, your boards are gone. Save boards to files regularly using the export button. Old-school, but yours.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">Canvas</p>
              <p>Click a node to select it and reveal its toolbar. Drag nodes to move them, scroll to zoom. Pan by dragging the background with the left button, or use middle-click or right-click drag.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">Node types</p>
              <p><strong>Core</strong> - your main idea, topic, or thesis. Start here.</p>
              <p><strong>Idea</strong> - a branch, variant, or proposal.</p>
              <p><strong>Problem</strong> - a flaw, risk, or blocker worth tracking.</p>
              <p><strong>Question / Answer</strong> - open threads and their resolutions.</p>
              <p><strong>Note</strong> - freeform sticky. No structure required.</p>
              <p className="mt-1 opacity-70">Any node can be converted to another type from its toolbar.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">AI actions</p>
              <p><strong>Find Problems</strong> - AI critiques the node and spawns Problem nodes for real issues it finds.</p>
              <p><strong>Ask me</strong> - generates one sharp question. Answer it yourself to push your thinking forward.</p>
              <p><strong>Answer me</strong> - you ask a question, AI answers it in context.</p>
              <p><strong>Generate Ideas / Suggest Solution</strong> - spawns new branches from the current node.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">AI fatigue</p>
              <p>Nodes generated by AI track their depth. The deeper the chain, the more unreliable the output - actions on those nodes show a warning badge. This is intentional: the further you drift from your own thinking, the less useful AI becomes.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">Resolving</p>
              <p>Answer and Idea nodes can be <strong>applied</strong> back to their parent - AI merges what you learned into the parent's body. Resolved nodes turn grey and can be hidden. This keeps the canvas clean as threads close.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">Details panel</p>
              <p>Open Details on any node to write a long-form body, read AI summaries, and see how the node connects to the rest of the graph.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">Multiple boards</p>
              <p>Use the board switcher in the top-left to create separate sessions. Each board is fully independent - different topics, different canvases.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">Summarize</p>
              <p>The Summarize button generates an AI overview of everything on the current canvas - useful for capturing where you landed after a long session.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SummarizeModal
        open={summarizeOpen}
        onClose={() => setSummarizeOpen(false)}
        graph={graph}
        cache={summarizeCache}
      />

      {/* Rename board dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="pb-2">Rename board</DialogTitle>
          </DialogHeader>
          <form onSubmit={e => { e.preventDefault(); if (renameName.trim()) { onRenameBoard(activeBoardId, renameName.trim()); setRenameOpen(false) } }} className="flex gap-2">
            <input
              className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={renameName}
              onChange={e => setRenameName(e.target.value)}
              autoFocus
            />
            <Button type="submit" size="sm" disabled={!renameName.trim()} className="shrink-0 h-9 text-sm cursor-pointer">Save</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete board confirm dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={open => { if (!open) setDeleteConfirmId(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="pb-2">Delete board?</DialogTitle>
            <DialogDescription>
              All nodes and edges on this board will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" className="h-9 text-sm cursor-pointer" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" className="h-9 text-sm cursor-pointer" onClick={() => { if (deleteConfirmId) { onDeleteBoard(deleteConfirmId); setDeleteConfirmId(null) } }}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Privacy & Terms modal */}
      <Dialog open={legalOpen} onOpenChange={setLegalOpen}>
        <DialogContent className="max-w-md sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Privacy & Terms</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <section>
              <strong className="text-foreground">Privacy Policy</strong>
              <p className="mt-1">Thonkboard does not collect, store, or transmit any personal data. Your boards and API key are stored exclusively in your browser's localStorage and never leave your device.</p>
              <p className="mt-1">This site uses Google Fonts, which are loaded from Google's servers. Google may log your IP address when fonts are fetched. See <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">Google's Privacy Policy</a>.</p>
              <p className="mt-1">Gemini API calls are made directly from your browser to Google's API using your own key. We have no visibility into these requests.</p>
            </section>
            <section>
              <strong className="text-foreground">Terms of Service</strong>
              <p className="mt-1">Thonkboard is provided free of charge, as-is, with no warranties of any kind. Use at your own risk. We are not liable for any loss of data or damages arising from use of this tool.</p>
              <p className="mt-1">You are responsible for your own Gemini API key and any costs associated with its use.</p>
              <p className="mt-1">Thonkboard uses AI to assist with thinking and ideation. AI-generated content may be inaccurate, incomplete, or misleading. You are solely responsible for evaluating AI output and any decisions, actions, or consequences that follow from it. Misuse of AI features is governed by your AI provider's terms. We accept no liability for harm arising from reliance on AI-generated content.</p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
