import { useRef, useState, memo, useEffect } from 'react'
import { Astroid, HelpCircle, Map, Brain, Lightbulb, TriangleAlert, MessageCircleQuestion, ChevronDown, Plus, Menu, Save, FolderOpen, Sparkles, Zap, EyeOff, StickyNote, Check, Pencil, Trash2, Coffee, ImageDown, Scale, Lock, Github } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from './ui/dropdown-menu'
import {
  setApiKey, getHighIQ, setHighIQ,
  getProvider, setProvider, getProviderKey, setProviderKey, hasActiveKey,
} from '@/ai/gemini'
import { getOllamaBaseUrl, getOllamaModel, setOllamaConfig, PROVIDER_MODEL_LITE, PROVIDER_MODEL_SMART } from '@/ai/openai-compat'
import { MODEL_LITE as ANTHROPIC_LITE, MODEL_SMART as ANTHROPIC_SMART } from '@/ai/anthropic'
import { SummarizeModal, type SummarizeCache } from './SummarizeModal'
import type { ThonkGraph, BoardMeta } from '@/store/types'
import type { Provider } from '@/ai/types'
import { useIsMobile, useIsNarrow } from '@/hooks/useIsMobile'

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
  onExportAs: () => void
  onExportPng: () => void
  linkedFileName: string | null
  fileDirty: boolean
  onImport: (file: File) => void
  graph: ThonkGraph
  boards: BoardMeta[]
  activeBoardId: string
  onSwitchBoard: (id: string) => void
  onCreateBoard: () => void
  onDeleteBoard: (id: string) => void
  onRenameBoard: (id: string, name: string) => void
  keyOpen: boolean
  onKeyOpenChange: (open: boolean) => void
  onAiConnected?: () => void
}

function MiniToggle({ on }: { on: boolean }) {
  return (
    <div className={`relative w-7 h-3.5 rounded-full ml-2 shrink-0 transition-colors ${on ? 'bg-gray-700' : 'bg-gray-300'}`}>
      <div className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </div>
  )
}

const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek', ollama: 'Ollama',
}

const PROVIDER_SERVER: Record<Provider, string> = {
  gemini: 'Google', openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek', ollama: 'Ollama',
}

const PROVIDERS: Provider[] = ['gemini', 'openai', 'anthropic', 'deepseek', 'ollama']

const PROVIDER_MODELS: Record<Provider, { lite: string; smart: string }> = {
  gemini:    { lite: 'gemini-3.1-flash-lite', smart: 'gemini-3.5-flash' },
  openai:    { lite: PROVIDER_MODEL_LITE.openai, smart: PROVIDER_MODEL_SMART.openai },
  anthropic: { lite: ANTHROPIC_LITE, smart: ANTHROPIC_SMART },
  deepseek:  { lite: PROVIDER_MODEL_LITE.deepseek, smart: PROVIDER_MODEL_SMART.deepseek },
  ollama:    { lite: '', smart: '' },
}

function apiKeyButtonLabel(provider: Provider): string {
  return hasActiveKey() ? `${PROVIDER_LABELS[provider]} ✓` : 'Set AI key'
}

function TopBarFn({ onAddCore, onAddIdea, onAddProblem, onAddQuestion, onAddNote, hideResolved, onToggleHideResolved, showLegend, onToggleLegend, onExport, onExportAs, onExportPng, onImport, linkedFileName, fileDirty, graph, boards, activeBoardId, onSwitchBoard, onCreateBoard, onDeleteBoard, onRenameBoard, keyOpen, onKeyOpenChange, onAiConnected }: TopBarProps) {
  const fsaSupported = 'showSaveFilePicker' in window
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { new Image().src = '/thonk-wizard.png' }, [])

  // Committed provider (drives button label + Turbo Thonking visibility)
  const [committedProvider, setCommittedProvider] = useState<Provider>(getProvider)

  const [saved, setSaved] = useState(false)
  const [highIQ, setHighIQState] = useState(getHighIQ)

  // Dialog-local state — reset each time dialog opens
  const [dialogProvider, setDialogProvider] = useState<Provider>(getProvider)
  const [geminiKey, setGeminiKey] = useState(() => getProviderKey('gemini'))
  const [openaiKey, setOpenaiKey] = useState(() => getProviderKey('openai'))
  const [anthropicKey, setAnthropicKey] = useState(() => getProviderKey('anthropic'))
  const [deepseekKey, setDeepseekKey] = useState(() => getProviderKey('deepseek'))
  const [ollamaKey, setOllamaKey] = useState(() => getProviderKey('ollama'))
  const [ollamaModel, setOllamaModel] = useState(getOllamaModel)
  const [ollamaPort, setOllamaPort] = useState(() => {
    const base = getOllamaBaseUrl()
    const match = base.match(/:(\d+)\//)
    return match ? match[1] : '11434'
  })
  const [ollamaTestStatus, setOllamaTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')

  const [summarizeOpen, setSummarizeOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const summarizeCache = useRef<SummarizeCache | null>(null)
  const isMobile = useIsMobile()
  const isNarrow = useIsNarrow()
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [legalOpen, setLegalOpen] = useState(false)

  const logoRef = useRef<HTMLImageElement>(null)
  const logoHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logoRafRef = useRef<number | null>(null)
  const logoShakingRef = useRef(false)
  const logoShakeStartRef = useRef<number>(0)

  const startLogoShake = () => {
    if (logoRafRef.current) { cancelAnimationFrame(logoRafRef.current); logoRafRef.current = null }
    logoShakingRef.current = true
    logoShakeStartRef.current = 0
    const animate = (now: number) => {
      if (!logoShakingRef.current || !logoRef.current) return
      if (!logoShakeStartRef.current) logoShakeStartRef.current = now
      const elapsed = (now - logoShakeStartRef.current) / 1000
      const intensity = Math.min(elapsed / 3, 1)
      const maxAngle = 2 + intensity * 6
      // freq ramps 1→2.5Hz over 3s; integrate phase so changing freq doesn't alias with large absolute now
      const phaseRad = elapsed < 3
        ? 2 * Math.PI * (elapsed + 0.25 * elapsed * elapsed)
        : 2 * Math.PI * (5.25 + 2.5 * (elapsed - 3))
      const angle = Math.sin(phaseRad) * maxAngle
      logoRef.current.style.transform = `rotate(${angle}deg)`
      logoRafRef.current = requestAnimationFrame(animate)
    }
    logoRafRef.current = requestAnimationFrame(animate)
  }

  const stopLogoShake = () => {
    logoShakingRef.current = false
    logoShakeStartRef.current = 0
    if (logoRafRef.current) { cancelAnimationFrame(logoRafRef.current); logoRafRef.current = null }
    if (logoHoverTimerRef.current) { clearTimeout(logoHoverTimerRef.current); logoHoverTimerRef.current = null }
    if (logoRef.current) logoRef.current.style.transform = ''
  }

  const hasContent = graph.nodes.some(n => n.type === 'core' || n.type === 'idea')

  const toggleHighIQ = () => {
    const next = !highIQ
    setHighIQ(next)
    setHighIQState(next)
  }

  const openKeyDialog = () => {
    // Re-sync from storage in case it changed
    setDialogProvider(getProvider())
    setGeminiKey(getProviderKey('gemini'))
    setOpenaiKey(getProviderKey('openai'))
    setAnthropicKey(getProviderKey('anthropic'))
    setDeepseekKey(getProviderKey('deepseek'))
    setOllamaKey(getProviderKey('ollama'))
    const portMatch = getOllamaBaseUrl().match(/:(\d+)\//)
    setOllamaPort(portMatch ? portMatch[1] : '11434')
    setOllamaModel(getOllamaModel())
    setOllamaTestStatus('idle')
    onKeyOpenChange(true)
  }

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      // Reset dialog state to committed values on close-without-save
      setDialogProvider(committedProvider)
    }
    onKeyOpenChange(open)
  }

  // Auto-detect provider from key prefix and switch tabs
  const handleKeyChange = (value: string, forProvider: Provider) => {
    if (value.startsWith('AIza') && forProvider !== 'gemini') {
      setGeminiKey(value); setDialogProvider('gemini'); return
    }
    if (value.startsWith('sk-ant-') && forProvider !== 'anthropic') {
      setAnthropicKey(value); setDialogProvider('anthropic'); return
    }
    if (forProvider === 'gemini')    setGeminiKey(value)
    else if (forProvider === 'openai')    setOpenaiKey(value)
    else if (forProvider === 'anthropic') setAnthropicKey(value)
    else if (forProvider === 'deepseek')  setDeepseekKey(value)
    else if (forProvider === 'ollama')    setOllamaKey(value)
  }

  const currentKey = dialogProvider === 'gemini'    ? geminiKey
                   : dialogProvider === 'openai'    ? openaiKey
                   : dialogProvider === 'anthropic' ? anthropicKey
                   : dialogProvider === 'deepseek'  ? deepseekKey
                   : ollamaKey

  const canSave = dialogProvider === 'ollama'
    ? !!ollamaModel.trim()
    : !!currentKey.trim()

  const handleSave = () => {
    if (dialogProvider === 'gemini') {
      setApiKey(geminiKey)
    } else if (dialogProvider === 'ollama') {
      setProviderKey('ollama', ollamaKey)
      setOllamaConfig(`http://localhost:${ollamaPort}/v1`, ollamaModel)
    } else {
      setProviderKey(dialogProvider, currentKey)
    }
    setProvider(dialogProvider)
    setCommittedProvider(dialogProvider)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onAiConnected?.()
    onKeyOpenChange(false)
  }

  return (
    <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-4 py-2 bg-white border-b border-border" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <img
        ref={logoRef}
        src="/thonkboard-logo.svg"
        alt="ThonkBoard"
        className="h-7 w-auto mr-1"
        style={{ transformOrigin: 'center' }}
        onMouseEnter={() => { logoHoverTimerRef.current = setTimeout(startLogoShake, 1000) }}
        onMouseLeave={stopLogoShake}
      />

      {/* Hamburger menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-9 w-9 p-0 cursor-pointer relative">
            <Menu className="w-5 h-5" />
            {isMobile && !hasActiveKey() && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
            )}
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
                  <span className="flex flex-col min-w-0">
                    <span className="truncate max-w-[140px]">{board.name}</span>
                    {isActive && linkedFileName && (
                      <span className="text-[10px] text-muted-foreground/50 font-mono truncate max-w-[140px]" title={linkedFileName}>
                        {fileDirty ? '* ' : ''}{linkedFileName}
                      </span>
                    )}
                  </span>
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
          <DropdownMenuItem onClick={onExport} className="justify-between">
            <span className="flex items-center gap-2"><Save className="w-4 h-4 text-muted-foreground" /> Save board</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <kbd className={`ml-3 text-xs font-mono cursor-default ${fsaSupported ? 'text-muted-foreground' : 'text-muted-foreground/30'}`}>Ctrl+S</kbd>
              </TooltipTrigger>
              {!fsaSupported && (
                <TooltipContent side="right" className="max-w-[180px] text-center text-xs">
                  Silent save not supported in Firefox — downloads a copy instead
                </TooltipContent>
              )}
            </Tooltip>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExportAs} disabled={!fsaSupported} className={!fsaSupported ? 'opacity-40' : undefined}>
            <Save className="w-4 h-4 text-muted-foreground" /> Save board as…
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
          {isMobile && (
            <>
              <DropdownMenuSeparator />
              {committedProvider !== 'ollama' && (
                <DropdownMenuItem onClick={toggleHighIQ} className="justify-between">
                  <span className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-muted-foreground" /> Turbo Thonking
                  </span>
                  <MiniToggle on={highIQ} />
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onToggleHideResolved} className="justify-between">
                <span className="flex items-center gap-2">
                  <EyeOff className="w-4 h-4 text-muted-foreground" /> Hide resolved
                </span>
                <MiniToggle on={hideResolved} />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={openKeyDialog} className={!hasActiveKey() ? 'text-red-500' : undefined}>
                <Astroid className={`w-4 h-4 ${!hasActiveKey() ? 'text-red-500' : 'text-muted-foreground'}`} />
                {apiKeyButtonLabel(committedProvider)}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setHelpOpen(true)}>
                <HelpCircle className="w-4 h-4 text-muted-foreground" /> Help
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href="https://github.com/titos2k/thonk" target="_blank" rel="noopener noreferrer">
              <Github className="w-4 h-4 text-muted-foreground" /> View on GitHub
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="https://buymeacoffee.com/titos2k" target="_blank" rel="noopener noreferrer">
              <Coffee className="w-4 h-4 text-muted-foreground" /> Buy me a coffee
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLegalOpen(true)}>
            <Scale className="w-4 h-4 text-muted-foreground" /> Privacy & Terms
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInputRef}
        type="file" accept=".thonk,.json" className="hidden"
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm" variant="outline"
              className="h-9 cursor-pointer bg-white"
              style={isNarrow ? { width: 36, padding: 0 } : undefined}
              disabled={!hasContent}
              onClick={() => setSummarizeOpen(true)}
            >
              <Sparkles className="w-4 h-4" />
              {!isNarrow && <span className="ml-1.5 text-sm">Summarize</span>}
            </Button>
          </TooltipTrigger>
          {isNarrow && <TooltipContent side="bottom">Summarize</TooltipContent>}
        </Tooltip>
      )}

      {/* Right-side controls — hidden on mobile */}
      <div className={`ml-auto items-center gap-2 ${isMobile ? 'hidden' : 'flex'}`}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggleHideResolved}
              className="flex items-center gap-2 h-9 px-2 rounded-md hover:bg-black/5 transition-colors"
            >
              {isNarrow
                ? <EyeOff className="w-4 h-4 text-muted-foreground" />
                : <span className="text-sm font-medium text-muted-foreground select-none">Hide resolved</span>}
              <div className={`relative w-8 h-4 rounded-full transition-colors ${hideResolved ? 'bg-gray-700' : 'bg-gray-300'}`}>
                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${hideResolved ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {hideResolved ? 'Showing only active nodes' : 'Hide resolved nodes'}
          </TooltipContent>
        </Tooltip>

        {committedProvider !== 'ollama' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleHighIQ}
                className="flex items-center gap-2 h-9 px-2 rounded-md hover:bg-black/5 transition-colors"
              >
                {isNarrow
                  ? <Brain className="w-4 h-4 text-muted-foreground" />
                  : <span className="text-sm font-medium text-muted-foreground select-none">Turbo Thonking</span>}
                <div className={`relative w-8 h-4 rounded-full transition-colors ${highIQ ? 'bg-gray-700' : 'bg-gray-300'}`}>
                  <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${highIQ ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[200px] text-center">
              {highIQ
                ? `Using ${PROVIDER_MODELS[committedProvider].smart} - smarter, slower, costs more`
                : `Using ${PROVIDER_MODELS[committedProvider].lite} - fast and cheap. Enable for deeper reasoning.`}
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm" variant="ghost"
              className={`h-9 gap-2 ${!hasActiveKey() ? 'text-red-500 hover:text-red-600' : ''}`}
              onClick={openKeyDialog}
            >
              <Astroid className="w-5 h-5" />
              {!isNarrow && <span className="text-sm">{apiKeyButtonLabel(committedProvider)}</span>}
            </Button>
          </TooltipTrigger>
          {isNarrow && (
            <TooltipContent side="bottom">{apiKeyButtonLabel(committedProvider)}</TooltipContent>
          )}
        </Tooltip>

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

      {/* ── API Key dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={keyOpen} onOpenChange={handleDialogClose}>
        <DialogContent className={isMobile ? 'max-w-md' : 'max-w-[580px]'}>
          {!isMobile && (
            <img
              src="/thonk-wizard.png"
              alt=""
              aria-hidden="true"
              className="absolute bottom-[30px] -left-[96px] h-[410px] w-auto pointer-events-none select-none"
            />
          )}
          <div className={`flex flex-col gap-4${!isMobile ? ' pl-[200px]' : ''}`}>
          <DialogHeader>
            <DialogTitle className="pb-2">Connect Your AI</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground leading-snug">
              <span className="text-foreground font-semibold">ThonkBoard</span>{' '}uses AI to critique your ideas, ask sharp questions, and generate answers. Pick a provider you already have access to - most have a free tier and take under a minute to set up.
            </DialogDescription>
          </DialogHeader>

          {/* Provider selector — radios */}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {PROVIDERS.map(p => {
              const isOllamaRemote = p === 'ollama' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
              return (
                <label key={p} className={`flex items-center gap-2 ${isOllamaRemote ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                  <input
                    type="radio"
                    name="ai-provider"
                    value={p}
                    checked={dialogProvider === p}
                    onChange={() => setDialogProvider(p)}
                    disabled={isOllamaRemote}
                    className="accent-gray-900 w-4 h-4"
                  />
                  <span className="text-sm font-medium select-none">{PROVIDER_LABELS[p]}</span>
                  {isOllamaRemote && <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-200 text-gray-500 rounded px-1.5 py-0.5 leading-none">Local only</span>}
                </label>
              )
            })}
          </div>

          {/* Trust banner — hidden for Ollama local */}
          {dialogProvider !== 'ollama' && (
            <div className="flex items-start gap-2 bg-gray-50 rounded px-3 py-3">
              <Lock className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'hsl(240, 55%, 42%)' }} />
              <p className="text-sm text-muted-foreground leading-snug">
                Your key is stored only in this browser's localStorage. It goes directly to{' '}
                {PROVIDER_SERVER[dialogProvider]}'s servers - never ours.
              </p>
            </div>
          )}

          {/* Per-provider content */}
          <form onSubmit={e => { e.preventDefault(); if (canSave) handleSave() }} className="space-y-3">

            {dialogProvider === 'gemini' && (
              <>
                <Input
                  type="password"
                  placeholder="Gemini API key…"
                  autoComplete="off"
                  value={geminiKey}
                  onChange={e => handleKeyChange(e.target.value, 'gemini')}
                  className="text-sm font-mono bg-white"
                  autoFocus
                />
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline hover:opacity-70 transition-opacity block"
                >
                  Get a free key from Google AI Studio →
                </a>
              </>
            )}

            {dialogProvider === 'openai' && (
              <>
                <Input
                  type="password"
                  placeholder="OpenAI API key…"
                  autoComplete="off"
                  value={openaiKey}
                  onChange={e => handleKeyChange(e.target.value, 'openai')}
                  className="text-sm font-mono bg-white"
                  autoFocus
                />
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline hover:opacity-70 transition-opacity block"
                >
                  Get your key from OpenAI Platform →
                </a>
              </>
            )}

            {dialogProvider === 'anthropic' && (
              <>
                <Input
                  type="password"
                  placeholder="Anthropic API key…"
                  autoComplete="off"
                  value={anthropicKey}
                  onChange={e => handleKeyChange(e.target.value, 'anthropic')}
                  className="text-sm font-mono bg-white"
                  autoFocus
                />
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline hover:opacity-70 transition-opacity block"
                >
                  Get your key from Anthropic Console →
                </a>
              </>
            )}

            {dialogProvider === 'deepseek' && (
              <>
                <Input
                  type="password"
                  placeholder="DeepSeek API key…"
                  autoComplete="off"
                  value={deepseekKey}
                  onChange={e => handleKeyChange(e.target.value, 'deepseek')}
                  className="text-sm font-mono bg-white"
                  autoFocus
                />
                <a
                  href="https://platform.deepseek.com/api_keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline hover:opacity-70 transition-opacity block"
                >
                  Get your key from DeepSeek Platform →
                </a>
              </>
            )}

            {dialogProvider === 'ollama' && (
              <>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground bg-gray-50 rounded px-3 py-2">
                    Make sure Ollama is running on your machine.{' '}
                    <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-70">
                      ollama.com →
                    </a>
                  </p>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-muted-foreground shrink-0">Port</label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="11434"
                      value={ollamaPort}
                      onChange={e => { setOllamaPort(e.target.value); setOllamaTestStatus('idle') }}
                      className="text-sm font-mono bg-white w-24"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 text-sm cursor-pointer bg-white shrink-0"
                      disabled={ollamaTestStatus === 'testing'}
                      onClick={async () => {
                        setOllamaTestStatus('testing')
                        try {
                          const port = ollamaPort || '11434'
                          const res = await fetch(`http://localhost:${port}/api/tags`, { signal: AbortSignal.timeout(3000) })
                          setOllamaTestStatus(res.ok ? 'ok' : 'fail')
                        } catch {
                          setOllamaTestStatus('fail')
                        }
                      }}
                    >
                      {ollamaTestStatus === 'testing' ? 'Testing…' : 'Test'}
                    </Button>
                    {ollamaTestStatus === 'ok' && <span className="text-sm text-green-600 font-medium">✓ Running</span>}
                    {ollamaTestStatus === 'fail' && <span className="text-sm text-red-500">Not reachable</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-sm text-muted-foreground shrink-0">Model</label>
                  <Input
                    type="text"
                    placeholder="gemma4"
                    value={ollamaModel}
                    onChange={e => setOllamaModel(e.target.value)}
                    className="text-sm font-mono bg-white"
                    autoFocus
                  />
                </div>
              </>
            )}

            <div className="pt-2">
              <Button
                type="submit"
                size="sm"
                disabled={!canSave}
                className="w-full h-9 text-sm cursor-pointer"
              >
                {saved ? 'Saved!' : 'Save'}
              </Button>
            </div>
          </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Help dialog */}
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
              <p className="mt-1 text-orange-600">Do not use ThonkBoard in incognito/private mode - browsers wipe localStorage on close, so you will lose all your work.</p>
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
              <p className="mt-1">ThonkBoard does not collect, store, or transmit any personal data. Your boards and API keys are stored exclusively in your browser's localStorage and never leave your device.</p>
              <p className="mt-1">AI API calls are made directly from your browser to your chosen provider using your own key. We have no visibility into these requests. When using Ollama (local), all AI processing happens on your device - no data leaves your machine at all.</p>
            </section>
            <section>
              <strong className="text-foreground">Terms of Service</strong>
              <p className="mt-1">ThonkBoard is provided free of charge, as-is, with no warranties of any kind. Use at your own risk. We are not liable for any loss of data or damages arising from use of this tool.</p>
              <p className="mt-1">You are responsible for your own API keys and any costs associated with their use.</p>
              <p className="mt-1">ThonkBoard uses AI to assist with thinking and ideation. AI-generated content may be inaccurate, incomplete, or misleading. You are solely responsible for evaluating AI output and any decisions, actions, or consequences that follow from it. Misuse of AI features is governed by your AI provider's terms. We accept no liability for harm arising from reliance on AI-generated content.</p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const TopBar = memo(TopBarFn)
