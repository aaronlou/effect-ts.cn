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
      <span className="badge warn">
        后端未启动 —— 在仓库根目录运行 <code>pnpm dev</code> 后刷新
      </span>
    )
  }
  return (
    <span className="badge ok">
      {health.service} v{health.version} · {health.status} · 由 Effect 驱动
    </span>
  )
}
