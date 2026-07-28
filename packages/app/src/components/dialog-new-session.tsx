import { Component, createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useDevice } from "@/context/device"

interface DialogNewSessionProps {
  directory: string
}

export const DialogNewSession: Component<DialogNewSessionProps> = (props) => {
  const navigate = useNavigate()
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const device = useDevice()
  
  const [title, setTitle] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  
  const handleCreate = async () => {
    const name = title().trim()
    if (!name) {
      showToast({
        variant: "error",
        title: language.t("toast.session.nameRequired.title"),
        description: language.t("toast.session.nameRequired.description"),
      })
      return
    }
    
    setCreating(true)
    
    try {
      const result = await globalSDK.client.session.create({
        directory: props.directory,
        title: name,
      })
      
      const session = result.data
      if (!session) {
        showToast({
          variant: "error",
          title: language.t("prompt.toast.sessionCreateFailed.title"),
          description: language.t("common.requestFailed"),
        })
        setCreating(false)
        return
      }
      
      const slug = base64Encode(props.directory)
      dialog.close()
      navigate(`/${slug}/session/${session.id}`)
      fetch("/api/stats/session-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientIP: device.clientIP(), sessionID: session.id, timestamp: Date.now() }),
      }).catch(() => {})
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("prompt.toast.sessionCreateFailed.title"),
        description: error instanceof Error ? error.message : String(error),
      })
      setCreating(false)
    }
  }
  
  return (
    <Dialog title={language.t("dialog.newSession.title")} fit draggable class="w-full max-w-[400px] mx-auto">
      <div class="flex flex-col gap-4 p-4 pt-0">
        <TextField
          autofocus
          type="text"
          label={language.t("dialog.newSession.nameLabel")}
          placeholder={language.t("dialog.newSession.namePlaceholder")}
          value={title()}
          onChange={(v) => setTitle(v)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey && !e.defaultPrevented) {
              e.preventDefault()
              handleCreate()
            }
          }}
        />
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="small" onClick={() => {
            const d = new Date()
            const pad = (n: number) => String(n).padStart(2, "0")
            setTitle(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`)
          }}>
            当前时间
          </Button>
          <Button variant="ghost" size="small" onClick={() => dialog.close()} disabled={creating()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="small" onClick={handleCreate} disabled={creating() || !title().trim()}>
            {creating() ? language.t("common.loading") : language.t("common.create")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}