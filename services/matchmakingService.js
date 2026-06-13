import matchmakingRedis from "../config/matchmakingRedis.js"

// Secondary index: userId → serialized member string, so we can find/remove a player in O(1)
const INDEX_KEY = "matchqueue:index"

// Add a player to the queue. Replaces any existing entry for the same userId.
export const joinMatchmakingQueue = async ({ userId, username, rating, socketId, topic, difficulty }) => {
  // O(1) dedup via the index key instead of scanning the whole sorted set
  const existing = await matchmakingRedis.hget(INDEX_KEY, userId)
  if (existing) await matchmakingRedis.zrem("matchmakingQueue", existing)

  const playerData = JSON.stringify({
    userId,
    username,
    rating,
    socketId,
    topic:      topic      || "Array",
    difficulty: difficulty || "Easy",
  })

  await matchmakingRedis.zadd("matchmakingQueue", rating, playerData)
  await matchmakingRedis.hset(INDEX_KEY, userId, playerData)
  return true
}

// Returns all players whose rating is within ±100 of the given value
export const findNearbyPlayers = async (rating) => {
  const players = await matchmakingRedis.zrangebyscore("matchmakingQueue", rating - 100, rating + 100)
  return players.map((p) => {
    try { return JSON.parse(p) }
    catch { return { userId: p } }
  })
}

// Remove a player from the queue using the index for O(1) lookup
export const leaveMatchmakingQueue = async (userId) => {
  const member = await matchmakingRedis.hget(INDEX_KEY, userId)
  if (member) {
    await matchmakingRedis.zrem("matchmakingQueue", member)
    await matchmakingRedis.hdel(INDEX_KEY, userId)
  }
  return true
}

export const getQueueCount = async () => {
  return await matchmakingRedis.zcard("matchmakingQueue")
}
