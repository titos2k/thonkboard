import { useRef, useState, memo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Astroid, HelpCircle, Map, ChevronDown, Plus, Menu, Save, FolderOpen, File, Sparkles, Zap, StickyNote, Check, Trash2, Coffee, ImageDown, Scale, Lock, Moon, Sun, Star, Globe, Settings, Search, FileInput, FileCode } from 'lucide-react'
import { IdeaIcon } from '@/components/icons/IdeaIcon'
import { ProblemIcon } from '@/components/icons/ProblemIcon'
import { QuestionIcon } from '@/components/icons/QuestionIcon'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from './ui/dropdown-menu'
import { EXAMPLES } from '@/examples'
import {
  setApiKey, getHighIQ, setHighIQ, getWebSearch, setWebSearch,
  getProvider, setProvider, getProviderKey, setProviderKey, hasActiveKey,
} from '@/ai/gemini'
import { getOllamaBaseUrl, getOllamaModel, setOllamaConfig, PROVIDER_MODEL_LITE, PROVIDER_MODEL_SMART } from '@/ai/openai-compat'
import { MODEL_LITE as ANTHROPIC_LITE, MODEL_SMART as ANTHROPIC_SMART } from '@/ai/anthropic'
import { SummarizeModal } from './SummarizeModal'
import type { ThonkGraph, BoardMeta } from '@/store/types'
import type { Provider } from '@/ai/types'
import { useIsMobile, useIsNarrow } from '@/hooks/useIsMobile'

interface TopBarProps {
  onAddIdea: () => void
  onAddProblem: () => void
  onAddQuestion: () => void
  onAddNote: () => void
  showLegend: boolean
  onToggleLegend: () => void
  onExport: () => void
  onExportAs: () => void
  onExportPng: () => void
  onExportMermaid: () => void
  linkedFileName: string | null
  fileDirty: boolean
  onImport: (file: File) => void
  onImportSource: (file: File) => void
  graph: ThonkGraph
  boards: BoardMeta[]
  activeBoardId: string
  onSwitchBoard: (id: string) => void
  onCreateBoard: () => void
  onDeleteBoard: (id: string) => void
  keyOpen: boolean
  onKeyOpenChange: (open: boolean) => void
  onAiConnected?: () => void
  darkMode: boolean
  onToggleDarkMode: () => void
  onLoadExample: (raw: string, name: string) => void
  exampleMode?: boolean
  onOpenPalette?: () => void
  onOpenPaletteAllBoards?: () => void
  conflictCount?: number
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
  return hasActiveKey() ? PROVIDER_LABELS[provider] : 'Set AI key'
}

function TopBarFn({ onAddIdea, onAddProblem, onAddQuestion, onAddNote, showLegend, onToggleLegend, onExport, onExportAs, onExportPng, onExportMermaid, onImport, onImportSource, linkedFileName, fileDirty, graph, boards, activeBoardId, onSwitchBoard, onCreateBoard, onDeleteBoard, keyOpen, onKeyOpenChange, onAiConnected, darkMode, onToggleDarkMode, onLoadExample, exampleMode, onOpenPalette, onOpenPaletteAllBoards, conflictCount }: TopBarProps) {
  const toastExampleBlocked = () => window.dispatchEvent(new CustomEvent('thonk:toast', { detail: 'Keep or exit the example before loading a board' }))
  const fsaSupported = 'showSaveFilePicker' in window
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sourceInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { ['/thonk-wizard.png', '/wizard-head1.png', '/wizard-head2.png'].forEach(src => { new Image().src = src }) }, [])

  // Committed provider (drives button label + Turbo Thonking visibility)
  const [committedProvider, setCommittedProvider] = useState<Provider>(getProvider)

  const [saved, setSaved] = useState(false)
  const [highIQ, setHighIQState] = useState(getHighIQ)
  const [webSearch, setWebSearchState] = useState(getWebSearch)

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
  const [sourceImportOpen, setSourceImportOpen] = useState(false)

  useEffect(() => {
    const handler = () => setSourceImportOpen(true)
    window.addEventListener('thonk:open-source-import', handler)
    return () => window.removeEventListener('thonk:open-source-import', handler)
  }, [])
  const isMobile = useIsMobile()
  const isNarrow = useIsNarrow()
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [minimapHover, setMinimapHover] = useState<{ svg: string; top: number; left: number } | null>(null)
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

  const toggleWebSearch = () => {
    const next = !webSearch
    setWebSearch(next)
    setWebSearchState(next)
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
    <>
    <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-4 py-2 bg-[var(--menu-bg)] text-[var(--menu-text)]" style={{ boxShadow: 'rgba(12, 14, 18, 0.05) 0px 2px 4px 0px' }}>
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
      <div>
      <DropdownMenu onOpenChange={open => { if (open) window.dispatchEvent(new CustomEvent('thonk:hamburger-open')) }}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-9 w-9 p-0 cursor-pointer relative">
            <Menu className="w-5 h-5" />
            {isMobile && !hasActiveKey() && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" alignOffset={isMobile ? -9999 : 0} collisionPadding={isMobile ? 8 : 0} className="max-w-[50vw]" onCloseAutoFocus={e => e.preventDefault()}>
          {/* Boards submenu */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <File className="w-4 h-4 text-muted-foreground shrink-0" /> Board
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[280px] max-w-[50vw]">
              <div className="max-h-[400px] overflow-y-auto">
                {boards.map(board => {
                  const isActive = board.id === activeBoardId
                  return (
                    <DropdownMenuItem
                      key={board.id}
                      onClick={() => { setMinimapHover(null); onSwitchBoard(board.id) }}
                      className="flex items-center justify-between gap-1 pr-1 relative"
                      onMouseEnter={(e) => {
                        try {
                          const svg = localStorage.getItem(`thonk.minimap.${board.id}`)
                          if (svg) {
                            const rect = e.currentTarget.getBoundingClientRect()
                            setMinimapHover({ svg, top: rect.top, left: rect.right + 10 })
                          }
                        } catch { /* ignore */ }
                      }}
                      onMouseLeave={() => setMinimapHover(null)}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        {isActive
                          ? <Check className="w-4 h-4 shrink-0 text-foreground" />
                          : <span className="w-4 shrink-0" />}
                        <span className="flex flex-col min-w-0">
                          <span className="truncate max-w-[220px] flex items-center gap-1" title={board.name}>
                            {board.emoji && <span className="shrink-0" style={{ fontSize: 16, marginRight: 4 }}>{board.emoji}</span>}
                            {board.name}
                          </span>
                          {isActive && linkedFileName && (
                            <span className="text-[10px] text-muted-foreground/50 font-mono truncate max-w-[220px]" title={linkedFileName}>
                              {fileDirty ? '* ' : ''}{linkedFileName}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="flex items-center gap-0.5 shrink-0">
                          {boards.length > 1 && (
                          <button
                            onClick={e => { e.stopPropagation(); setDeleteConfirmId(board.id); setMinimapHover(null) }}
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
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => exampleMode ? toastExampleBlocked() : onCreateBoard()}>
                <Plus className="w-4 h-4 text-muted-foreground" /> New board
              </DropdownMenuItem>
              {onOpenPaletteAllBoards && boards.length > 1 && (
                <DropdownMenuItem onClick={onOpenPaletteAllBoards}>
                  <Search className="w-4 h-4 text-muted-foreground" /> Search boards
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {/* File submenu */}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderOpen className="w-4 h-4 text-muted-foreground" /> File
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-w-[50vw]">
              <DropdownMenuItem onClick={() => exampleMode ? toastExampleBlocked() : onExport()} className="justify-between">
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
              <DropdownMenuItem onClick={() => exampleMode ? toastExampleBlocked() : onExportAs()} disabled={!fsaSupported} className={!fsaSupported ? 'opacity-40' : undefined}>
                <Save className="w-4 h-4 text-muted-foreground" /> Save board as…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exampleMode ? toastExampleBlocked() : fileInputRef.current?.click()}>
                <FolderOpen className="w-4 h-4 text-muted-foreground" /> Load board
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => exampleMode ? toastExampleBlocked() : setSourceImportOpen(true)}>
                <FileInput className="w-4 h-4 text-muted-foreground" /> Import source…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onExportPng}>
                <ImageDown className="w-4 h-4 text-muted-foreground" /> Export as PNG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExportMermaid}>
                <FileCode className="w-4 h-4 text-muted-foreground" /> Export as Mermaid
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* AI */}
          <DropdownMenuItem disabled={!hasContent} onClick={() => setSummarizeOpen(true)}>
            <Sparkles className="w-4 h-4 text-muted-foreground" /> Summarize
          </DropdownMenuItem>

          {/* Examples submenu */}
          {EXAMPLES.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Star className="w-4 h-4 text-muted-foreground" /> Examples
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-w-[50vw]">
                  {EXAMPLES.filter(ex => !ex.isTemplate).map(ex => (
                    <DropdownMenuItem key={ex.id} title={ex.description} onClick={() => onLoadExample(ex.raw, ex.name)}>
                      {ex.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Templates</div>
                  {EXAMPLES.filter(ex => ex.isTemplate).map(ex => (
                    <DropdownMenuItem key={ex.id} title={ex.description} onClick={() => onLoadExample(ex.raw, ex.name)}>
                      {ex.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}

          {isMobile && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onOpenPalette}>
                <Search className="w-4 h-4 text-muted-foreground" /> Search nodes
              </DropdownMenuItem>
              {committedProvider !== 'ollama' && (
                <DropdownMenuItem onClick={toggleHighIQ} className="justify-between">
                  <span className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-muted-foreground" /> Turbo Thonking
                  </span>
                  <MiniToggle on={highIQ} />
                </DropdownMenuItem>
              )}
              {committedProvider !== 'ollama' && committedProvider !== 'deepseek' && (
                <DropdownMenuItem onClick={toggleWebSearch} className="justify-between">
                  <span className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-muted-foreground" /> Web Search
                  </span>
                  <MiniToggle on={webSearch} />
                </DropdownMenuItem>
              )}
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
          <DropdownMenuItem onClick={onToggleDarkMode} className="justify-between">
            <span className="flex items-center gap-2">
              {darkMode ? <Sun className="w-4 h-4 text-muted-foreground" /> : <Moon className="w-4 h-4 text-muted-foreground" />}
              {darkMode ? 'Light mode' : 'Dark mode'}
            </span>
            <MiniToggle on={darkMode} />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* About submenu */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              About
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-w-[50vw]">
              <DropdownMenuItem asChild>
                <a href="https://github.com/titos2k/thonkboard" target="_blank" rel="noopener noreferrer">
                  <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
                  View on GitHub
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
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>

      <input
        ref={fileInputRef}
        type="file" accept=".thonk,.json" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) { if (exampleMode) { toastExampleBlocked(); e.target.value = ''; return } onImport(f) } e.target.value = '' }}
      />
      <input
        ref={sourceInputRef}
        type="file" accept=".md,.txt" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onImportSource(f); e.target.value = '' }}
      />

      {/* Add Node dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-9 text-sm gap-1.5 cursor-pointer bg-[var(--menu-bg)] border-[var(--menu-border)] hover:bg-[var(--menu-item-hover)]">
            <Plus className="w-4 h-4" /> Add Node <ChevronDown className="w-4 h-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={e => e.preventDefault()}>
          <DropdownMenuItem onClick={onAddIdea} className="justify-between">
            <span className="flex items-center gap-2"><IdeaIcon className="w-4 h-4" /> Idea</span>
            <kbd className="text-xs text-muted-foreground/50 font-mono ml-4">(I)</kbd>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddQuestion} className="justify-between">
            <span className="flex items-center gap-2"><QuestionIcon className="w-4 h-4" /> Question</span>
            <kbd className="text-xs text-muted-foreground/50 font-mono ml-4">(Q)</kbd>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddProblem} className="justify-between">
            <span className="flex items-center gap-2"><ProblemIcon className="w-4 h-4" /> Problem</span>
            <kbd className="text-xs text-muted-foreground/50 font-mono ml-4">(P)</kbd>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="outline" className="h-9 w-9 p-0 cursor-pointer bg-[var(--menu-bg)] border-[var(--menu-border)] hover:bg-[var(--menu-item-hover)]" onClick={onAddNote}>
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
              className="h-9 cursor-pointer bg-[var(--menu-bg)] border-[var(--menu-border)] hover:bg-[var(--menu-item-hover)]"
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
        {!!conflictCount && conflictCount > 0 && (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('thonk:navigate-first-conflict'))}
            className="flex items-center px-2 py-1 rounded-md bg-red-500 text-white text-xs font-semibold hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500 transition-colors select-none"
          >
            {conflictCount} Conflict{conflictCount !== 1 ? 's' : ''}
          </button>
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
              {!isNarrow && hasActiveKey() && <Check className="w-3.5 h-3.5" />}
            </Button>
          </TooltipTrigger>
          {isNarrow && (
            <TooltipContent side="bottom">{apiKeyButtonLabel(committedProvider)}</TooltipContent>
          )}
        </Tooltip>

        {committedProvider !== 'ollama' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-9 w-9 p-0">
                <Settings className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72" onCloseAutoFocus={e => e.preventDefault()}>
              <DropdownMenuItem onSelect={e => e.preventDefault()} onClick={toggleHighIQ} className="justify-between gap-6">
                <span className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>
                    <div className="text-sm">Turbo Thonking</div>
                    <div className="text-xs text-muted-foreground">
                      {highIQ
                        ? `Switch to ${PROVIDER_MODELS[committedProvider].lite}, faster and cheaper`
                        : `Switch to ${PROVIDER_MODELS[committedProvider].smart}, smarter and slower`}
                    </div>
                  </span>
                </span>
                <MiniToggle on={highIQ} />
              </DropdownMenuItem>
              {committedProvider !== 'deepseek' && (
                <DropdownMenuItem onSelect={e => e.preventDefault()} onClick={toggleWebSearch} className="justify-between gap-6">
                  <span className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span>
                      <div className="text-sm">Web Search</div>
                      <div className="text-xs text-muted-foreground">
                        {webSearch ? 'Current facts in answers, turn off to save costs' : 'Current facts in answers, higher cost per query'}
                      </div>
                    </span>
                  </span>
                  <MiniToggle on={webSearch} />
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0" onClick={onOpenPalette}>
              <Search className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Search nodes (Cmd+K)</TooltipContent>
        </Tooltip>

        <Button size="sm" variant="ghost" className="h-9 w-9 p-0" onClick={() => setHelpOpen(true)}>
          <HelpCircle className="w-5 h-5" />
        </Button>
      </div>

      {/* ── API Key dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={keyOpen} onOpenChange={handleDialogClose}>
        <DialogContent className={`${isMobile ? 'max-w-md' : 'max-w-[580px]'} p-0`}>
          {!isMobile && (
            <img
              src="/thonk-wizard.png"
              alt=""
              aria-hidden="true"
              className="absolute top-1/2 -translate-y-1/2 -left-[96px] h-[410px] w-auto pointer-events-none select-none"
            />
          )}
          <div className={`flex flex-col gap-5 p-8${!isMobile ? ' pl-[200px]' : ''}`}>
          <DialogHeader>
            <DialogTitle className="pb-2">Connect Your AI</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
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
            <div className="flex items-start gap-2 bg-muted/50 dark:bg-muted rounded px-3 py-3">
              <Lock className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
              <p className="text-sm text-muted-foreground">
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
                  className="text-base bg-white dark:bg-background h-11"
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
                  className="text-base bg-white dark:bg-background h-11"
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
                  className="text-base bg-white dark:bg-background h-11"
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
                  className="text-base bg-white dark:bg-background h-11"
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
                  <p className="text-sm text-muted-foreground bg-secondary rounded px-3 py-2">
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
                      className="text-sm bg-white w-24"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 text-sm cursor-pointer bg-card shrink-0"
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
                    className="text-base bg-white dark:bg-background h-11"
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
              <p><strong>Source</strong> - attach a document (markdown, text, etc.). Its content is digested and silently informs every AI action on the board.</p>
              <p className="mt-1 opacity-70">Any node can be converted to another type from its toolbar.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">AI actions</p>
              <p><strong>Push Thinking</strong> - generates a mixed starter set of ideas, questions, and problems to kick off exploration from different angles.</p>
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
        boardId={activeBoardId}
      />

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
            <Button variant="destructive" className="h-9 text-sm cursor-pointer" onClick={() => { if (deleteConfirmId) { onDeleteBoard(deleteConfirmId); setDeleteConfirmId(null); setMinimapHover(null) } }}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import source dialog */}
      <Dialog open={sourceImportOpen} onOpenChange={setSourceImportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="pb-2">Import source document</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              A source node seeds your board with existing material - a spec, research doc, or notes. Text is extracted in your browser - <strong>nothing is uploaded to our servers.</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <p className="text-sm font-medium mb-1.5">Accepted formats</p>
              <p className="text-sm text-muted-foreground">.md .txt</p>
            </div>
            <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Tip - summarise your codebase</p>
              <p>Ask your codebase AI assistant: <em>"Give me a markdown overview of this project: what it does, its main features and components, and what's actively being worked on. Format it with headings and bullets, no code blocks or HTML."</em> Save the response as a <code className="text-xs bg-muted px-1 rounded">.md</code> file and import here.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" className="h-9 text-sm cursor-pointer" onClick={() => setSourceImportOpen(false)}>
              Cancel
            </Button>
            <Button className="h-9 text-sm cursor-pointer" onClick={() => { setSourceImportOpen(false); sourceInputRef.current?.click() }}>
              Choose file…
            </Button>
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
              <p className="mt-3">ThonkBoard does not collect, store, or transmit any personal data. Your boards and API keys are stored exclusively in your browser's localStorage and never leave your device.</p>
              <p className="mt-3">AI API calls are made directly from your browser to your chosen provider using your own key. We have no visibility into these requests. When using Ollama (local), all AI processing happens on your device - no data leaves your machine at all.</p>
            </section>
            <section>
              <strong className="text-foreground">Terms of Service</strong>
              <p className="mt-3">ThonkBoard is provided free of charge, as-is, with no warranties of any kind. Use at your own risk. We are not liable for any loss of data or damages arising from use of this tool.</p>
              <p className="mt-3">You are responsible for your own API keys and any costs associated with their use.</p>
              <p className="mt-3">ThonkBoard uses AI to assist with thinking and ideation. AI-generated content may be inaccurate, incomplete, or misleading. You are solely responsible for evaluating AI output and any decisions, actions, or consequences that follow from it. Misuse of AI features is governed by your AI provider's terms. We accept no liability for harm arising from reliance on AI-generated content.</p>
            </section>
            <section>
              <strong className="text-foreground">License</strong>
              <p className="mt-3">ThonkBoard is released under the <a href="https://polyformproject.org/licenses/noncommercial/1.0.0" target="_blank" rel="noopener noreferrer" className="underline text-foreground hover:text-primary">Polyform Noncommercial License 1.0.0</a>. You are free to use, modify, and distribute it for personal and internal organisational purposes.</p>
              <p className="mt-3">Commercial use is not permitted - you may not offer ThonkBoard (or a product whose value derives substantially from it) as a service to others. Copyright © 2026 Tomasz Zych.</p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    {minimapHover && createPortal(
      <div
        className="pointer-events-none fixed z-[9999] w-[200px] h-[120px] rounded-lg border border-border bg-card shadow-xl overflow-hidden [&_svg]:w-full [&_svg]:h-full"
        style={{ top: minimapHover.top, left: minimapHover.left }}
        dangerouslySetInnerHTML={{ __html: minimapHover.svg }}
      />,
      document.body,
    )}
    </>
  )
}

export const TopBar = memo(TopBarFn)
