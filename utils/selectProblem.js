import UserModel from "../models/UserModel.js"
import { ProblemModel } from "../models/ProblemModel.js"

export const selectProblem = async (
  topic,
  difficulty,
  player1Id,
  player2Id
) => {

  try {

    console.log("\n========== selectProblem START ==========")

    console.log("INPUTS:")
    console.log({
      topic,
      difficulty,
      player1Id,
      player2Id
    })

    console.log("\nDATABASE INFO:")
    console.log("Collection:", ProblemModel.collection.name)
    console.log("DB:", ProblemModel.db.name)

    // ---------------- FETCH USERS ----------------

    console.log("\nFETCHING USERS...")

    const [user1, user2] = await Promise.all([
      UserModel.findById(player1Id).select("solvedProblems"),
      UserModel.findById(player2Id).select("solvedProblems"),
    ])

    console.log("USER 1 FOUND:", !!user1)
    console.log("USER 2 FOUND:", !!user2)

    console.log("\nRAW solvedProblems:")
    console.log("user1:", user1?.solvedProblems)
    console.log("user2:", user2?.solvedProblems)

    // ---------------- PROCESS SOLVED IDS ----------------

    const solvedIds = []

    const processSolvedProblems = (arr, userLabel) => {

      if (!Array.isArray(arr)) {
        console.log(`${userLabel} solvedProblems is NOT array`)
        return
      }

      arr.forEach((id, index) => {

        console.log(`${userLabel} solvedProblems[${index}] =`, id)

        if (!id) {
          console.log(`❌ NULL/UNDEFINED ID FOUND at ${userLabel}[${index}]`)
          return
        }

        try {

          const converted = id.toString()

          console.log(`✅ Converted ID:`, converted)

          solvedIds.push(converted)

        } catch (err) {

          console.log(`❌ FAILED converting ID at ${userLabel}[${index}]`)
          console.log("VALUE:", id)
          console.log("ERROR:", err.message)

        }

      })

    }

    processSolvedProblems(user1?.solvedProblems, "USER1")
    processSolvedProblems(user2?.solvedProblems, "USER2")

    const solvedByEither = new Set(solvedIds)

    console.log("\nFINAL solvedByEither:")
    console.log([...solvedByEither])

    // ---------------- FIND PROBLEMS ----------------

    console.log("\nSTEP 1 QUERY")
    console.log({
      topic,
      difficulty,
      excludedIds: [...solvedByEither]
    })

    let problems = await ProblemModel.find({
      topic,
      difficulty,
      _id: { $nin: [...solvedByEither] }
    })

    console.log("STEP 1 COUNT:", problems.length)

    // ---------------- FALLBACK 1 ----------------

    if (!problems.length) {

      console.log("\nSTEP 2 FALLBACK")

      problems = await ProblemModel.find({
        difficulty,
        _id: { $nin: [...solvedByEither] }
      })

      console.log("STEP 2 COUNT:", problems.length)
    }

    // ---------------- FALLBACK 2 ----------------

    if (!problems.length) {

      console.log("\nSTEP 3 FALLBACK -> FETCH ALL")

      problems = await ProblemModel.find({})

      console.log("STEP 3 COUNT:", problems.length)
    }

    // ---------------- FINAL ----------------

    console.log("\nFINAL PROBLEMS FOUND:")

    problems.forEach((p, index) => {
      console.log(`${index + 1}.`, {
        id: p?._id?.toString(),
        title: p?.title,
        difficulty: p?.difficulty,
        topic: p?.topic,
      })
    })

    if (!problems.length) {

      console.log("❌ NO PROBLEMS FOUND")
      return null

    }

    const selectedProblem =
      problems[Math.floor(Math.random() * problems.length)]

    console.log("\n✅ SELECTED PROBLEM:")
    console.log({
      id: selectedProblem?._id?.toString(),
      title: selectedProblem?.title,
      difficulty: selectedProblem?.difficulty,
      topic: selectedProblem?.topic,
    })

    console.log("========== selectProblem END ==========\n")

    return selectedProblem

  } catch (error) {

    console.log("\n❌ ERROR INSIDE selectProblem")
    console.log("MESSAGE:", error.message)
    console.log("STACK:", error.stack)

    return null
  }
}