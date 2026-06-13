import { handleMatchEnded } from '../handlers/matchEndHandler.js'

export const registerSocketHandlers = (socket, io, redis) => {
  const userId = socket.user?.userId
  if (!userId) {
    socket.disconnect()
    return
  }

  // Map userId → socketId so we can reach this user from other contexts
  redis.set(`socket:${userId}`, socket.id, "EX", 86400)

  socket.on("join_match", async ({ matchId }) => {
    socket.join(matchId)
    // Also used as "reconnected" — lets the opponent flip their panel back to online
    socket.to(matchId).emit("opponent_joined", { userId })
    socket.data.matchId = matchId
  })

  socket.on("code_change", ({ matchId, tokens }) => {
    socket.to(matchId).emit("opponent_tokens", { tokens })
  })

  // Forward typing/reading/idle state to the opponent, no persistence needed
  socket.on("presence", ({ matchId, state, section }) => {
    if (!matchId || !state) return
    socket.to(matchId).emit("opponent_presence", {
      userId,
      state,
      section: section || null,
      ts: Date.now(),
    })
  })

  socket.on("tc_update", ({ matchId, testsPassed, totalTests }) => {
    socket.to(matchId).emit("opponent_tc_update", { userId, testsPassed, totalTests })
  })

  socket.on("emote", ({ matchId, emote }) => {
    socket.to(matchId).emit("opponent_emote", { emote })
  })

  socket.on("match_ended", async ({ matchId, userId: senderId, code, language, testsPassed, submissionCount, aiUsageCount }) => {
    await handleMatchEnded({
      matchId,
      playerData: { userId: senderId, code, language, testsPassed, submissionCount, aiUsageCount },
      io,
    })
  })

  socket.on("accept_match", async ({ matchId }) => {
    try {
      const pendingRaw = await redis.get(`pending:${matchId}`)
      if (!pendingRaw) {
        socket.emit("match_cancelled", { reason: "Match expired" })
        return
      }

      const pending = JSON.parse(pendingRaw)
      if (!pending.acceptedBy.includes(userId)) pending.acceptedBy.push(userId)

      if (pending.acceptedBy.length === 2) {
        await redis.del(`pending:${matchId}`)

        // Write the problem ID into match state so new-browser restore can find the full problem
        const problemId = pending.problem?._id || pending.problem?.id
        if (problemId) {
          const matchRaw = await redis.get(`match:${matchId}`)
          if (matchRaw) {
            const matchState = JSON.parse(matchRaw)
            matchState.problem.id = problemId.toString()
            const ttl = Math.max(60, Math.floor((matchState.endsAt - Date.now()) / 1000))
            await redis.set(`match:${matchId}`, JSON.stringify(matchState), "EX", ttl)
          }
        }

        io.to(pending.playerA.socketId).emit("match_accepted", {
          matchId,
          opponent: { userId: pending.playerB.userId, username: pending.playerB.username, rating: pending.playerB.rating },
          problem:  pending.problem,
        })
        io.to(pending.playerB.socketId).emit("match_accepted", {
          matchId,
          opponent: { userId: pending.playerA.userId, username: pending.playerA.username, rating: pending.playerA.rating },
          problem:  pending.problem,
        })
      } else {
        await redis.set(`pending:${matchId}`, JSON.stringify(pending), "EX", 30)
        socket.emit("match_acceptance_waiting", { message: "Waiting for opponent to accept" })
      }
    } catch (err) {
      console.error("accept_match error:", err.message)
    }
  })

  socket.on("decline_match", async ({ matchId }) => {
    try {
      const pendingRaw = await redis.get(`pending:${matchId}`)
      if (!pendingRaw) return

      const pending = JSON.parse(pendingRaw)
      await redis.del(`pending:${matchId}`)

      io.to(pending.playerA.socketId).emit("match_cancelled", { reason: "Opponent declined the match" })
      io.to(pending.playerB.socketId).emit("match_cancelled", { reason: "Opponent declined the match" })

      // Clean up match + user-match pointers so auto-rejoin doesn't redirect into a ghost match
      await redis.del(`match:${matchId}`)
      await redis.zrem('active_matches', matchId)
      await redis.del(`user:${pending.playerA.userId}:match`)
      await redis.del(`user:${pending.playerB.userId}:match`)
    } catch (err) {
      console.error("decline_match error:", err.message)
    }
  })

  socket.on("disconnect", async () => {
    const matchId = socket.data?.matchId
    if (matchId) {
      // 3s grace period — if they reconnect within it, the socket map will point to the new socket
      // and we skip the offline broadcast (avoids false disconnects from page reloads)
      setTimeout(async () => {
        try {
          const currentSocketId = await redis.get(`socket:${userId}`)
          if (currentSocketId !== socket.id) return
          io.to(matchId).emit("opponent_offline", { userId })
        } catch {}
      }, 3000)
    }

    try {
      const { leaveMatchmakingQueue } = await import('../services/matchmakingService.js')
      await leaveMatchmakingQueue(userId)
    } catch (err) {
      console.error("queue cleanup on disconnect:", err.message)
    }

    // Remove socket mapping after 5s; skip if they've already reconnected
    setTimeout(async () => {
      const currentSocketId = await redis.get(`socket:${userId}`)
      if (currentSocketId === socket.id) await redis.del(`socket:${userId}`)
    }, 5000)
  })
}
