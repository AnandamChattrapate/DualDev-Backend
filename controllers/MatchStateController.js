import {
  createMatchState,
  getMatchState,
  getMatchWithTimer,
  updatePlayerSubmission,
  incrementAIUsage,
  finishMatch,
  getActiveMatchForUser,
} from "../services/matchStateService.js"
import matchmakingRedis from "../config/matchmakingRedis.js"
import { ProblemModel } from "../models/ProblemModel.js"
import { MatchModel } from "../models/MatchModel.js"
import UserModel from "../models/UserModel.js"

// Returns 403 if the authenticated user isn't one of the two players
function requirePlayer(match, userId) {
  const ids = [match.playerA?.userId, match.playerB?.userId]
  return ids.includes(userId)
}

export const createMatch = async (req, res) => {
  try {
    const { matchId, playerA, playerB, problem } = req.body
    const match = await createMatchState({ matchId, playerA, playerB, problem })
    res.json({ success: true, match })
  } catch (err) {
    console.error("createMatch error:", err.message)
    res.status(500).json({ success: false, message: err.message })
  }
}

export const fetchMatchState = async (req, res, next) => {
  try {
    const { matchId } = req.params
    const userId = req.user.userId

    const match = await getMatchState(matchId)
    if (!match) {
      // This is the Result.jsx fallback fetch (fires when the match_result
      // socket event was missed). A 404 here means the Redis match:{id} key
      // is gone by the time the result page asks for it — log loudly, this
      // is the same symptom the result-page bug traces back to.
      console.error(`[fetchMatchState] match:${matchId} NOT FOUND in Redis (requested by user ${userId})`)
      return res.status(404).json({ success: false, message: "Match not found" })
    }

    if (!requirePlayer(match, userId)) {
      console.error(`[fetchMatchState] match:${matchId} found but user ${userId} is not a player in it`)
      return res.status(403).json({ success: false, message: "Not your match" })
    }

    console.log(`[fetchMatchState] match:${matchId} found, status=${match.status}, winner=${match.winner}`)
    res.json({ success: true, match })
  } catch (err) {
    next(err)
  }
}

/* Authoritative final result for the result screen.
   The Redis match:{id} key has a TTL, so it is gone for anyone who reloads
   the result page later — that used to strand the page on its spinner and
   then a "couldn't load" error even though the match was finished and
   stored. Read Redis first (it carries the rich per-player data), then fall
   back to the persisted MatchModel document, which always survives.
   Always reports `finished` explicitly so the client can stop loading even
   when no winner could be determined. */
export const fetchMatchResult = async (req, res, next) => {
  try {
    const { matchId } = req.params
    const userId = req.user.userId

    const [state, doc] = await Promise.all([
      getMatchState(matchId),
      MatchModel.findOne({ matchId }).populate("players.user", "username rating"),
    ])

    if (!state && !doc) {
      return res.status(404).json({ success: false, message: "Match not found" })
    }

    // Authorize against whichever source we have.
    const docPlayerIds = (doc?.players || []).map((p) => p.user?._id?.toString()).filter(Boolean)
    const authorized = (state && requirePlayer(state, userId)) || docPlayerIds.includes(userId)
    if (!authorized) {
      return res.status(403).json({ success: false, message: "Not your match" })
    }

    // Neither source says finished yet — tell the client to keep waiting
    // rather than treating it as a failure.
    const finished = doc?.status === "finished" || state?.status === "finished"
    if (!finished) {
      return res.json({ success: true, result: { finished: false } })
    }

    // Merge: Redis carries the rich per-player data (tests, code, language)
    // but not aiReview; the Mongo doc carries aiReview and usernames but not
    // per-player test data. Either may be absent.
    const players = {}
    if (state) {
      for (const p of [state.playerA, state.playerB]) {
        if (!p?.userId) continue
        players[p.userId] = {
          userId:      p.userId,
          testsPassed: p.testsPassed || 0,
          totalTests:  p.totalTests  || 0,
          language:    p.language    || null,
          code:        p.code        || null,
        }
      }
    }
    for (const p of doc?.players || []) {
      const id = p.user?._id?.toString()
      if (!id) continue
      players[id] = {
        ...(players[id] || { userId: id }),
        username:     p.user?.username ?? players[id]?.username ?? null,
        result:       p.result ?? null,
        ratingBefore: p.ratingBefore ?? null,
        ratingAfter:  p.ratingAfter  ?? null,
      }
    }

    return res.json({
      success: true,
      result: {
        finished:   true,
        winner:     doc?.winner ?? state?.winner ?? null,
        aiReview:   doc?.aiReview ?? null,
        startedAt:  doc?.startedAt  ?? (state?.startedAt  ? new Date(state.startedAt)  : null),
        finishedAt: doc?.finishedAt ?? (state?.finishedAt ? new Date(state.finishedAt) : null),
        players,
      },
    })
  } catch (err) {
    next(err)
  }
}

export const fetchMatchWithTimer = async (req, res, next) => {
  try {
    const { matchId } = req.params
    const userId = req.user.userId

    const match = await getMatchWithTimer(matchId)
    if (!match) return res.status(404).json({ success: false, message: "Match not found" })

    if (!requirePlayer(match, userId)) {
      return res.status(403).json({ success: false, message: "Not your match" })
    }

    res.json({ success: true, match })
  } catch (err) {
    next(err)
  }
}

export const updateSubmission = async (req, res, next) => {
  try {
    // userId comes from the JWT — never trust the request body for this
    const userId = req.user.userId
    const { matchId, testsPassed, totalTests } = req.body

    const match = await getMatchState(matchId)
    if (!match) return res.status(404).json({ success: false, message: "Match not found" })

    if (!requirePlayer(match, userId)) {
      return res.status(403).json({ success: false, message: "Not your match" })
    }

    const updatedMatch = await updatePlayerSubmission({ matchId, userId, testsPassed, totalTests })
    res.json({ success: true, match: updatedMatch })
  } catch (err) {
    next(err)
  }
}

export const updateAIUsage = async (req, res, next) => {
  try {
    const { matchId } = req.body
    const userId = req.user.userId

    const match = await getMatchState(matchId)
    if (!match) return res.status(404).json({ success: false, message: "Match not found" })

    if (!requirePlayer(match, userId)) {
      return res.status(403).json({ success: false, message: "Not your match" })
    }

    const updated = await incrementAIUsage({ matchId, userId })
    res.json({ success: true, match: updated })
  } catch (err) {
    next(err)
  }
}

export const endMatch = async (req, res, next) => {
  try {
    const { matchId, winner } = req.body
    const userId = req.user.userId

    const match = await getMatchState(matchId)
    if (!match) return res.status(404).json({ success: false, message: "Match not found" })

    if (!requirePlayer(match, userId)) {
      return res.status(403).json({ success: false, message: "Not your match" })
    }

    const ended = await finishMatch({ matchId, winner })
    res.json({ success: true, match: ended })
  } catch (err) {
    next(err)
  }
}

// Returns the user's active ongoing match, enriched with full problem + opponent data
export const getMyActiveMatch = async (req, res, next) => {
  try {
    const userId = req.user.userId

    const match = await getActiveMatchForUser(userId)
    if (!match) return res.json({ success: true, active: false, reason: "no_match" })

    if (match.timeLeft == null || match.timeLeft <= 60) {
      return res.json({ success: true, active: false, reason: "near_end", timeLeft: match.timeLeft })
    }

    const opponentId = match.playerA.userId === userId
      ? match.playerB.userId
      : match.playerA.userId

    const [fullProblem, opponentUser] = await Promise.all([
      match.problem?.id ? ProblemModel.findById(match.problem.id).lean() : null,
      UserModel.findById(opponentId).select("_id username rating").lean(),
    ])

    return res.json({
      success:  true,
      active:   true,
      matchId:  match.matchId,
      match,
      problem:  fullProblem || null,
      opponent: opponentUser ? {
        userId:   opponentUser._id.toString(),
        username: opponentUser.username,
        rating:   opponentUser.rating,
      } : null,
    })
  } catch (err) {
    next(err)
  }
}

// Debug endpoint — dumps Redis state for current user. Remove once rejoin is stable.
export const debugActiveMatch = async (req, res, next) => {
  try {
    const userId = req.user.userId

    const userMatchKey   = `user:${userId}:match`
    const matchIdFromKey = await matchmakingRedis.get(userMatchKey)

    let matchSnapshot = null
    let timerInfo     = null
    if (matchIdFromKey) {
      const raw = await matchmakingRedis.get(`match:${matchIdFromKey}`)
      matchSnapshot = raw ? JSON.parse(raw) : null
      timerInfo = await getMatchWithTimer(matchIdFromKey)
    }

    let allUserMatchKeys = []
    try {
      allUserMatchKeys = await matchmakingRedis.keys("user:*:match") || []
    } catch (_) {
      /* ignore */
    }

    return res.json({
      success:               true,
      yourUserId:            userId,
      lookupKey:             userMatchKey,
      matchIdFromKey:        matchIdFromKey || null,
      matchSnapshotExists:   !!matchSnapshot,
      matchStatus:           matchSnapshot?.status,
      timeLeft:              timerInfo?.timeLeft,
      bufferSeconds:         60,
      willRedirect:          !!(timerInfo?.status === "ongoing" && timerInfo?.timeLeft > 60),
      allUserMatchKeysInRedis: allUserMatchKeys,
    })
  } catch (err) {
    next(err)
  }
}
