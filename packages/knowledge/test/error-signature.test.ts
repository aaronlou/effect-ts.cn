import { describe, expect, it } from "vitest"
import { describeSignature, errorSignature, normalizeErrorText } from "../src/error-signature.js"

describe("报错归一化：抹掉「同一报错在不同机器上必然不同」的部分", () => {
  it("绝对路径、行列号、堆栈帧都被抹掉", () => {
    const normalized = normalizeErrorText(
      "src/a.ts(12,5): error TS2345: bad\n  at /Users/alice/proj/node_modules/effect/src/Effect.ts:1234:10"
    )
    expect(normalized).not.toContain("/Users/alice")
    expect(normalized).not.toContain("1234:10")
    expect(normalized).toContain("TS2345")
  })

  it("Windows 路径同样处理", () => {
    expect(normalizeErrorText("at C:\\Users\\bob\\proj\\node_modules\\effect\\Effect.ts:5:1")).not.toContain("bob")
  })
})

describe("报错签名：它是整个报错百科的键，必须稳定且可区分", () => {
  const base = `src/app.ts(12,5): error TS2345: Argument of type 'Effect<number, never, never>' is not assignable to parameter of type 'Effect<string, Error, never>'`
  const sameOnAnotherMachine = `src/other.ts(99,1): error TS2345: Type 'Effect<boolean, never, never>' is not assignable to type 'Effect<string, Error, never>'.
  at C:\\Users\\bob\\node_modules\\effect\\Effect.ts:5:1`

  it("同一报错、不同机器/不同措辞 ⇒ **同一个 id**（否则同一个问题会裂成多条）", () => {
    expect(errorSignature(base).id).toBe(errorSignature(sameOnAnotherMachine).id)
  })

  it("不同错误码 ⇒ 不同 id", () => {
    expect(errorSignature(base).id).not.toBe(
      errorSignature(`src/a.ts(1,1): error TS2375: Type 'Layer.Layer<never, never, Config>' is not assignable`).id
    )
  })

  it("同错误码、不同类型 ⇒ 不同 id（否则两类问题会被错误合并）", () => {
    const layer = errorSignature(`error TS2375: Layer<never, never, Config> not assignable`)
    const stream = errorSignature(`error TS2375: Stream<never, never, Config> not assignable`)
    expect(layer.id).not.toBe(stream.id)
  })

  it("抽出错误码与类型名，且**不把 TypeScript 诊断里的英文高频词当类型**", () => {
    const sig = errorSignature(base)
    expect(sig.codes).toEqual(["TS2345"])
    expect(sig.symbols).toContain("Effect")
    // 这些词会随报错措辞变化，计进签名就会把同一个问题裂开
    for (const noise of ["Argument", "Type", "Expected", "Value", "Property"]) {
      expect(sig.symbols).not.toContain(noise)
    }
    // 错误码本身也不是符号
    expect(sig.symbols).not.toContain("TS2345")
  })

  it("限定名（Effect.gen）优先于裸类型名", () => {
    const sig = errorSignature(
      `error TS2345: Effect.gen(function* () {}) 处的类型不匹配，涉及 Effect.gen 与 Layer、Layer.Layer`
    )
    expect(sig.symbols).toContain("Effect.gen")
  })

  it("没有特征的输入**不沉淀**（否则百科会变成噪声垃圾场）", () => {
    for (const text of ["我这报错了帮我看看", "Cannot read properties of undefined", ""]) {
      expect(errorSignature(text).confident, `「${text}」不该被判为可沉淀`).toBe(false)
    }
  })

  it("有错误码就算有特征（哪怕没有类型名）", () => {
    expect(errorSignature("error TS2554: Expected 2 arguments, but got 1").confident).toBe(true)
  })

  it("符号排序稳定：同样的输入多次调用结果一致（签名不能抖）", () => {
    const once = errorSignature(base)
    const twice = errorSignature(base)
    expect(once.symbols).toEqual(twice.symbols)
    expect(once.id).toBe(twice.id)
  })

  it("标题可读：错误码 + 前几个类型名", () => {
    expect(describeSignature(errorSignature(`error TS2375: Layer.Layer<never, never, Config>`))).toContain("TS2375")
    expect(describeSignature(errorSignature("随便一段没有特征的文字"))).toBe("未识别的报错")
  })
})
