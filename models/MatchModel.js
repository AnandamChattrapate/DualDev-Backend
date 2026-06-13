import mongoose from "mongoose";

const matchSchema = new mongoose.Schema(
  {
    matchId: {
      type:     String,
      required: [true, "Match ID is required"],
      unique:   true,
      trim:     true,
    },

    players: [
      {
        user: {
          type:     mongoose.Schema.Types.ObjectId,
          ref:      "UserModel",
          required: [true, "Player user is required"],
        },
        result: {
          type:    String,
          enum:    { values: ["won", "lost", "draw"], message: "Result must be won, lost, or draw" },
          default: "draw",
        },
      },
    ],

    problem: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "ProblemModel",
      required: false,
      default:  null,
    },

    winner: {
      type:    String,
      default: null,
    },

    status: {
      type:    String,
      enum:    { values: ["active", "finished", "cancelled"], message: "Invalid match status" },
      default: "active",
    },

    aiReview: {
      winner:         { type: String,  default: null },
      reasoning:      { type: String,  default: "" },
      optimalSolution:{ type: String,  default: "" },
      playerAReview: {
        strengths:    { type: String,  default: "" },
        improvements: { type: String,  default: "" },
        complexity:   { type: String,  default: "" },
      },
      playerBReview: {
        strengths:    { type: String,  default: "" },
        improvements: { type: String,  default: "" },
        complexity:   { type: String,  default: "" },
      },
    },

    startedAt:  { type: Date,   default: Date.now },
    finishedAt: { type: Date,   default: null },

    submissionsLog: [
      {
        user:      { type: mongoose.Schema.Types.ObjectId, ref: "UserModel", required: true },
        verdict:   { type: String, required: true },
        timestamp: { type: Date,   default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

export const MatchModel = mongoose.model("MatchModel", matchSchema);