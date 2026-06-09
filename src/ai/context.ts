import type { ThonkGraph, ThonkNode } from '../store/types'

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

  const neighbors = graph.nodes.filter(n => connectedIds.has(n.id))

  const skeleton = {
    nodes: graph.nodes.map(n => ({ id: n.id, type: n.type, title: n.title })),
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
