import { describe, test, expect } from "vitest"
import { Codec } from "../src"
import { z } from "zod"
import { randomUUID } from "crypto"

describe("Codec", () => {
  describe("json", () => {
    test("roundtrips", () => {
      const codec = Codec.json<any>()
      const event = { type: "Hello", data: { world: "hello" } }
      expect(codec.encode(event, undefined)).toEqual({
        type: "Hello",
        data: '{"world":"hello"}',
        meta: undefined,
        id: undefined,
      })
      expect(
        codec.tryDecode({
          type: "Hello",
          data: '{"world":"hello"}',
          meta: undefined,
          id: "123",
        } as any),
      ).toEqual(event)
    })

    test("Keeps metadata and id if they exist", () => {
      const codec = Codec.json<any>()
      const event = { id: "123", type: "Hello", data: { world: "hello" }, meta: { hello: "hi" } }
      expect(codec.encode(event, undefined)).toEqual({
        type: "Hello",
        data: '{"world":"hello"}',
        meta: '{"hello":"hi"}',
        id: "123",
      })
    })
  })

  describe("upcast", () => {
    describe("with zod", () => {
      const HelloSchema = z.object({
        hello: z
          .string()
          .datetime()
          .transform((x) => new Date(x)),
      })
      const codec = Codec.upcast(Codec.json(), Codec.Upcast.body({ Hello: HelloSchema.parse }))

      test("roundtrips", () => {
        const event = { type: "Hello", data: { hello: new Date() } }
        const encoded = codec.encode(event, undefined)
        const decoded = codec.tryDecode(encoded as any)
        expect(decoded).toEqual(event)
      })

      test("fails if upcast fails", () => {
        const event = { type: "Hello", data: { hello: "hello" } }
        const encoded = codec.encode(event, undefined)
        expect(() => codec.tryDecode(encoded as any)).toThrow()
      })

      test("does not roundtrip complex types", () => {
        const HelloSchema = z.object({ hello: z.date() })
        const codec = Codec.upcast(Codec.json(), Codec.Upcast.body({ Hello: HelloSchema.parse }))
        const event = { type: "Hello", data: { hello: new Date() } }
        const encoded = codec.encode(event, undefined)
        // string is not a date
        expect(() => codec.tryDecode(encoded as any)).toThrow()
      })
    })

    describe("with custom parser", () => {
      const date = (x: unknown): Date => {
        if (x instanceof Date) return x
        if (typeof x === "string") {
          const date = new Date(x)
          if (isNaN(date.getTime())) throw new Error("unable to decode date")
          return date
        }
        throw new Error("unable to decode date")
      }

      const schema =
        <T extends Record<string, any>>(mapping: { [P in keyof T]: (x: unknown) => T[P] }) =>
        (e: Record<string, any>): T => {
          return Object.fromEntries(
            Object.entries(mapping).map(([k, decode]) => {
              return [k, decode(e[k])]
            }),
          ) as T
        }

      const HelloSchema = schema({ at: date })

      const codec = Codec.upcast(Codec.json(), Codec.Upcast.body({ Hello: HelloSchema }))
      test("roundtrips", () => {
        const event = { type: "Hello", data: { at: new Date() } }
        const encoded = codec.encode(event, undefined)
        const decoded = codec.tryDecode(encoded as any)
        expect(decoded).toEqual(event)
      })

      test('fails if upcast fails', () => {
        const event = { type: "Hello", data: { at: "hello" } }
        const encoded = codec.encode(event, undefined)
        expect(() => codec.tryDecode(encoded as any)).toThrow()
      })
    })
  })
})
