import OpenAI from "openai"
import { config } from 'dotenv'
config()

const getJudgeClient = () => new OpenAI({
  apiKey:  process.env.JUDGE_API,
  baseURL: "https://api.aicredits.in/v1",
})

// gpt-5-nano behind this proxy is a reasoning model — it burns hidden
// reasoning tokens even on a trivial prompt (~1.5s just for "reply OK"),
// and the real judge prompt (full problem + two players' code + JSON
// schema instructions) needs meaningfully more of that. 10s was cutting
// real calls off before they finished; 25s gives it room to actually
// complete instead of falling back to the heuristic on every match.
const JUDGE_TIMEOUT_MS = 25_000

const SYSTEM_PROMPT = `You are a competitive programming judge. Evaluate two players' solutions to the same problem and decide the winner.

Scoring criteria, in order of importance:
1. Test cases passed (most important)
2. Fewer submissions is better
3. Faster solve time is better
4. Code quality and efficiency

Respond ONLY with valid JSON in this exact format, no markdown fences, no extra text:
{
  "winner": "playerA" or "playerB" or "draw",
  "reasoning": "2-3 sentence explanation of why this player won",
  "playerAReview": {
    "strengths": "what player A did well",
    "improvements": "what player A could improve",
    "complexity": "time and space complexity of their solution"
  },
  "playerBReview": {
    "strengths": "what player B did well",
    "improvements": "what player B could improve",
    "complexity": "time and space complexity of their solution"
  },
  "optimalSolution": "brief description of the optimal approach for this problem"
}`

// The SDK has no built-in request timeout, and a rate-limited or otherwise
// unresponsive judge call would otherwise hang handleMatchEnded indefinitely —
// match-end processing (and therefore the result screen) would never
// complete for either player. Race it against a timeout so a slow/rate-limited
// call always falls through to the heuristic fallback in judgeMatch's catch,
// the same as an outright API error.
const callJudgeAI = async ({ prompt }) => {
  const client = getJudgeClient()
  const completion = await Promise.race([
    client.chat.completions.create({
      model: "openai/gpt-5-nano",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: prompt },
      ],
      temperature: 0.1,
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Judge call timed out after ${JUDGE_TIMEOUT_MS}ms`)), JUDGE_TIMEOUT_MS)
    ),
  ])
  return completion.choices[0]?.message?.content || ""
}

export const judgeMatch = async ({ playerA, playerB, problem }) => {
  /* Neither player got a single test case green — there is nothing to
     separate them on, so this is a draw by definition. Decided here rather
     than left to the model, which will happily pick a "winner" on code style
     alone and hand someone a rating win for a solution that never worked.
     Also saves a pointless API call. */
  if (!(playerA.testsPassed > 0) && !(playerB.testsPassed > 0)) {
    return {
      winner:          "draw",
      playerAId:       playerA.userId,
      playerBId:       playerB.userId,
      reasoning:       "Neither player passed a test case, so the match is a draw.",
      playerAReview:   { strengths: "", improvements: "", complexity: "" },
      playerBReview:   { strengths: "", improvements: "", complexity: "" },
      optimalSolution: "",
    }
  }

  // TEMP — live AI judge calls deliberately disabled. The `openai` package
  // and JUDGE_API were only just wired up on the VPS (was previously
  // erroring with "Cannot find package 'openai'" on every match end because
  // `npm install` was never re-run after that dependency was committed).
  // Now that it's actually able to run, don't let it start silently
  // spending real API credits on every match end until the key/cost is
  // verified — flip this back to true once that's confirmed.
  const AI_JUDGE_ENABLED = false
  if (!AI_JUDGE_ENABLED) {
    const winner =
      playerA.testsPassed > playerB.testsPassed ? playerA.userId :
      playerB.testsPassed > playerA.testsPassed ? playerB.userId :
      "draw"
    return {
      winner,
      playerAId:       playerA.userId,
      playerBId:       playerB.userId,
      reasoning:       "AI judge temporarily disabled — winner decided by test cases passed.",
      playerAReview:   { strengths: "", improvements: "", complexity: "" },
      playerBReview:   { strengths: "", improvements: "", complexity: "" },
      optimalSolution: "",
    }
  }

  try {
    const prompt = `Problem: ${problem.title} (${problem.difficulty})

Player A:
- Language: ${playerA.language || "unknown"}
- Tests Passed: ${playerA.testsPassed}/${playerA.totalTests}
- Submissions: ${playerA.submissionCount}
- Time Taken: ${playerA.timeTaken ? playerA.timeTaken + "s" : "did not solve"}
- Code:
${playerA.code || "No code submitted"}

Player B:
- Language: ${playerB.language || "unknown"}
- Tests Passed: ${playerB.testsPassed}/${playerB.totalTests}
- Submissions: ${playerB.submissionCount}
- Time Taken: ${playerB.timeTaken ? playerB.timeTaken + "s" : "did not solve"}
- Code:
${playerB.code || "No code submitted"}`

    const response = await callJudgeAI({ prompt })

    const cleaned = response.replace(/```json|```/g, "").trim()
    const result  = JSON.parse(cleaned)

    const winnerId =
      result.winner === "playerA" ? playerA.userId :
      result.winner === "playerB" ? playerB.userId :
      "draw"

    return {
        winner:          winnerId,
        playerAId:       playerA.userId,
        playerBId:       playerB.userId,
        reasoning:       result.reasoning,
        playerAReview:   result.playerAReview,
        playerBReview:   result.playerBReview,
        optimalSolution: result.optimalSolution,
    }

  } catch (err) {
    const rateLimited = err?.status === 429
    console.log(`judgeMatch error${rateLimited ? " (rate limited)" : ""}:`, err.message)
    const winner =
      playerA.testsPassed > playerB.testsPassed ? playerA.userId :
      playerB.testsPassed > playerA.testsPassed ? playerB.userId :
      "draw"

    return {
      winner,
      reasoning:      "AI judge unavailable — winner decided by test cases passed.",
      playerAReview:  { strengths: "", improvements: "", complexity: "" },
      playerBReview:  { strengths: "", improvements: "", complexity: "" },
      optimalSolution: "",
    }
  }
}
