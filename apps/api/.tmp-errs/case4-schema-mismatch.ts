import { Schema } from "effect"
const Person = Schema.Struct({ name: Schema.String, age: Schema.Number })
export const getName = (input: unknown): string => Schema.decodeUnknownSync(Person)(input)
