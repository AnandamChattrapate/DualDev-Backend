import mongoose from "mongoose";

const phraseFeedbackSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserModel",
      required: [true, "User is required"],
    },

    phrase: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PhraseModel",
      required: [true, "Phrase is required"],
    },

    action: {
      type: String,
      required: [true, "Action is required"],
      enum: {
        values: ["like", "dislike"],
        message: "Action must be like or dislike",
      },
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export const PhraseFeedbackModel = mongoose.model("PhraseFeedbackModel", phraseFeedbackSchema);
