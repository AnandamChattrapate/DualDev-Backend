import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import {
  joinQueue,
  findMatch,
  leaveQueue,
  queueCount,
  createRoom,
  joinRoom,
} from "../controllers/MatchmakingController.js";

const router = express.Router();

router.post("/join",        authMiddleware, joinQueue)
router.get("/find",         authMiddleware, findMatch)
router.delete("/leave",     authMiddleware, leaveQueue)
router.get("/count",        queueCount)
router.post("/create-room", authMiddleware, createRoom)  // ← new
router.post("/join-room",   authMiddleware, joinRoom)    // ← new

export const MatchmakingRouter = router;