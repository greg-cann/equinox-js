import { describe, test, expect, beforeAll } from "vitest"
import { StreamName } from "@equinox-js/core"
import { MessageDbConnection } from "@equinox-js/message-db"
import { randomUUID } from "crypto"
import { Pool } from "pg"
import { MessageDbCategoryReader } from "../src/lib/MessageDbClient.js"

describe("MessageDbCategoryReader", () => {
  const connectionString =
    process.env.MDB_CONN_STR ?? "postgres://message_store:@localhost:5432/message_store"
  const pool = new Pool({ connectionString })
  const conn = MessageDbConnection.create(pool)
  const category = randomUUID().replace(/-/g, "")
  const streamId = randomUUID().replace(/-/g, "")
  const streamName = StreamName.create(category, streamId)
  beforeAll(async () => {
    await conn.write.writeMessages(streamName, Array(100).fill({ type: "TestEvent" }), -1n)
    await conn.write.writeSingleMessage(streamName, { type: "ExclusiveEvent" }, null)
  })
  test("Can read a category", async () => {
    const reader = new MessageDbCategoryReader(pool)
    const batch = await reader.readCategoryMessages({
      category,
      fromPositionInclusive: 0n,
      batchSize: 10,
    })
    expect(batch.messages).toHaveLength(10)
    expect(batch.isTail).toBe(false)
    expect(batch.checkpoint).toBeGreaterThan(0n)
  })
  test("Can not read a category with a condition if sql_condition is off", async () => {
    const reader = new MessageDbCategoryReader(pool)
    const batch = reader.readCategoryMessages({
      category,
      fromPositionInclusive: 0n,
      batchSize: 10,
      condition: "messages.type = 'ExclusiveEvent'",
    })

    await expect(batch).rejects.toThrow("SQL condition is not activated")
  })

  test("Can read a category with a condition", async () => {
    await pool.query("SELECT set_config('message_store.sql_condition', 'on', true)", [])
    const reader = new MessageDbCategoryReader(pool)
    const batch = await reader.readCategoryMessages({
      category,
      fromPositionInclusive: 0n,
      batchSize: 10,
      condition: "messages.type = 'ExclusiveEvent'",
    })
    expect(batch.messages).toHaveLength(1)
    expect(batch.isTail).toBe(true)
    expect(batch.checkpoint).toBeGreaterThan(0n)
  })

  describe("Consumer groups", () => {
    const category = randomUUID().replace(/-/g, "")
    beforeAll(async () => {
      for (let i = 0; i < 100; i++) {
        const streamId = randomUUID().replace(/-/g, "")
        const streamName = StreamName.create(category, streamId)
        await conn.write.writeSingleMessage(streamName, { type: "TestEvent" }, -1n)
      }
    })

    test("Can segment fetching into consumer groups, each getting a different set of messages", async () => {
      const reader = new MessageDbCategoryReader(pool)
      const consumers = Array.from({ length: 3 }).map((_, i) => ({
        consumerGroupMember: i,
        consumerGroupSize: 3,
      }))
      const messages: Set<string>[] = []
      for (const group of consumers) {
        const batch = await reader.readCategoryMessages({
          category,
          fromPositionInclusive: 0n,
          batchSize: 100,
          consumerGroupMember: group.consumerGroupMember,
          consumerGroupSize: group.consumerGroupSize,
        })
        expect(batch.isTail).toBe(true)
        expect(batch.messages.length).toBeGreaterThan(0)
        expect(batch.checkpoint).toBeGreaterThan(0n)
        messages[group.consumerGroupMember] = new Set(batch.messages.map((m) => m[1].id))
      }

      expect(setIntersection(messages[0], messages[1])).toHaveLength(0)
      expect(setIntersection(messages[0], messages[2])).toHaveLength(0)
      expect(setIntersection(messages[1], messages[2])).toHaveLength(0)
    })

    function setIntersection<T>(a: Set<T>, b: Set<T>) {
      return new Set([...a].filter((x) => b.has(x)))
    }
  })
})
