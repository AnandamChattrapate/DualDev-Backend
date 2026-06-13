import matchmakingRedis from "../config/matchmakingRedis.js"
import UserModel from "../models/UserModel.js"

/* ────────────────────────────────────────────────────────────
   User Cache
   ──────────────────────────────────────────────────────────────
   Redis-backed cache for the user profile fields we need on every
   authed request. Pattern: read-through with write-side invalidation.

   On read:
     1) Look up `user:{userId}:profile` in Redis.
     2) If hit → JSON.parse + return.
     3) If miss → fetch from Mongo, store in Redis with TTL, return.

   On write (rating change, wins/losses update, etc.):
     Call invalidateUserCache(userId) AFTER user.save() so the next
     read pulls fresh data from Mongo and re-warms the cache.

   Cache failures are non-fatal — if Redis is down, we fall through
   to Mongo and return the data anyway. The user-facing request
   never fails just because the cache is unhappy.
   ──────────────────────────────────────────────────────────── */

const TTL_SECONDS = 60                              // refresh window: 60s
const cacheKey    = (userId) => `user:${userId}:profile`

/* The fields we cache — superset of what authMiddleware + /me need so
   both can be served from a single cache entry.                       */
const SELECT_FIELDS =
  "_id username email rating wins losses avatar solvedProblems totalMatches accuracy"

export const getUserCached = async (userId) => {
  if (!userId) return null
  const key = cacheKey(userId)

  /* ── 1) Try Redis ──────────────────────────────────────── */
  try {
    const cached = await matchmakingRedis.get(key)
    if (cached) {
      return JSON.parse(cached)
    }
  } catch (err) {
    /* Redis is down or returned garbage — fall through to Mongo.
       Don't bubble the error; the request must still succeed.   */
    console.log("userCache GET error:", err.message)
  }

  /* ── 2) Miss → fetch from Mongo ────────────────────────── */
  const user = await UserModel.findById(userId).select(SELECT_FIELDS).lean()
  if (!user) return null

  /* ── 3) Warm the cache for next time (best-effort) ─────── */
  try {
    await matchmakingRedis.set(key, JSON.stringify(user), "EX", TTL_SECONDS)
  } catch (err) {
    console.log("userCache SET error:", err.message)
  }

  return user
}

export const invalidateUserCache = async (userId) => {
  if (!userId) return
  try {
    await matchmakingRedis.del(cacheKey(userId))
  } catch (err) {
    console.log("userCache DEL error:", err.message)
  }
}
