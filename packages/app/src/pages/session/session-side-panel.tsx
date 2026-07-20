import { For, Match, Show, Switch, createEffect, createMemo, onCleanup, onMount, on, type JSX, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"

import FileTree from "@/components/file-tree"
import { useCommand } from "@/context/command"
import { useDevice } from "@/context/device"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { usePrompt, type ContentPart } from "@/context/prompt"
import { useParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { decode64 } from "@/utils/base64"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import { createOpenSessionFileTab, createSessionTabs, type Sizing } from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"

export function SessionSidePanel(props: {
  size: Sizing
}) {
  const layout = useLayout()
  const platform = usePlatform()
  const settings = useSettings()
  const sync = useSync()
  const file = useFile()
const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const params = useParams()
  const prompt = usePrompt()
  const sdk = useSDK()
  const device = useDevice()
  const { sessionKey, tabs, view } = useSessionLayout()

const isDesktop = createMediaQuery("(min-width: 768px)")
  const sessionID = createMemo(() => params.id)
  const uploadDir = createMemo(() => sessionID() ? `uploads/${sessionID()}` : undefined)
  const [uploading, setUploading] = createSignal(false)
  let uploadAbortController: AbortController | null = null
  let uploadStartSessionID: string | null = null

  // Abort upload when session changes
  createEffect(on(sessionID, (newID, prevID) => {
    if (prevID && uploading()) {
      uploadAbortController?.abort()
      setUploading(false)
      uploadAbortController = null
      uploadStartSessionID = null
      document.body.removeAttribute("data-drop-completed")
    }
  }))

  // Poll upload directory for changes
  let pollInterval: ReturnType<typeof setInterval> | undefined
  const startPolling = () => {
    if (pollInterval) return
    pollInterval = setInterval(() => {
      const dir = uploadDir()
      if (dir) file.tree.refresh(dir)
    }, 5000)
  }
  const stopPolling = () => {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = undefined }
  }
  createEffect(() => {
    if (layout.fileTree.opened() && uploadDir() && isOwnProject()) startPolling()
    else stopPolling()
  })

  // Cleanup on component destroy
  onCleanup(() => {
    stopPolling()
    uploadAbortController?.abort()
    setUploading(false)
    document.body.removeAttribute("data-drop-completed")
    document.body.removeAttribute("data-upload-zone-active")
    document.body.removeAttribute("data-prevent-drag-overlay")
  })
  
  const isOwnProject = createMemo(() => {
    const directory = decode64(params.dir)
    if (!directory) return true
    return device.isOwnProject(directory)
  })
  
  // Ensure upload directory exists (only when we have a real session id)
  createEffect(() => {
    const dir = uploadDir()
    if (!dir || !sdk.directory) return
    
    const fullPath = `${sdk.directory}/${dir}`
    fetch('/directory/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fullPath }),
    })
      .then(() => {
        file.tree.list(dir, { force: true }).catch(() => {})
      })
      .catch(() => {})
  })
  const shown = createMemo(
    () =>
      platform.platform !== "desktop" ||
      import.meta.env.VITE_OPENCODE_CHANNEL !== "beta" ||
      settings.general.showFileTree(),
  )

  const fileOpen = createMemo(() => isDesktop() && shown() && layout.fileTree.opened())
  const open = createMemo(() => fileOpen())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    return `${layout.fileTree.width()}px`
  })
  const treeWidth = createMemo(() => (fileOpen() ? `${layout.fileTree.width()}px` : "0px"))

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    setActive: tabs().setActive,
  })

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
  })
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab

  const fileTreeTab = () => layout.fileTree.tab()

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  const showAllFiles = () => {
    layout.fileTree.setTab("all")
  }

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  return (
    <Show when={isDesktop()}>
      <aside
        id="side-panel"
        aria-label={language.t("session.files.all")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 h-full flex shrink-0 overflow-hidden bg-background-base"
        classList={{
          "pointer-events-none": !open(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active(),
        }}
        style={{ width: panelWidth() }}
      >
        <Show when={shown()}>
          <div
              id="file-tree-panel"
              aria-hidden={!fileOpen()}
              inert={!fileOpen()}
              class="relative min-w-0 h-full shrink-0 overflow-hidden"
              classList={{
                "pointer-events-none": !fileOpen(),
                "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                  !props.size.active(),
              }}
              style={{ width: treeWidth() }}
              onDragEnter={(e) => {
                e.preventDefault()
                e.stopPropagation()
                document.body.setAttribute("data-file-tree-dragging", "true")
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const target = e.target as HTMLElement
                const panel = target.closest("#file-tree-panel")
                if (!panel || e.currentTarget !== panel) {
                  document.body.removeAttribute("data-file-tree-dragging")
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                document.body.removeAttribute("data-file-tree-dragging")
              }}
            >
              <div
                class="h-full flex flex-col overflow-hidden group/filetree"
                classList={{ "border-l border-border-weaker-base": fileOpen() }}
              >
                <Tabs
                  variant="pill"
                  value="all"
                  class="h-full"
                  data-scope="filetree"
                >
                  <Tabs.List>
                    <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                      {language.t("session.files.all")}
                    </Tabs.Trigger>
                  </Tabs.List>
                  <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
                    <Show when={uploadDir() && !nofiles()}>
                          <FileTree
                            path={uploadDir()!}
                            class="pt-3"
                            showDelete={true}
                            isOwnProject={isOwnProject()}
                            onFileDoubleClick={(node) => {
                              const current = prompt.current()
                              const archiveExts = [".zip", ".tar.gz", ".tgz", ".tar", ".rar", ".7z"]
                              const isArchive = archiveExts.some(e => node.path.toLowerCase().endsWith(e))
                              const parts: ContentPart[] = [...current, { type: "file", path: node.path, content: "@" + node.path, start: 0, end: 0 }]
                              if (isArchive) {
                                const dir = node.path.includes("/") ? node.path.substring(0, node.path.lastIndexOf("/")) : ""
                                const archiveNameWithoutExt = node.name.replace(/\.(zip|tar\.gz|tgz|tar|rar|7z)$/i, "")
                                parts.push({ type: "text", content: `（${language.t("session.archive.extractHint")} @${dir}/${archiveNameWithoutExt}），`, start: 0, end: 0 })
                              } else {
                                parts.push({
                                  type: "text",
                                  content: `，`,
                                  start: 0,
                                  end: 0,
                                })
                              }
                              prompt.set(parts, prompt.cursor())
                            }}
                          />
                        </Show>

                    <Show when={isOwnProject() && uploadDir()} fallback={<>
                      <Show when={!isOwnProject()}>
                        <div class="mt-4 p-3 border-2 border-dashed border-border-weak rounded-lg opacity-50" style="min-height: 80px">
                          <div class="flex flex-col items-center justify-center text-text-weaker">
                            <Icon name="cloud-upload" class="size-6 mb-2" />
                            <p class="text-12-regular">{language.t("session.files.uploadDisabled")}</p>
                          </div>
                        </div>
                      </Show>
                      <Show when={isOwnProject() && !uploadDir()}>
                        <div class="mt-4 p-3 border-2 border-dashed border-border-weak rounded-lg opacity-50" style="min-height: 80px">
                          <div class="flex flex-col items-center justify-center text-text-weaker">
                            <Spinner class="mb-2" />
                            <p class="text-12-regular">{language.t("session.files.initializing")}</p>
                          </div>
                        </div>
                      </Show>
                    </>}>
                      <div
                        class="mt-4 p-3 border-2 border-dashed rounded-lg transition-colors file-upload-zone"
                        classList={{
                          "cursor-pointer": !uploading(),
                          "border-border-weak hover:border-border-base": !uploading(),
                          "border-interactive-base bg-surface-interactive-weak": uploading(),
                        }}
                        style="min-height: 80px"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const dir = uploadDir()
                          if (!dir || uploading()) return
                          
                          const input = document.createElement('input')
                          input.type = 'file'
                          input.multiple = true
                          input.style.display = 'none'
                          input.onchange = async (event) => {
                            const target = event.target as HTMLInputElement
                            const files = target.files
                            if (!files || files.length === 0) return
                            
                            setUploading(true)
                            
                            for (const selectedFile of Array.from(files)) {
                              const targetPath = `${dir}/${selectedFile.name}`
                              const formData = new FormData()
                              formData.append("file", selectedFile)
                              formData.append("path", targetPath)
                              
                              try {
                                const response = await fetch(`/file/upload?directory=${sdk.directory}`, {
                                  method: "POST",
                                  body: formData,
                                })
                                
                                if (!response.ok) {
                                  const error = await response.json()
                                  throw new Error(error.error || "Upload failed")
                                }
                                
                                file.tree.refresh(dir)
                                showToast({
                                  variant: "success",
                                  title: language.t("toast.file.uploadSuccess.title"),
                                  description: language.t("toast.file.uploadSuccess.description", { filename: selectedFile.name }),
                                })
                              } catch (error) {
                                const errorMsg = error instanceof Error ? error.message : String(error)
                                showToast({
                                  variant: "error",
                                  title: language.t("toast.file.uploadFailed.title"),
                                  description: `${selectedFile.name}: ${errorMsg}`,
                                })
                              }
                            }
                            
                            setUploading(false)
                            document.body.removeChild(input)
                          }
                          document.body.appendChild(input)
                          input.click()
                        }}
                        onDragEnter={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          e.stopImmediatePropagation()
                          document.body.setAttribute("data-upload-zone-active", "true")
                          document.body.setAttribute("data-prevent-drag-overlay", "true")
                        }}
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          e.stopImmediatePropagation()
                          e.dataTransfer!.dropEffect = "copy"
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          e.stopImmediatePropagation()
                          const target = e.target as HTMLElement
                          const zone = target.closest(".file-upload-zone")
                          if (zone && e.currentTarget === zone) {
                            document.body.removeAttribute("data-upload-zone-active")
                            document.body.removeAttribute("data-prevent-drag-overlay")
                          }
                        }}
                        onDrop={async (e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          e.stopImmediatePropagation()

                          document.body.setAttribute("data-drop-completed", "true")
                          document.body.removeAttribute("data-upload-zone-active")
                          document.body.removeAttribute("data-prevent-drag-overlay")

                          const dir = uploadDir()
                          if (!dir || uploading()) return

                          const items = Array.from(e.dataTransfer!.items)
                          if (items.length === 0) return

                          const currentSessionID = sessionID()
                          if (!currentSessionID) return

                          uploadAbortController = new AbortController()
                          uploadStartSessionID = currentSessionID
                          const signal = uploadAbortController.signal
                          setUploading(true)

                          const uploadFile = async (file: File, path: string) => {
                            if (signal.aborted) throw new Error("Aborted")
                            if (sessionID() !== uploadStartSessionID) {
                              uploadAbortController?.abort()
                              throw new Error("Session changed")
                            }

                            const formData = new FormData()
                            formData.append("file", file)
                            formData.append("path", path)

                            const response = await fetch(`/file/upload?directory=${sdk.directory}`, {
                              method: "POST",
                              body: formData,
                              signal,
                            })

                            if (!response.ok) {
                              const error = await response.json()
                              throw new Error(error.error || "Upload failed")
                            }
                          }

                          const traverseEntry = async (entry: FileSystemEntry, basePath: string) => {
                            if (signal.aborted) throw new Error("Aborted")
                            if (sessionID() !== uploadStartSessionID) {
                              uploadAbortController?.abort()
                              throw new Error("Session changed")
                            }

                            if (entry.isFile) {
                              const fileEntry = entry as FileSystemFileEntry
                              const file = await new Promise<File>((resolve) => fileEntry.file(resolve))
                              await uploadFile(file, basePath)
                            } else if (entry.isDirectory) {
                              const dirEntry = entry as FileSystemDirectoryEntry
                              const reader = dirEntry.createReader()
                              const entries = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve))
                              for (const childEntry of entries) {
                                await traverseEntry(childEntry, `${basePath}/${childEntry.name}`)
                              }
                            }
                          }

                          try {
                            for (const item of items) {
                              const entry = item.webkitGetAsEntry()
                              if (entry) {
                                await traverseEntry(entry, `${dir}/${entry.name}`)
                              }
                            }
                            await Promise.all([file.tree.refresh(""), file.tree.refresh(dir)])
                          } catch (error) {
                            if (error instanceof Error && (error.name === "AbortError" || error.message === "Aborted" || error.message === "Session changed")) {
                              showToast({
                                variant: "success",
                                title: language.t("toast.file.uploadAborted.title"),
                                description: language.t("toast.file.uploadAborted.description"),
                              })
                            } else {
                              const errorMsg = error instanceof Error ? error.message : String(error)
                              showToast({
                                variant: "error",
                                title: language.t("toast.file.uploadFailed.title"),
                                description: errorMsg,
                              })
                            }
                          } finally {
                            setUploading(false)
                            uploadAbortController = null
                            uploadStartSessionID = null
                            document.body.removeAttribute("data-drop-completed")
                          }
                        }}
                      >
                        <div classList={{ "flex flex-col items-center justify-center text-text-weak": !uploading(), "flex flex-col items-center justify-center text-text-strong": uploading() }}>
                          <Show when={uploading()} fallback={<Icon name="cloud-upload" class="size-6 mb-2" />}>
                            <Spinner class="mb-2" />
                          </Show>
                          <p class="text-12-medium">{uploading() ? language.t("session.files.uploading") : language.t("session.files.uploadHint")}</p>
                        </div>
                      </div>
                      <div data-component="usage-guide" class="mt-2 px-1 text-12-regular text-text-weaker leading-4">
                        <p class="text-12-medium text-text-weak mb-1">{language.t("enterprise.usageGuide.title")}（<span style="color:#f59e0b">黄区环境</span>）：</p>
                        <p>{language.t("enterprise.usageGuide.scenario")}</p>
                        <p>{language.t("enterprise.usageGuide.reference")}</p>
                        <p>{language.t("enterprise.usageGuide.delete")}</p>
                        <p>{language.t("enterprise.usageGuide.example")}</p>
                      </div>
                    </Show>
                  </Tabs.Content>
                </Tabs>
              </div>
              <Show when={fileOpen()}>
                <div onPointerDown={() => props.size.start()}>
                  <ResizeHandle
                    direction="horizontal"
                    edge="start"
                    size={layout.fileTree.width()}
                    min={250}
                    max={600}
                    onResize={(width) => {
                      props.size.touch()
                      layout.fileTree.resize(width)
                    }}
                  />
                </div>
              </Show>
            </div>
          </Show>
        </aside>
      </Show>
  )
}
