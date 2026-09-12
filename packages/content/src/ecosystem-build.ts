/**
 * 把「机器的观测」与「人的点评」合并成站点数据文件。
 *
 * 分工是刻意的：
 *   · 机器给事实 —— star / 依赖清单 / 渗透度 / 能力证据 / 真实文件路径；
 *   · 人给解释 —— 一句话定位 / 分类 / 难度 / 该读哪一块 / 同源谱系。
 *
 * 合并时会**强制核对**：点评里写的每个 `reading.path` 必须出现在观测到的
 * 「真的 import 了 effect 的文件」列表里（或它的子目录下）。指向不存在的文件即失败 ——
 * 这条规则的作用是让点评无法凭印象编造，和译文门禁要求「代码块与上游逐字节一致」同源。
 */
import {
  CAPABILITIES,
  CATEGORY_LABELS,
  type Category,
  type EcosystemEntry,
  type EcosystemFile,
  type Level,
  type ReadingHint,
  MAINLINE_STARS,
  validateEcosystem
} from "./ecosystem.js"
import type { ObservationFile, RepoObservation } from "./ecosystem-collect.js"

export interface Annotation {
  readonly summary: string
  readonly category: Category
  readonly level: Level
  readonly reading: readonly ReadingHint[]
  /** 与榜内其它条目同源时标注，例如 opencode 的衍生版 */
  readonly lineage?: string
  /** 人工确认的首页（观测到的 homepage 为空时用） */
  readonly homepage?: string
}

export interface AnnotationsFile {
  readonly note?: string
  readonly entries: Readonly<Record<string, Annotation>>
}

export interface MergeResult {
  readonly file: EcosystemFile
  readonly problems: string[]
  readonly unannotated: readonly string[]
  readonly unmatchedAnnotations: readonly string[]
}

/** 路径是否落在观测集合内：精确命中，或是指向某个命中文件的目录。 */
export function pathIsEvidenced(candidate: string, effectFilePaths: readonly string[]): boolean {
  const needle = candidate.replace(/\/+$/, "")
  if (needle.length === 0) return false
  return effectFilePaths.some((p) => p === needle || p.startsWith(`${needle}/`))
}

export function mergeEcosystem(
  observations: ObservationFile,
  annotations: AnnotationsFile,
  options: { readonly checkedAt: string; readonly mainlineStars?: number }
): MergeResult {
  const mainlineStars = options.mainlineStars ?? MAINLINE_STARS
  const problems: string[] = []
  const entries: EcosystemEntry[] = []
  const unannotated: string[] = []

  for (const obs of observations.observations) {
    const note = annotations.entries[obs.repo]
    if (note === undefined) {
      unannotated.push(obs.repo)
      continue
    }
    entries.push(toEntry(obs, note, options.checkedAt, problems))
  }

  const observedRepos = new Set(observations.observations.map((o) => o.repo))
  const unmatchedAnnotations = Object.keys(annotations.entries).filter((repo) => !observedRepos.has(repo))

  const file: EcosystemFile = {
    generatedAt: new Date().toISOString(),
    method:
      "GitHub 依赖验证 + tarball 全仓扫描（只统计真的 import 了 effect 的文件）。" +
      "收录判据：package.json 的 dependencies/peerDependencies 里必须有 effect 或 @effect/*，且不能只出现在 bench/examples/docs 等边角路径。",
    mainlineStars,
    labels: {
      capabilities: Object.fromEntries(CAPABILITIES.map((c) => [c.id, c.label])),
      categories: CATEGORY_LABELS
    },
    entries: entries.sort((a, b) => b.stars - a.stars)
  }

  return { file, problems: [...problems, ...validateEcosystem(file)], unannotated, unmatchedAnnotations }
}

function toEntry(obs: RepoObservation, note: Annotation, checkedAt: string, problems: string[]): EcosystemEntry {
  for (const hint of note.reading) {
    if (!pathIsEvidenced(hint.path, obs.effectFilePaths))
      problems.push(`${obs.repo}: 「该读这里」指向的文件在观测里不存在或没有 import effect → ${hint.path}`)
  }
  return {
    repo: obs.repo,
    stars: obs.stars,
    checkedAt,
    category: note.category,
    level: note.level,
    homepage: note.homepage ?? obs.homepage ?? undefined,
    summary: note.summary,
    centrality: {
      ratio: obs.centrality.ratio,
      verdict: obs.centrality.verdict,
      runtimePackages: obs.centrality.runtimePackages,
      totalPackages: obs.centrality.totalPackages
    },
    deps: obs.deps,
    capabilities: obs.capabilities.present,
    evidence: { scannedFiles: obs.scannedFiles, effectFiles: obs.effectFiles },
    reading: note.reading,
    via: obs.via,
    lineage: note.lineage
  }
}

/** 采集报告：给作者看「哪些还没点评 / 哪些点评已经没有对应观测」。 */
export function formatCollectReport(result: MergeResult, observations: ObservationFile): string {
  const lines: string[] = []
  const mainline = result.file.entries.filter((e) => e.stars >= result.file.mainlineStars)
  const selected = result.file.entries.filter((e) => e.stars < result.file.mainlineStars)
  lines.push(`采集时间：${observations.collectedAt}`)
  lines.push(`渠道：${observations.channels.join(" · ")}`)
  lines.push(`候选 ${observations.candidateCount} → 通过依赖验证 ${observations.observations.length} → 已点评入榜 ${result.file.entries.length}`)
  lines.push(`  主线（≥${result.file.mainlineStars}★）${mainline.length} 条 · 精选（<${result.file.mainlineStars}★）${selected.length} 条`)
  if (result.unannotated.length > 0) {
    lines.push("")
    lines.push(`待点评（${result.unannotated.length}）：`)
    for (const repo of result.unannotated) {
      const obs = observations.observations.find((o) => o.repo === repo)
      const caps = obs?.capabilities.present.join(",") ?? ""
      lines.push(`  · ${repo}  ${obs?.stars ?? "?"}★  渗透度 ${obs?.centrality.ratio ?? "?"}  [${caps}]`)
    }
  }
  if (result.unmatchedAnnotations.length > 0) {
    lines.push("")
    lines.push(`点评了但没有观测（仓库可能已淘汰或改名，请复核）：${result.unmatchedAnnotations.join(", ")}`)
  }
  if (result.problems.length > 0) {
    lines.push("")
    lines.push(`✘ 门禁问题 ${result.problems.length} 条：`)
    for (const p of result.problems) lines.push(`  · ${p}`)
  } else {
    lines.push("")
    lines.push("✔ 榜单诚实性门禁通过")
  }
  return lines.join("\n")
}

/** 给作者写点评用的素材：每个待点评仓库的能力证据与最密的入口文件。 */
export function formatEvidenceSheet(observations: ObservationFile): string {
  const lines: string[] = []
  for (const o of observations.observations) {
    lines.push(`${o.repo}  ${o.stars}★  ${o.license ?? "?"}  pushed ${o.pushedAt.slice(0, 10)}`)
    lines.push(`  渗透度 ${o.centrality.ratio}（${o.centrality.verdict}）· 运行时包 ${o.centrality.runtimePackages.length}/${o.centrality.totalPackages}`)
    lines.push(`  依赖：${o.deps.join(" ")}`)
    lines.push(`  扫描 ${o.scannedFiles} 个 .ts，其中 ${o.effectFiles} 个 import 了 effect`)
    const caps = o.capabilities.present.map((c) => `${c}(${o.capabilities.counts[c]})`).join(" ")
    lines.push(`  能力：${caps}`)
    lines.push("  最密的入口文件：")
    for (const f of o.capabilities.topFiles.slice(0, 6)) lines.push(`    ${f.path}  hits=${f.hits}  [${f.capabilities.join(",")}]`)
    lines.push("")
  }
  return lines.join("\n")
}
