import { getAIHint } from "../utils/aiUsage.js"
import { incrementAIUsage } from "../services/matchStateService.js"

export const getHint = async (req, res, next) => {
  try {
    const { question, problemTitle, description, code, language, matchId } = req.body
    const userId = req.user._id.toString()

    if (!question?.trim()) {
      return res.status(400).json({ success: false, message: "Question is required" })
    }

    if (matchId) {
      const matchState = await (await import("../services/matchStateService.js")).getMatchState(matchId)
      if (matchState) {
        const player = matchState.playerA.userId === userId
          ? matchState.playerA
          : matchState.playerB
        if ((player.aiUsageCount || 0) >= 5) {
          return res.status(403).json({ success: false, message: "AI usage limit reached (5 per match)" })
        }
        await incrementAIUsage({ matchId, userId })
      }
    }

    const hint = await getAIHint({ question, problemTitle, description, code, language })

    return res.status(200).json({ success: true, hint })

  } catch (err) {
    console.log("getHint error:", err.message)
    next(err)
  }
}