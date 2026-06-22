import { createSignal, createResource, For, Show, Suspense, onMount, createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Button } from "@opencode-ai/ui/button"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Markdown } from "@opencode-ai/ui/markdown"
import mermaid from "mermaid"

const DEFAULT_SIDEBAR_WIDTH = 300
const MERMAID_PREFIX = "MERMAID_BLOCK_"
const mermaidSvgStore = new Map<string, string>()

export function CaseLibraryDialog() {
  const language = useLanguage()
  const [currentPath, setCurrentPath] = createSignal("")
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)
  const [store, setStore] = createStore({
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  })
  let wrapperRef: HTMLDivElement | undefined
  let observer: MutationObserver | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  onMount(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "loose",
    })
  })

  const [items] = createResource(currentPath, async (path) => {
    try {
      const url = path ? `/api/case-library/list?path=${encodeURIComponent(path)}` : "/api/case-library/list"
      const res = await fetch(url)
      if (!res.ok) return { files: [], dirs: [] }
      return await res.json()
    } catch {
      return { files: [], dirs: [] }
    }
  })

  const [content] = createResource(selectedFile, async (filePath) => {
    if (!filePath) return { text: "", isMarkdown: false }
    try {
      const res = await fetch(`/api/case-library/read?path=${encodeURIComponent(filePath)}`)
      if (!res.ok) return { text: "", isMarkdown: false }
      const data = await res.json()
      const text = data.content || ""
      const isMarkdown = filePath.toLowerCase().endsWith(".md")

      if (isMarkdown) {
        const processedText = await processMermaidBlocks(text)
        return { text: processedText, isMarkdown }
      }

      return { text, isMarkdown: false }
    } catch {
      return { text: "", isMarkdown: false }
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
        const { svg } = await mermaid.render(id, codeContent)
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
    if (isExternal) return

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
      setCurrentPath(newDir)
      setSelectedFile(null)
    } else {
      setSelectedFile(normalized)
    }
  }

  const goToParent = () => {
    const path = currentPath()
    if (!path) return
    const parts = path.split("/")
    parts.pop()
    setCurrentPath(parts.join("/"))
    setSelectedFile(null)
  }

  const enterDir = (dirName: string) => {
    const path = currentPath()
    setCurrentPath(path ? `${path}/${dirName}` : dirName)
    setSelectedFile(null)
  }

  const selectFile = (fileName: string) => {
    const path = currentPath()
    setSelectedFile(path ? `${path}/${fileName}` : fileName)
  }

  const getDisplayName = (name: string) => {
    return name.length > 30 ? name.substring(0, 27) + "..." : name
  }

  return (
    <Dialog title={language.t("enterprise.caseLibrary")} size="large" draggable fullscreen>
      <div class="relative flex gap-0 flex-1 min-h-0">
        <div
          class="border-r border-border-weak-base flex flex-col min-h-0 shrink-0 relative"
          style={{ width: `${store.sidebarWidth}px` }}
        >
          <div class="flex items-center gap-2 px-2 py-1 border-b border-border-weak-base min-h-[36px] shrink-0">
            <Show when={currentPath()}>
              <Button variant="ghost" size="small" class="h-6 w-6 p-0" onClick={goToParent}>
                <Icon name="arrow-left" size="small" />
              </Button>
              <span class="text-11-regular text-text-weak truncate flex-1">{currentPath()}</span>
            </Show>
            <Show when={!currentPath()}>
              <span class="text-11-regular text-text-weak">知识库根目录</span>
            </Show>
          </div>
          <div class="flex-1 overflow-y-auto p-2 min-h-0">
            <Suspense fallback={<Spinner />}>
              <Show when={items()?.dirs?.length === 0 && items()?.files?.length === 0}>
                <div class="text-12-regular text-text-weak">暂无内容</div>
              </Show>
              <For each={items()?.dirs || []}>
                {(dir: { name: string; path: string }) => (
                  <div
                    class="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-surface-raised-base rounded text-12-regular"
                    onClick={() => enterDir(dir.name)}
                  >
                    <Icon name="folder" size="small" class="text-icon-weak" />
                    <span class="truncate">{getDisplayName(dir.name)}</span>
                  </div>
                )}
              </For>
              <For each={items()?.files || []}>
                {(file: { name: string; path: string }) => (
                  <div
                    class="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-surface-raised-base rounded text-12-regular"
                    classList={{ "bg-surface-raised-base": selectedFile() === file.path }}
                    onClick={() => selectFile(file.name)}
                  >
                    <Icon name="code" size="small" class="text-icon-weak" />
                    <span class="truncate">{getDisplayName(file.name)}</span>
                  </div>
                )}
              </For>
            </Suspense>
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
        <div class="flex-1 overflow-y-auto p-2 min-h-0">
          <Show when={!selectedFile()}>
            <div class="flex items-center justify-center h-full text-12-regular text-text-weak">
              {language.t("enterprise.selectFileToView")}
            </div>
          </Show>
          <Show when={selectedFile()}>
            <Suspense fallback={<Spinner />}>
              <div class="text-12-medium mb-2 text-text-base">{selectedFile()}</div>
              <Show when={content()?.isMarkdown}>
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
              </Show>
              <Show when={!content()?.isMarkdown}>
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