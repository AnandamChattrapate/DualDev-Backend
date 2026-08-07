import {
  getSummary,
  getOnlineTimeseries,
  getSignupsTimeseries,
  getMatchesTimeseries,
  getRecentMatches,
} from "../services/insightsService.js";

export const summary = async (req, res, next) => {
  try {
    const data = await getSummary();
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
};

export const onlineTimeseries = async (req, res, next) => {
  try {
    const hours = Number(req.query.hours) || 24;
    const points = await getOnlineTimeseries(hours);
    res.json({ success: true, points });
  } catch (err) {
    next(err);
  }
};

export const signupsTimeseries = async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const points = await getSignupsTimeseries(days);
    res.json({ success: true, points });
  } catch (err) {
    next(err);
  }
};

export const matchesTimeseries = async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const points = await getMatchesTimeseries(days);
    res.json({ success: true, points });
  } catch (err) {
    next(err);
  }
};

export const recentMatches = async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const matches = await getRecentMatches(limit);
    res.json({ success: true, matches });
  } catch (err) {
    next(err);
  }
};
