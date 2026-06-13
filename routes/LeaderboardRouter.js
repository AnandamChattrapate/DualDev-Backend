import express from "express";
import {
  updateLeaderboard,
  leaderboard,
  leaderboardWithMe,
  playerRank,
} from "../controllers/LeaderboardController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";


const router=express.Router()
router.post("/update",updateLeaderboard);
router.get("/",                  leaderboard);
router.get("/me",  authMiddleware, leaderboardWithMe);
router.get("/rank/:userId",      playerRank);

export const LeaderboardRouter = router;
