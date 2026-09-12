import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal, onCleanup } from "solid-js"
import { getFilename } from "@opencode-ai/core/util/path"

export const { use: useDevice, provider: DeviceProvider } = createSimpleContext({
  name: "Device",
  init: () => {
    const [deviceInfo, setDeviceInfo] = createSignal<Record<string, any>>({
      clientIP: null, contactAdmin: [], feedbackUrl: "", caseLibraryDir: "",
      helpDocUrl: "", fileTreePollInterval: 10000, heartbeatInterval: 60000,
      diskUsageThreshold: 90, hiddenProviders: [], onboardingCompleted: 0,
      username: "", role: "",
    })

    const fetchDeviceInfo = async () => {
      try {
        const [devResult, authResult] = await Promise.allSettled([
          fetch('/device/info', { cache: "no-store" }),
          fetch('/api/auth/me', { cache: "no-store" }),
        ])
        const devResp = devResult.status === 'fulfilled' ? devResult.value : null
        const authResp = authResult.status === 'fulfilled' ? authResult.value : null
        let authData: { username: string; role: string } | null = null
        if (authResp?.ok) authData = await authResp.json()
        if (devResp?.ok) {
          const { clientIP, contactAdmin, feedbackUrl, caseLibraryDir, helpDocUrl, fileTreePollInterval, heartbeatInterval, diskUsageThreshold, hiddenProviders, onboardingCompleted } = await devResp.json()
          const data = { clientIP, contactAdmin, feedbackUrl, caseLibraryDir, helpDocUrl, fileTreePollInterval, heartbeatInterval, diskUsageThreshold, hiddenProviders: hiddenProviders ?? [], onboardingCompleted: onboardingCompleted ?? 0, username: authData?.username ?? "", role: authData?.role ?? "" }
          setDeviceInfo(prev => JSON.stringify(prev) === JSON.stringify(data) ? prev : data)
        }
      } catch (error) {
        console.error('Failed to get device info:', error)
      }
    }

    void fetchDeviceInfo()
    const configPollTimer = setInterval(() => fetchDeviceInfo(), 30000)
    onCleanup(() => clearInterval(configPollTimer))

    const clientIP = () => deviceInfo()?.clientIP
    const contactAdmin = () => deviceInfo()?.contactAdmin ?? []
    const feedbackUrl = () => deviceInfo()?.feedbackUrl ?? ""
    const caseLibraryDir = () => deviceInfo()?.caseLibraryDir ?? ""
    const username = () => deviceInfo()?.username ?? ""
    const role = () => deviceInfo()?.role ?? ""

    const helpDocUrl = () => deviceInfo()?.helpDocUrl ?? ""
    const fileTreePollInterval = () => deviceInfo()?.fileTreePollInterval ?? 10000
    const heartbeatInterval = () => deviceInfo()?.heartbeatInterval ?? 60000
    const diskUsageThreshold = () => deviceInfo()?.diskUsageThreshold ?? 90
    const hiddenProviders = () => deviceInfo()?.hiddenProviders ?? []
    const onboardingCompleted = () => deviceInfo()?.onboardingCompleted ?? 0

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
      fileTreePollInterval,
      heartbeatInterval,
      diskUsageThreshold,
      hiddenProviders,
      onboardingCompleted,
      isOwnProject,
      username,
      role,
    }
  },
})
