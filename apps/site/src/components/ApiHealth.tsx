import { useEffect, useState } from "react"

interface Health {
  status: "ok" | "degraded"
  service: string
  version: string
  timestamp: string
}

/** 展示 Effect 后端（apps/api）的健康状态 —— 本站 dogfooding 的小证据 */
export default function ApiHealth() {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading")
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: Health) => {
        if (!cancelled) {
          setHealth(data)
          setState("ok")
        }
      })
      .catch(() => {
        if (!cancelled) setState("error")
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state === "loading") {
    return <span className="badge dim">正在连接后端…</span>
  }
  if (state === "error" || health === null) {
    return (
      <span className="badge dim" title="社区功能（问答 / 投稿）尚未上线，内容浏览不受影响">
        社区后端筹备中 —— 内容浏览不受影响
      </span>
    )
  }
  return (
    <span className="badge ok">
      {health.service} v{health.version} · {health.status} · 由 Effect 驱动
    </span>
  )
}
