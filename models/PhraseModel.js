import mongoose from "mongoose";

const phraseSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: [true, "Phrase text is required"],
      trim: true,
    },

    /* Flexible bag of style weights, e.g. { competitive: 1, genz: 0.9, short: 1 }.
       A phrase only needs to carry the attributes it's actually tagged with. */
    attributes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export const PhraseModel = mongoose.model("PhraseModel", phraseSchema);
