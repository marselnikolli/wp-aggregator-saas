import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Loader2, Image, Eye, Layers, Type, Frame, Move, Tag, AlignLeft, AlignCenter, AlignRight } from 'lucide-react'
import { toast } from 'sonner'
import { imageTemplatesApi, postsApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Rnd } from 'react-rnd'

// ─── Google Fonts ─────────────────────────────────────────────────────────────

const GOOGLE_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
  'Oswald', 'Playfair Display', 'Raleway', 'Nunito', 'Poppins',
  'Source Sans 3', 'PT Sans',
]

function injectGoogleFonts() {
  const existing = document.getElementById('gf-social-templates')
  if (existing) return
  const families = GOOGLE_FONTS.map(f => encodeURIComponent(f) + ':wght@400;700').join('&family=')
  const link = document.createElement('link')
  link.id   = 'gf-social-templates'
  link.rel  = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`
  document.head.appendChild(link)
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ElementType = 'gradient' | 'title' | 'category' | 'logo' | 'domain'

interface TemplateElement {
  id: string
  type: ElementType
  x: number        // % of canvas (0–100)
  y: number
  width: number    // % of canvas
  // gradient
  opacity?: number
  startOpacity?: number
  direction?: 'bottom' | 'top' | 'left' | 'right'
  colorSource?: 'category' | 'fixed'
  fixedColor?: string
  startColor?: string
  // text / font
  fontSize?: number
  color?: string
  textColor?: string
  fontFamily?: string
  textAlign?: 'left' | 'center' | 'right'
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  maxLines?: number
  // category badge
  badgeStyle?: 'pill' | 'square'
  // domain
  text?: string
}

interface ImageTemplate {
  id: string
  name: string
  platform: 'FACEBOOK' | 'INSTAGRAM'
  elements: TemplateElement[]
  logoUrl: string | null
  createdAt: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID()
}

const ELEMENT_DEFAULTS: Record<ElementType, Partial<TemplateElement>> = {
  gradient: { x: 0, y: 0, width: 100, startColor: '#000000', startOpacity: 0, opacity: 0.85, direction: 'bottom', colorSource: 'category', fixedColor: '#000000' },
  title:    { x: 5, y: 65, width: 90, fontSize: 52, color: '#ffffff', maxLines: 4 },
  category: { x: 5, y: 5, width: 25, fontSize: 18, textColor: '#ffffff', badgeStyle: 'pill' },
  logo:     { x: 75, y: 80, width: 18 },
  domain:   { x: 5, y: 90, width: 40, fontSize: 20, color: '#ffffffb3', text: 'example.com' },
}

function newElement(type: ElementType): TemplateElement {
  return { id: uid(), type, ...ELEMENT_DEFAULTS[type] } as TemplateElement
}

function hexWithOpacity(hex: string, opacity: number): string {
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255).toString(16).padStart(2, '0')
  return hex.replace(/^#/, '#').slice(0, 7) + alpha
}

function gradientCss(el: TemplateElement): string {
  const dir = el.direction ?? 'bottom'
  const cssDir =
    dir === 'bottom' ? 'to top' :
    dir === 'top'    ? 'to bottom' :
    dir === 'left'   ? 'to right' :
                       'to left'
  const endColor   = el.colorSource === 'fixed' ? (el.fixedColor ?? '#000000') : '#1a3a6b'
  const startColor = el.startColor ?? endColor
  const startStop  = hexWithOpacity(startColor,  el.startOpacity ?? 0)
  const endStop    = hexWithOpacity(endColor,     el.opacity      ?? 0.85)
  return `linear-gradient(${cssDir}, ${startStop}, ${endStop})`
}

// ─── Element visual renderer (inside canvas) ─────────────────────────────────

interface ElementVisualProps {
  el: TemplateElement
  canvasSize: number
  logoUrl: string | null
  selected: boolean
  onClick: () => void
}

function ElementVisual({ el, canvasSize, logoUrl, selected, onClick }: ElementVisualProps) {
  const scale = canvasSize / 600
  const border = selected ? '2px dashed #3b82f6' : '1px dashed transparent'

  const base: React.CSSProperties = {
    width: '100%',
    height: '100%',
    cursor: 'pointer',
    border,
    boxSizing: 'border-box',
    overflow: 'hidden',
    userSelect: 'none',
  }

  if (el.type === 'gradient') {
    return (
      <div
        style={{
          ...base,
          background: gradientCss(el),
          opacity: el.opacity ?? 0.7,
          border: selected ? '2px dashed #3b82f6' : 'none',
          pointerEvents: 'all',
        }}
        onClick={onClick}
      />
    )
  }

  if (el.type === 'title') {
    const tt = el.textTransform && el.textTransform !== 'none' ? el.textTransform : undefined
    return (
      <div style={{ ...base, display: 'flex', alignItems: 'flex-end' }} onClick={onClick}>
        <p style={{
          color: el.color ?? '#ffffff',
          fontSize: (el.fontSize ?? 52) * scale,
          fontFamily: el.fontFamily ? `'${el.fontFamily}', Arial, sans-serif` : 'Arial, sans-serif',
          fontWeight: 700,
          lineHeight: 1.2,
          margin: 0,
          padding: '4px',
          width: '100%',
          textAlign: (el.textAlign as React.CSSProperties['textAlign']) ?? 'left',
          textTransform: tt as React.CSSProperties['textTransform'],
          textShadow: '0 1px 4px rgba(0,0,0,0.5)',
          WebkitLineClamp: el.maxLines ?? 4,
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          Article Title Preview — This Is a Longer Headline Example
        </p>
      </div>
    )
  }

  if (el.type === 'category') {
    const radius = el.badgeStyle === 'pill' ? '9999px' : '4px'
    const tt = el.textTransform && el.textTransform !== 'none' ? el.textTransform : undefined
    return (
      <div style={{ ...base, display: 'flex', alignItems: 'center', padding: '4px' }} onClick={onClick}>
        <span style={{
          background: '#3b82f6',
          color: el.textColor ?? '#ffffff',
          fontSize: (el.fontSize ?? 18) * scale,
          fontFamily: el.fontFamily ? `'${el.fontFamily}', Arial, sans-serif` : 'Arial, sans-serif',
          fontWeight: 600,
          borderRadius: radius,
          padding: `${2 * scale}px ${8 * scale}px`,
          whiteSpace: 'nowrap',
          textTransform: tt as React.CSSProperties['textTransform'],
        }}>
          Category
        </span>
      </div>
    )
  }

  if (el.type === 'logo') {
    if (logoUrl) {
      return (
        <div style={base} onClick={onClick}>
          <img src={logoUrl} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
      )
    }
    return (
      <div style={{
        ...base,
        border: selected ? '2px dashed #3b82f6' : '2px dashed rgba(255,255,255,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }} onClick={onClick}>
        <Image style={{ color: 'rgba(255,255,255,0.5)', width: 24, height: 24 }} />
      </div>
    )
  }

  if (el.type === 'domain') {
    const tt = el.textTransform && el.textTransform !== 'none' ? el.textTransform : undefined
    return (
      <div style={{ ...base, display: 'flex', alignItems: 'center', padding: '2px', justifyContent:
        el.textAlign === 'center' ? 'center' : el.textAlign === 'right' ? 'flex-end' : 'flex-start',
      }} onClick={onClick}>
        <span style={{
          color: el.color ?? 'rgba(255,255,255,0.7)',
          fontSize: (el.fontSize ?? 20) * scale,
          fontFamily: el.fontFamily ? `'${el.fontFamily}', Arial, sans-serif` : 'Arial, sans-serif',
          fontWeight: 400,
          textTransform: tt as React.CSSProperties['textTransform'],
        }}>
          {el.text || 'example.com'}
        </span>
      </div>
    )
  }

  return null
}

// ─── Properties panel ─────────────────────────────────────────────────────────

interface PropsPanelProps {
  el: TemplateElement | undefined
  onChange: (updated: TemplateElement) => void
  onDelete: () => void
}

function PropsPanel({ el, onChange, onDelete }: PropsPanelProps) {
  if (!el) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 px-4">
        <Move className="h-8 w-8 opacity-30" />
        <p className="text-xs text-center">Click an element on the canvas to edit its properties</p>
      </div>
    )
  }

  const set = (key: keyof TemplateElement, value: unknown) =>
    onChange({ ...el, [key]: value } as TemplateElement)

  return (
    <div className="p-4 space-y-3 overflow-y-auto flex-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {el.type}
        </span>
        <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Separator />

      {/* Position / size — all elements */}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px]">X (%)</Label>
          <Input type="number" min={0} max={100} value={Math.round(el.x)} className="h-7 text-xs"
            onChange={e => set('x', parseFloat(e.target.value) || 0)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px]">Y (%)</Label>
          <Input type="number" min={0} max={100} value={Math.round(el.y)} className="h-7 text-xs"
            onChange={e => set('y', parseFloat(e.target.value) || 0)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px]">W (%)</Label>
          <Input type="number" min={1} max={100} value={Math.round(el.width)} className="h-7 text-xs"
            onChange={e => set('width', parseFloat(e.target.value) || 10)} />
        </div>
      </div>

      {/* Gradient */}
      {el.type === 'gradient' && (
        <>
          <div className="space-y-1">
            <Label className="text-[10px]">Direction</Label>
            <select value={el.direction ?? 'bottom'}
              onChange={e => set('direction', e.target.value)}
              className="w-full h-7 rounded-md border border-input bg-transparent px-2 text-xs">
              <option value="bottom">↑ From bottom</option>
              <option value="top">↓ From top</option>
              <option value="left">→ From left</option>
              <option value="right">← From right</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Color source (end stop)</Label>
            <div className="flex gap-2">
              {(['category', 'fixed'] as const).map(src => (
                <button key={src} type="button"
                  onClick={() => set('colorSource', src)}
                  className={`flex-1 rounded border py-1 text-[10px] transition-colors ${
                    (el.colorSource ?? 'category') === src
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-secondary'
                  }`}>
                  {src === 'category' ? 'Category' : 'Fixed'}
                </button>
              ))}
            </div>
          </div>
          {el.colorSource === 'fixed' && (
            <div className="space-y-1">
              <Label className="text-[10px]">End color</Label>
              <input type="color" value={el.fixedColor ?? '#000000'}
                onChange={e => set('fixedColor', e.target.value)}
                className="h-7 w-full rounded border border-input cursor-pointer" />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-[10px]">End opacity</Label>
            <input type="range" min={0} max={1} step={0.05} value={el.opacity ?? 0.85}
              className="w-full h-2 accent-primary"
              onChange={e => set('opacity', parseFloat(e.target.value))} />
            <span className="text-[10px] text-muted-foreground">{((el.opacity ?? 0.85) * 100).toFixed(0)}%</span>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Start color</Label>
            <input type="color" value={el.startColor ?? '#000000'}
              onChange={e => set('startColor', e.target.value)}
              className="h-7 w-full rounded border border-input cursor-pointer" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Start opacity</Label>
            <input type="range" min={0} max={1} step={0.05} value={el.startOpacity ?? 0}
              className="w-full h-2 accent-primary"
              onChange={e => set('startOpacity', parseFloat(e.target.value))} />
            <span className="text-[10px] text-muted-foreground">{((el.startOpacity ?? 0) * 100).toFixed(0)}%</span>
          </div>
        </>
      )}

      {/* Title */}
      {el.type === 'title' && (
        <>
          <div className="space-y-1">
            <Label className="text-[10px]">Font</Label>
            <select value={el.fontFamily ?? ''}
              onChange={e => set('fontFamily', e.target.value || undefined)}
              className="w-full h-7 rounded-md border border-input bg-transparent px-2 text-xs"
              style={{ fontFamily: el.fontFamily ?? undefined }}>
              <option value="">System (Arial)</option>
              {GOOGLE_FONTS.map(f => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Font size (px @ 1080px)</Label>
            <Input type="number" min={10} max={120} value={el.fontSize ?? 52} className="h-7 text-xs"
              onChange={e => set('fontSize', parseFloat(e.target.value) || 52)} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Alignment</Label>
            <div className="flex gap-1">
              {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([val, Icon]) => (
                <button key={val} type="button"
                  onClick={() => set('textAlign', val)}
                  className={`flex-1 flex items-center justify-center rounded border py-1 transition-colors ${
                    (el.textAlign ?? 'left') === val
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-secondary'
                  }`}>
                  <Icon className="h-3 w-3" />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Transform</Label>
            <select value={el.textTransform ?? 'none'}
              onChange={e => set('textTransform', e.target.value)}
              className="w-full h-7 rounded-md border border-input bg-transparent px-2 text-xs">
              <option value="none">None</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
              <option value="capitalize">Capitalize</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Color</Label>
            <input type="color" value={el.color ?? '#ffffff'}
              onChange={e => set('color', e.target.value)}
              className="h-7 w-full rounded border border-input cursor-pointer" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Max lines</Label>
            <Input type="number" min={1} max={5} value={el.maxLines ?? 4} className="h-7 text-xs"
              onChange={e => set('maxLines', parseInt(e.target.value) || 4)} />
          </div>
        </>
      )}

      {/* Category */}
      {el.type === 'category' && (
        <>
          <div className="space-y-1">
            <Label className="text-[10px]">Font</Label>
            <select value={el.fontFamily ?? ''}
              onChange={e => set('fontFamily', e.target.value || undefined)}
              className="w-full h-7 rounded-md border border-input bg-transparent px-2 text-xs">
              <option value="">System (Arial)</option>
              {GOOGLE_FONTS.map(f => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Font size</Label>
            <Input type="number" min={8} max={60} value={el.fontSize ?? 18} className="h-7 text-xs"
              onChange={e => set('fontSize', parseFloat(e.target.value) || 18)} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Transform</Label>
            <select value={el.textTransform ?? 'none'}
              onChange={e => set('textTransform', e.target.value)}
              className="w-full h-7 rounded-md border border-input bg-transparent px-2 text-xs">
              <option value="none">None</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
              <option value="capitalize">Capitalize</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Text color</Label>
            <input type="color" value={el.textColor ?? '#ffffff'}
              onChange={e => set('textColor', e.target.value)}
              className="h-7 w-full rounded border border-input cursor-pointer" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Badge style</Label>
            <div className="flex gap-2">
              {(['pill', 'square'] as const).map(s => (
                <button key={s} type="button"
                  onClick={() => set('badgeStyle', s)}
                  className={`flex-1 rounded border py-1 text-[10px] transition-colors ${
                    (el.badgeStyle ?? 'pill') === s
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-secondary'
                  }`}>
                  {s === 'pill' ? 'Pill' : 'Square'}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Domain */}
      {el.type === 'domain' && (
        <>
          <div className="space-y-1">
            <Label className="text-[10px]">Text</Label>
            <Input value={el.text ?? ''} placeholder="yoursite.com" className="h-7 text-xs"
              onChange={e => set('text', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Font</Label>
            <select value={el.fontFamily ?? ''}
              onChange={e => set('fontFamily', e.target.value || undefined)}
              className="w-full h-7 rounded-md border border-input bg-transparent px-2 text-xs">
              <option value="">System (Arial)</option>
              {GOOGLE_FONTS.map(f => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Font size</Label>
            <Input type="number" min={8} max={60} value={el.fontSize ?? 20} className="h-7 text-xs"
              onChange={e => set('fontSize', parseFloat(e.target.value) || 20)} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Alignment</Label>
            <div className="flex gap-1">
              {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([val, Icon]) => (
                <button key={val} type="button"
                  onClick={() => set('textAlign', val)}
                  className={`flex-1 flex items-center justify-center rounded border py-1 transition-colors ${
                    (el.textAlign ?? 'left') === val
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-secondary'
                  }`}>
                  <Icon className="h-3 w-3" />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Transform</Label>
            <select value={el.textTransform ?? 'none'}
              onChange={e => set('textTransform', e.target.value)}
              className="w-full h-7 rounded-md border border-input bg-transparent px-2 text-xs">
              <option value="none">None</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
              <option value="capitalize">Capitalize</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Color</Label>
            <input type="color" value={(el.color ?? '#ffffff').slice(0, 7)}
              onChange={e => set('color', e.target.value)}
              className="h-7 w-full rounded border border-input cursor-pointer" />
          </div>
        </>
      )}

      {/* Logo — width only */}
      {el.type === 'logo' && (
        <p className="text-[10px] text-muted-foreground">Width controls size; aspect ratio is preserved.</p>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

const PLATFORM_CLASS: Record<string, string> = {
  FACEBOOK:  'bg-blue-600 text-white',
  INSTAGRAM: 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 text-white',
}

export function SocialTemplates() {
  const qc = useQueryClient()

  useEffect(() => { injectGoogleFonts() }, [])

  // Template list state
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [isNew, setIsNew]                 = useState(false)

  // Editable template fields
  const [elements, setElements]           = useState<TemplateElement[]>([])
  const [name, setName]                   = useState('')
  const [platform, setPlatform]           = useState<'FACEBOOK' | 'INSTAGRAM'>('FACEBOOK')
  const [logoUrl, setLogoUrl]             = useState<string | null>(null)

  // Canvas
  const canvasRef                         = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize]       = useState(600)
  const [selectedElId, setSelectedElId]  = useState<string | null>(null)

  // Preview
  const [previewPostId, setPreviewPostId] = useState('')
  const [previewUrl, setPreviewUrl]       = useState<string | null>(null)
  const [previewOpen, setPreviewOpen]     = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Logo upload
  const [logoUploading, setLogoUploading] = useState(false)
  const logoInputRef                      = useRef<HTMLInputElement>(null)

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: templates, isLoading: templatesLoading } = useQuery<ImageTemplate[]>({
    queryKey: ['image-templates'],
    queryFn: imageTemplatesApi.list,
  })

  const { data: postsData } = useQuery<any>({
    queryKey: ['posts-preview-pick'],
    queryFn: () => postsApi.list({ page: 1, limit: 30 }),
  })
  const posts = postsData?.posts ?? postsData?.items ?? []
  const previewPost = posts.find((p: any) => p.id === previewPostId) ?? posts[0] ?? null

  useEffect(() => {
    if (posts.length && !previewPostId) setPreviewPostId(posts[0]?.id ?? '')
  }, [posts])

  // ── Canvas size tracking ────────────────────────────────────────────────────

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setCanvasSize(entry.contentRect.width)
    })
    observer.observe(el)
    setCanvasSize(el.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])

  // ── Load template into editor ───────────────────────────────────────────────

  function loadTemplate(t: ImageTemplate) {
    setSelectedId(t.id)
    setName(t.name)
    setPlatform(t.platform)
    setElements(t.elements ?? [])
    setLogoUrl(t.logoUrl)
    setSelectedElId(null)
    setIsNew(false)
  }

  function startNew() {
    setSelectedId(null)
    setName('')
    setPlatform('FACEBOOK')
    setElements([])
    setLogoUrl(null)
    setSelectedElId(null)
    setIsNew(true)
  }

  // ── Mutations ───────────────────────────────────────────────────────────────

  const save = useMutation({
    mutationFn: () => {
      const body = { name, platform, elements }
      if (isNew || !selectedId) return imageTemplatesApi.create(body)
      return imageTemplatesApi.update(selectedId, body)
    },
    onSuccess: (saved: ImageTemplate) => {
      qc.invalidateQueries({ queryKey: ['image-templates'] })
      toast.success(isNew ? 'Template created' : 'Template saved')
      setSelectedId(saved.id)
      setIsNew(false)
    },
    onError: () => toast.error('Save failed'),
  })

  // ── Element management ──────────────────────────────────────────────────────

  function addElement(type: ElementType) {
    const el = newElement(type)
    setElements(prev => [...prev, el])
    setSelectedElId(el.id)
  }

  function updateElement(updated: TemplateElement) {
    setElements(prev => prev.map(e => e.id === updated.id ? updated : e))
  }

  function deleteElement(id: string) {
    setElements(prev => prev.filter(e => e.id !== id))
    if (selectedElId === id) setSelectedElId(null)
  }

  const selectedEl = elements.find(e => e.id === selectedElId)

  // ── Drag/resize helpers ─────────────────────────────────────────────────────

  const pxToPercent = useCallback((px: number) => (px / canvasSize) * 100, [canvasSize])

  function onDragStop(el: TemplateElement, d: { x: number; y: number }) {
    updateElement({ ...el, x: pxToPercent(d.x), y: pxToPercent(d.y) })
  }

  function onResizeStop(
    el: TemplateElement,
    _e: unknown,
    _dir: unknown,
    ref: HTMLElement,
    _delta: unknown,
    pos: { x: number; y: number }
  ) {
    updateElement({
      ...el,
      x: pxToPercent(pos.x),
      y: pxToPercent(pos.y),
      width: pxToPercent(ref.offsetWidth),
    })
  }

  // ── Logo upload ─────────────────────────────────────────────────────────────

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !selectedId) return
    setLogoUploading(true)
    try {
      const reader = new FileReader()
      const base64: string = await new Promise((res, rej) => {
        reader.onload = () => res((reader.result as string).split(',')[1])
        reader.onerror = rej
        reader.readAsDataURL(file)
      })
      const result = await imageTemplatesApi.uploadLogo(selectedId, base64, file.type)
      setLogoUrl(result.logoUrl ?? result.url ?? null)
      toast.success('Logo uploaded')
    } catch {
      toast.error('Logo upload failed')
    } finally {
      setLogoUploading(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  // ── Preview ─────────────────────────────────────────────────────────────────

  async function renderPreview() {
    if (!selectedId || !previewPostId) return
    setPreviewLoading(true)
    try {
      const blob = await imageTemplatesApi.preview(selectedId, previewPostId)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(URL.createObjectURL(blob))
      setPreviewOpen(true)
    } catch {
      toast.error('Preview render failed')
    } finally {
      setPreviewLoading(false)
    }
  }

  const hasContent = isNew || !!selectedId

  // ── Gradient element height = full canvas ───────────────────────────────────
  function elementHeightPx(el: TemplateElement): number | string {
    if (el.type === 'gradient') return canvasSize
    if (el.type === 'logo') return (el.width / 100) * canvasSize
    return 'auto'
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel: template list + add elements ───────────────────────── */}
      <div className="w-56 shrink-0 border-r border-border flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <span className="text-xs font-semibold">Image Templates</span>
          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={startNew}>
            <Plus className="h-3 w-3 mr-1" />New
          </Button>
        </div>

        {/* Template list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
          {templatesLoading
            ? [...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-md" />)
            : !templates?.length && !isNew
              ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                  <Frame className="h-6 w-6 opacity-30" />
                  <p className="text-[10px] text-center">No templates yet.</p>
                </div>
              )
              : templates?.map(t => (
                <button
                  key={t.id}
                  onClick={() => loadTemplate(t)}
                  className={`w-full text-left rounded-md px-2.5 py-2 text-xs transition-colors border ${
                    selectedId === t.id && !isNew
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'border-transparent hover:bg-secondary text-foreground'
                  }`}
                >
                  <p className="font-medium truncate">{t.name || 'Untitled'}</p>
                  <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium mt-0.5 ${PLATFORM_CLASS[t.platform]}`}>
                    {t.platform === 'FACEBOOK' ? 'Facebook' : 'Instagram'}
                  </span>
                </button>
              ))
          }
          {isNew && (
            <div className="w-full rounded-md px-2.5 py-2 text-xs bg-primary/10 border border-primary/30 text-primary">
              <p className="font-medium">New template</p>
              <span className="text-[10px] opacity-70">unsaved</span>
            </div>
          )}
        </div>

        {/* Add elements section */}
        {hasContent && (
          <>
            <Separator />
            <div className="p-2.5 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">Add Element</p>
              {([
                ['gradient', 'Gradient', Layers],
                ['title',    'Title',    Type],
                ['category', 'Category', Tag],
                ['domain',   'Domain',   Move],
              ] as [ElementType, string, React.ComponentType<{ className?: string }>][]).map(([type, label, Icon]) => (
                <Button key={type} variant="outline" size="sm"
                  className="w-full h-7 text-[11px] justify-start"
                  onClick={() => addElement(type)}>
                  <Icon className="h-3 w-3 mr-1.5" />+ {label}
                </Button>
              ))}
              <Button
                variant="outline" size="sm"
                className="w-full h-7 text-[11px] justify-start"
                disabled={!logoUrl}
                onClick={() => addElement('logo')}
              >
                <Image className="h-3 w-3 mr-1.5" />+ Logo
              </Button>

              <Separator className="my-1" />

              {/* Logo upload */}
              <div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/svg+xml"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
                <Button
                  variant="outline" size="sm"
                  className="w-full h-7 text-[11px] justify-start"
                  disabled={!selectedId || logoUploading}
                  onClick={() => logoInputRef.current?.click()}
                >
                  {logoUploading
                    ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                    : <Image className="h-3 w-3 mr-1.5" />}
                  {logoUrl ? 'Replace logo' : 'Upload logo'}
                </Button>
                {!selectedId && (
                  <p className="text-[9px] text-muted-foreground mt-1 px-0.5">Save template first to upload logo</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Middle: header + canvas ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {!hasContent ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <Frame className="h-12 w-12 opacity-20" />
            <p className="text-sm">Select a template to edit, or create a new one</p>
            <Button variant="outline" onClick={startNew}><Plus className="h-3.5 w-3.5 mr-1.5" />New Template</Button>
          </div>
        ) : (
          <>
            {/* Header bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Template name…"
                className="h-7 text-sm flex-1 max-w-xs"
              />
              <div className="flex gap-1">
                {(['FACEBOOK', 'INSTAGRAM'] as const).map(p => (
                  <button key={p} type="button" onClick={() => setPlatform(p)}
                    className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                      platform === p
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border text-muted-foreground hover:bg-secondary'
                    }`}>
                    {p === 'FACEBOOK' ? 'Facebook' : 'Instagram'}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <Button size="sm" className="h-7 text-xs" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
                {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Save
              </Button>
            </div>

            {/* Canvas area */}
            <div className="flex-1 overflow-auto bg-muted/30 flex flex-col items-center justify-start p-4 gap-3 min-h-0">
              {/* The canvas */}
              <div
                ref={canvasRef}
                style={{
                  width: `min(calc(100vh - 160px), 560px)`,
                  aspectRatio: '1/1',
                  position: 'relative',
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
                className="rounded-lg shadow-xl border border-border bg-zinc-900"
                onClick={(e) => { if (e.target === e.currentTarget) setSelectedElId(null) }}
              >
                {/* Background image */}
                {previewPost?.imageUrl ? (
                  <img
                    src={previewPost.imageUrl}
                    alt=""
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                  />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', pointerEvents: 'none' }} />
                )}

                {/* Elements */}
                {elements.map(el => {
                  const x = (el.x / 100) * canvasSize
                  const y = (el.y / 100) * canvasSize
                  const w = (el.width / 100) * canvasSize
                  const h = elementHeightPx(el)
                  return (
                    <Rnd
                      key={el.id}
                      position={{ x, y }}
                      size={{ width: w, height: h }}
                      bounds="parent"
                      disableDragging={el.type === 'gradient'}
                      enableResizing={el.type !== 'gradient' ? {
                        right: true, left: true,
                        top: false, bottom: false,
                        topLeft: false, topRight: false, bottomLeft: false, bottomRight: false,
                      } : false}
                      onDragStop={(_e, d) => onDragStop(el, d)}
                      onResizeStop={(e, dir, ref, delta, pos) => onResizeStop(el, e, dir, ref, delta, pos)}
                      onClick={() => setSelectedElId(el.id)}
                      style={{ zIndex: el.type === 'gradient' ? 1 : 2 }}
                    >
                      <ElementVisual
                        el={el}
                        canvasSize={canvasSize}
                        logoUrl={logoUrl}
                        selected={selectedElId === el.id}
                        onClick={() => setSelectedElId(el.id)}
                      />
                    </Rnd>
                  )
                })}

                {/* Empty hint */}
                {elements.length === 0 && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center' }}>
                      Add elements from the left panel
                    </p>
                  </div>
                )}
              </div>

              {/* Preview controls */}
              <div className="flex items-center gap-2 shrink-0">
                {posts.length > 0 && (
                  <select
                    value={previewPostId}
                    onChange={e => setPreviewPostId(e.target.value)}
                    className="h-7 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground max-w-[260px]"
                  >
                    {posts.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.title?.slice(0, 55)}</option>
                    ))}
                  </select>
                )}
                <Button
                  variant="outline" size="sm" className="h-7 text-xs"
                  disabled={!selectedId || !previewPostId || previewLoading}
                  onClick={renderPreview}
                >
                  {previewLoading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    : <Eye className="h-3.5 w-3.5 mr-1" />}
                  Render preview
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Right panel: properties ────────────────────────────────────────── */}
      {hasContent && (
        <div className="w-52 shrink-0 border-l border-border flex flex-col h-full">
          <div className="px-3 py-2.5 border-b border-border">
            <span className="text-xs font-semibold">Properties</span>
          </div>
          <PropsPanel
            el={selectedEl}
            onChange={updateElement}
            onDelete={() => selectedElId && deleteElement(selectedElId)}
          />
        </div>
      )}

      {/* ── Preview dialog ─────────────────────────────────────────────────── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Rendered Preview</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <img src={previewUrl} alt="Preview" className="w-full rounded-md" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
