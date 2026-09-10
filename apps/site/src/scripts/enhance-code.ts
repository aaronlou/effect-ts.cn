/**
 * 代码块增强：为每段代码加上「语言 / 复制 / 打开 Playground」工具条。
 * 采用渐进增强：无 JS 时代码照常可读；Astro 默认 Shiki 已完成高亮。
 *
 * 说明：官方 Playground 目前不支持通过 URL 预置代码，因此此处只提供入口（不假装能带入代码）。
 */
const PLAYGROUND_URL = "https://effect.website/play"

function enhanceCodeBlocks(): void {
  const blocks = document.querySelectorAll<HTMLPreElement>(".prose pre")
  blocks.forEach((pre) => {
    if (pre.dataset.enhanced === "true") return
    const code = pre.querySelector("code")
    if (code === null) return
    pre.dataset.enhanced = "true"

    const langMatch = /language-([\w-]+)/.exec(code.className)
    const lang = langMatch?.[1] ?? "text"

    const toolbar = document.createElement("div")
    toolbar.className = "code-toolbar"

    const label = document.createElement("span")
    label.className = "code-lang"
    label.textContent = lang

    const copy = document.createElement("button")
    copy.type = "button"
    copy.className = "code-btn"
    copy.textContent = "复制"
    copy.addEventListener("click", () => {
      const text = code.textContent ?? ""
      navigator.clipboard.writeText(text).then(
        () => {
          copy.textContent = "已复制 ✓"
          window.setTimeout(() => {
            copy.textContent = "复制"
          }, 1500)
        },
        () => {
          copy.textContent = "复制失败"
        }
      )
    })

    const play = document.createElement("a")
    play.className = "code-btn"
    play.href = PLAYGROUND_URL
    play.target = "_blank"
    play.rel = "external"
    play.textContent = "Playground ↗"

    toolbar.append(label, copy, play)
    pre.prepend(toolbar)
  })
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", enhanceCodeBlocks)
} else {
  enhanceCodeBlocks()
}

export {}
