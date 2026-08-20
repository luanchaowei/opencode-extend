import { defineConfig } from "vite"
import desktopPlugin from "./vite"

export default defineConfig({
  envDir: "../..",
  plugins: [desktopPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 10000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("mermaid") || id.includes("cytoscape") || id.includes("dagre") || id.includes("elkjs") || id.includes("webcola")) return "mermaid"
            if (id.includes("shiki") || id.includes("@shikijs")) return "shiki"
            if (id.includes("marked") || id.includes("marked-")) return "marked"
            if (id.includes("@solidjs") || id.includes("solid-js") || id.includes("solid-") || id.includes("@kobalte")) return "solid"
            if (id.includes("@tanstack")) return "query"
          }
        },
      },
    },
  },
})
