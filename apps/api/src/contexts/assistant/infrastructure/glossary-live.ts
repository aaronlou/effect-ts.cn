/**
 * Assistant 上下文 · infrastructure：加载术语表（与内容门禁共用 docs/glossary.json）。
 *
 * 找不到文件时退化为内置的 3 条核心禁用词，并**明确告警**（不静默失效）。
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Config, Effect, Layer, Option } from "effect"
import { Glossary } from "../application/ports/glossary"

/** 与 docs/glossary.json 保持一致的兜底（文件缺失时至少这些仍然生效） */
const BUILTIN_FORBIDDEN = ["纤维", "图层", "效果系统"] as const

interface GlossaryFile {
  readonly forbidden?: ReadonlyArray<{ readonly term?: string }>
}

function candidatePaths(configured: string | undefined): ReadonlyArray<string> {
  const fromSource = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../../../docs/glossary.json"
  )
  const candidates = [
    configured,
    path.resolve(process.cwd(), "docs/glossary.json"),
    path.resolve(process.cwd(), "../../docs/glossary.json"),
    fromSource
  ]
  return candidates.filter((candidate): candidate is string => candidate !== undefined)
}

export const GlossaryLive = Layer.effect(
  Glossary,
  Effect.gen(function* () {
    const configured = yield* Config.option(Config.string("GLOSSARY_PATH"))

    for (const candidate of candidatePaths(Option.getOrUndefined(configured))) {
      const loaded = yield* Effect.tryPromise({
        try: async () => {
          const raw = await readFile(candidate, "utf8")
          return JSON.parse(raw) as GlossaryFile
        },
        catch: () => "unreadable" as const
      }).pipe(Effect.orElseSucceed(() => undefined))

      if (loaded !== undefined) {
        const forbidden = (loaded.forbidden ?? [])
          .map((rule) => rule.term)
          .filter((term): term is string => typeof term === "string" && term.length > 0)
        return {
          forbidden: forbidden.length > 0 ? forbidden : [...BUILTIN_FORBIDDEN],
          termCount: (loaded.forbidden ?? []).length,
          source: candidate
        }
      }
    }

    yield* Effect.logWarning(
      `未找到 docs/glossary.json → 仅使用内置术语黑名单：${BUILTIN_FORBIDDEN.join("、")}`
    )
    return { forbidden: [...BUILTIN_FORBIDDEN], termCount: BUILTIN_FORBIDDEN.length, source: "builtin" }
  })
)
