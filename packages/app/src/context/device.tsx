import { createSimpleContext } from "@opencode-ai/ui/context"
import { createResource } from "solid-js"
import { getFilename } from "@opencode-ai/core/util/path"

export const { use: useDevice, provider: DeviceProvider } = createSimpleContext({
  name: "Device",
  init: () => {
    const [deviceInfo] = createResource(async () => {
      try {
        const [devResult, authResult] = await Promise.allSettled([
          fetch('/device/info'),
          fetch('/api/auth/me'),
        ])
        const devResp = devResult.status === 'fulfilled' ? devResult.value : null
        const authResp = authResult.status === 'fulfilled' ? authResult.value : null
        let authData: { username: string; role: string } | null = null
        if (authResp?.ok) authData = await authResp.json()
        if (devResp?.ok) {
          const { clientIP, contactAdmin, feedbackUrl, caseLibraryDir, helpDocUrl, downloadCutoffText, fileTreePollInterval, heartbeatInterval, diskUsageThreshold, hiddenProviders } = await devResp.json()
           return { clientIP, contactAdmin, feedbackUrl, caseLibraryDir, helpDocUrl, downloadCutoffText, fileTreePollInterval, heartbeatInterval, diskUsageThreshold, hiddenProviders: hiddenProviders ?? [], username: authData?.username ?? "", role: authData?.role ?? "" }
         }
       } catch (error) {
         console.error('Failed to get device info:', error)
       }
       return { clientIP: null, contactAdmin: [], feedbackUrl: "", caseLibraryDir: "", helpDocUrl: "", downloadCutoffText: "", fileTreePollInterval: 5000, heartbeatInterval: 60000, diskUsageThreshold: 90, hiddenProviders: [], username: "", role: "" }
    })

    const clientIP = () => deviceInfo()?.clientIP
    const contactAdmin = () => deviceInfo()?.contactAdmin ?? []
    const feedbackUrl = () => deviceInfo()?.feedbackUrl ?? ""
    const caseLibraryDir = () => deviceInfo()?.caseLibraryDir ?? ""
    const username = () => deviceInfo()?.username ?? ""
    const role = () => deviceInfo()?.role ?? ""

    const helpDocUrl = () => deviceInfo()?.helpDocUrl ?? ""
    const downloadCutoffText = () => deviceInfo()?.downloadCutoffText ?? ""
    const fileTreePollInterval = () => deviceInfo()?.fileTreePollInterval ?? 5000
    const heartbeatInterval = () => deviceInfo()?.heartbeatInterval ?? 60000
    const diskUsageThreshold = () => deviceInfo()?.diskUsageThreshold ?? 90
    const hiddenProviders = () => deviceInfo()?.hiddenProviders ?? []

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
      downloadCutoffText,
      fileTreePollInterval,
      heartbeatInterval,
      diskUsageThreshold,
      hiddenProviders,
      isOwnProject,
      username,
      role,
    }
  },
})