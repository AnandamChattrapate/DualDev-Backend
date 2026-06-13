import Groq from "groq-sdk"
import {config} from 'dotenv'
config()
const getGroqClient = () => new Groq({ apiKey: process.env.GROQ_API_KEY })

const callGroqAI = async ({ messages }) => {
  const groq = getGroqClient()
  const completion = await groq.chat.completions.create({
    messages,
    model:       "llama-3.3-70b-versatile",
    temperature: 0.3,
  })
  return completion.choices[0]?.message?.content || ""
}

export const judgeMatch = async ({ playerA, playerB, problem }) => {
  try {
    const prompt = `You are a competitive programming judge. Evaluate these two solutions and decide the winner.

Problem: ${problem.title} (${problem.difficulty})

Player A:
- Language: ${playerA.language || "unknown"}
- Tests Passed: ${playerA.testsPassed}/${playerA.totalTests}
- Submissions: ${playerA.submissionCount}
- AI Usage: ${playerA.aiUsageCount}
- Time Taken: ${playerA.timeTaken ? playerA.timeTaken + "s" : "did not solve"}
- Code:
${playerA.code || "No code submitted"}

Player B:
- Language: ${playerB.language || "unknown"}
- Tests Passed: ${playerB.testsPassed}/${playerB.totalTests}
- Submissions: ${playerB.submissionCount}
- AI Usage: ${playerB.aiUsageCount}
- Time Taken: ${playerB.timeTaken ? playerB.timeTaken + "s" : "did not solve"}
- Code:
${playerB.code || "No code submitted"}

Scoring criteria (in order of importance):
1. Test cases passed (most important)
2. Fewer submissions is better
3. Less AI usage is better
4. Faster solve time is better
5. Code quality and efficiency

Respond ONLY with valid JSON in this exact format:
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

    const response = await callGroqAI({
      messages: [{ role: "user", content: prompt }]
    })

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
    console.log("judgeMatch error:", err.message)
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