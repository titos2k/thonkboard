import type { ThonkGraph, ThonkNode } from '../store/types'

const STOPWORDS = new Set(['a','an','the','is','it','in','of','to','and','or','for','with','this','that','not','be','are'])

function tokenize(text: string): Map<string, number> {
  const freq = new Map<string, number>()
  for (const w of text.toLowerCase().match(/\b\w{3,}\b/g) ?? []) {
    if (!STOPWORDS.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1)
  }
  return freq
}

function scoreSimilarity(a: string, b: string): number {
  const fa = tokenize(a), fb = tokenize(b)
  let dot = 0
  for (const [w, n] of fa) if (fb.has(w)) dot += n * fb.get(w)!
  const magA = Math.sqrt([...fa.values()].reduce((s, n) => s + n * n, 0))
  const magB = Math.sqrt([...fb.values()].reduce((s, n) => s + n * n, 0))
  return magA && magB ? dot / (magA * magB) : 0
}

export interface AssembledContext {
  target: ThonkNode
  neighbors: ThonkNode[]
  skeleton: {
    nodes: Array<{ id: string; type: string; title: string }>
    edges: Array<{ source: string; target: string; relation: string }>
  }
}

export function assembleContext(graph: ThonkGraph, targetId: string): AssembledContext | null {
  const target = graph.nodes.find(n => n.id === targetId)
  if (!target) return null

  const connectedIds = new Set<string>()
  for (const e of graph.edges) {
    if (e.source === targetId) connectedIds.add(e.target)
    if (e.target === targetId) connectedIds.add(e.source)
  }
  connectedIds.delete(targetId)

  const neighbors = graph.nodes.filter(n => connectedIds.has(n.id) && n.type !== 'note')

  const skeleton = {
    nodes: graph.nodes.filter(n => n.type !== 'note').map(n => ({ id: n.id, type: n.type, title: n.title })),
    edges: graph.edges.map(e => ({ source: e.source, target: e.target, relation: e.relation })),
  }

  return { target, neighbors, skeleton }
}

export function contextToPrompt(ctx: AssembledContext): string {
  const lines: string[] = []

  lines.push(`TARGET NODE (${ctx.target.type.toUpperCase()})`)
  lines.push(`Title: ${ctx.target.title}`)
  lines.push(`Body: ${ctx.target.body}`)
  lines.push('')

  if (ctx.neighbors.length > 0) {
    lines.push('CONNECTED NODES (full detail):')
    for (const n of ctx.neighbors) {
      lines.push(`- [${n.type}] ${n.title}: ${n.body}`)
    }
    lines.push('')
  }

  lines.push('BOARD SKELETON (all nodes, title only):')
  for (const n of ctx.skeleton.nodes) {
    lines.push(`- [${n.id}] [${n.type}] ${n.title}`)
  }
  lines.push('')
  lines.push('EDGES:')
  for (const e of ctx.skeleton.edges) {
    lines.push(`- ${e.source.slice(0, 8)} --${e.relation}--> ${e.target.slice(0, 8)}`)
  }

  return lines.join('\n')
}

export function assembleContextSemantic(graph: ThonkGraph, targetId: string): string | null {
  const ctx = assembleContext(graph, targetId)
  if (!ctx) return null

  const neighborIds = new Set(ctx.neighbors.map(n => n.id))
  const query = `${ctx.target.title} ${ctx.target.body}`

  const candidates = graph.nodes.filter(
    n => n.type !== 'note' && n.id !== targetId && !neighborIds.has(n.id)
  )

  const scored = candidates.map(n => ({
    node: n,
    score: scoreSimilarity(query, `${n.title} ${n.body}`) + (n.type === 'core' ? 0.3 : 0),
  }))
  scored.sort((a, b) => b.score - a.score)
  const topK = scored.slice(0, 5).filter(s => s.score > 0.05)

  const lines: string[] = []
  lines.push(`TARGET NODE (${ctx.target.type.toUpperCase()})`)
  lines.push(`Title: ${ctx.target.title}`)
  lines.push(`Body: ${ctx.target.body}`)
  lines.push('')

  if (ctx.neighbors.length > 0) {
    lines.push('CONNECTED NODES (full detail):')
    for (const n of ctx.neighbors) lines.push(`- [${n.type}] ${n.title}: ${n.body}`)
    lines.push('')
  }

  if (topK.length > 0) {
    lines.push('RELEVANT CONTEXT (related nodes, summary only):')
    for (const { node: n } of topK) {
      lines.push(`- [${n.type}] ${n.title}: ${n.summary || n.body.slice(0, 120)}`)
    }
  }

  return lines.join('\n')
}
