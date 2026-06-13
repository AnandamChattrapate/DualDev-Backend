import mongoose from "mongoose";

const problemSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Problem title is required"],
      trim: true,
    },

    slug: {
      type: String,
      required: [true, "Problem slug is required"],
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },

    topic: {
      type: String,
      required: [true, "Problem topic is required"],
    },

    tags: {
      type: [String],
      default: [],
    },

    difficulty: {
      type: String,
      required: [true, "Difficulty is required"],
      enum: {
        values: ["Easy", "Medium", "Hard"],
        message: "Difficulty must be Easy, Medium, or Hard",
      },
    },

    difficultyScore: {
      type: Number,
      required: [true, "Difficulty score is required"],
      min: [0, "Difficulty score cannot be negative"],
    },

    description: {
      type: String,
      required: [true, "Description is required"],
    },

    inputFormat: {
      type: String,
      required: [true, "Input format is required"],
    },

    outputFormat: {
      type: String,
      required: [true, "Output format is required"],
    },

    constraints: {
      type: [String],
      default: [],
    },

    timeLimit: {
      type: Number,
      default: 1,
      min: [1, "Time limit must be at least 1 second"],
    },

    memoryLimit: {
      type: Number,
      default: 128,
      min: [1, "Memory limit must be at least 1 MB"],
    },

    judgeType: {
      type: String,
      enum: {
        values: ["exact", "custom"],
        message: "Judge type must be exact or custom",
      },
      default: "exact",
    },

    sampleTestCases: [
      {
        id: {
          type: Number,
          required: [true, "Sample testcase ID is required"],
        },

        input: {
          type: String,
          required: [true, "Sample testcase input is required"],
        },

        output: {
          type: String,
          required: [true, "Sample testcase output is required"],
        },

        explanation: {
          type: String,
          default: "",
        },
      },
    ],

    hiddenTestCases: [
      {
        id: {
          type: Number,
          required: [true, "Hidden testcase ID is required"],
        },

        input: {
          type: String,
          required: [true, "Hidden testcase input is required"],
        },

        output: {
          type: String,
          required: [true, "Hidden testcase output is required"],
        },

        weight: {
          type: Number,
          default: 20,
          min: [1, "Weight must be greater than 0"],
        },

        isHidden: {
          type: Boolean,
          default: true,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);
export const ProblemModel = mongoose.model(
  "ProblemModel",
  problemSchema
);