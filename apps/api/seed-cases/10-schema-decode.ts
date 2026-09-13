// Schema 解码结果类型不符
import { Schema } from "effect"
const Person = Schema.Struct({ name: Schema.String, age: Schema.Number })
export const getName = (input: unknown): string => Schema.decodeUnknownSync(Person)(input)
