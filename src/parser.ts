export type ContentBlock = {
  id: string
  marker: string
  key: string
  heading: string
  content: string
  originalContent: string
  valueStart: number
  valueEnd: number
}

export type ParsedDocument = {
  source: string
  blocks: ContentBlock[]
}

/**
 * Parses one configuration per `key=value` line. Lines beginning with `#`
 * are comments: they are ignored here and retained verbatim during save.
 */
export function parseDocument(source: string): ParsedDocument {
  const matcher = /^([^\r\n=#][^=\r\n]*?)=(.*?)(\r?)(?=\n|$)/gm
  const blocks: ContentBlock[] = []
  let match: RegExpExecArray | null

  while ((match = matcher.exec(source)) !== null) {
    const rawKey = match[1]
    const value = match[2]
    const valueStart = match.index + rawKey.length + 1
    blocks.push({
      id: `block-${blocks.length}`,
      marker: '',
      key: rawKey.trim() || '未命名 key',
      heading: '',
      content: value,
      originalContent: value,
      valueStart,
      valueEnd: valueStart + value.length,
    })
  }

  return { source, blocks }
}

export function getJsonObjectInfo(content: string): { keyCount: number } | null {
  const candidate = content.trim()
  if (!candidate) return null

  try {
    const value: unknown = JSON.parse(candidate)
    if (value === null || Array.isArray(value) || typeof value !== 'object') return null
    return { keyCount: Object.keys(value).length }
  } catch {
    return null
  }
}

/**
 * Whitespace-only JSON compaction. It intentionally does not stringify an
 * object, so original key ordering and literal spellings stay intact.
 */
function compactJsonObjectContent(content: string): string {
  const leading = content.match(/^\s*/)?.[0] ?? ''
  const trailing = content.match(/\s*$/)?.[0] ?? ''
  const core = content.slice(leading.length, content.length - trailing.length)

  try {
    JSON.parse(core)
  } catch {
    return content
  }

  let output = ''
  let inString = false
  let escaped = false
  for (const character of core) {
    if (inString) {
      output += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
    } else if (character === '"') {
      inString = true
      output += character
    } else if (!/\s/.test(character)) {
      output += character
    }
  }
  return `${leading}${output}${trailing}`
}

export function serializeDocument(document: ParsedDocument, compactJson = false): string {
  let output = document.source
  for (const block of [...document.blocks].reverse()) {
    const content = compactJson ? compactJsonObjectContent(block.content) : block.content
    output = `${output.slice(0, block.valueStart)}${content}${output.slice(block.valueEnd)}`
  }
  return output
}
