import { handleMatchEnded } from '../handlers/matchEndHandler.js'
import { MATCH_END_GRACE_SECONDS, createMatchState } from '../services/matchStateService.js'

// Both players see this 5-4-3-2-1 overlay after accepting, before either one
// is actually navigated into the match — gives the "starting…" moment its
// own beat instead of jumping straight from the accept dialog to the editor.
const START_COUNTDOWN_SECONDS = 5

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

  /* In-match chat. Messages are relayed to the opponent and never stored —
     no history, no replay on reconnect. Length-capped and rate-limited so a
     client can't flood the room. */
  let lastChatAt = 0
  socket.on("chat", ({ matchId, text }) => {
    if (!matchId || typeof text !== "string") return
    const body = text.trim().slice(0, 300)
    if (!body) return

    const now = Date.now()
    if (now - lastChatAt < 400) return
    lastChatAt = now

    socket.to(matchId).emit("opponent_chat", { userId, text: body, ts: now })
  })

  socket.on("match_ended", async ({ matchId, userId: senderId, code, language, testsPassed, submissionCount, aiUsageCount }) => {
    await handleMatchEnded({
      matchId,
      playerData: { userId: senderId, code, language, testsPassed, submissionCount, aiUsageCount },
      io,
    })
  })

  socket.on("accept_match", async ({ matchId }) => {
    // Both players' accept clicks typically land within milliseconds of each
    // other. A plain get-mutate-set here is a real race: two concurrent
    // handlers can both read acceptedBy:[], each push only their own userId,
    // and both write back a length-1 array — neither ever sees length 2, so
    // match_accepted silently never fires for either player. Same spinlock
    // idiom as matchStateService.js's withMatchLock.
    const lockKey = `accept:lock:${matchId}`
    let acquired = false
    for (let attempt = 0; attempt < 20 && !acquired; attempt++) {
      acquired = await redis.set(lockKey, "1", "NX", "PX", 2000)
      if (!acquired) await new Promise((r) => setTimeout(r, 25))
    }
    if (!acquired) {
      console.error(`accept_match: could not acquire lock for match ${matchId}`)
      return
    }

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

        // Ranked matches already have match:{matchId} — the matchmaking
        // worker creates it before publishing match:created. Friend-room
        // matches don't (joinRoom no longer creates it eagerly, so a
        // declined/expired invite never leaves a live match behind); create
        // it now that both sides have actually agreed to play.
        const problemId = pending.problem?._id || pending.problem?.id
        const matchRaw = await redis.get(`match:${matchId}`)
        if (!matchRaw) {
          await createMatchState({
            matchId,
            playerA: pending.playerA.userId,
            playerB: pending.playerB.userId,
            problem: pending.problem,
          })
        } else if (problemId) {
          // Write the problem ID into match state so new-browser restore can find the full problem
          const matchState = JSON.parse(matchRaw)
          matchState.problem.id = problemId.toString()
          const ttl = Math.max(60, Math.floor((matchState.endsAt - Date.now()) / 1000) + MATCH_END_GRACE_SECONDS)
          await redis.set(`match:${matchId}`, JSON.stringify(matchState), "EX", ttl)
        }

        const payloadForA = {
          matchId,
          opponent: { userId: pending.playerB.userId, username: pending.playerB.username, rating: pending.playerB.rating },
          problem:  pending.problem,
        }
        const payloadForB = {
          matchId,
          opponent: { userId: pending.playerA.userId, username: pending.playerA.username, rating: pending.playerA.rating },
          problem:  pending.problem,
        }

        io.to(pending.playerA.socketId).emit("match_starting", { matchId, seconds: START_COUNTDOWN_SECONDS })
        io.to(pending.playerB.socketId).emit("match_starting", { matchId, seconds: START_COUNTDOWN_SECONDS })

        setTimeout(() => {
          io.to(pending.playerA.socketId).emit("match_accepted", payloadForA)
          io.to(pending.playerB.socketId).emit("match_accepted", payloadForB)
        }, START_COUNTDOWN_SECONDS * 1000)
      } else {
        await redis.set(`pending:${matchId}`, JSON.stringify(pending), "EX", 30)
        socket.emit("match_acceptance_waiting", { message: "Waiting for opponent to accept" })
      }
    } catch (err) {
      console.error("accept_match error:", err.message)
    } finally {
      await redis.del(lockKey)
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
        } catch {
          /*  ignore */
        }
      }, 3000)
    }

    try {
      const { leaveMatchmakingQueue } = await import('../services/matchmakingService.js')
      await leaveMatchmakingQueue(userId)
    } catch (err) {
      console.error("queue cleanup on disconnect:", err.message)
    }

    // Remove socket mapping after a grace period; skip if they've already
    // reconnected. This window matters beyond the in-match "reconnecting"
    // badge: match:created (server.js) uses the presence of socket:<userId>
    // to decide whether a friend-room opponent is "online" before starting
    // the match. 5s was too tight — a backgrounded tab (common while
    // someone waits and switches away to actually paste/send the room ID)
    // routinely takes longer than that to reconnect, so the room creator
    // would look offline and the match would get silently cancelled right
    // as the friend tried to join. 20s covers a normal background/reconnect
    // cycle while still cleaning up promptly for someone actually gone.
    setTimeout(async () => {
      const currentSocketId = await redis.get(`socket:${userId}`)
      if (currentSocketId === socket.id) await redis.del(`socket:${userId}`)
    }, 20000)
  })
}
