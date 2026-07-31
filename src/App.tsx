import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Editor, { type BeforeMount } from '@monaco-editor/react'
import { List, useListRef, type RowComponentProps } from 'react-window'
import { getJsonObjectInfo, parseDocument, serializeDocument, type ContentBlock, type ParsedDocument } from './parser'

type Toast = { message: string; tone: 'success' | 'error' } | null

const focusRing = 'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#FFF,0_0_0_4px_#0072F5]'
const buttonBase = `inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[6px] px-3 text-sm font-normal ${focusRing}`

const example = `# 基础配置
model=gpt-5
temperature=0.7

## 欢迎语
welcome=欢迎使用 Paladin 编辑器。

# 检索配置
topK=8
enabled=true
`

function Icon({ name, className = 'size-4' }: { name: 'copy' | 'search' | 'paste' | 'arrow' | 'close'; className?: string }) {
  const paths = {
    copy: <><rect x="8" y="8" width="10" height="10" rx="1" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    search: <><circle cx="10.8" cy="10.8" r="5.8" /><path d="m16 16 4 4" /></>,
    paste: <><path d="M9 5h6" /><path d="M9 3h6v4H9z" /><rect x="5" y="5" width="14" height="16" rx="2" /><path d="M8 13h8M8 17h5" /></>,
    arrow: <path d="m9 18 6-6-6-6" />,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  }[name]
  return <svg className={`${className} shrink-0 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]`} viewBox="0 0 24 24" aria-hidden="true">{paths}</svg>
}

function snippet(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160) || '空内容'
}

function matchedSnippet(value: string, query: string) {
  const source = value.replace(/\s+/g, ' ').trim() || '空内容'
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return source.slice(0, 220)

  const matchIndex = source.toLocaleLowerCase().indexOf(needle)
  if (matchIndex === -1) return source.slice(0, 220)

  const start = Math.max(0, matchIndex - 80)
  const end = Math.min(source.length, matchIndex + needle.length + 120)
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`
}

function formatJsonValue(content: string) {
  const candidate = content.trim()
  if (!candidate) return content

  try {
    return JSON.stringify(JSON.parse(candidate), null, 2)
  } catch {
    return content
  }
}

function matches(block: ContentBlock, query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  return !normalized || `${block.key}\n${block.content}`.toLocaleLowerCase().includes(normalized)
}

function highlightValue(value: string, query: string): ReactNode {
  const needle = query.trim()
  if (!needle) return value || '空内容'

  const source = value || '空内容'
  const lowerSource = source.toLocaleLowerCase()
  const lowerNeedle = needle.toLocaleLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let matchIndex = lowerSource.indexOf(lowerNeedle)

  while (matchIndex !== -1) {
    if (matchIndex > cursor) parts.push(source.slice(cursor, matchIndex))
    parts.push(
      <mark className="rounded-[3px] bg-[#E5484D] px-0.5 text-white" key={`${matchIndex}-${cursor}`}>
        {source.slice(matchIndex, matchIndex + needle.length)}
      </mark>,
    )
    cursor = matchIndex + needle.length
    matchIndex = lowerSource.indexOf(lowerNeedle, cursor)
  }

  parts.push(source.slice(cursor))
  return parts
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = window.document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  window.document.body.append(textarea)
  textarea.select()
  const copied = window.document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Clipboard unavailable')
}

function blockHeight(content: string) {
  return Math.max(260, Math.min(560, content.split(/\r?\n/).length * 20 + 96))
}

export default function App() {
  const [document, setDocument] = useState<ParsedDocument | null>(null)
  const [draft, setDraft] = useState('')
  const [showImporter, setShowImporter] = useState(true)
  const [showSearch, setShowSearch] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState<Toast>(null)

  const visibleBlocks = useMemo(
    () => document?.blocks.filter((block) => matches(block, search)) ?? [],
    [document, search],
  )
  const activeBlock = useMemo(
    () => document?.blocks.find((block) => block.id === activeId) ?? null,
    [activeId, document],
  )

  useEffect(() => {
    if (!activeId && document?.blocks.length) setActiveId(document.blocks[0].id)
  }, [activeId, document])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const handleParse = () => {
    if (!draft.trim()) {
      setToast({ message: '请先粘贴需要解析的内容', tone: 'error' })
      return
    }
    const parsed = parseDocument(draft)
    const formatted = {
      ...parsed,
      blocks: parsed.blocks.map((block) => {
        const content = formatJsonValue(block.content)
        return { ...block, content, originalContent: content }
      }),
    }
    setDocument(formatted)
    setActiveId(formatted.blocks[0]?.id ?? null)
    setSearch('')
    setShowSearch(false)
    setShowImporter(false)
  }

  const updateContent = (id: string, content: string) => {
    setDocument((current) => current && ({
      ...current,
      blocks: current.blocks.map((block) => block.id === id ? { ...block, content } : block),
    }))
  }

  const handleCopy = async () => {
    if (!document) return
    try {
      await copyText(serializeDocument(document, true))
      setToast({ message: '新配置已复制，注释保持不变', tone: 'success' })
    } catch {
      setToast({ message: '无法访问剪切板，请检查浏览器权限', tone: 'error' })
    }
  }

  const openImporter = () => {
    if (document) setDraft(serializeDocument(document, true))
    setShowSearch(false)
    setShowImporter(true)
  }

  const openSelectedBlock = (id: string) => {
    setActiveId(id)
    setSearch('')
    setShowSearch(false)
  }

  const beforeMount: BeforeMount = (monaco) => {
    monaco.editor.defineTheme('paladin-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#FFFFFF',
        'editorLineNumber.foreground': '#8F8F8F',
        'editorLineNumber.activeForeground': '#4D4D4D',
        'editorGutter.background': '#FFFFFF',
        'editor.selectionBackground': '#DCEEFF',
        'editorCursor.foreground': '#0072F5',
        'editor.lineHighlightBackground': '#FAFAFA',
      },
    })
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: true,
      trailingCommas: 'ignore',
    })
  }

  return (
    <main className="min-h-screen bg-[#FAFAFA] font-sans text-[#171717]">
      <Header
        hasDocument={Boolean(document && !showImporter)}
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          setShowSearch(Boolean(value))
        }}
        onSearchFocus={() => setShowSearch(true)}
        onClearSearch={() => {
          setSearch('')
          setShowSearch(false)
        }}
        onOpenImporter={openImporter}
        onCopy={handleCopy}
      />

      {document && !showImporter ? (
        showSearch ? (
          <SearchPage
            query={search}
            results={visibleBlocks}
            onSelect={openSelectedBlock}
          />
        ) : (
          <EditorWorkspace
            document={document}
            activeBlock={activeBlock}
            activeId={activeId}
            onSelect={setActiveId}
            onChange={updateContent}
            beforeMount={beforeMount}
          />
        )
      ) : (
        <Importer draft={draft} onDraftChange={setDraft} onParse={handleParse} onExample={() => setDraft(example)} />
      )}

      {toast && (
        <div className="fixed right-6 bottom-6 z-30 flex items-center gap-2 rounded-[6px] bg-[#171717] px-4 py-3 text-[13px] font-normal text-white shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_8px_16px_-4px_rgba(0,0,0,0.12)] animate-[toast-in_.2s_ease-out]">
          <span className={`size-2.5 rounded-full ${toast.tone === 'success' ? 'bg-[#45A557]' : 'bg-[#E5484D]'}`} />
          {toast.message}
        </div>
      )}
    </main>
  )
}

function Header({
  hasDocument,
  search,
  onSearchChange,
  onSearchFocus,
  onClearSearch,
  onOpenImporter,
  onCopy,
}: {
  hasDocument: boolean
  search: string
  onSearchChange: (value: string) => void
  onSearchFocus: () => void
  onClearSearch: () => void
  onOpenImporter: () => void
  onCopy: () => void
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 bg-[#FAFAFA]/90 px-4 shadow-[0_1px_0_0_rgba(0,0,0,0.10)] backdrop-blur-md md:gap-6 md:px-6">
      <div className="flex shrink-0 items-center gap-3">
        <span className="grid size-8 place-items-center rounded-[6px] bg-[#171717] font-mono text-base font-medium text-white">P</span>
        <span className="hidden text-sm font-medium tracking-[-0.28px] sm:inline">Paladin 编辑器</span>
      </div>

      {hasDocument && (
        <>
          <label className="ml-auto flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[6px] bg-white px-3 text-[#8F8F8F] shadow-[0_0_0_1px_rgba(0,0,0,0.08)] focus-within:outline-1 focus-within:outline-[#005FCC] md:max-w-[560px]">
            <Icon name="search" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[13px] font-normal text-[#171717] outline-none placeholder:text-[#8F8F8F]"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              onFocus={onSearchFocus}
              placeholder="搜索 key 或 value"
            />
            {search && (
              <button
                type="button"
                className={`grid size-6 place-items-center rounded-[4px] text-[#8F8F8F] hover:bg-[#EBEBEB] hover:text-[#171717] ${focusRing}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onClearSearch}
                aria-label="清除搜索"
              >
                <Icon name="close" className="size-3.5" />
              </button>
            )}
          </label>

          <div className="flex shrink-0 gap-2">
            <button type="button" className={`${buttonBase} bg-transparent text-[#4D4D4D] shadow-[0_0_0_1px_rgba(0,0,0,0.08)] hover:bg-[#EBEBEB] hover:text-[#171717]`} onClick={onOpenImporter}>
              <Icon name="paste" />
              <span className="hidden xl:inline">重新粘贴</span>
            </button>
            <button type="button" className={`${buttonBase} bg-[#171717] text-white hover:bg-[#333333]`} onClick={onCopy}>
              <Icon name="copy" />
              <span className="hidden xl:inline">复制新配置</span>
            </button>
          </div>
        </>
      )}
    </header>
  )
}

type ConfigRowData = {
  blocks: ContentBlock[]
  activeId: string | null
  onSelect: (id: string) => void
}

function ConfigRow({ index, style, ariaAttributes, blocks, activeId, onSelect }: RowComponentProps<ConfigRowData>) {
  const block = blocks[index]
  if (!block) return null

  const dirty = block.content !== block.originalContent
  const active = block.id === activeId

  return (
    <div {...ariaAttributes} className="px-0.5 pb-1" style={style}>
      <button
        className={`group flex h-[60px] w-full items-center gap-3 rounded-[6px] px-3 text-left text-[#4D4D4D] ${focusRing} ${active ? 'bg-white text-[#171717] shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_2px_rgba(0,0,0,0.04)]' : 'hover:bg-[#EBEBEB] hover:text-[#171717]'}`}
        onClick={() => onSelect(block.id)}
        aria-current={active ? 'true' : undefined}
      >
        <span className="grid min-w-0 flex-1 gap-1">
          <strong className="truncate text-[13px] font-medium">{block.key}</strong>
          <small className="truncate text-xs font-normal text-[#8F8F8F]">{snippet(block.content)}</small>
        </span>
        {dirty && <span className="size-2.5 shrink-0 rounded-full bg-[#0062D1]" title="已修改" />}
        <Icon name="arrow" className="size-3.5 text-[#8F8F8F]" />
      </button>
    </div>
  )
}

type SearchRowData = {
  results: ContentBlock[]
  query: string
  onSelect: (id: string) => void
}

function SearchResultRow({ index, style, ariaAttributes, results, query, onSelect }: RowComponentProps<SearchRowData>) {
  const block = results[index]
  if (!block) return null

  return (
    <div {...ariaAttributes} className="px-0.5 pb-3" style={style}>
      <button
        type="button"
        className={`group grid h-[96px] w-full grid-cols-[minmax(140px,0.35fr)_minmax(0,1fr)_auto] items-center gap-6 rounded-xl bg-white p-5 text-left shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_2px_rgba(0,0,0,0.04)] hover:shadow-[0_0_0_1px_#EBEBEB,0_8px_16px_-8px_rgba(0,0,0,0.08)] max-sm:grid-cols-[1fr_auto] ${focusRing}`}
        onClick={() => onSelect(block.id)}
      >
        <span className="truncate text-sm font-medium text-[#171717]">{block.key}</span>
        <span className="line-clamp-2 min-w-0 break-words font-mono text-[13px] font-medium leading-5 text-[#4D4D4D] max-sm:col-span-2 max-sm:row-start-2">
          {highlightValue(matchedSnippet(block.content, query), query)}
        </span>
        <Icon name="arrow" className="size-4 text-[#8F8F8F] group-hover:text-[#171717]" />
      </button>
    </div>
  )
}

function EditorWorkspace({
  document,
  activeBlock,
  activeId,
  onSelect,
  onChange,
  beforeMount,
}: {
  document: ParsedDocument
  activeBlock: ContentBlock | null
  activeId: string | null
  onSelect: (id: string) => void
  onChange: (id: string, value: string) => void
  beforeMount: BeforeMount
}) {
  const listRef = useListRef(null)
  const activeIndex = document.blocks.findIndex((block) => block.id === activeId)
  const rowProps = useMemo<ConfigRowData>(
    () => ({ blocks: document.blocks, activeId, onSelect }),
    [activeId, document.blocks, onSelect],
  )
  const rowKey = useCallback((index: number, data: ConfigRowData) => data.blocks[index]?.id ?? index, [])
  const scrollToActive = useCallback(() => {
    if (activeIndex >= 0) listRef.current?.scrollToRow({ index: activeIndex, align: 'smart' })
  }, [activeIndex, listRef])

  useEffect(() => {
    const timer = window.setTimeout(scrollToActive, 0)
    return () => window.clearTimeout(timer)
  }, [scrollToActive])

  return (
    <section className="grid h-[calc(100vh-64px)] min-h-0 grid-cols-[280px_minmax(0,1fr)] overflow-hidden max-md:h-auto max-md:min-h-[calc(100vh-64px)] max-md:grid-cols-1 max-md:overflow-visible">
      <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-[#FAFAFA] px-4 py-6 shadow-[1px_0_0_0_rgba(0,0,0,0.08)] max-md:h-[320px] max-md:px-4 max-md:py-4">
        <div className="shrink-0 px-2 pb-4">
          <div>
            <p className="mb-1 text-[11px] font-normal tracking-[0.08em] text-[#8F8F8F]">CONFIGURATIONS</p>
            <h1 className="text-sm font-medium tracking-[-0.28px]">配置列表</h1>
          </div>
        </div>

        <List
          aria-label="配置列表"
          className="min-h-0 flex-1"
          defaultHeight={640}
          listRef={listRef}
          onResize={scrollToActive}
          overscanCount={8}
          rowComponent={ConfigRow}
          rowCount={document.blocks.length}
          rowHeight={64}
          rowKey={rowKey}
          rowProps={rowProps}
          tagName="nav"
          style={{ height: '100%', width: '100%' }}
        />

        <p className="mt-4 shrink-0 px-2 text-xs font-normal text-[#8F8F8F] max-md:hidden">编辑会保留原始顺序与全部注释</p>
      </aside>

      <section className="h-full min-w-0 overflow-y-auto bg-[#FAFAFA] px-6 py-8 md:px-10 lg:px-16">
        <div className="mx-auto max-w-[1200px]">
          <div className="mb-6 flex items-end justify-between gap-6 max-sm:block">
            <div>
              <p className="mb-1 text-[11px] font-normal tracking-[0.08em] text-[#8F8F8F]">CONTENT</p>
              <h2 className="text-sm font-medium tracking-[-0.28px]">配置内容</h2>
            </div>
          </div>

          {activeBlock ? (
            <ContentCard block={activeBlock} onChange={(value) => onChange(activeBlock.id, value)} beforeMount={beforeMount} />
          ) : (
            <EmptyState title="没有可显示的配置" description="请从左侧选择一项。" />
          )}
        </div>
      </section>
    </section>
  )
}

function SearchPage({
  query,
  results,
  onSelect,
}: {
  query: string
  results: ContentBlock[]
  onSelect: (id: string) => void
}) {
  const rowProps = useMemo<SearchRowData>(
    () => ({ results, query, onSelect }),
    [onSelect, query, results],
  )
  const rowKey = useCallback((index: number, data: SearchRowData) => data.results[index]?.id ?? index, [])

  return (
    <section className="min-h-[calc(100vh-64px)] bg-[#FAFAFA] px-6 py-10">
      <div className="mx-auto max-w-[960px]">
        <p className="mb-6 text-sm font-normal text-[#4D4D4D]">找到 {results.length} 个匹配项</p>

        {results.length ? (
          <List
            aria-label="搜索结果"
            defaultHeight={640}
            overscanCount={8}
            rowComponent={SearchResultRow}
            rowCount={results.length}
            rowHeight={108}
            rowKey={rowKey}
            rowProps={rowProps}
            style={{ height: 'calc(100vh - 264px)', minHeight: 400, width: '100%' }}
          />
        ) : (
          <EmptyState title="没有搜索结果" description="试试其他 key 或 value。" />
        )}
      </div>
    </section>
  )
}

function Importer({ draft, onDraftChange, onParse, onExample }: { draft: string; onDraftChange: (value: string) => void; onParse: () => void; onExample: () => void }) {
  return (
    <section className="mx-auto flex min-h-[calc(100vh-64px)] max-w-[1040px] items-center px-6 py-10">
      <div className="w-full overflow-hidden rounded-xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_2px_rgba(0,0,0,0.04),0_8px_16px_-4px_rgba(0,0,0,0.04)]">
        <div className="flex min-h-16 items-center justify-between gap-4 px-5 shadow-[0_1px_0_0_rgba(0,0,0,0.08)]">
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-[6px] bg-[#F2F2F2] text-[#4D4D4D]"><Icon name="paste" /></span>
            <div>
              <strong className="block text-sm font-medium text-[#171717]">粘贴内容</strong>
              <small className="mt-0.5 block text-xs font-normal text-[#8F8F8F]">支持 key、value 与原始注释</small>
            </div>
          </div>
          <button type="button" className={`rounded-[6px] px-2 py-1.5 text-xs font-normal text-[#0072F5] hover:bg-[#EBEBEB] ${focusRing}`} onClick={onExample}>填入示例</button>
        </div>
        <p className="m-0 flex items-center gap-2 bg-[#FAFAFA] px-5 py-3 text-xs font-normal text-[#4D4D4D] shadow-[0_1px_0_0_rgba(0,0,0,0.08)]">
          <span className="size-2.5 shrink-0 rounded-full bg-[#0062D1]" />
          本工具完全离线，所有配置都在浏览器本地处理，不会发送到服务器。
        </p>
        <textarea
          className="block h-[calc(100vh-248px)] min-h-[520px] max-h-[760px] w-full resize-y bg-white p-6 font-mono text-[13px] font-medium leading-6 text-[#171717] outline-none placeholder:text-[#8F8F8F] focus:outline-1 focus:outline-[#005FCC] max-sm:h-[60vh] max-sm:min-h-[420px]"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onParse() }}
          placeholder={'# 分类注释\nkey=value\n\n## 另一条注释\nkeyaa=value'}
          autoFocus
        />
        <div className="flex items-center justify-between gap-4 px-5 py-4 shadow-[0_-1px_0_0_rgba(0,0,0,0.08)]">
          <span className="text-xs font-normal text-[#8F8F8F]">⌘ / Ctrl + Enter 解析</span>
          <button type="button" className={`${buttonBase} h-12 bg-[#171717] px-4 text-white hover:bg-[#333333]`} onClick={onParse}>
            开始解析 <Icon name="arrow" />
          </button>
        </div>
      </div>
    </section>
  )
}

function ContentCard({ block, onChange, beforeMount }: { block: ContentBlock; onChange: (value: string) => void; beforeMount: BeforeMount }) {
  const json = getJsonObjectInfo(block.content)
  const dirty = block.content !== block.originalContent
  return (
    <article className="overflow-hidden rounded-xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_2px_rgba(0,0,0,0.04)]">
      <div className="flex min-h-20 items-center gap-4 px-5 shadow-[0_1px_0_0_rgba(0,0,0,0.08)]">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium tracking-[-0.28px] text-[#171717]">{block.key}</h3>
          <p className="mt-1 text-xs font-normal text-[#8F8F8F]">正在编辑 value</p>
        </div>
        <div className="flex items-center gap-4 text-xs font-normal text-[#4D4D4D]">
          {json && <span className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#0062D1]" />JSON · {json.keyCount} keys</span>}
          {dirty && <span className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#FF990A]" />已编辑</span>}
        </div>
      </div>
      <div className="bg-white">
        <Editor
          height={blockHeight(block.content)}
          path={`config-block-${block.id}.${json ? 'json' : 'txt'}`}
          language={json ? 'json' : 'plaintext'}
          theme="paladin-light"
          value={block.content}
          beforeMount={beforeMount}
          onChange={(value) => onChange(value ?? '')}
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            lineHeight: 20,
            fontFamily: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontWeight: '500',
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            wrappingIndent: 'indent',
            tabSize: 2,
            formatOnPaste: false,
            formatOnType: false,
            renderLineHighlight: 'gutter',
            overviewRulerBorder: false,
          }}
        />
        {json && (
          <p className="m-0 px-5 py-3 text-xs font-normal text-[#4D4D4D] shadow-[0_-1px_0_0_rgba(0,0,0,0.08)]">
            已识别为 JSON 对象；复制时仅压缩空白，不改变 key 顺序。
          </p>
        )}
      </div>
    </article>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-72 place-content-center justify-items-center rounded-xl bg-white text-center shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
      <Icon name="search" className="size-6 text-[#8F8F8F]" />
      <h3 className="mt-4 text-sm font-medium text-[#171717]">{title}</h3>
      <p className="mt-1 text-xs font-normal text-[#8F8F8F]">{description}</p>
    </div>
  )
}
