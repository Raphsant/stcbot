import mongoose from 'mongoose';

let isConnected = false;

export async function connectToMongo() {
  if (isConnected) return;

  await mongoose.connect(process.env.MONGODB_URI);
  isConnected = true;
  console.log('✅ Connected to MongoDB');
}

export default mongoose;
