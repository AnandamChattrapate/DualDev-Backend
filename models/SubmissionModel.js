import mongoose from "mongoose";

const submissionSchema = new mongoose.Schema(
  {
    submissionId: {
      type: String,
      required: [true, "Submission ID is required"],
      unique: true,
      trim: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserModel",
      required: [true, "User is required"],
    },

    problem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProblemModel",
      required: [true, "Problem is required"],
    },

    match: {
      type: String,
      default: null,
    },

    sourceCode: {
      type: String,
      default: "",
    },

    languageId: {
      type: Number,
      required: [true, "Language ID is required"],
    },

    judge0Token: {
      type: String,
      default: "",
    },

    status: {
      type: String,
      enum: {
        values: ["queued", "running", "completed", "error"],
        message: "Invalid submission status",
      },
      default: "queued",
    },

    verdict: {
      type: String,
      default: "",
    },

    stdout: {
      type: String,
      default: "",
    },

    stderr: {
      type: String,
      default: "",
    },

    compileOutput: {
      type: String,
      default: "",
    },

    time: {
      type: Number,
      default: 0,
      min: [0, "Time cannot be negative"],
    },

    memory: {
      type: Number,
      default: 0,
      min: [0, "Memory cannot be negative"],
    },
  },
  {
    timestamps: true,
  }
);

export const SubmissionModel = mongoose.model(
  "SubmissionModel",
  submissionSchema
);
