import {createClient} from 'redis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
export const client = createClient({url: redisUrl});

client.on('error', (err) => console.error('Redis Client Error', err));

//connect right away
await client.connect();

/**
 * @param {Function} fetchNewTokenFn
 *
 */

export async function getCachedZoomToken(key, fetchNewTokenFn) {
  const CACHE_KEY = `zoom_access_token:${key}`;

  //We check redis first
  const cachedToken = await client.get(CACHE_KEY);
  if (cachedToken) {
    console.log(`Using cached Zoom token for ${key}`);
    return cachedToken;
  }
  //if no token
  console.log(`No cached Zoom token found for ${key}, fetching new one`);
  const newToken = await fetchNewTokenFn();


  //now we store in redis
  console.log(`Storing new Zoom token for ${key} in redis`);
  await client.set(CACHE_KEY, newToken, {EX: 3540});
  return newToken;
}


/**
 * Tracks a user joining a meeting.
 * @param {string} name - User's display name
 * @param {string} meetingId - The ID of the meeting joined
 */
export async function trackJoin(name, meetingId) {
  const now = new Date();
  // Using Central Time (Chicago) for the date key as per the bot's convention
  const dateKey = now.toLocaleDateString('en-US', { timeZone: 'America/Chicago' }).replace(/\//g, '-');
  const redisKey = `zoom_daily_joins:${dateKey}`;

  const joinData = JSON.stringify({
    name,
    meetingId,
    timestamp: now.toISOString()
  });

  await client.rPush(redisKey, joinData);
  // Set expiry to 7 days to allow for some historical data but keep it clean
  await client.expire(redisKey, 60 * 60 * 24 * 7);
}

/**
 * Retrieves joins for a specific date.
 * @param {string} dateKey - The date key in MM-DD-YYYY format
 */
export async function getDailyJoins(dateKey) {
  const redisKey = `zoom_daily_joins:${dateKey}`;
  const joins = await client.lRange(redisKey, 0, -1);
  return joins.map(j => JSON.parse(j));
}

export async function saveMessageMap(messageId, meetingId){
  const mapEntry = JSON.stringify({
    meetingId,
    messageId
  })
  const redisKey = "message_map_zoom_test"
  await client.rPush(redisKey, mapEntry)
}

export async function getMessageMap(){
  const redisKey = "message_map_zoom_test"
  const message_map = await client.lRange(redisKey,0,-1)
  return message_map.map(j => JSON.parse(j))
}
