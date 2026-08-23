import express from "express"
import {
  createMatch,
  fetchMatchState,
  fetchMatchResult,
  fetchMatchWithTimer,
  updateSubmission,
  endMatch,
  getMyActiveMatch,
  debugActiveMatch,
} from "../controllers/MatchStateController.js"
import { authMiddleware } from "../middlewares/authMiddleware.js"

const router = express.Router()

router.post("/create",        authMiddleware, createMatch)
router.get("/active/me",      authMiddleware, getMyActiveMatch)
router.get("/debug/active",   authMiddleware, debugActiveMatch)
router.get("/:matchId",        authMiddleware, fetchMatchState)
router.get("/:matchId/result", authMiddleware, fetchMatchResult)
router.get("/:matchId/timer",  authMiddleware, fetchMatchWithTimer)
router.post("/submission",    authMiddleware, updateSubmission)
router.post("/end",           authMiddleware, endMatch)

export const MatchStateRouter = router
