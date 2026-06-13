import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { connect } from 'mongoose'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { config } from 'dotenv'
import Redis from 'ioredis'
import jwt from 'jsonwebtoken'
import { AIRouter } from './routes/AIRouter.js'
import statsRoutes from './routes/statsRoutes.js'
import { initializeStats } from './controllers/statsController.js'
import { UserRouter } from './routes/UserRouter.js'
import { MatchStateRouter } from "./routes/MatchStateRouter.js"
import { ProblemRouter } from './routes/ProblemRouter.js'
import { SubmissionRouter } from './routes/SubmissionRouter.js'
import { MatchmakingRouter } from "./routes/MatchmakingRouter.js"
import { OnlineUsersRouter } from "./routes/OnlineUsersRouter.js"
import { LeaderboardRouter } from "./routes/LeaderboardRouter.js"
import matchmakingRedis from './config/matchmakingRedis.js'
import { registerSocketHandlers } from './socket/registerSocketHandlers.js'

config()

const app        = express()
const httpServer = createServer(app)
const PORT       = process.env.PORT || 5000

// Shared Redis instance used across the app (matchmaking, match state, sockets)
export const redis = matchmakingRedis

// Online presence: userId → last heartbeat timestamp (sorted set)
const HEARTBEAT_KEY     = 'online_heartbeats'
const HEARTBEAT_TIMEOUT = 10_000 // 10 seconds — users inactive longer than this are considered offline

// Drop heartbeats older than HEARTBEAT_TIMEOUT every 15 seconds
setInterval(async () => {
  try {
    await redis.zremrangebyscore(HEARTBEAT_KEY, '-inf', Date.now() - HEARTBEAT_TIMEOUT)
  } catch (err) {
    console.error('Heartbeat cleanup error:', err.message)
  }
}, 15_000)

// Remove match IDs from the active set once their TTL passes
setInterval(async () => {
  try {
    await redis.zremrangebyscore('active_matches', '-inf', Date.now())
  } catch (err) {
    console.error('Match cleanup error:', err.message)
  }
}, 60_000)

// Separate Redis subscriber for match:created events (published by the matchmaking worker)
const subscriber = new Redis({
  host:     process.env.REDIS2_HOST,
  port:     Number(process.env.REDIS2_PORT),
  username: "default",
  password: process.env.REDIS2_PASSWORD,
})
subscriber.on("connect", () => console.log("Subscriber Redis Connected"))
subscriber.on("error",   (err) => console.error("Subscriber Redis Error:", err.message))

// Separate Redis subscriber for result:ready events (published by the judge worker)
const resultSubscriber = new Redis({
  host:                 process.env.REDIS_HOST,
  port:                 Number(process.env.REDIS_PORT),
  username:             "default",
  password:             process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
})
resultSubscriber.on("connect", () => console.log("Result Subscriber Connected"))
resultSubscriber.on("error",   (err) => console.error("Result Subscriber Error:", err.message))

export const io = new Server(httpServer, {
  cors: {
    origin:      process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  }
})

const connectDB = async () => {
  try {
    await connect(process.env.DB_URL)
    console.log("DB connected")
  } catch (err) {
    console.error("DB connection error:", err.message)
  }
}
connectDB()

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true }))
app.use(express.json())
app.use(cookieParser())

app.get('/', (req, res) => res.send("backend is running"))
app.use('/api/auth',         UserRouter)
app.use('/api/problems',     ProblemRouter)
app.use('/api/submit',       SubmissionRouter)
app.use("/api/match",        MatchStateRouter)
app.use("/api/matchmaking",  MatchmakingRouter)
app.use("/api/online-users", OnlineUsersRouter)
app.use("/api/leaderboard",  LeaderboardRouter)
app.use('/api/ai',           AIRouter)
app.use('/api/stats',        statsRoutes)

// Authenticate socket connections using the JWT from the cookie
io.use((socket, next) => {
  try {
    const raw = socket.handshake.headers.cookie || ""
    // Regex is safe against cookies whose values contain "token=" as a substring
    const token = raw.match(/(?:^|;\s*)token=([^;]+)/)?.[1]
    if (!token) return next(new Error("No token"))
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    socket.user = { userId: decoded.userId, email: decoded.email }
    next()
  } catch (err) {
    next(new Error("Socket auth failed"))
  }
})

io.on("connection", (socket) => {
  registerSocketHandlers(socket, io, redis)

  const userId = socket.user?.userId
  if (!userId) return

  // Mark user online and keep their heartbeat fresh
  redis.zadd(HEARTBEAT_KEY, Date.now(), userId)
  socket.on('heartbeat', () => redis.zadd(HEARTBEAT_KEY, Date.now(), userId))
  socket.on('disconnect', () => redis.zrem(HEARTBEAT_KEY, userId))
})

// Fired by the matchmaking worker when two players are paired
subscriber.subscribe('match:created', (err) => {
  if (err) console.error('Redis subscribe error:', err.message)
})

subscriber.on('message', async (channel, message) => {
  if (channel !== 'match:created') return
  try {
    const { matchId, playerA, playerB, problem, topic, difficulty, mode, reason } = JSON.parse(message)

    let selectedProblem = problem

    // Friend matches don't have a pre-selected problem — pick one now
    if (mode === "friend" && !selectedProblem) {
      const { selectProblem } = await import('./utils/selectProblem.js')
      selectedProblem = await selectProblem(topic, difficulty, playerA.userId, playerB.userId)
    }

    const socketIdA = await redis.get(`socket:${playerA.userId}`)
    const socketIdB = await redis.get(`socket:${playerB.userId}`)

    const isPlayerAOnline = socketIdA && io.sockets.sockets.get(socketIdA)
    const isPlayerBOnline = socketIdB && io.sockets.sockets.get(socketIdB)

    // Cancel immediately if either player went offline before we could notify them
    if (!isPlayerAOnline || !isPlayerBOnline) {
      console.log(`Match ${matchId} cancelled — player offline`)
      if (isPlayerAOnline) io.to(socketIdA).emit("match_cancelled", { reason: "Opponent disconnected before match started" })
      if (isPlayerBOnline) io.to(socketIdB).emit("match_cancelled", { reason: "Opponent disconnected before match started" })
      await redis.del(`match:${matchId}`)
      await redis.zrem('active_matches', matchId)
      await redis.del(`user:${playerA.userId}:match`)
      await redis.del(`user:${playerB.userId}:match`)
      return
    }

    await redis.hincrby('codejudge:stats', 'battlesPlayed', 1)

    // Store the pending match for 30s while waiting for both players to accept
    const pendingMatch = {
      matchId,
      playerA:    { ...playerA, socketId: socketIdA },
      playerB:    { ...playerB, socketId: socketIdB },
      problem:    selectedProblem,
      acceptedBy: [],
      createdAt:  Date.now(),
    }
    await redis.set(`pending:${matchId}`, JSON.stringify(pendingMatch), "EX", 30)

    io.to(socketIdA).emit("match_found", {
      matchId,
      opponent: { userId: playerB.userId, username: playerB.username, rating: playerB.rating },
      problem:  selectedProblem,
      timeout:  30,
      reason,
    })
    io.to(socketIdB).emit("match_found", {
      matchId,
      opponent: { userId: playerA.userId, username: playerA.username, rating: playerA.rating },
      problem:  selectedProblem,
      timeout:  30,
      reason,
    })

    // If both players haven't accepted within 30s, cancel the match
    setTimeout(async () => {
      const pending = await redis.get(`pending:${matchId}`)
      if (!pending) return
      const data = JSON.parse(pending)
      if (data.acceptedBy.length < 2) {
        await redis.del(`pending:${matchId}`)
        io.to(socketIdA).emit("match_cancelled", { reason: "Match acceptance timed out" })
        io.to(socketIdB).emit("match_cancelled", { reason: "Match acceptance timed out" })
        await redis.del(`match:${matchId}`)
        await redis.zrem('active_matches', matchId)
        await redis.del(`user:${playerA.userId}:match`)
        await redis.del(`user:${playerB.userId}:match`)
      }
    }, 30000)

  } catch (err) {
    console.error('Error handling match:created:', err.message)
  }
})

// Fired by the judge worker when a run or submission result is ready
resultSubscriber.subscribe("result:ready", (err) => {
  if (err) console.error("Result subscribe error:", err.message)
})

resultSubscriber.on("message", async (channel, message) => {
  if (channel !== "result:ready") return
  try {
    const { jobId, matchId, userId, verdict, testsPassed, totalTests, results, totalExecutionTime } = JSON.parse(message)

    // No matchId = plain run (not a submission), send result only to the requester
    if (!matchId) {
      const socketId = await redis.get(`socket:${userId}`)
      if (socketId) io.to(socketId).emit("run_result", { verdict, testsPassed, totalTests, results })
      return
    }

    try {
      const { updatePlayerSubmission } = await import('./services/matchStateService.js')
      await updatePlayerSubmission({ matchId, userId, testsPassed, totalTests })
    } catch (err) {
      console.error("updatePlayerSubmission error:", err.message)
    }

    const computedVerdict = testsPassed === totalTests && totalTests > 0 ? "Accepted" : "Wrong Answer"
    io.to(matchId).emit("verdict", { userId, verdict: computedVerdict, testsPassed, totalTests, results, totalExecutionTime })
    io.to(matchId).emit("opponent_tc_update", { userId, testsPassed, totalTests })

  } catch (err) {
    console.error("Error handling result:ready:", err.message)
  }
})

// 404 catch-all
app.use((req, res) => {
  res.status(404).json({ message: `${req.url} is not a valid path` })
})

// Global error handler
app.use((err, req, res, next) => {
  if (err.name === "ValidationError") return res.status(400).json({ message: "Validation error", error: err.message })
  if (err.name === "CastError")       return res.status(400).json({ message: "Invalid ID", error: err.message })

  const errCode  = err.code ?? err.cause?.code ?? err.errorResponse?.code
  const keyValue = err.keyValue ?? err.cause?.keyValue ?? err.errorResponse?.keyValue

  if (errCode === 11000) {
    const field = Object.keys(keyValue)[0]
    return res.status(409).json({ message: "Duplicate entry", error: `${field} "${keyValue[field]}" already exists` })
  }

  if (err.status) return res.status(err.status).json({ message: "error occurred", error: err.message })
  res.status(500).json({ message: "Server error" })
})

httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`))
