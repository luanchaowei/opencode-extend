import { createSimpleContext } from "@opencode-ai/ui/context"
import { createResource } from "solid-js"
import { getFilename } from "@opencode-ai/core/util/path"

export const { use: useDevice, provider: DeviceProvider } = createSimpleContext({
  name: "Device",
  init: () => {
    const [deviceInfo] = createResource(async () => {
      try {
        const response = await fetch('/device/info')
        if (response.ok) {
          const { clientIP, contactAdmin, feedbackUrl, caseLibraryDir, helpDocUrl } = await response.json()
           return { clientIP, contactAdmin, feedbackUrl, caseLibraryDir, helpDocUrl }
        }
      } catch (error) {
        console.error('Failed to get device info:', error)
      }
      return { clientIP: null, contactAdmin: [], feedbackUrl: "", caseLibraryDir: "", helpDocUrl: "" }
    })

    const clientIP = () => deviceInfo()?.clientIP
    const contactAdmin = () => deviceInfo()?.contactAdmin ?? []
    const feedbackUrl = () => deviceInfo()?.feedbackUrl ?? ""
    const caseLibraryDir = () => deviceInfo()?.caseLibraryDir ?? ""

    const helpDocUrl = () => deviceInfo()?.helpDocUrl ?? ""

    const isOwnProject = (projectWorktree: string): boolean => {
      const ip = clientIP()
      if (ip === undefined || ip === null) return true
      if (ip === 'localhost' || ip === 'unknown') return true
      const dirName = getFilename(projectWorktree)
      return dirName === ip
    }

    return {
      clientIP,
      contactAdmin,
      feedbackUrl,
      caseLibraryDir,
      helpDocUrl,
      isOwnProject,
    }
  },
})