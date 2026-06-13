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

// ─────────────────────────────────────────
// JOIN RANDOM QUEUE
// ─────────────────────────────────────────
export const joinQueue = async (req, res, next) => {
  try {
    const { socketId, topic, difficulty } = req.body
    const { _id, username, rating } = req.user

    console.log("Joining queue:", { userId: _id, username, rating, socketId,topic,difficulty })

    await joinMatchmakingQueue({
      userId:     _id.toString(),
      username,
      rating:     Number(rating),
      socketId,
      topic:      topic      || "Array",
      difficulty: difficulty || "Easy",
    })

    console.log(`${username} added to matchmaking queue with rating ${rating}`)

    return res.status(200).json({
      success: true,
      message: "Joined matchmaking queue"
    })

  } catch (err) { next(err) }
}

// ─────────────────────────────────────────
// FIND NEARBY PLAYERS
// ─────────────────────────────────────────
export const findMatch = async (req, res, next) => {
  try {
    const { rating } = req.query
    const players = await findNearbyPlayers(Number(rating))
    return res.json({ success: true, players })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────
// LEAVE QUEUE
// ─────────────────────────────────────────
export const leaveQueue = async (req, res, next) => {
  try {
    const { _id } = req.user
    await leaveMatchmakingQueue(_id.toString())
    return res.json({ success: true, message: "Left matchmaking queue" })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────
// QUEUE COUNT
// ─────────────────────────────────────────
export const queueCount = async (req, res, next) => {
  try {
    const count = await getQueueCount()
    return res.json({ success: true, count })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────
// CREATE ROOM — User A creates friend match room
// ─────────────────────────────────────────
export const createRoom = async (req, res, next) => {
  try {
    console.log("createRoom body:", req.body)  // ← add this

    const { socketId, topic, difficulty } = req.body
    const { userId } = req.user
    const user =await UserModel.findById(userId).select("_id username rating")
    if (!user) {
      return res.status(404).json({
      success: false,
      message: "User not found",
    });
    }
    console.log("user details from db : ",user)

    const { _id, username, rating } = user;

    console.log(_id);
    console.log(username);
    console.log(rating);

    // Generate roomId
    const roomId = `room-${Date.now()}`

    const roomData = {
      roomId,
      playerA: {
        userId:   _id.toString(),
        username,
        rating:   Number(rating),
        socketId,
      },
      playerB:    null,
      topic:      topic      || "Array",
      difficulty: difficulty || "Easy",
      status:     "waiting",
      createdAt:  Date.now(),
    }

    // Store in Redis — expires in 5 mins
    await matchmakingRedis.set(
      `room:${roomId}`,
      JSON.stringify(roomData),
      "EX", 300
    )

    console.log(`Room created: ${roomId} by ${username}`)

    return res.status(200).json({
      success: true,
      roomId,
      message: "Room created — share roomId with your friend"
    })

  } catch (err) { next(err) }
}

// ─────────────────────────────────────────
// JOIN ROOM — User B joins with roomId
// ─────────────────────────────────────────
export const joinRoom = async (req, res, next) => {
  try {
     console.log("joinRoom called")
    const { roomId, socketId } = req.body
    console.log("roomId:", roomId, "socketId:", socketId)
    const { _id, username, rating } = req.user
    console.log("user:", _id, username, rating)


    // Get room from Redis
    const roomRaw = await matchmakingRedis.get(`room:${roomId}`)

    if (!roomRaw) {
      return res.status(404).json({
        success: false,
        message: "Room not found or expired"
      })
    }

    const room = JSON.parse(roomRaw)

    // Check room is still waiting
    if (room.status !== "waiting") {
      return res.status(400).json({
        success: false,
        message: "Room already started"
      })
    }

    // Prevent same user joining their own room
    if (room.playerA.userId === _id.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot join your own room"
      })
    }

    // Add Player B
    room.playerB = {
      userId:   _id.toString(),
      username,
      rating:   Number(rating),
      socketId,
    }
    room.status = "ready"

    // Update room in Redis
    await matchmakingRedis.set(
      `room:${roomId}`,
      JSON.stringify(room),
      "EX", 300
    )

    console.log(`${username} joined room ${roomId} — both players ready`)

    // ── Both players present — create match ──
    const matchId = `match-${Date.now()}`

          // CORRECT
      await createMatchState({
        matchId,
        playerA: room.playerA.userId,
        playerB: room.playerB.userId,
        problem: {
          id:         null,
          title:      "",
          difficulty: room.difficulty,  // ← use room difficulty for timer calculation
        }
      })

    // Emit countdown to both players via Socket.io
    const countdown = 5
    const socketIdA = await redis.get(`socket:${room.playerA.userId}`)
    const socketIdB = socketId  // already have it

    if (socketIdA) {
      io.to(socketIdA).emit("match_starting", { matchId, seconds: countdown })
    }
    io.to(socketIdB).emit("match_starting", { matchId, seconds: countdown })

    console.log(`Countdown started for room ${roomId} — match ${matchId} in ${countdown}s`)

    // ── After countdown — publish match:created ──
    setTimeout(async () => {
      try {
        // Mark room as started
        room.status = "started"
        await matchmakingRedis.set(
          `room:${roomId}`,
          JSON.stringify(room),
          "EX", 60
        )

        // Publish match:created — same flow as random match
        await matchmakingRedis.publish("match:created", JSON.stringify({
          matchId,
          playerA: {
            userId:   room.playerA.userId,
            username: room.playerA.username,
            rating:   room.playerA.rating,
          },
          playerB: {
            userId:   room.playerB.userId,
            username: room.playerB.username,
            rating:   room.playerB.rating,
          },
          problem: null,  // server.js subscriber will pick problem
          topic:      room.topic,
          difficulty: room.difficulty,
          mode:       "friend",
        }))

        console.log(`Published match:created for friend match — ${matchId}`)

      } catch (err) {
        console.log("Error publishing friend match:", err.message)
      }
    }, countdown * 1000)

    return res.status(200).json({
      success: true,
      message: "Joined room — match starting in 5 seconds",
      matchId,
    })

  } catch (err) { next(err) }
}