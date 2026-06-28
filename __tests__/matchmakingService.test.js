import { describe, it, expect, vi, beforeEach } from "vitest"

// matchmakingRedis connects to a real Redis instance as an import side effect,
// so it must be mocked before matchmakingService (which imports it) loads.
vi.mock("../config/matchmakingRedis.js", () => ({
  default: {
    hget: vi.fn(),
    hset: vi.fn(),
    hdel: vi.fn(),
    zadd: vi.fn(),
    zrem: vi.fn(),
    zcard: vi.fn(),
    zrangebyscore: vi.fn(),
  },
}))

import matchmakingRedis from "../config/matchmakingRedis.js"
import {
  joinMatchmakingQueue,
  leaveMatchmakingQueue,
  findNearbyPlayers,
  getRatingRange,
  getQueueCount,
  RATING_WINDOW,
} from "../services/matchmakingService.js"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("RATING_WINDOW / getRatingRange", () => {
  it("exposes a ±200 rating window, matching the resume's matchmaking spec", () => {
    expect(RATING_WINDOW).toBe(200)
  })

  it("computes a symmetric min/max range around the given rating", () => {
    expect(getRatingRange(1500)).toEqual({ min: 1300, max: 1700 })
  })

  it("respects a custom window when explicitly provided", () => {
    expect(getRatingRange(1500, 50)).toEqual({ min: 1450, max: 1550 })
  })
})

describe("joinMatchmakingQueue", () => {
  it("adds a new player to the sorted set and the userId index", async () => {
    matchmakingRedis.hget.mockResolvedValue(null) // no existing entry

    const result = await joinMatchmakingQueue({
      userId: "u1",
      username: "cench",
      rating: 1200,
      socketId: "s1",
      topic: "Array",
      difficulty: "Easy",
    })

    expect(result).toBe(true)
    expect(matchmakingRedis.zadd).toHaveBeenCalledTimes(1)
    const [setName, rating, payload] = matchmakingRedis.zadd.mock.calls[0]
    expect(setName).toBe("matchmakingQueue")
    expect(rating).toBe(1200)
    expect(JSON.parse(payload)).toMatchObject({ userId: "u1", username: "cench", rating: 1200 })

    expect(matchmakingRedis.hset).toHaveBeenCalledWith(
      "matchqueue:index",
      "u1",
      expect.any(String)
    )
    // No prior entry, so no removal should happen
    expect(matchmakingRedis.zrem).not.toHaveBeenCalled()
  })

  it("defaults topic to 'Array' and difficulty to 'Easy' when omitted", async () => {
    matchmakingRedis.hget.mockResolvedValue(null)

    await joinMatchmakingQueue({ userId: "u2", username: "noob", rating: 900, socketId: "s2" })

    const [, , payload] = matchmakingRedis.zadd.mock.calls[0]
    const parsed = JSON.parse(payload)
    expect(parsed.topic).toBe("Array")
    expect(parsed.difficulty).toBe("Easy")
  })

  it("removes the player's previous queue entry before re-adding (dedup on rejoin)", async () => {
    const staleEntry = JSON.stringify({ userId: "u1", username: "cench", rating: 1000 })
    matchmakingRedis.hget.mockResolvedValue(staleEntry)

    await joinMatchmakingQueue({
      userId: "u1",
      username: "cench",
      rating: 1300,
      socketId: "s3",
    })

    expect(matchmakingRedis.zrem).toHaveBeenCalledWith("matchmakingQueue", staleEntry)
    expect(matchmakingRedis.zadd).toHaveBeenCalledWith(
      "matchmakingQueue",
      1300,
      expect.any(String)
    )
  })
})

describe("leaveMatchmakingQueue", () => {
  it("removes the player from both the sorted set and the index when present", async () => {
    const entry = JSON.stringify({ userId: "u1", rating: 1200 })
    matchmakingRedis.hget.mockResolvedValue(entry)

    const result = await leaveMatchmakingQueue("u1")

    expect(result).toBe(true)
    expect(matchmakingRedis.zrem).toHaveBeenCalledWith("matchmakingQueue", entry)
    expect(matchmakingRedis.hdel).toHaveBeenCalledWith("matchqueue:index", "u1")
  })

  it("is a no-op against the sorted set/index when the player isn't queued", async () => {
    matchmakingRedis.hget.mockResolvedValue(null)

    const result = await leaveMatchmakingQueue("ghost")

    expect(result).toBe(true)
    expect(matchmakingRedis.zrem).not.toHaveBeenCalled()
    expect(matchmakingRedis.hdel).not.toHaveBeenCalled()
  })
})

describe("findNearbyPlayers", () => {
  it("queries Redis using the ±200 rating window and parses results", async () => {
    const players = [
      JSON.stringify({ userId: "a", rating: 1100 }),
      JSON.stringify({ userId: "b", rating: 1250 }),
    ]
    matchmakingRedis.zrangebyscore.mockResolvedValue(players)

    const result = await findNearbyPlayers(1200)

    expect(matchmakingRedis.zrangebyscore).toHaveBeenCalledWith("matchmakingQueue", 1000, 1400)
    expect(result).toEqual([
      { userId: "a", rating: 1100 },
      { userId: "b", rating: 1250 },
    ])
  })

  it("falls back to a minimal object if a queue entry isn't valid JSON", async () => {
    matchmakingRedis.zrangebyscore.mockResolvedValue(["not-json"])

    const result = await findNearbyPlayers(1000)

    expect(result).toEqual([{ userId: "not-json" }])
  })

  it("returns an empty array when no one is in range", async () => {
    matchmakingRedis.zrangebyscore.mockResolvedValue([])

    const result = await findNearbyPlayers(1000)

    expect(result).toEqual([])
  })
})

describe("getQueueCount", () => {
  it("returns the sorted set cardinality", async () => {
    matchmakingRedis.zcard.mockResolvedValue(7)

    const result = await getQueueCount()

    expect(result).toBe(7)
    expect(matchmakingRedis.zcard).toHaveBeenCalledWith("matchmakingQueue")
  })
})
