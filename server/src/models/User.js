import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    // Stored lowercase so "A@x.com" and "a@x.com" are the same account.
    email: {
      type: String,
      required: true,
      unique: true, // creates the unique index that makes duplicate registration impossible, even in a race
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    // select:false => never returned by default queries. Must be requested with .select('+passwordHash').
    passwordHash: { type: String, required: true, select: false },
    targetRoles: {
      type: [{ type: String, trim: true, maxlength: 80 }],
      default: [],
      validate: { validator: (v) => v.length <= 5, message: 'At most 5 target roles.' },
    },
    preferences: {
      // Consent to send resume / notes / answers to the external AI provider.
      // Later milestones refuse AI calls unless this is true.
      aiDataConsent: {
        given: { type: Boolean, default: false },
        givenAt: { type: Date, default: null },
      },
    },
    // Incrementing this invalidates every JWT issued earlier ("sign out everywhere").
    tokenVersion: { type: Number, default: 0, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        delete ret.tokenVersion;
        return ret;
      },
    },
  },
);

export const User = mongoose.model('User', userSchema);
