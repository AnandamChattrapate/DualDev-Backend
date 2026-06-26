import matchmakingRedis from './config/matchmakingRedis.js'

const redis = matchmakingRedis

const keys = await redis.keys('match:*')
const pending = await redis.keys('pending:*')
const userMatch = await redis.keys('user:*:match')
const rooms = await redis.keys('room:*')
const queue = 'matchmaking_queue'
const index = 'matchqueue:index'

const all = [...keys, ...pending, ...userMatch, ...rooms, queue, index]
if (all.length) {
  await redis.del(...all)
  console.log(`Deleted ${all.length} keys:`, all)
} else {
  console.log('Nothing to clear')
}

process.exit(0)
