import Groq from "groq-sdk"
import { config } from 'dotenv'

config()

const getGroqClient = () => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not defined in environment variables")
  }
  return new Groq({ apiKey: process.env.GROQ_API_KEY})
}

const callGroqAI = async ({ messages }) => {
  try {
    const groq = getGroqClient()
    const completion = await groq.chat.completions.create({
      messages,
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
    })
    return completion.choices[0]?.message?.content || ""
  } catch (error) {
    console.error("Error calling Groq API:", error)
    throw error
  }
}

export const getAIHint = async ({ question, problemTitle, description, code, language }) => {
  const prompt = `You are a helpful coding assistant during a competitive programming match. 
The user is solving a problem and needs help. Give guidance WITHOUT revealing the complete solution.

Problem: ${problemTitle}
Description: ${description}

User's current code (${language}):
${code || "No code written yet"}

User's question: ${question}

Rules:
- Give a helpful hint or explanation
- Do NOT write the complete solution
- Do NOT write more than 5-6 lines of code as example
- Keep response concise — under 150 words
- Focus on the concept or approach, not the exact implementation`

  // Only log first/last few chars of API key for security
  const apiKey = process.env.GROQ_API_KEY
  if (apiKey) {
    console.log(`Using API key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 5)}`)
  } else {
    console.error("GROQ_API_KEY not found in environment variables")
  }
  
  const response = await callGroqAI({
    messages: [{ role: "user", content: prompt }]
  })

  return response
}