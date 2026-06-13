import express from "express"
import { authMiddleware } from "../middlewares/authMiddleware.js"
import { getHint } from "../controllers/AIController.js"
const router = express.Router()

router.post("/hint", authMiddleware, getHint)
export const AIRouter = router