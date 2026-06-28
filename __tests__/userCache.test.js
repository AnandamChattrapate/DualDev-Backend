import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../config/matchmakingRedis.js", () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}))

vi.mock("../models/UserModel.js", () => ({
  default: {
    findById: vi.fn(),
  },
}))

import matchmakingRedis from "../config/matchmakingRedis.js"
import UserModel from "../models/UserModel.js"
import { getUserCached, invalidateUserCache, cacheKey } from "../services/userCache.js"

beforeEach(() => {
  vi.clearAllMocks()
})

// Helper to mimic Mongoose's findById(...).select(...).lean() chain
const mockMongoLookup = (returnValue) => {
  const lean = vi.fn().mockResolvedValue(returnValue)
  const select = vi.fn().mockReturnValue({ lean })
  UserModel.findById.mockReturnValue({ select })
  return { select, lean }
}

describe("cacheKey", () => {
  it("namespaces the Redis key by userId", () => {
    expect(cacheKey("u1")).toBe("user:u1:profile")
  })
})

describe("getUserCached", () => {
  it("returns null immediately when no userId is given, without touching Redis or Mongo", async () => {
    const result = await getUserCached(undefined)

    expect(result).toBeNull()
    expect(matchmakingRedis.get).not.toHaveBeenCalled()
    expect(UserModel.findById).not.toHaveBeenCalled()
  })

  it("returns the parsed value on a cache hit, without querying Mongo", async () => {
    const cachedUser = { _id: "u1", username: "cench", rating: 1200 }
    matchmakingRedis.get.mockResolvedValue(JSON.stringify(cachedUser))

    const result = await getUserCached("u1")

    expect(result).toEqual(cachedUser)
    expect(matchmakingRedis.get).toHaveBeenCalledWith("user:u1:profile")
    expect(UserModel.findById).not.toHaveBeenCalled()
  })

  it("falls through to Mongo on a cache miss and warms the cache with a 60s TTL", async () => {
    matchmakingRedis.get.mockResolvedValue(null)
    const dbUser = { _id: "u1", username: "cench", rating: 1200 }
    mockMongoLookup(dbUser)

    const result = await getUserCached("u1")

    expect(result).toEqual(dbUser)
    expect(UserModel.findById).toHaveBeenCalledWith("u1")
    expect(matchmakingRedis.set).toHaveBeenCalledWith(
      "user:u1:profile",
      JSON.stringify(dbUser),
      "EX",
      60
    )
  })

  it("returns null when the user genuinely doesn't exist in Mongo, and doesn't warm the cache", async () => {
    matchmakingRedis.get.mockResolvedValue(null)
    mockMongoLookup(null)

    const result = await getUserCached("ghost")

    expect(result).toBeNull()
    expect(matchmakingRedis.set).not.toHaveBeenCalled()
  })

  it("falls through to Mongo when Redis GET throws, without bubbling the error", async () => {
    matchmakingRedis.get.mockRejectedValue(new Error("ECONNREFUSED"))
    const dbUser = { _id: "u1", username: "cench", rating: 1200 }
    mockMongoLookup(dbUser)

    const result = await getUserCached("u1")

    expect(result).toEqual(dbUser)
  })

  it("still returns Mongo data even if warming the cache (Redis SET) fails", async () => {
    matchmakingRedis.get.mockResolvedValue(null)
    matchmakingRedis.set.mockRejectedValue(new Error("ECONNREFUSED"))
    const dbUser = { _id: "u1", username: "cench", rating: 1200 }
    mockMongoLookup(dbUser)

    const result = await getUserCached("u1")

    expect(result).toEqual(dbUser)
  })
})

describe("invalidateUserCache", () => {
  it("deletes the user's cache entry", async () => {
    await invalidateUserCache("u1")

    expect(matchmakingRedis.del).toHaveBeenCalledWith("user:u1:profile")
  })

  it("is a no-op when no userId is given", async () => {
    await invalidateUserCache(undefined)

    expect(matchmakingRedis.del).not.toHaveBeenCalled()
  })

  it("swallows errors from Redis DEL instead of throwing", async () => {
    matchmakingRedis.del.mockRejectedValue(new Error("ECONNREFUSED"))

    await expect(invalidateUserCache("u1")).resolves.toBeUndefined()
  })
})
