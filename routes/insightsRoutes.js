import express from "express";
import {
  summary,
  onlineTimeseries,
  signupsTimeseries,
  matchesTimeseries,
  recentMatches,
} from "../controllers/insightsController.js";

const router = express.Router();

router.get("/summary",            summary);
router.get("/online-timeseries",  onlineTimeseries);
router.get("/signups-timeseries", signupsTimeseries);
router.get("/matches-timeseries", matchesTimeseries);
router.get("/recent-matches",     recentMatches);

export default router;
