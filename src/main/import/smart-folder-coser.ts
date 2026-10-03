export type SmartCoserIndexItem = { id: string; name: string; aliases: string[] }
export type SmartFolderCoserCandidate = { id: string; name: string; aliases: string[]; score: number }
export type SmartFolderImportStatus = 'matching' | 'queued' | 'review' | 'committing' | 'imported' | 'skipped' | 'failed'
export type SmartFolderImportItem = {
  id: string
  sourceName: string
  parentName: string
  status: SmartFolderImportStatus
  candidates: SmartFolderCoserCandidate[]
  recommendedCoserId: string | null
  evidence: string
  reason: string
  proposedName: string
  saveAlias: boolean
}
export type SmartFolderImportSession = { id: string; items: SmartFolderImportItem[] }
export type SmartFolderImportDecision = { itemId: string; action: 'assign' | 'library' | 'skip' | 'create'; coserId?: string; newName?: string; saveAlias?: boolean; alias?: string }
export type SmartFolderCoserSettings = { enabled: boolean; baseUrl: string; model: string }
export type SmartFolderModelResult = { status: 'matched' | 'ambiguous' | 'new' | 'unknown'; coserId: string; proposedName: string; evidence: string; reason: string }

const SEPARATORS = /[\s._\-—–()[\]{}（）【】「」『』〈〉《》·•,:，、]+/u

export function normalizeCoserText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function normalizeFolderImportIdentity(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/gu, ' ')
}

function nameTokens(value: string): string[] {
  return value.normalize('NFKC').split(SEPARATORS).map(normalizeCoserText).filter(Boolean)
}

export function findFolderCoserMatches(folderName: string, parentName: string, cosers: SmartCoserIndexItem[]): string[] {
  const findIn = (text: string): Set<string> => {
    const tokens = new Set(nameTokens(text))
    const matches = new Set<string>()
    for (const coser of cosers) {
      const terms = [coser.name, ...coser.aliases].map(normalizeCoserText).filter((term) => term.length >= 2)
      if (terms.some((term) => tokens.has(term))) matches.add(coser.id)
    }
    return matches
  }

  const folderMatches = findIn(folderName)
  const parentMatches = findIn(parentName)
  if (folderMatches.size && parentMatches.size) {
    const shared = [...folderMatches].filter((id) => parentMatches.has(id))
    return shared.length ? shared : [...new Set([...folderMatches, ...parentMatches])]
  }
  return [...new Set([...folderMatches, ...parentMatches])]
}

function bigramDice(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  if (Math.min(left.length, right.length) < 2) return 0
  const grams = (text: string): Map<string, number> => {
    const result = new Map<string, number>()
    for (let index = 0; index + 1 < text.length; index += 1) {
      const gram = text.slice(index, index + 2)
      result.set(gram, (result.get(gram) ?? 0) + 1)
    }
    return result
  }
  const first = grams(left)
  const second = grams(right)
  let overlap = 0
  for (const [gram, count] of first) overlap += Math.min(count, second.get(gram) ?? 0)
  const total = [...first.values()].reduce((sum, count) => sum + count, 0) + [...second.values()].reduce((sum, count) => sum + count, 0)
  return total ? 2 * overlap / total : 0
}

export function rankFolderCoserCandidates(folderName: string, parentName: string, cosers: SmartCoserIndexItem[], limit = 10): SmartFolderCoserCandidate[] {
  const contexts = [normalizeCoserText(folderName), normalizeCoserText(parentName)].filter(Boolean).map((value) => value.slice(0, 240))
  const rawInput = contexts.join(' ').slice(0, 320)
  const exactTokens = new Set([...nameTokens(folderName), ...nameTokens(parentName)])
  return cosers.map((coser) => {
    const terms = [coser.name, ...coser.aliases]
    const score = Math.max(...terms.map((term) => {
      const normalized = normalizeCoserText(term)
      if (exactTokens.has(normalized)) return 1
      const substringScore = Math.max(0, ...contexts.filter((context) => context.includes(normalized)).map((context) => 0.8 + 0.19 * normalized.length / context.length))
      return Math.max(substringScore, bigramDice(rawInput.replace(/\s/g, ''), normalized))
    }))
    return { ...coser, score }
  }).filter((candidate) => candidate.score > 0).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name)).slice(0, Math.max(1, limit))
}

export function validateFolderCoserModelResult(result: SmartFolderModelResult, item: Pick<SmartFolderImportItem, 'sourceName' | 'parentName'>, candidates: SmartCoserIndexItem[]): SmartFolderModelResult | null {
  if (!result || !['matched', 'ambiguous', 'new', 'unknown'].includes(result.status) || typeof result.evidence !== 'string' || typeof result.reason !== 'string' || typeof result.proposedName !== 'string' || typeof result.coserId !== 'string') return null
  const evidence = normalizeFolderImportIdentity(result.evidence)
  if (!evidence || ![item.sourceName, item.parentName].some((value) => normalizeFolderImportIdentity(value).includes(evidence))) return null
  if (result.status === 'matched' && (!candidates.some((candidate) => candidate.id === result.coserId) || !result.coserId || result.proposedName)) return null
  if (result.status === 'new' && (result.coserId !== 'none' || !result.proposedName || evidence !== normalizeFolderImportIdentity(result.proposedName))) return null
  if ((result.status === 'ambiguous' || result.status === 'unknown') && (result.coserId !== 'none' || result.proposedName)) return null
  return { ...result, evidence: result.evidence.slice(0, 160), reason: result.reason.slice(0, 240), proposedName: result.proposedName.slice(0, 80) }
}
