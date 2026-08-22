import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { getFeed, submitFeedback } from "../controllers/PhraseController.js";

const router = express.Router();

router.get("/feed", getFeed);
router.post("/feedback", authMiddleware, submitFeedback);

export const PhraseRouter = router;
