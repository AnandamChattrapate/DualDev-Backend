import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      minlength: [3, "Username must be at least 3 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },
    passwordHash: {
      type: String,
      required: [true, "Password hash is required"],
    },
    rating: {
      type: Number,
      default: 1000,
      min: [0, "Rating cannot be negative"],
    },
    wins: {
      type: Number,
      default: 0,
      min: [0, "Wins cannot be negative"],
    },
    losses: {
      type: Number,
      default: 0,
      min: [0, "Losses cannot be negative"],
    },
    afk: {
      type: Boolean,
      default: false,
    },
    avatar: {
      type: String,
      default: "",
    },
    solvedProblems: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ProblemModel",
      },
    ],

    accuracy: {
      type: Number,
      default: 0,
      min: [0, "Accuracy cannot be negative"],
      max: [100, "Accuracy cannot exceed 100"],
    },
    avgSolveTime: {
      type: Number,
      default: 0,
      min: [0, "Avg solve time cannot be negative"],
    },
    totalAIUsage: {
      type: Number,
      default: 0,
      min: [0, "AI usage cannot be negative"],
    },
    totalMatches: {
      type: Number,
      default: 0,
      min: [0, "Total matches cannot be negative"],
    },
    perfectSolves: {
      type: Number,
      default: 0,
      min: [0, "Perfect solves cannot be negative"],
    },

    submissions: [
      {
        problem:    { type: mongoose.Schema.Types.ObjectId, ref: "ProblemModel" },
        matchId:    { type: String, default: null },
        code:       { type: String, required: true },
        language:   { type: String, required: true },
        verdict:    { type: String, required: true },
        testsPassed:{ type: Number, default: 0 },
        totalTests: { type: Number, default: 0 },
        submittedAt:{ type: Date,   default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

const UserModel = mongoose.model("UserModel", userSchema);

export default UserModel;