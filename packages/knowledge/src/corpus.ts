/**
 * 语料加载与索引装配。
 *
 * corpus.json 由内容管线生成（`ecn-content corpus`），随仓库提交：
 * - 运行时（apps/api）直接 import，零冷启动、零外部依赖；
 * - CI 会在构建站点后重新生成并比对，防止语料与内容漂移。
 */
import corpusJson from "../data/corpus.json"
import { createIndex, type KnowledgeIndex } from "./bm25.js"
import type { Corpus } from "./types.js"

export const corpus = corpusJson as unknown as Corpus

export function loadCorpus(): Corpus {
  return corpus
}

export function createCorpusIndex(source: Corpus = corpus): KnowledgeIndex {
  return createIndex(source.pages)
}
