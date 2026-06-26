import {
  joinMatchmakingQueue,
  findNearbyPlayers,
  leaveMatchmakingQueue,
  getQueueCount,
} from "../services/matchmakingService.js"
import UserModel from "../models/UserModel.js"
import { createMatchState } from "../services/matchStateService.js"
import matchmakingRedis from "../config/matchmakingRedis.js"
import { io, redis } from "../server.js"

export const joinQueue = async (req, res, next) => {
  try {
    const { socketId, topic, difficulty } = req.body
    const { _id, username, rating } = req.user

    const resolvedSocketId = socketId || await redis.get(`socket:${_id.toString()}`)
    if (!resolvedSocketId) {
      return res.status(400).json({ success: false, message: "Socket not connected. Refresh and try again." })
    }

    console.log("Joining queue:", { userId: _id, username, rating, resolvedSocketId, topic, difficulty })

    await joinMatchmakingQueue({
      userId:     _id.toString(),
      username,
      rating:     Number(rating),
      socketId:   resolvedSocketId,
      topic:      topic      || "Array",
      difficulty: difficulty || "Easy",
    })

    return res.status(200).json({ success: true, message: "Joined matchmaking queue" })
  } catch (err) { next(err) }
}

export const findMatch = async (req, res, next) => {
  try {
    const { rating } = req.query
    const players = await findNearbyPlayers(Number(rating))
    return res.json({ success: true, players })
  } catch (err) { next(err) }
}

export const leaveQueue = async (req, res, next) => {
  try {
    const { _id } = req.user
    await leaveMatchmakingQueue(_id.toString())
    return res.json({ success: true, message: "Left matchmaking queue" })
  } catch (err) { next(err) }
}

export const queueCount = async (req, res, next) => {
  try {
    const count = await getQueueCount()
    return res.json({ success: true, count })
  } catch (err) { next(err) }
}

export const createRoom = async (req, res, next) => {
  try {
    const { socketId, topic, difficulty } = req.body
    const { userId } = req.user

    const resolvedSocketId = socketId || await redis.get(`socket:${userId}`)
    if (!resolvedSocketId) {
      return res.status(400).json({ success: false, message: "Socket not connected. Refresh and try again." })
    }

    const user = await UserModel.findById(userId).select("_id username rating")
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" })
    }

    const { _id, username, rating } = user
    const roomId = `room-${Date.now()}`

    const roomData = {
      roomId,
      playerA: {
        userId:   _id.toString(),
        username,
        rating:   Number(rating),
        socketId: resolvedSocketId,
      },
      playerB:    null,
      topic:      topic      || "Array",
      difficulty: difficulty || "Easy",
      status:     "waiting",
      createdAt:  Date.now(),
    }

    await matchmakingRedis.set(`room:${roomId}`, JSON.stringify(roomData), "EX", 300)
    console.log(`Room created: ${roomId} by ${username}`)

    return res.status(200).json({ success: true, roomId, message: "Room created — share roomId with your friend" })
  } catch (err) { next(err) }
}

export const joinRoom = async (req, res, next) => {
  try {
    const { roomId, socketId } = req.body
    const { _id, username, rating } = req.user

    const resolvedSocketIdB = socketId || await redis.get(`socket:${_id.toString()}`)
    if (!resolvedSocketIdB) {
      return res.status(400).json({ success: false, message: "Socket not connected. Refresh and try again." })
    }

    const roomRaw = await matchmakingRedis.get(`room:${roomId}`)
    if (!roomRaw) {
      return res.status(404).json({ success: false, message: "Room not found or expired" })
    }

    const room = JSON.parse(roomRaw)

    if (room.status !== "waiting") {
      return res.status(400).json({ success: false, message: "Room already started" })
    }

    if (room.playerA.userId === _id.toString()) {
      return res.status(400).json({ success: false, message: "You cannot join your own room" })
    }

    room.playerB = {
      userId:   _id.toString(),
      username,
      rating:   Number(rating),
      socketId: resolvedSocketIdB,
    }
    room.status = "ready"

    await matchmakingRedis.set(`room:${roomId}`, JSON.stringify(room), "EX", 300)
    console.log(`${username} joined room ${roomId} — both players ready`)

    const matchId = `match-${Date.now()}`

    await createMatchState({
      matchId,
      playerA: room.playerA.userId,
      playerB: room.playerB.userId,
      problem: { id: null, title: "", difficulty: room.difficulty }
    })

    const countdown = 5
    const socketIdA = await redis.get(`socket:${room.playerA.userId}`)
    const socketIdB = resolvedSocketIdB

    if (socketIdA) io.to(socketIdA).emit("match_starting", { matchId, seconds: countdown })
    io.to(socketIdB).emit("match_starting", { matchId, seconds: countdown })

    console.log(`Countdown started for room ${roomId} — match ${matchId} in ${countdown}s`)

    setTimeout(async () => {
      try {
        room.status = "started"
        await matchmakingRedis.set(`room:${roomId}`, JSON.stringify(room), "EX", 60)

        await matchmakingRedis.publish("match:created", JSON.stringify({
          matchId,
          playerA: { userId: room.playerA.userId, username: room.playerA.username, rating: room.playerA.rating },
          playerB: { userId: room.playerB.userId, username: room.playerB.username, rating: room.playerB.rating },
          problem:    null,
          topic:      room.topic,
          difficulty: room.difficulty,
          mode:       "friend",
        }))

        console.log(`Published match:created for friend match — ${matchId}`)
      } catch (err) {
        console.error("Error publishing friend match:", err.message)
      }
    }, countdown * 1000)

    return res.status(200).json({ success: true, message: "Joined room — match starting in 5 seconds", matchId })
  } catch (err) { next(err) }
}
