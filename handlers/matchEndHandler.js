import { getMatchState, finishMatch, mergePlayerData } from '../services/matchStateService.js'
import { MatchModel } from '../models/MatchModel.js'
import UserModel from '../models/UserModel.js'
import { updatePlayerRating } from '../services/leaderboardService.js'
import { invalidateUserCache } from '../services/userCache.js'
import matchmakingRedis from '../config/matchmakingRedis.js'

export const handleMatchEnded = async ({ matchId, playerData, io }) => {
  console.log(`[matchEnd:${matchId}] handleMatchEnded invoked, playerData=${playerData ? JSON.stringify({ userId: playerData.userId, testsPassed: playerData.testsPassed, submissionCount: playerData.submissionCount }) : 'null'}`)

  // Both players emit match_ended (timer expiry usually fires for both, or one
  // submits and the other's timer runs out shortly after). Merge each caller's
  // final code/stats unconditionally and *before* the "compute once" lock below —
  // otherwise whichever caller loses the lock race has their data silently dropped.
  if (playerData) {
    try {
      await mergePlayerData({ matchId, ...playerData })
      console.log(`[matchEnd:${matchId}] mergePlayerData OK for user ${playerData.userId}`)
    } catch (err) {
      console.error(`[matchEnd:${matchId}] mergePlayerData error for user ${playerData.userId}:`, err.message)
    }
  }

  // Use Redis SET NX as a distributed lock so two simultaneous match_ended events
  // (e.g. both players hit the timer at the same time) only process once,
  // even across server restarts (unlike an in-memory Set).
  const lockKey = `match:ended:${matchId}`
  const acquired = await matchmakingRedis.set(lockKey, '1', 'NX', 'EX', 3600)
  if (!acquired) {
    console.log(`[matchEnd:${matchId}] lock already held — another caller is processing (or already processed) this match, skipping`)
    return
  }
  console.log(`[matchEnd:${matchId}] lock acquired, proceeding with match-end processing`)

  // Both players' match_ended events typically arrive within milliseconds of
  // each other (same timer hitting 0, or one manual end followed by the
  // other's handler). mergePlayerData for the second caller can still be
  // in flight when the first caller reaches this point — a plain read here
  // isn't synchronized against it, so without this, the read can win the
  // race and permanently miss the other player's final testsPassed/language.
  // A short settle window lets a near-simultaneous sibling call land first.
  await new Promise((r) => setTimeout(r, 500))

  let matchState = null
  try {
    const ttl = await matchmakingRedis.ttl(`match:${matchId}`)
    matchState = await getMatchState(matchId)
    if (!matchState) {
      console.error(`[matchEnd:${matchId}] match state NOT FOUND in Redis (key TTL was ${ttl}s before this read — -2 means the key doesn't exist). Releasing lock so a retry (e.g. the other player's match_ended) can still succeed.`)
      // Don't leave the "already processed" lock held for a full hour when
      // nothing was actually processed — that would permanently block every
      // future attempt for this match, silently, with no way to recover.
      await matchmakingRedis.del(lockKey)
      return
    }
    console.log(`[matchEnd:${matchId}] match state found (key TTL was ${ttl}s): playerA=${matchState.playerA.userId} testsPassed=${matchState.playerA.testsPassed}/${matchState.playerA.totalTests}, playerB=${matchState.playerB.userId} testsPassed=${matchState.playerB.testsPassed}/${matchState.playerB.totalTests}`)

    const { judgeMatch } = await import('../utils/aiJudge.js')
    const aiResult = await judgeMatch({
      playerA: matchState.playerA,
      playerB: matchState.playerB,
      problem: matchState.problem,
    })
    console.log(`[matchEnd:${matchId}] judgeMatch result: winner=${aiResult.winner}`)

    await finishMatch({ matchId, winner: aiResult.winner })
    console.log(`[matchEnd:${matchId}] finishMatch OK`)

    const doc = await MatchModel.create({
      matchId,
      players: [
        {
          user:   matchState.playerA.userId,
          result: aiResult.winner === matchState.playerA.userId ? "won"
                : aiResult.winner === "draw" ? "draw" : "lost",
        },
        {
          user:   matchState.playerB.userId,
          result: aiResult.winner === matchState.playerB.userId ? "won"
                : aiResult.winner === "draw" ? "draw" : "lost",
        },
      ],
      problem:    matchState.problem?.id || null,
      winner:     aiResult.winner,
      status:     "finished",
      aiReview:   aiResult,
      startedAt:  new Date(matchState.startedAt),
      finishedAt: new Date(),
    })
    console.log(`[matchEnd:${matchId}] MatchModel.create OK, _id=${doc._id}`)

    const elapsed = (Date.now() - matchState.startedAt) / 1000

    await Promise.all([
      updateUserStats(matchState.playerA, aiResult.winner, elapsed, matchState.problem?.id),
      updateUserStats(matchState.playerB, aiResult.winner, elapsed, matchState.problem?.id),
    ])
    console.log(`[matchEnd:${matchId}] updateUserStats OK for both players`)

    const payload = {
      winnerId: aiResult.winner,
      aiReview: aiResult,
      players:  buildPlayersPayload(matchState),
    }
    console.log(`[matchEnd:${matchId}] emitting match_result:`, JSON.stringify(payload))
    io.to(matchId).emit("match_result", payload)

  } catch (err) {
    console.error(`[matchEnd:${matchId}] handleMatchEnded error:`, err.message)
    // Fallback: decide by test cases so neither player sees a wrong "lost"
    let fallbackWinner = null
    if (matchState) {
      const a = matchState.playerA.testsPassed || 0
      const b = matchState.playerB.testsPassed || 0
      fallbackWinner = a > b ? matchState.playerA.userId
                     : b > a ? matchState.playerB.userId
                     : "draw"
    }
    const payload = {
      winnerId: fallbackWinner,
      aiReview: null,
      players:  buildPlayersPayload(matchState),
    }
    console.log(`[matchEnd:${matchId}] emitting fallback match_result:`, JSON.stringify(payload))
    io.to(matchId).emit("match_result", payload)
  }
}

// Authoritative final per-player stats, keyed by userId, so the result screen
// doesn't have to rely on live socket events it may have missed (reload, late
// join, dropped connection).
const buildPlayersPayload = (matchState) => {
  if (!matchState) return null
  const toPayload = (p) => ({
    testsPassed: p.testsPassed || 0,
    totalTests:  p.totalTests  || 0,
    language:    p.language    || null,
  })
  return {
    [matchState.playerA.userId]: toPayload(matchState.playerA),
    [matchState.playerB.userId]: toPayload(matchState.playerB),
  }
}

const updateUserStats = async (player, winnerId, elapsed, problemId) => {
  try {
    const user = await UserModel.findById(player.userId)
    if (!user) return

    const won       = winnerId === player.userId
    const draw      = winnerId === "draw"
    const prevTotal = user.totalMatches || 0
    const newTotal  = prevTotal + 1

    const newAccuracy = Math.round(
      ((user.accuracy * prevTotal) + (player.testsPassed > 0 ? 100 : 0)) / newTotal
    )

    const newAvgSolveTime = Math.round(
      ((user.avgSolveTime * prevTotal) + elapsed) / newTotal
    )

    const eloChange = won ? 25 : draw ? 0 : -15

    if (won)        user.wins   = (user.wins   || 0) + 1
    else if (!draw) user.losses = (user.losses || 0) + 1

    user.rating       = Math.max(0, (user.rating || 1000) + eloChange)
    user.totalMatches = newTotal
    user.accuracy     = newAccuracy
    user.avgSolveTime = newAvgSolveTime
    user.totalAIUsage = (user.totalAIUsage || 0) + (player.aiUsageCount || 0)

    if (player.submissionCount === 1 && player.testsPassed === player.totalTests) {
      user.perfectSolves = (user.perfectSolves || 0) + 1
    }

    // Use the problem ID passed from matchState, not from playerData (which never had it)
    // solvedProblems can contain stray null/undefined entries from earlier data
    // issues — filter them out before calling .toString(), or this throws and
    // aborts the whole update before user.save() ever runs.
    if (
      problemId &&
      player.testsPassed === player.totalTests &&
      player.totalTests > 0 &&
      !(user.solvedProblems || []).some((id) => id && id.toString() === problemId.toString())
    ) {
      user.solvedProblems.push(problemId)
    }

    await user.save()

    try {
      await updatePlayerRating({ userId: player.userId, rating: user.rating })
    } catch (lbErr) {
      console.error("leaderboard sync error:", lbErr.message)
    }

    await invalidateUserCache(player.userId)

  } catch (err) {
    console.error("updateUserStats error:", err.message)
  }
}
