import mongoose from 'mongoose';

export async function connectDB(uri) {
  mongoose.set('strictQuery', true);
  // Fail fast (10s) instead of hanging forever if Atlas is unreachable / IP not allow-listed.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
