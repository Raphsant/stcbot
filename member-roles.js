// HTTP handlers that change a member's roles or add them to the server, for the
// sibling apps that are not allowed to talk to Discord themselves:
//
//   stc-payments  POST|DELETE /api/members/:discordId/alpha
//   stc-billing   PUT|DELETE  /api/members/:discordId/roles/:roleId
//                 PUT         /api/members/:discordId            (join the server)
//
// Kept out of index.js, and with no imports of its own, so it can be exercised
// with a fake guild: index.js passes in the two things that need the live bot
// (`getGuild`) and the database (`saveRoles`). Routes are mounted there, behind
// requireApiKey.

const SNOWFLAKE = /^\d{15,21}$/;

// Discord API error codes this file answers for.
const UNKNOWN_MEMBER = 10007;
const UNKNOWN_USER = 10013;
const MAX_GUILDS = 30001;
const USER_BANNED = 40007;
const MISSING_PERMISSIONS = 50013;
const INVALID_OAUTH_TOKEN = 50025;
const MISSING_OAUTH_SCOPE = 50026;

/**
 * The only roles the generic endpoint may grant or remove: MANAGED_ROLE_IDS,
 * comma-separated. This is the safety property of the whole API: a leaked
 * BOT_API_KEY must not be able to hand out the admin role. Unset = none.
 */
export function managedRoleIds(env = process.env) {
  return new Set(
    String(env.MANAGED_ROLE_IDS ?? '')
      .split(',')
      .map(id => id.trim())
      .filter(id => SNOWFLAKE.test(id)),
  );
}

/**
 * @param {object} deps
 * @param {() => Promise<import('discord.js').Guild>} deps.getGuild  resolves once the bot is ready
 * @param {(discordId: string, roleNames: string[]) => Promise<unknown>} deps.saveRoles  writes DiscordUser.roles
 * @param {NodeJS.ProcessEnv} [deps.env]
 */
export function createMemberRoleHandlers({getGuild, saveRoles, env = process.env}) {
  /** The member, or null when they are not in the server. */
  async function fetchMember(guild, discordId) {
    try {
      return await guild.members.fetch(discordId);
    } catch (err) {
      if (err?.code === UNKNOWN_MEMBER || err?.code === UNKNOWN_USER) return null;
      throw err;
    }
  }

  /**
   * Adds or removes one role. `resolveRole(roles)` picks it from the guild's
   * roles and returns either the role or `{status, error}` to answer with.
   * Succeeds (200) when the member already has / lacks the role: Discord treats
   * both as no-ops. Writes DiscordUser.roles right away so the dashboards see
   * the change on their next read instead of waiting on guildMemberUpdate.
   */
  async function setMemberRole(req, res, add, resolveRole, label) {
    try {
      const {discordId} = req.params;
      if (!SNOWFLAKE.test(discordId)) {
        return res.status(400).json({error: 'invalid_id'});
      }

      const guild = await getGuild();
      const role = resolveRole(await guild.roles.fetch());
      if (!role || role.error) {
        return res.status(role?.status ?? 500).json({error: role?.error ?? 'role_not_found'});
      }

      const member = await fetchMember(guild, discordId);
      if (!member) return res.status(404).json({error: 'not_in_guild'});

      const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 400) : undefined;
      let updated;
      try {
        updated = add ? await member.roles.add(role, reason) : await member.roles.remove(role, reason);
      } catch (err) {
        // The bot's own role sits below this one, or it lacks Manage Roles.
        if (err?.code === MISSING_PERMISSIONS) {
          return res.status(502).json({error: 'missing_permissions'});
        }
        throw err;
      }

      const roleNames = updated.roles.cache.map(r => r.name);
      await saveRoles(discordId, roleNames);
      res.status(200).json({id: discordId, roles: roleNames});
    } catch (e) {
      console.error(`Error en ${label} (${add ? 'add' : 'remove'}):`, e.message);
      res.status(500).json({error: 'internal'});
    }
  }

  /** The "Alpha" role, by ALPHA_ROLE_ID or exact name, so the separate "Alpha." tier is never touched. */
  function resolveAlpha(roles) {
    const alpha = env.ALPHA_ROLE_ID ? roles.get(env.ALPHA_ROLE_ID) : roles.find(r => r.name === 'Alpha');
    return alpha ?? {status: 500, error: 'alpha_role_not_found'};
  }

  return {
    /** POST|DELETE /api/members/:discordId/alpha */
    setAlphaRole: add => (req, res) => setMemberRole(req, res, add, resolveAlpha, '/api/members/:discordId/alpha'),

    /** PUT|DELETE /api/members/:discordId/roles/:roleId */
    setManagedRole: add => (req, res) => {
      const {roleId} = req.params;
      if (!SNOWFLAKE.test(roleId)) {
        return res.status(400).json({error: 'invalid_id'});
      }
      // Checked before anything touches Discord.
      if (!managedRoleIds(env).has(roleId)) {
        return res.status(403).json({error: 'role_not_allowed'});
      }
      // 422, not 404: the callers read a bare 404 as "this bot has no such endpoint".
      const resolve = roles => roles.get(roleId) ?? {status: 422, error: 'role_not_found'};
      return setMemberRole(req, res, add, resolve, '/api/members/:discordId/roles/:roleId');
    },

    /**
     * PUT /api/members/:discordId  { accessToken }
     * Adds a buyer to the server with the OAuth token from their login
     * (guilds.join scope). Only works when that login used this bot's own
     * Discord application, and the bot has Create Invite in the guild.
     * Gives no role: the caller asks for that separately.
     */
    joinGuild: async (req, res) => {
      try {
        const {discordId} = req.params;
        if (!SNOWFLAKE.test(discordId)) {
          return res.status(400).json({error: 'invalid_id'});
        }
        const accessToken = req.body?.accessToken;
        if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 500) {
          return res.status(400).json({error: 'invalid_token'});
        }

        const guild = await getGuild();
        if (await fetchMember(guild, discordId)) {
          return res.status(200).json({id: discordId, joined: false});
        }

        let member;
        try {
          // fetchWhenExisting: false → null (not a member object) if they joined in between.
          member = await guild.members.add(discordId, {accessToken, fetchWhenExisting: false});
        } catch (err) {
          if (err?.code === INVALID_OAUTH_TOKEN || err?.code === MISSING_OAUTH_SCOPE) {
            return res.status(400).json({error: 'invalid_token'});
          }
          if (err?.code === MISSING_PERMISSIONS) return res.status(502).json({error: 'missing_permissions'});
          if (err?.code === USER_BANNED) return res.status(403).json({error: 'banned'});
          if (err?.code === MAX_GUILDS) return res.status(409).json({error: 'max_guilds'});
          throw err;
        }
        res.status(member ? 201 : 200).json({id: discordId, joined: Boolean(member)});
      } catch (e) {
        console.error('Error en PUT /api/members/:discordId:', e.message);
        res.status(500).json({error: 'internal'});
      }
    },
  };
}
