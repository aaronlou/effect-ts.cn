/**
 * 代码块增强：为每段代码加上「语言 / 复制 / 打开 Playground」工具条，
 * 并在**代码比容器宽**时给出两个出路：显式的"可横向滚动"提示 + 一键换行。
 *
 * 为什么要那个提示：macOS 的滚动条默认是覆盖式的、不滚动就不显示 ——
 * 于是"这块代码被截断了"和"这块代码可以横向滚"在视觉上完全一样，
 * 用户只会觉得内容显示不全。宁可多一个小标签，也不要让人猜。
 *
 * 为什么还要换行开关：本站文档里最宽的代码行有 120+ 字符（连接串、长注释），
 * 在 1161px 的窗口下仍有 ~190px 溢出。给一个开关，比逼着人左右拖动强。
 * 偏好写进 localStorage（跨页面记着）——用户表达的是"我讨厌横向滚"，不是"这一块"。
 *
 * 采用渐进增强：无 JS 时代码照常可读；Astro 默认 Shiki 已完成高亮。
 */
const PLAYGROUND_URL = "https://effect.website/play"
const WRAP_KEY = "ecn:code-wrap"

/** 本页所有代码块的换行开关：点任意一个，整页一起变（阅读时不该一块一块点） */
const wrapSetters: Array<(on: boolean) => void> = []
const setAllWrapped = (on: boolean): void => {
  for (const set of wrapSetters) set(on)
}

const readWrapPreference = (): boolean => {
  try {
    return localStorage.getItem(WRAP_KEY) === "1"
  } catch {
    return false
  }
}

const writeWrapPreference = (on: boolean): void => {
  try {
    localStorage.setItem(WRAP_KEY, on ? "1" : "0")
  } catch {
    // 隐私模式：记不住没关系，本次会话内仍然有效
  }
}

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

    // 溢出提示：只在真的溢出时出现（默认隐藏，避免给短代码块添噪）
    const scrollHint = document.createElement("span")
    scrollHint.className = "code-scroll-hint"
    scrollHint.textContent = "↔ 可横向滚动"
    scrollHint.hidden = true

    // 换行开关：溢出时出现；已经换行时保持可见（否则一换行按钮就消失，换不回来）
    const wrap = document.createElement("button")
    wrap.type = "button"
    wrap.className = "code-btn"
    wrap.hidden = true

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

    toolbar.append(label, scrollHint, wrap, copy, play)
    pre.prepend(toolbar)

    /** 布局完成后量一次：字体、侧栏宽度、窗口大小都会影响"这行放不放得下" */
    const sync = (): void => {
      const wrapped = pre.classList.contains("is-wrapped")
      const overflowing = pre.scrollWidth > pre.clientWidth + 2
      const showHint = overflowing && !wrapped
      pre.classList.toggle("is-overflowing", showHint)
      scrollHint.hidden = !showHint
      wrap.hidden = !(overflowing || wrapped)
    }

    const applyWrap = (on: boolean): void => {
      pre.classList.toggle("is-wrapped", on)
      wrap.textContent = on ? "不换行" : "换行"
      sync()
    }

    wrapSetters.push(applyWrap)
    wrap.addEventListener("click", () => {
      const next = !pre.classList.contains("is-wrapped")
      writeWrapPreference(next)
      setAllWrapped(next)
    })

    applyWrap(readWrapPreference())
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => sync())
      observer.observe(pre)
    } else {
      window.addEventListener("resize", () => sync())
    }
  })
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", enhanceCodeBlocks)
} else {
  enhanceCodeBlocks()
}

export {}
