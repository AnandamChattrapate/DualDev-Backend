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

    const elapsed = (Date.now() - matchState.startedAt) / 1000

    const [statsA, statsB] = await Promise.all([
      updateUserStats(matchState.playerA, aiResult.winner, elapsed, matchState.problem?.id),
      updateUserStats(matchState.playerB, aiResult.winner, elapsed, matchState.problem?.id),
    ])
    console.log(`[matchEnd:${matchId}] updateUserStats: A=${JSON.stringify(statsA)} B=${JSON.stringify(statsB)}`)

    await finishMatch({ matchId, winner: aiResult.winner })
    console.log(`[matchEnd:${matchId}] finishMatch OK`)

    const doc = await MatchModel.create({
      matchId,
      players: [
        {
          user:   matchState.playerA.userId,
          result: aiResult.winner === matchState.playerA.userId ? "won"
                : aiResult.winner === "draw" ? "draw" : "lost",
          ratingBefore: statsA?.ratingBefore ?? null,
          ratingAfter:  statsA?.ratingAfter  ?? null,
        },
        {
          user:   matchState.playerB.userId,
          result: aiResult.winner === matchState.playerB.userId ? "won"
                : aiResult.winner === "draw" ? "draw" : "lost",
          ratingBefore: statsB?.ratingBefore ?? null,
          ratingAfter:  statsB?.ratingAfter  ?? null,
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

    const payload = {
      winnerId: aiResult.winner,
      aiReview: aiResult,
      players:  buildPlayersPayload(matchState, {
        [matchState.playerA.userId]: statsA,
        [matchState.playerB.userId]: statsB,
      }),
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
    // updateUserStats never ran on this path, so it supplied no usernames —
    // without them the result screen renders the opponent as "Unknown".
    // Look them up directly; a failure here must not block the emit.
    let names = {}
    if (matchState) {
      try {
        const docs = await UserModel.find(
          { _id: { $in: [matchState.playerA.userId, matchState.playerB.userId] } },
          "username"
        )
        names = Object.fromEntries(docs.map((d) => [d._id.toString(), { username: d.username }]))
      } catch (nameErr) {
        console.error(`[matchEnd:${matchId}] username lookup failed:`, nameErr.message)
      }
    }
    const payload = {
      winnerId: fallbackWinner,
      aiReview: null,
      players:  buildPlayersPayload(matchState, names),
    }
    console.log(`[matchEnd:${matchId}] emitting fallback match_result:`, JSON.stringify(payload))
    io.to(matchId).emit("match_result", payload)
  }
}

// Authoritative final per-player stats, keyed by userId, so the result screen
// doesn't have to rely on live socket events it may have missed (reload, late
// join, dropped connection), a client-side rating snapshot that can drift
// from the server's true value, or the opponent object set at match-start
// time (which some join paths — e.g. friend-room matches — may populate
// incompletely). statsByUserId is null/missing per-key when updateUserStats
// never ran (e.g. the catch-block fallback path) — the frontend falls back
// to its own state for whatever's missing.
const buildPlayersPayload = (matchState, statsByUserId = {}) => {
  if (!matchState) return null
  const toPayload = (p) => ({
    testsPassed:  p.testsPassed || 0,
    totalTests:   p.totalTests  || 0,
    language:     p.language    || null,
    code:         p.code        || null,
    // Seconds from match start to the submission that went fully green.
    // Null when they never passed everything — the client renders a dash.
    timeTaken:    p.timeTaken   ?? null,
    username:     statsByUserId[p.userId]?.username     ?? null,
    ratingBefore: statsByUserId[p.userId]?.ratingBefore ?? null,
    ratingAfter:  statsByUserId[p.userId]?.ratingAfter  ?? null,
  })
  return {
    [matchState.playerA.userId]: toPayload(matchState.playerA),
    [matchState.playerB.userId]: toPayload(matchState.playerB),
  }
}

// Returns { username, ratingBefore, ratingAfter } on success, null if the
// update couldn't be applied (missing user, save failure, etc.) — callers
// must treat null as "no authoritative data available" rather than assuming 0.
const updateUserStats = async (player, winnerId, elapsed, problemId) => {
  try {
    const user = await UserModel.findById(player.userId)
    if (!user) return null

    const username = user.username
    const ratingBefore = user.rating || 1000

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

    return { username, ratingBefore, ratingAfter: user.rating }

  } catch (err) {
    console.error("updateUserStats error:", err.message)
    return null
  }
}
