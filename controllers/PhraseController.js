import { PhraseModel } from "../models/PhraseModel.js";
import { PhraseFeedbackModel } from "../models/PhraseFeedbackModel.js";
import UserModel from "../models/UserModel.js";

const PREFERENCE_KEYS = ["competitive", "friend", "funny", "cold", "genz", "short"];
const LEARNING_RATE = 0.2;

const clamp = (value) => Math.max(-1, Math.min(1, value));

/* GET /api/phrases/feed?limit=6
   Pure random selection of active phrases — no personalization here by
   design (see FUTURE note below). Swapping this for preference-based
   selection later should not require any frontend change: same route,
   same response shape. */
export const getFeed = async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 6));

    const phrases = await PhraseModel.aggregate([
      { $match: { isActive: true } },
      { $sample: { size: limit } },
      { $project: { text: 1, attributes: 1 } },
    ]);

    res.json({
      phrases: phrases.map((p) => ({
        id: p._id,
        text: p.text,
        attributes: p.attributes || {},
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* POST /api/phrases/feedback
   Body: { phraseId, action: "like" | "dislike" }
   Nudges every preference the phrase carries an attribute for:
     like:    preference += 0.2 * attribute_weight
     dislike: preference -= 0.2 * attribute_weight
   Clamped to [-1, 1]. We only ever store the like/dislike event itself —
   no impression or shown-history tracking. */
export const submitFeedback = async (req, res) => {
  try {
    const { phraseId, action } = req.body;

    if (!phraseId || !["like", "dislike"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "phraseId and a valid action ('like' or 'dislike') are required",
      });
    }

    const phrase = await PhraseModel.findById(phraseId);
    if (!phrase) {
      return res.status(404).json({ success: false, message: "Phrase not found" });
    }

    const user = await UserModel.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const sign = action === "like" ? 1 : -1;
    const attributes = phrase.attributes || {};

    for (const key of PREFERENCE_KEYS) {
      const weight = attributes[key];
      if (typeof weight !== "number") continue;
      user.preferences[key] = clamp(user.preferences[key] + sign * LEARNING_RATE * weight);
    }

    await user.save();
    await PhraseFeedbackModel.create({ user: user._id, phrase: phrase._id, action });

    res.json({ success: true, preferences: user.preferences });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
