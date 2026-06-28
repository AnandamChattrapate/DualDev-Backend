import { describe, it, expect } from "vitest"
import { resolveCascadeTier } from "../utils/selectProblem.js"

describe("resolveCascadeTier", () => {
  it("prefers tier 1 (topic+difficulty) when it has any candidates", () => {
    const problems = [{ _id: "p1" }]
    const difficultyMatches = [{ _id: "d1" }]
    const allProblems = [{ _id: "a1" }]

    const result = resolveCascadeTier(problems, difficultyMatches, allProblems)

    expect(result).toEqual({ problems, tier: "topic+difficulty" })
  })

  it("falls back to tier 2 (difficulty-only) when tier 1 is empty", () => {
    const difficultyMatches = [{ _id: "d1" }, { _id: "d2" }]
    const allProblems = [{ _id: "a1" }]

    const result = resolveCascadeTier([], difficultyMatches, allProblems)

    expect(result).toEqual({ problems: difficultyMatches, tier: "difficulty" })
  })

  it("falls back to tier 3 (any) when tiers 1 and 2 are both empty", () => {
    const allProblems = [{ _id: "a1" }, { _id: "a2" }]

    const result = resolveCascadeTier([], [], allProblems)

    expect(result).toEqual({ problems: allProblems, tier: "any" })
  })

  it("returns an empty problems array and tier 'any' when every tier is empty", () => {
    const result = resolveCascadeTier([], [], [])

    expect(result).toEqual({ problems: [], tier: "any" })
  })
})
