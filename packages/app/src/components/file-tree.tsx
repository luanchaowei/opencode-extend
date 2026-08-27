import { useFile } from "@/context/file"
import { encodeFilePath } from "@/context/file/path"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Markdown } from "@opencode-ai/ui/markdown"
import { MarkdownTOC } from "./markdown-toc"
import { showToast } from "@opencode-ai/ui/toast"
import {
  createEffect,
  createMemo,
  createResource,
  For,
  Match,
  on,
  onCleanup,
  Show,
  splitProps,
  Suspense,
  Switch,
  untrack,
  createSignal,
  type ComponentProps,
  type ParentProps,
  type Component,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

const MAX_DEPTH = 128

type Mermaid = typeof import("mermaid").default
const MERMAID_PREFIX = "MERMAID_BLOCK_"
const svgStore = new Map<string, string>()

function pathToFileUrl(filepath: string): string {
  return `file://${encodeFilePath(filepath)}`
}

type Kind = "add" | "del" | "mix"

type Filter = {
  files: Set<string>
  dirs: Set<string>
}

function shouldListRoot(input: { level: number; dir?: { loaded?: boolean; loading?: boolean } }) {
  if (input.level !== 0) return false
  if (input.dir?.loaded) return false
  if (input.dir?.loading) return false
  return true
}

function dirsToExpand(input: {
  level: number
  filter?: { dirs: Set<string> }
  expanded: (dir: string) => boolean
}) {
  if (input.level !== 0) return []
  if (!input.filter) return []
  return [...input.filter.dirs].filter((dir) => !input.expanded(dir))
}

const kindLabel = (kind: Kind) => {
  if (kind === "add") return "A"
  if (kind === "del") return "D"
  return "M"
}

const kindTextColor = (kind: Kind) => {
  if (kind === "add") return "color: var(--icon-diff-add-base)"
  if (kind === "del") return "color: var(--icon-diff-delete-base)"
  return "color: var(--icon-diff-modified-base)"
}

const kindDotColor = (kind: Kind) => {
  if (kind === "add") return "background-color: var(--icon-diff-add-base)"
  if (kind === "del") return "background-color: var(--icon-diff-delete-base)"
  return "background-color: var(--icon-diff-modified-base)"
}

const visibleKind = (node: FileNode, kinds?: ReadonlyMap<string, Kind>, marks?: Set<string>) => {
  const kind = kinds?.get(node.path)
  if (!kind) return
  if (!marks?.has(node.path)) return
  return kind
}

const buildDragImage = (target: HTMLElement) => {
  const icon = target.querySelector('[data-component="file-icon"]') ?? target.querySelector("svg")
  const text = target.querySelector("span")
  if (!icon || !text) return

  const image = document.createElement("div")
  image.className =
    "flex items-center gap-x-2 px-2 py-1 bg-surface-raised-base rounded-md border border-border-base text-12-regular text-text-strong"
  image.style.position = "absolute"
  image.style.top = "-1000px"
  image.innerHTML = (icon as SVGElement).outerHTML + (text as HTMLSpanElement).outerHTML
  return image
}

const withFileDragImage = (event: DragEvent) => {
  const image = buildDragImage(event.currentTarget as HTMLElement)
  if (!image) return
  document.body.appendChild(image)
  event.dataTransfer?.setDragImage(image, 0, 12)
  setTimeout(() => document.body.removeChild(image), 0)
}

const FileTreeNode = (
  p: ParentProps &
    ComponentProps<"div"> & {
      node: FileNode
      level: number
      active?: string
      nodeClass?: string
      draggable: boolean
      kinds?: ReadonlyMap<string, Kind>
      marks?: Set<string>
      onDelete?: (node: FileNode) => void
      onDownload?: (node: FileNode) => void
      onPreview?: (node: FileNode) => void
      isOwnProject?: boolean
      language?: { t: (key: string, params?: any) => string }
      as?: string | Component
    },
) => {
  const [local, rest] = splitProps(p, [
    "node",
    "level",
    "active",
    "nodeClass",
    "draggable",
    "kinds",
    "marks",
    "children",
    "class",
    "classList",
    "onDelete",
    "onDownload",
    "onPreview",
    "isOwnProject",
    "language",
    "as",
  ])
  const kind = () => visibleKind(local.node, local.kinds, local.marks)
  const active = () => !!kind() && !local.node.ignored
  const color = () => {
    const value = kind()
    if (!value) return
    return kindTextColor(value)
  }

  const [menuOpen, setMenuOpen] = createSignal(false)
  const [menuPosition, setMenuPosition] = createSignal({ x: 0, y: 0 })

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const menuWidth = 120
    const menuHeight = 80
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8)
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8)
    setMenuPosition({ x, y })
    setMenuOpen(true)
  }

  return (
    <>
      <Dynamic
        component={local.as ?? "div"}
        classList={{
          "w-full min-w-0 h-6 flex items-center justify-start gap-x-1.5 rounded-md px-1.5 py-0 text-left hover:bg-surface-raised-base-hover active:bg-surface-base-active transition-colors cursor-pointer": true,
          "bg-surface-base-active": local.node.path === local.active,
          ...local.classList,
          [local.class ?? ""]: !!local.class,
          [local.nodeClass ?? ""]: !!local.nodeClass,
        }}
        style={`padding-left: ${Math.max(0, 8 + local.level * 12 - (local.node.type === "file" ? 24 : 4))}px`}
        draggable={local.draggable}
        onDragStart={(event: DragEvent) => {
          if (!local.draggable) return
          event.dataTransfer?.setData("text/plain", `file:${local.node.path}`)
          event.dataTransfer?.setData("text/uri-list", pathToFileUrl(local.node.path))
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy"
          withFileDragImage(event)
        }}
        onContextMenu={handleContextMenu}
        {...rest}
      >
        {local.children}
        <span
          classList={{
            "flex-1 min-w-0 text-12-medium whitespace-nowrap truncate": true,
            "text-text-weak": !active(),
          }}
          style={active() ? color() : undefined}
          title={local.node.name}
        >
          {local.node.name}
        </span>
        {(() => {
          const value = kind()
          if (!value) return null
          if (local.node.type === "file") {
            return (
              <span class="shrink-0 w-4 text-center text-12-medium" style={kindTextColor(value)}>
                {kindLabel(value)}
              </span>
            )
          }
          return <div class="shrink-0 size-1.5 mr-1.5 rounded-full" style={kindDotColor(value)} />
        })()}
      </Dynamic>
      <Show when={menuOpen()}>
        <DropdownMenu
          modal={false}
          open={true}
          onOpenChange={(open) => {
            if (!open) setMenuOpen(false)
          }}
        >
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              class="min-w-[120px]"
              style={`position: fixed; left: ${menuPosition().x}px; top: ${menuPosition().y}px;`}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <Show when={local.node.type === "file" && local.node.path.endsWith(".md") && local.onPreview}>
                <DropdownMenu.Item onSelect={() => {
                  local.onPreview?.(local.node)
                  setMenuOpen(false)
                }}>
                  <div class="flex items-center gap-2">
                    <Icon name="eye" size="small" class="text-icon-weak" />
                    <DropdownMenu.ItemLabel>{local.language?.t("file.preview.label") || "Preview"}</DropdownMenu.ItemLabel>
                  </div>
                </DropdownMenu.Item>
              </Show>
              <Show when={local.node.type === "file" && local.onDownload}>
                <DropdownMenu.Item onSelect={() => {
                  local.onDownload?.(local.node)
                  setMenuOpen(false)
                }}>
                  <div class="flex items-center gap-2">
                    <Icon name="download" size="small" class="text-icon-weak" />
                    <DropdownMenu.ItemLabel>{local.language?.t("file.download.label") || "Download"}</DropdownMenu.ItemLabel>
                  </div>
                </DropdownMenu.Item>
              </Show>
              <Show when={local.onDelete}>
                <DropdownMenu.Item
                  disabled={!local.isOwnProject}
                  onSelect={() => {
                    if (!local.isOwnProject) return
                    local.onDelete?.(local.node)
                    setMenuOpen(false)
                  }}
                >
                  <div class="flex items-center gap-2">
                    <Icon name="trash" size="small" class="text-icon-weak" />
                    <DropdownMenu.ItemLabel>{local.language?.t("file.delete.label") || "Delete"}</DropdownMenu.ItemLabel>
                  </div>
                </DropdownMenu.Item>
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </Show>
    </>
  )
}

export default function FileTree(props: {
  path: string
  class?: string
  nodeClass?: string
  active?: string
  level?: number
  allowed?: readonly string[]
  modified?: readonly string[]
  kinds?: ReadonlyMap<string, Kind>
  draggable?: boolean
  onFileDoubleClick?: (file: FileNode) => void
  showDelete?: boolean
  isOwnProject?: boolean

  _filter?: Filter
  _marks?: Set<string>
  _deeps?: Map<string, number>
  _kinds?: ReadonlyMap<string, Kind>
  _chain?: readonly string[]
}) {
  const file = useFile()
  const sdk = useSDK()
  const language = useLanguage()
  const level = props.level ?? 0
  const draggable = () => props.draggable ?? true
  
  const handleDownload = async (node: FileNode) => {
    try {
      const response = await fetch(`/file/download?directory=${sdk.directory}&path=${encodeURIComponent(node.path)}`)
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Download failed")
      }
      
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = node.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      showToast({
        variant: "success",
        title: language.t("toast.file.downloadSuccess.title"),
        description: language.t("toast.file.downloadSuccess.description", { filename: node.name }),
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      showToast({
        variant: "error",
        title: language.t("toast.file.downloadFailed.title"),
        description: language.t("toast.file.downloadFailed.description", { filename: node.name, error: errorMsg }),
      })
    }
  }

  const handleDelete = async (node: FileNode) => {
    const confirmed = window.confirm(language.t("file.delete.confirm", { filename: node.name }))
    if (!confirmed) return
    
    try {
      const response = await fetch(`/file/delete?directory=${sdk.directory}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: node.path }),
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Delete failed")
      }
      
      showToast({
        variant: "success",
        title: language.t("toast.file.deleteSuccess.title"),
        description: language.t("toast.file.deleteSuccess.description", { filename: node.name }),
      })
      
      file.tree.removeDir(node.path)
      
      const normalizedPath = node.path.endsWith("/") ? node.path.slice(0, -1) : node.path
      const parentDir = normalizedPath.includes("/") ? normalizedPath.substring(0, normalizedPath.lastIndexOf("/")) : ""
      file.tree.refresh(parentDir)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      showToast({
        variant: "error",
        title: language.t("toast.file.deleteFailed.title"),
        description: language.t("toast.file.deleteFailed.description", { filename: node.name, error: errorMsg }),
      })
    }
  }

  const dialog = useDialog()

  function fixMermaidParens(code: string): string {
    return code
      .replace(/(\w+)\[([^\]]+)\]/g, (match, id: string, label: string) => {
        if (label.startsWith('"') || !/[()]/.test(label)) return match
        return `${id}["${label}"]`
      })
      .replace(/(\w+)\{([^\}]+)\}/g, (match, id: string, label: string) => {
        if (label.startsWith('"') || !/[()]/.test(label)) return match
        return `${id}{"${label}"}`
      })
  }

  function PreviewMarkdownDialog(props: { node: FileNode }) {
    let wrapperRef: HTMLDivElement | undefined
    let observer: MutationObserver | undefined
    let debounceTimer: ReturnType<typeof setTimeout> | undefined

    const mermaidReady = import("mermaid").then((m) => {
      const lib = m.default
      lib.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose" })
      return lib
    })

    onCleanup(() => {
      if (observer) observer.disconnect()
      if (debounceTimer) clearTimeout(debounceTimer)
    })

    const [content] = createResource(async () => {
      try {
        const mermaidLib = await mermaidReady
        const response = await fetch(`/file/download?directory=${sdk.directory}&path=${encodeURIComponent(props.node.path)}`)
        if (!response.ok) throw new Error("Failed to read file")
        const text = await response.text()
        return await processMermaidBlocks(text, mermaidLib)
      } catch (e) {
        console.error("Failed to read file:", e)
        return ""
      }
    })

    const processMermaidBlocks = async (text: string, mermaidLib: Mermaid): Promise<string> => {
      svgStore.clear()
      let result = text
      let idx = 0

      for (;;) {
        const start = result.indexOf("```mermaid")
        if (start === -1) break
        const end = result.indexOf("```", start + 10)
        if (end === -1) break

        const fullBlock = result.substring(start, end + 3)
        let codeContent = result.substring(start + 10, end).trim()
        const placeholder = `${MERMAID_PREFIX}${idx}`
        idx++

        codeContent = fixMermaidParens(codeContent)

        try {
          const id = `mermaid-${Date.now()}-${idx}`
          const { svg } = await mermaidLib.render(id, codeContent)
          svgStore.set(placeholder, svg)
          result = result.replace(fullBlock, placeholder)
        } catch {
          svgStore.set(placeholder, `<div style="padding:8px;border:1px solid var(--border-critical-base);border-radius:4px;color:var(--text-diff-delete-base);font-size:13px;">Mermaid render error</div>`)
          result = result.replace(fullBlock, placeholder)
        }
      }

      return result
    }

    const injectMermaidSvgs = (): boolean => {
      if (!wrapperRef) return false
      if (svgStore.size === 0) return true

      const markdownEl = wrapperRef.querySelector('[data-component="markdown"]')
      if (!markdownEl) return false

      const allText = markdownEl.textContent ?? ""
      let hasRemaining = false
      for (const [placeholder] of svgStore) {
        if (allText.includes(placeholder)) hasRemaining = true
      }

      if (!hasRemaining) return true

      for (const [placeholder, svg] of svgStore) {
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
      const text = content()
      if (!text || svgStore.size === 0) return

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

    return (
      <Dialog title={props.node.name} class="min-w-[600px]" fullscreen>
        <div class="flex gap-0 flex-1 min-h-0">
          <Suspense fallback={<div class="flex-1 flex items-center justify-center text-text-weak">{language.t("file.preview.loading")}</div>}>
            <div
              ref={wrapperRef}
              class="flex-1 min-h-0 overflow-auto p-4"
              onClick={(e) => {
                const link = (e.target as HTMLElement).closest("a")
                if (link) {
                  e.preventDefault()
                  e.stopPropagation()
                }
              }}
            >
              <Markdown text={content() || ""} class="prose prose-sm" />
            </div>
            <MarkdownTOC containerRef={wrapperRef} />
          </Suspense>
        </div>
      </Dialog>
    )
  }

  const handlePreview = (node: FileNode) => {
    dialog.show(() => <PreviewMarkdownDialog node={node} />)
  }

  const key = (p: string) =>
    file
      .normalize(p)
      .replace(/[\\/]+$/, "")
      .replaceAll("\\", "/")
  const chain = props._chain ? [...props._chain, key(props.path)] : [key(props.path)]

  const filter = createMemo(() => {
    if (props._filter) return props._filter

    const allowed = props.allowed
    if (!allowed) return

    const files = new Set(allowed)
    const dirs = new Set<string>()

    for (const item of allowed) {
      const parts = item.split("/")
      const parents = parts.slice(0, -1)
      for (const [idx] of parents.entries()) {
        const dir = parents.slice(0, idx + 1).join("/")
        if (dir) dirs.add(dir)
      }
    }

    return { files, dirs }
  })

  const marks = createMemo(() => {
    if (props._marks) return props._marks

    const out = new Set<string>()
    for (const item of props.modified ?? []) out.add(item)
    for (const item of props.kinds?.keys() ?? []) out.add(item)
    if (out.size === 0) return
    return out
  })

  const kinds = createMemo(() => {
    if (props._kinds) return props._kinds
    return props.kinds
  })

  const deeps = createMemo(() => {
    if (props._deeps) return props._deeps

    const out = new Map<string, number>()

    const root = props.path
    if (!(file.tree.state(root)?.expanded ?? false)) return out

    const seen = new Set<string>()
    const stack: { dir: string; lvl: number; i: number; kids: string[]; max: number }[] = []

    const push = (dir: string, lvl: number) => {
      const id = key(dir)
      if (seen.has(id)) return
      seen.add(id)

      const kids = file.tree
        .children(dir)
        .filter((node) => node.type === "directory" && (file.tree.state(node.path)?.expanded ?? false))
        .map((node) => node.path)

      stack.push({ dir, lvl, i: 0, kids, max: lvl })
    }

    push(root, level - 1)

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!

      if (top.i < top.kids.length) {
        const next = top.kids[top.i]!
        top.i++
        push(next, top.lvl + 1)
        continue
      }

      out.set(top.dir, top.max)
      stack.pop()

      const parent = stack[stack.length - 1]
      if (!parent) continue
      parent.max = Math.max(parent.max, top.max)
    }

    return out
  })

  createEffect(() => {
    const current = filter()
    const dirs = dirsToExpand({
      level,
      filter: current,
      expanded: (dir) => untrack(() => file.tree.state(dir)?.expanded) ?? false,
    })
    for (const dir of dirs) file.tree.expand(dir)
  })

  createEffect(
    on(
      () => props.path,
      (path) => {
        const dir = untrack(() => file.tree.state(path))
        if (!shouldListRoot({ level, dir })) return
        void file.tree.list(path)
      },
      { defer: false },
    ),
  )

  const nodes = createMemo(() => {
    const nodes = file.tree.children(props.path)
    const current = filter()
    if (!current) return nodes

    const parent = (path: string) => {
      const idx = path.lastIndexOf("/")
      if (idx === -1) return ""
      return path.slice(0, idx)
    }

    const leaf = (path: string) => {
      const idx = path.lastIndexOf("/")
      return idx === -1 ? path : path.slice(idx + 1)
    }

    const out = nodes.filter((node) => {
      if (node.type === "file") return current.files.has(node.path)
      return current.dirs.has(node.path)
    })

    const seen = new Set(out.map((node) => node.path))

    for (const dir of current.dirs) {
      if (parent(dir) !== props.path) continue
      if (seen.has(dir)) continue
      out.push({
        name: leaf(dir),
        path: dir,
        absolute: dir,
        type: "directory",
        ignored: false,
      })
      seen.add(dir)
    }

    for (const item of current.files) {
      if (parent(item) !== props.path) continue
      if (seen.has(item)) continue
      out.push({
        name: leaf(item),
        path: item,
        absolute: item,
        type: "file",
        ignored: false,
      })
      seen.add(item)
    }

    out.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    return out
  })

  return (
    <div data-component="filetree" class={`flex flex-col gap-0.5 ${props.class ?? ""}`}>
      <For each={nodes()}>
        {(node) => {
          const expanded = () => file.tree.state(node.path)?.expanded ?? false
          const deep = () => deeps().get(node.path) ?? -1
          const kind = () => visibleKind(node, kinds(), marks())
          const active = () => !!kind() && !node.ignored

          return (
            <Switch>
              <Match when={node.type === "directory"}>
                <Collapsible
                  variant="ghost"
                  class="w-full"
                  data-scope="filetree"
                  forceMount={false}
                  open={expanded()}
                  onOpenChange={(open) => (open ? file.tree.expand(node.path) : file.tree.collapse(node.path))}
                >
                  <Collapsible.Trigger>
                    <FileTreeNode
                      node={node}
                      level={level}
                      active={props.active}
                      nodeClass={props.nodeClass}
                      draggable={draggable()}
                      kinds={kinds()}
                      marks={marks()}
                      language={language}
                      onDelete={props.showDelete ? handleDelete : undefined}
                      isOwnProject={props.isOwnProject}
                      onDblClick={(e: MouseEvent) => {
                        e.stopPropagation()
                        e.preventDefault()
                        props.onFileDoubleClick?.(node)
                      }}
                    >
                      <div class="size-4 flex items-center justify-center text-icon-weak">
                        <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
                      </div>
                    </FileTreeNode>
                  </Collapsible.Trigger>
                  <Collapsible.Content class="relative pt-0.5">
                    <div
                      classList={{
                        "absolute top-0 bottom-0 w-px pointer-events-none bg-border-weak-base opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none": true,
                        "group-hover/filetree:opacity-100": expanded() && deep() === level,
                        "group-hover/filetree:opacity-50": !(expanded() && deep() === level),
                      }}
                      style={`left: ${Math.max(0, 8 + level * 12 - 4) + 8}px`}
                    />
                    <Show
                      when={level < MAX_DEPTH && !chain.includes(key(node.path))}
                      fallback={<div class="px-2 py-1 text-12-regular text-text-weak">...</div>}
                    >
                      <FileTree
                        path={node.path}
                        level={level + 1}
                        allowed={props.allowed}
                        modified={props.modified}
                        kinds={props.kinds}
                        active={props.active}
                        draggable={props.draggable}
                        showDelete={props.showDelete}
                        isOwnProject={props.isOwnProject}
                        onFileDoubleClick={props.onFileDoubleClick}
                        _filter={filter()}
                        _marks={marks()}
                        _deeps={deeps()}
                        _kinds={kinds()}
                        _chain={chain}
                      />
                    </Show>
                  </Collapsible.Content>
                </Collapsible>
              </Match>
              <Match when={node.type === "file"}>
                <FileTreeNode
                  node={node}
                  level={level + 1}
                  draggable={false}
                  active={props.active}
                  nodeClass={props.nodeClass}
                  kinds={kinds()}
                  marks={marks()}
                  language={language}
                  onDelete={props.showDelete ? handleDelete : undefined}
                  onDownload={handleDownload}
                  onPreview={handlePreview}
                  isOwnProject={props.isOwnProject}
                  onDblClick={() => props.onFileDoubleClick?.(node)}
                >
                  <div class="w-4 shrink-0" />
                  <Switch>
                    <Match when={active()}>
                      <FileIcon
                        node={node}
                        class="size-4 filetree-icon filetree-icon--mono"
                        style={kindTextColor(kind()!)}
                        mono
                      />
                    </Match>
                    <Match when={true}>
                      <span class="filetree-iconpair size-4">
                        <FileIcon
                          node={node}
                          class="size-4 filetree-icon filetree-icon--color opacity-0 group-hover/filetree:opacity-100"
                        />
                        <FileIcon
                          node={node}
                          class="size-4 filetree-icon filetree-icon--mono group-hover/filetree:opacity-0"
                          mono
                        />
                      </span>
                    </Match>
                  </Switch>
                </FileTreeNode>
              </Match>
            </Switch>
          )
        }}
      </For>
    </div>
  )
}
