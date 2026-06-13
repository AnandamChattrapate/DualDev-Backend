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
    if (!match) return res.status(404).json({ success: false, message: "Match not found" })

    if (!requirePlayer(match, userId)) {
      return res.status(403).json({ success: false, message: "Not your match" })
    }

    res.json({ success: true, match })
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
    } catch (_) {}

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
