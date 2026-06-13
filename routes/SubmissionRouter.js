import exp from "express";
import submissionQueue from "../producers/submissionQueue.js";
import { v4 as uuidv4 } from "uuid"; // npm install uuid

export const SubmissionRouter = exp.Router();

SubmissionRouter.post("/", async (req, res) => {
  try {
    const { language, code, input, testCases = [], matchId, userId } = req.body;

    // Generate a unique jobId for tracking
    const jobId = uuidv4();

    console.log("Submission received:", { language, jobId, matchId, userId });

    await submissionQueue.add("code-execution", {
      language,
      code,
      input: input || "",
      testCases,   // ← was missing
      jobId,       // ← was missing
      matchId,     // ← was missing
      userId,      // ← was missing
    });

    return res.status(200).json({
      success: true,
      message: "Submission Added To Queue",
      jobId,       // ← return this to frontend so it can track the result
    });

  } catch (err) {
    console.log("ERROR In Submission:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});