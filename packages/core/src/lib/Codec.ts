import { StreamEvent, TimelineEvent } from "./Types"
import * as zlib from "node:zlib"
import { promisify } from "node:util"

const deflate = promisify(zlib.deflateRaw)
const inflate = promisify(zlib.inflateRaw)

export type Codec<E, C> = {
  tryDecode(event: TimelineEvent<Record<string, any>>): E | undefined

  encode(event: E, ctx: C): StreamEvent<Record<string, any>>
}

export const PassThroughCodec = <E extends { type: string; data?: Record<string, any> }, C>(
  ctxToMeta: (ctx: C) => Record<string, any> | undefined = (x) => undefined
): Codec<E, C> => ({
  tryDecode(event: TimelineEvent<Record<string, any>>): E | undefined {
    return event as any as E
  },
  encode(event: E, ctx: C): StreamEvent<Record<string, any>> {
    return { type: event.type, data: event.data, meta: ctxToMeta(ctx) }
  },
})

export abstract class AsyncCodec<E, F, C = undefined> {
  abstract tryDecode(event: TimelineEvent<F>): Promise<E | undefined> | E | undefined

  abstract encode(event: E, ctx: C): Promise<StreamEvent<F>> | StreamEvent<F>

  static map<E, From, C, To>(
    codec: AsyncCodec<E, From, C>,
    encode: (v: From) => To | Promise<To>,
    decode: (v: To) => From | Promise<From>
  ): AsyncCodec<E, To, C> {
    return {
      tryDecode: async (event: TimelineEvent<To>): Promise<E | undefined> => {
        const [data, meta] = await Promise.all([event.data ? decode(event.data) : undefined, event.meta ? decode(event.meta) : undefined])
        return codec.tryDecode({ ...event, data, meta })
      },
      encode: async (e, ctx) => {
        const result = await codec.encode(e, ctx)
        const data = result.data ? encode(result.data) : undefined
        const meta = result.meta ? encode(result.meta) : undefined
        return { ...result, data: await data, meta: await meta }
      },
    }
  }

  static deflate<E, C>(codec: AsyncCodec<E, Record<string, any>, C>): AsyncCodec<E, [number | undefined, Uint8Array | undefined], C> {
    return AsyncCodec.map(
      codec,
      async (x) => {
        if (x == null) return [undefined, undefined]
        const raw = Buffer.from(JSON.stringify(x))
        const deflated = await deflate(raw)
        if (deflated.length < raw.length) return [1, deflated]
        return [0, raw]
      },
      async ([encoding, b]) => {
        if (b == null || b.length === 0) return null
        const buf = Buffer.from(b)
        if (encoding === 0) return JSON.parse(buf.toString())
        const inflated = await inflate(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
        return JSON.parse(inflated.toString())
      }
    )
  }

  static unsafeEmpty<E extends { type: string; data?: Record<string, any> }>() {
    return AsyncCodec.deflate({
      tryDecode: (e) => e as any as E,
      encode: (e) => e as any as StreamEvent<Record<string, any>>,
    })
  }
}
