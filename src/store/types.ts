export type NodeType = 'core' | 'idea' | 'problem' | 'question' | 'answer' | 'note'

export type EdgeRelation =
  | 'spawns'
  | 'questions'
  | 'answers'
  | 'argues'
  | 'fixes'
  | 'expands'

export interface ConflictEntry {
  nodeId: string
  description: string
}

export interface GroundingChunk {
  title: string
  uri: string
}

export interface ThonkNode {
  id: string
  type: NodeType
  title: string
  body: string        // full markdown description (edited in panel)
  summary: string     // AI-generated 1-2 sentence summary; empty until generated
  resolved: boolean        // true when the Q&A pair has been closed (merged or closed)
  resolvedAs?: 'merged' | 'closed' | 'rejected'
  unread?: boolean         // true when AI has updated this node's body since the user last opened Details
  conflicts: ConflictEntry[]  // contradictions detected with other nodes after approval
  position: { x: number; y: number }
  meta: {
    createdAt: string
    severity: number | null   // 0–1, only on problem nodes
    revisionOf: string | null // id of prior core this replaces
    aiGenerated?: boolean     // true for AI-proposed answers
    yesNo?: boolean           // true when AI classified this as a yes/no question
    sources?: GroundingChunk[] // web sources when Gemini used search grounding
    aiDepth?: number          // AI generation depth; absent/0 = human-authored
  }
}

export interface ThonkEdge {
  id: string
  source: string
  target: string
  relation: EdgeRelation
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface ThonkGraph {
  nodes: ThonkNode[]
  edges: ThonkEdge[]
}
