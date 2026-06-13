import { getMatchState, finishMatch } from '../services/matchStateService.js'
import { MatchModel } from '../models/MatchModel.js'
import UserModel from '../models/UserModel.js'
import { updatePlayerRating } from '../services/leaderboardService.js'
import { invalidateUserCache } from '../services/userCache.js'
import matchmakingRedis from '../config/matchmakingRedis.js'

export const handleMatchEnded = async ({ matchId, playerData, io }) => {
  // Use Redis SET NX as a distributed lock so two simultaneous match_ended events
  // (e.g. both players hit the timer at the same time) only process once,
  // even across server restarts (unlike an in-memory Set).
  const lockKey = `match:ended:${matchId}`
  const acquired = await matchmakingRedis.set(lockKey, '1', 'NX', 'EX', 3600)
  if (!acquired) return

  try {
    const matchState = await getMatchState(matchId)
    if (!matchState) return

    // Merge the triggering player's final code + stats into the snapshot
    if (playerData) {
      const player = matchState.playerA.userId === playerData.userId
        ? matchState.playerA
        : matchState.playerB
      player.code            = playerData.code
      player.language        = playerData.language
      player.testsPassed     = playerData.testsPassed     ?? player.testsPassed
      player.submissionCount = playerData.submissionCount ?? player.submissionCount
      player.aiUsageCount    = playerData.aiUsageCount    ?? player.aiUsageCount
    }

    const { judgeMatch } = await import('../utils/aiJudge.js')
    const aiResult = await judgeMatch({
      playerA: matchState.playerA,
      playerB: matchState.playerB,
      problem: matchState.problem,
    })

    await finishMatch({ matchId, winner: aiResult.winner })

    await MatchModel.create({
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

    const elapsed = (Date.now() - matchState.startedAt) / 1000

    await Promise.all([
      updateUserStats(matchState.playerA, aiResult.winner, elapsed, matchState.problem?.id),
      updateUserStats(matchState.playerB, aiResult.winner, elapsed, matchState.problem?.id),
    ])

    io.to(matchId).emit("match_result", {
      winnerId: aiResult.winner,
      aiReview: aiResult,
    })

  } catch (err) {
    console.error("handleMatchEnded error:", err.message)
    io.to(matchId).emit("match_result", { winnerId: null, aiReview: null })
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
    if (
      problemId &&
      player.testsPassed === player.totalTests &&
      player.totalTests > 0 &&
      !user.solvedProblems?.map(id => id.toString()).includes(problemId.toString())
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
