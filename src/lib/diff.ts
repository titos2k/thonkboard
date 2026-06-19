export interface DiffChunk {
  value: string
  added?: boolean
  removed?: boolean
}

export function diffWords(oldText: string, newText: string): DiffChunk[] {
  // Tokenise preserving whitespace as separate tokens
  const tokenize = (s: string) => s.match(/\S+|\s+/g) ?? []
  const a = tokenize(oldText)
  const b = tokenize(newText)

  // Build LCS length table
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])

  // Traceback to produce chunks
  const chunks: DiffChunk[] = []
  let i = m, j = n
  const ops: Array<'same' | 'add' | 'remove'> = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) { ops.push('same'); i--; j-- }
    else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { ops.push('add'); j-- }
    else { ops.push('remove'); i-- }
  }
  ops.reverse()

  // Merge consecutive same-kind ops into chunks
  let ai = 0, bi = 0
  for (const op of ops) {
    const token = op === 'add' ? b[bi] : a[ai]
    const last = chunks[chunks.length - 1]
    if (op === 'same') {
      if (last && !last.added && !last.removed) last.value += token
      else chunks.push({ value: token })
      ai++; bi++
    } else if (op === 'add') {
      if (last?.added) last.value += token
      else chunks.push({ value: token, added: true })
      bi++
    } else {
      if (last?.removed) last.value += token
      else chunks.push({ value: token, removed: true })
      ai++
    }
  }

  return chunks
}
