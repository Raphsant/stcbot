# Engagement Tracking — Bot Changes

**Companion to:** `engagement-tracking-spec.md` (in `stc-front` repo)
**Repo:** `stcbot`
**Status:** Proposed

This document covers everything that needs to change in the **bot repo** to support the new engagement tracking. Read the main spec first for context on _why_ — this one focuses on the _what_.

## TL;DR

You're doing two things:

1. Adding a new Mongoose model (`MessageActivity`) that mirrors the one in `stc-front`.
2. Replacing the existing `messageCreate` handler so it writes to a daily bucket instead of incrementing a lifetime counter.

That's basically it. No new dependencies, no infrastructure changes, no Discord intent changes.

---

## What stays the same

- The bot already connects to MongoDB via `mongo-client.js` — reuse it.
- The bot already follows a `models/*.js` pattern with raw `mongoose.model()` (e.g. `models/DiscordUser.js`) — match it.
- The `messageCreate` handler stays fire-and-forget. Don't `await` it. The whole point of the current pattern is that message handling never blocks the event loop, and that's correct.
- All existing functionality (slash commands, button handlers, ClickFunnels webhooks, Zoom registration POST to `stc-front`) is untouched.

## Required Discord intents

Already enabled. The bot has `GatewayIntentBits.GuildMessages` in its `Client` constructor, which is what `messageCreate` needs.

**Note on `MessageContent` intent:** to read `message.content.length` (for the `charSum` field), you _technically_ need the `MessageContent` privileged intent. Check whether the bot already has it enabled in the Discord Developer Portal. If not, you have two options:
- **Enable it** in the portal + add `GatewayIntentBits.MessageContent` to the intents array. This is the cleanest path if you want char-length tracking.
- **Skip `charSum`** for now. You can still track per-day, per-channel message counts without ever reading content. Drop `charSum` from the schema and the upsert. This is the safer option if you don't want to deal with the privileged-intent re-verification process.

If you skip `charSum`, the main spec's "average message length" / quality-filter ideas just become a future enhancement. Everything else still works.

---

## File 1 — New model

Create `models/MessageActivity.js` in the bot repo. This must match the schema in `stc-front`'s `server/models/MessageActivity.schema.ts` exactly, including the `collection: 'messageActivity'` option, so both apps point at the same Mongo collection.

```js
// models/MessageActivity.js
import mongoose from 'mongoose';

const messageActivitySchema = new mongoose.Schema({
  userId:        { type: String, required: true, index: true },
  date:          { type: Date,   required: true },
  channelId:     { type: String, required: true },
  channelName:   { type: String },
  count:         { type: Number, required: true, default: 0 },
  charSum:       { type: Number, required: true, default: 0 }, // omit if skipping MessageContent intent
  lastMessageAt: { type: Date },
});

// Compound unique index — one bucket per user/day/channel
messageActivitySchema.index(
  { userId: 1, date: 1, channelId: 1 },
  { unique: true }
);

export const MessageActivity = mongoose.model('MessageActivity', messageActivitySchema);
```

The compound index will be created automatically by Mongoose on first connect (or you can create it manually in Mongo if you prefer).

---

## File 2 — Update `index.js`

Two small edits.

### Edit 1: Import the new model

Near the existing `DiscordUser` import:

```js
// before
import { DiscordUser } from "./models/DiscordUser.js";

// after
import { DiscordUser } from "./models/DiscordUser.js";
import { MessageActivity } from "./models/MessageActivity.js";
```

### Edit 2: Replace the `messageCreate` handler

**Current handler** (at the bottom of `index.js`):

```js
client.on('messageCreate', message => {
  if (message.author.bot) return;
  //this is fire and forget, let's not await it just to improve speed.
  DiscordUser.updateOne({
    _id: message.author.id,
  }, {$inc: {messageCount: 1}}).catch(console.error);
})
```

**New handler — Phase 1 (run in parallel with the old one):**

```js
client.on('messageCreate', message => {
  if (message.author.bot) return;

  // Existing lifetime counter — keep during migration, remove in Phase 4.
  DiscordUser.updateOne(
    { _id: message.author.id },
    { $inc: { messageCount: 1 } }
  ).catch(console.error);

  // New daily-bucket activity tracking.
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);

  MessageActivity.updateOne(
    { userId: message.author.id, date, channelId: message.channelId },
    {
      $inc: { count: 1, charSum: message.content.length }, // drop charSum if no MessageContent intent
      $set: {
        lastMessageAt: new Date(),
        channelName: message.channel.name,
      },
    },
    { upsert: true }
  ).catch(console.error);
});
```

Both writes are fire-and-forget. They run concurrently. If either fails, it logs to console and the bot keeps going — same behavior as today.

**Phase 4 cleanup (after the new system is verified, ~2 weeks):**

Remove the `DiscordUser.updateOne` block. The handler reduces to just the `MessageActivity` upsert.

---

## Testing

The bot doesn't have a test suite right now, so there's nothing to add there. To verify locally:

1. Start the bot pointed at a dev Mongo (or your prod URI if you're brave — the writes are additive and harmless).
2. Send a few messages in the test Discord server.
3. Query the `messageActivity` collection:
   ```
   db.messageActivity.find({ userId: 'YOUR_DISCORD_ID' }).pretty()
   ```
4. You should see one document per channel you posted in today, with `count` matching the number of messages you sent.
5. Send another message in the same channel — `count` should increment, not create a new doc.
6. Send a message in a different channel — should create a new doc.

If `charSum` is always `0`, you forgot to enable the `MessageContent` intent (or you're skipping it intentionally — that's fine).

---

## Things to watch for

- **Time zone gotcha.** `setUTCHours(0,0,0,0)` truncates to UTC midnight. The `stc-front` aggregation also uses UTC. Don't mix in local time anywhere — always UTC for the bucket key. (Display formatting is a UI concern, handled in the frontend.)
- **`message.channel.name`** can be `undefined` for some channel types (DMs, threads under certain conditions). The schema allows it to be missing — that's fine. Just be aware that the channel breakdown in the UI may show "Unknown" or need to fall back to `channelId`.
- **Bot DMs.** If the bot receives DMs, those will get logged with a `channelId` that's a DM channel ID. Probably not what you want. If this matters, add `if (!message.guild) return;` after the bot-author check to skip DMs entirely.
- **Threads.** Messages in threads have a `channelId` that's the thread ID, not the parent channel. If you want thread messages to roll up to the parent channel, use `message.channel.parentId ?? message.channelId`. Decide based on how granular you want the breakdown.
- **Index creation on a large collection.** First time the bot starts after this change, Mongoose will try to create the compound index. On an empty collection this is instant. Not a concern here since the collection is new.

---

## Deployment order

This matters — do it in this order to avoid a window where the frontend expects data the bot isn't writing yet:

1. **Bot first.** Deploy the changes above. Verify rows appear in `messageActivity` for ~24 hours.
2. **Then frontend.** Deploy `stc-front` Phase 1 (just the model + smoke test — no UI changes yet, so nothing breaks if data is sparse).
3. Continue with `stc-front` Phases 2–4 per the main spec.
4. **Bot Phase 4 cleanup last.** Remove the `DiscordUser.messageCount` $inc only after the frontend has fully migrated and the field is no longer read anywhere.

---

## Acceptance criteria

- [ ] `models/MessageActivity.js` exists and matches the `stc-front` schema
- [ ] `messageCreate` handler writes to `MessageActivity` on every non-bot message
- [ ] Compound unique index `{ userId, date, channelId }` exists on the collection
- [ ] Existing `DiscordUser.messageCount` increment still runs in parallel (Phase 1)
- [ ] Bot stays fire-and-forget — no new `await` in the message handler
- [ ] Manual smoke test: sending messages in 2+ channels produces 2+ rows, and re-sending in the same channel increments `count`
