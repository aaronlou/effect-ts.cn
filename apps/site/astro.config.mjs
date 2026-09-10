import { defineConfig } from "astro/config"
import react from "@astrojs/react"
import mdx from "@astrojs/mdx"
import sitemap from "@astrojs/sitemap"

// 站点元信息在 src/layouts/Base.astro 中维护；此处为 Astro 构建配置。
export default defineConfig({
  site: "https://effect-ts.cn",
  output: "static",
  integrations: [react(), mdx(), sitemap()],
  vite: {
    server: {
      // 本地开发：把 /api/* 代理到 Effect 后端（pnpm dev 时 api 运行在 8787）
      proxy: {
        "/api": "http://localhost:8787"
      }
    }
  }
})
