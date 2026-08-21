import { createSignal, createResource, For, Show, Suspense, onMount, createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Markdown } from "@opencode-ai/ui/markdown"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { MarkdownTOC } from "./markdown-toc"

type Mermaid = typeof import("mermaid").default

const DEFAULT_SIDEBAR_WIDTH = 300
const MERMAID_PREFIX = "MERMAID_BLOCK_"
const mermaidSvgStore = new Map<string, string>()
const MAX_DEPTH = 128

export function CaseLibraryDialog() {
  const language = useLanguage()
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)
  const [history, setHistory] = createSignal<string[]>([])
  const [historyIndex, setHistoryIndex] = createSignal(-1)
  const [store, setStore] = createStore({
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  })
  const [expandedDirs, setExpandedDirs] = createStore<Record<string, boolean>>({})
  let wrapperRef: HTMLDivElement | undefined
  let observer: MutationObserver | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  let mermaidLib: Mermaid | undefined

  onMount(() => {
    void import("mermaid").then((m) => {
      mermaidLib = m.default
      mermaidLib.initialize({
        startOnLoad: false,
        theme: "default",
        securityLevel: "loose",
      })
    })
  })

  const processImagePaths = (text: string, currentFile: string): string => {
    const dir = currentFile.includes("/") ? currentFile.substring(0, currentFile.lastIndexOf("/")) : ""
    return text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^)]*")?\)/g, (match, alt, src) => {
      if (src.startsWith("http") || src.startsWith("data:") || src.startsWith("/")) return match
      const resolved = dir
        ? `${dir}/${src}`.split("/").reduce((acc: string[], p) => {
            if (p === "..") acc.pop()
            else if (p !== "." && p !== "") acc.push(p)
            return acc
          }, []).join("/")
        : src
      return `![${alt}](/api/case-library/asset?path=${encodeURIComponent(resolved)})`
    })
  }

  const [content] = createResource(selectedFile, async (filePath) => {
    if (!filePath) return { text: "", isMarkdown: false, isImage: false }
    try {
      const res = await fetch(`/api/case-library/read?path=${encodeURIComponent(filePath)}`)
      if (!res.ok) return { text: "", isMarkdown: false, isImage: false }
      const data = await res.json()
      if (data.encoding === "base64" && data.mimeType) {
        return { text: `data:${data.mimeType};base64,${data.content}`, isMarkdown: false, isImage: true }
      }
      const text = data.content || ""
      const isMarkdown = filePath.toLowerCase().endsWith(".md")

      if (isMarkdown) {
        const withImages = processImagePaths(text, filePath)
        const processedText = await processMermaidBlocks(withImages)
        return { text: processedText, isMarkdown, isImage: false }
      }

      return { text, isMarkdown: false, isImage: false }
    } catch {
      return { text: "", isMarkdown: false, isImage: false }
    }
  })

  const processMermaidBlocks = async (text: string): Promise<string> => {
    mermaidSvgStore.clear()
    let result = text
    let idx = 0

    for (;;) {
      const start = result.indexOf("```mermaid")
      if (start === -1) break
      const end = result.indexOf("```", start + 10)
      if (end === -1) break

      const fullBlock = result.substring(start, end + 3)
      const codeContent = result.substring(start + 10, end).trim()
      const placeholder = `${MERMAID_PREFIX}${idx}`
      idx++

      try {
        const id = `mermaid-${Date.now()}-${idx}`
        if (!mermaidLib) throw new Error("mermaid not loaded")
        const { svg } = await mermaidLib.render(id, codeContent)
        mermaidSvgStore.set(placeholder, svg)
        result = result.replace(fullBlock, placeholder)
      } catch {
        result = result.replace(fullBlock, `\`\`\`mermaid\n${codeContent}\n\`\`\``)
      }
    }

    return result
  }

  const injectMermaidSvgs = (): boolean => {
    if (!wrapperRef) return false
    if (mermaidSvgStore.size === 0) return true

    const markdownEl = wrapperRef.querySelector('[data-component="markdown"]')
    if (!markdownEl) return false

    const allText = markdownEl.textContent ?? ""
    let hasRemaining = false
    for (const [placeholder] of mermaidSvgStore) {
      if (allText.includes(placeholder)) hasRemaining = true
    }

    if (!hasRemaining) return true

    for (const [placeholder, svg] of mermaidSvgStore) {
      if (!allText.includes(placeholder)) continue

      const walker = document.createTreeWalker(markdownEl, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        if (!node.textContent?.includes(placeholder)) continue

        const parent = node.parentElement
        if (!parent) continue

        const wrapper = document.createElement("div")
        wrapper.className = "mermaid-diagram"
        wrapper.innerHTML = svg
        parent.replaceChild(wrapper, node)
        break
      }
    }

    return !hasRemaining
  }

  createEffect(() => {
    const text = content()?.text
    if (!text || !content()?.isMarkdown || mermaidSvgStore.size === 0) return

    if (observer) observer.disconnect()

    observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(injectMermaidSvgs, 50)
    })

    const markdownEl = wrapperRef?.querySelector('[data-component="markdown"]')
    if (markdownEl) {
      observer.observe(markdownEl, { childList: true, subtree: true, characterData: true })
    }

    setTimeout(injectMermaidSvgs, 100)
  })

  onCleanup(() => {
    if (observer) observer.disconnect()
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  const handleLinkClick = (e: MouseEvent) => {
    const target = e.target
    if (!(target instanceof Element)) return
    const anchor = target.closest("a")
    if (!anchor) return

    const href = anchor.getAttribute("href")
    if (!href) return

    const isExternal = href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//") || href.startsWith("mailto:")
    if (isExternal) {
      e.preventDefault()
      window.open(href, "_blank", "noopener,noreferrer")
      return
    }

    if (href.startsWith("#")) return

    e.preventDefault()

    const current = selectedFile()
    if (!current) return

    const dir = current.includes("/") ? current.substring(0, current.lastIndexOf("/")) : ""
    const resolved = dir ? `${dir}/${href}` : href

    const normalized = resolved
      .split("/")
      .reduce((acc: string[], part) => {
        if (part === "..") acc.pop()
        else if (part !== "." && part !== "") acc.push(part)
        return acc
      }, [])
      .join("/")

    if (href.endsWith("/") || !normalized.includes(".")) {
      const newDir = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized
      setExpandedDirs(newDir, true)
      setSelectedFile(null)
    } else {
      selectFile(normalized)
    }
  }

  const toggleExpand = (path: string) => {
    setExpandedDirs(path, (v) => !v)
  }

  const selectFile = (filePath: string) => {
    setSelectedFile(filePath)
    const h = history()
    const i = historyIndex()
    setHistory([...h.slice(0, i + 1), filePath])
    setHistoryIndex(i + 1)
  }

  const goBack = () => {
    const i = historyIndex()
    if (i > 0) {
      setHistoryIndex(i - 1)
      setSelectedFile(history()[i - 1])
    }
  }

  const goForward = () => {
    const i = historyIndex()
    const h = history()
    if (i < h.length - 1) {
      setHistoryIndex(i + 1)
      setSelectedFile(h[i + 1])
    }
  }

  const getDisplayName = (name: string) => {
    return name.length > 30 ? name.substring(0, 27) + "..." : name
  }

  const fetchItems = async (path: string) => {
    try {
      const url = path ? `/api/case-library/list?path=${encodeURIComponent(path)}` : "/api/case-library/list"
      const res = await fetch(url)
      if (!res.ok) return { files: [], dirs: [] }
      return await res.json()
    } catch {
      return { files: [], dirs: [] }
    }
  }

  const CaseLibraryTreeNode = (props: { path: string; level: number }) => {
    const [items] = createResource(() => props.path, fetchItems)

    return (
      <Suspense fallback={<div class="px-2 py-1"><Spinner /></div>}>
        <Show when={items()?.dirs?.length === 0 && items()?.files?.length === 0 && props.level === 0}>
          <div class="text-12-regular text-text-weak px-2 py-1">{language.t("caseLibrary.empty")}</div>
        </Show>
        <For each={items()?.dirs || []}>
          {(dir: { name: string; path: string }) => {
            const expanded = () => expandedDirs[dir.path] ?? false
            return (
              <Collapsible
                variant="ghost"
                class="w-full"
                open={expanded()}
                onOpenChange={() => toggleExpand(dir.path)}
              >
                <Collapsible.Trigger class="w-full">
                  <div
                    class="flex items-center gap-1.5 w-full min-w-0 h-6 rounded-md px-1.5 py-0 text-left hover:bg-surface-raised-base-hover transition-colors cursor-pointer"
                    style={`padding-left: ${Math.max(0, 8 + props.level * 12)}px`}
                  >
                    <div class="size-4 flex items-center justify-center text-icon-weak">
                      <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
                    </div>
                    <Icon name="folder" size="small" class="text-icon-weak" />
                    <span class="truncate text-12-medium text-text-base" title={dir.name}>{getDisplayName(dir.name)}</span>
                  </div>
                </Collapsible.Trigger>
                <Collapsible.Content class="relative">
                  <Show
                    when={props.level < MAX_DEPTH}
                    fallback={<div class="px-2 py-1 text-12-regular text-text-weak">...</div>}
                  >
                    <CaseLibraryTreeNode path={dir.path} level={props.level + 1} />
                  </Show>
                </Collapsible.Content>
              </Collapsible>
            )
          }}
        </For>
        <For each={items()?.files || []}>
          {(file: { name: string; path: string }) => (
            <div
              class="flex items-center gap-1.5 w-full min-w-0 h-6 rounded-md px-1.5 py-0 text-left hover:bg-surface-raised-base-hover transition-colors cursor-pointer"
              classList={{ "bg-surface-base-active": selectedFile() === file.path }}
              style={`padding-left: ${Math.max(0, 8 + props.level * 12 + 20)}px`}
              onClick={() => selectFile(file.path)}
            >
              <Icon name="code" size="small" class="text-icon-weak" />
              <span class="truncate text-12-medium text-text-base" title={file.name}>{getDisplayName(file.name)}</span>
            </div>
          )}
        </For>
      </Suspense>
    )
  }

  return (
    <Dialog title={language.t("enterprise.caseLibrary")} size="large" draggable fullscreen>
      <div class="relative flex gap-0 flex-1 min-h-0">
        <div
          class="border-r border-border-weak-base flex flex-col min-h-0 shrink-0 relative"
          style={{ width: `${store.sidebarWidth}px` }}
        >
          <div class="flex items-center gap-2 px-2 py-1 border-b border-border-weak-base min-h-[36px] shrink-0">
            <Icon name="folder" size="small" class="text-icon-weak" />
            <span class="text-11-regular text-text-weak">{language.t("caseLibrary.title")}</span>
          </div>
          <div class="flex-1 overflow-y-auto p-1 min-h-0">
            <CaseLibraryTreeNode path="" level={0} />
          </div>
          <ResizeHandle
            direction="horizontal"
            edge="end"
            size={store.sidebarWidth}
            min={200}
            max={500}
            onResize={(width) => {
              setStore("sidebarWidth", width)
            }}
          />
        </div>
        <div class="flex-1 p-2 min-h-0 flex flex-col">
          <Show when={!selectedFile()}>
            <div class="flex items-center justify-center h-full text-12-regular text-text-weak">
              {language.t("enterprise.selectFileToView")}
            </div>
          </Show>
          <Show when={selectedFile()}>
            <Suspense fallback={<Spinner />}>
              <div class="flex items-center gap-1 mb-2">
                <IconButton
                  icon="arrow-left"
                  size="small"
                  variant="ghost"
                  onClick={goBack}
                  disabled={historyIndex() <= 0}
                  aria-label={language.t("caseLibrary.back")}
                />
                <IconButton
                  icon="arrow-right"
                  size="small"
                  variant="ghost"
                  onClick={goForward}
                  disabled={historyIndex() >= history().length - 1}
                  aria-label={language.t("caseLibrary.forward")}
                />
                <span class="text-12-medium text-text-base">{selectedFile()}</span>
              </div>
              <Show when={content()?.isImage}>
                <div class="flex items-center justify-center flex-1 min-h-0 overflow-auto p-4">
                  <img src={content()?.text} class="max-w-full max-h-full rounded" />
                </div>
              </Show>
              <Show when={content()?.isMarkdown}>
                <div class="flex gap-0 flex-1 min-h-0">
                  <div
                    ref={wrapperRef}
                    class="flex-1 min-h-0 overflow-auto bg-surface-panel p-4 rounded border border-border-weak-base"
                    onClick={handleLinkClick}
                  >
                    <Markdown
                      text={content()?.text || ""}
                      class="prose prose-sm"
                    />
                  </div>
                  <MarkdownTOC containerRef={wrapperRef} />
                </div>
              </Show>
              <Show when={!content()?.isMarkdown && !content()?.isImage}>
                <pre class="text-12-regular whitespace-pre-wrap bg-surface-panel p-3 rounded border border-border-weak-base overflow-auto flex-1 min-h-0">
                  {content()?.text}
                </pre>
              </Show>
            </Suspense>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}