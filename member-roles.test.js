import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemberRoleHandlers, managedRoleIds } from './member-roles.js';

// The handlers run against a fake guild: nothing here talks to Discord or Mongo.

const DELTA = '111111111111111111', ALPHA = '222222222222222222', ADMIN = '333333333333333333';
const GHOST = '444444444444444444';    // allowed, but the guild has no such role
const TOO_HIGH = '555555555555555555'; // allowed, but above the bot's own role
const MEMBER = '900000000000000010', OUTSIDER = '900000000000000011', BANNED = '900000000000000012';

const apiError = (code) => Object.assign(new Error(`DiscordAPIError[${code}]`), { code });

function makeGuild() {
  const names = { [DELTA]: 'Delta', [ALPHA]: 'Alpha', [ADMIN]: 'Admin', [TOO_HIGH]: 'Too high' };
  const roles = new Map(Object.entries(names).map(([id, name]) => [id, { id, name }]));
  roles.find = (fn) => [...roles.values()].find(fn);
  const members = new Map();
  const audit = [];
  const makeMember = (id) => {
    const cache = new Map([['everyone', { name: 'everyone' }]]);
    cache.map = (fn) => [...cache.values()].map(fn);
    const member = {
      id,
      roles: {
        cache,
        async add(role, reason) {
          if (role.id === TOO_HIGH) throw apiError(50013);
          cache.set(role.name, { name: role.name });
          audit.push(['add', id, role.name, reason]);
          return member;
        },
        async remove(role, reason) {
          cache.delete(role.name);
          audit.push(['remove', id, role.name, reason]);
          return member;
        },
      },
    };
    return member;
  };
  members.set(MEMBER, makeMember(MEMBER));
  return {
    audit,
    roles: { fetch: async () => roles },
    members: {
      async fetch(id) {
        if (!members.has(id)) throw apiError(10007);
        return members.get(id);
      },
      async add(id, { accessToken, fetchWhenExisting }) {
        assert.equal(fetchWhenExisting, false);
        if (accessToken === 'bad') throw apiError(50025);
        if (accessToken === 'noscope') throw apiError(50026);
        if (id === BANNED) throw apiError(40007);
        const member = makeMember(id);
        members.set(id, member);
        return member;
      },
    },
  };
}

function setup(env = { MANAGED_ROLE_IDS: ` ${DELTA}, ${GHOST},${TOO_HIGH}, not-an-id ` }) {
  const guild = makeGuild();
  const saved = [];
  const handlers = createMemberRoleHandlers({
    getGuild: async () => guild,
    saveRoles: async (id, roleNames) => saved.push([id, roleNames]),
    env,
  });
  /** Calls a handler the way Express would and returns [status, body]. */
  const call = async (handler, params, body) => {
    const out = [];
    const res = {
      status(code) { out[0] = code; return res; },
      json(payload) { out[1] = payload; return res; },
    };
    await handler({ params, body }, res);
    return out;
  };
  return { guild, saved, handlers, call };
}

test('MANAGED_ROLE_IDS keeps only role ids, and unset means none', () => {
  assert.deepEqual([...managedRoleIds({ MANAGED_ROLE_IDS: ` ${DELTA}, nope ,${ALPHA}` })], [DELTA, ALPHA]);
  assert.equal(managedRoleIds({}).size, 0);
});

test('grants a managed role, saves the role names and passes the reason to the audit log', async () => {
  const { guild, saved, handlers, call } = setup();
  const res = await call(handlers.setManagedRole(true), { discordId: MEMBER, roleId: DELTA }, { reason: 'billing:active' });
  assert.deepEqual(res, [200, { id: MEMBER, roles: ['everyone', 'Delta'] }]);
  assert.deepEqual(saved, [[MEMBER, ['everyone', 'Delta']]]);
  assert.deepEqual(guild.audit, [['add', MEMBER, 'Delta', 'billing:active']]);
});

test('granting twice and removing are both plain 200s', async () => {
  const { handlers, call } = setup();
  const params = { discordId: MEMBER, roleId: DELTA };
  await call(handlers.setManagedRole(true), params);
  assert.deepEqual(await call(handlers.setManagedRole(true), params), [200, { id: MEMBER, roles: ['everyone', 'Delta'] }]);
  assert.deepEqual(await call(handlers.setManagedRole(false), params, { reason: 'billing:grace_expired' }), [200, { id: MEMBER, roles: ['everyone'] }]);
});

test('refuses a role outside MANAGED_ROLE_IDS without touching Discord', async () => {
  const { guild, handlers, call } = setup();
  guild.roles.fetch = async () => { throw new Error('must not be reached'); };
  assert.deepEqual(await call(handlers.setManagedRole(true), { discordId: MEMBER, roleId: ADMIN }), [403, { error: 'role_not_allowed' }]);
});

test('with MANAGED_ROLE_IDS unset every role is refused', async () => {
  const { handlers, call } = setup({});
  assert.deepEqual(await call(handlers.setManagedRole(true), { discordId: MEMBER, roleId: DELTA }), [403, { error: 'role_not_allowed' }]);
});

test('answers 400 for a malformed member or role id', async () => {
  const { handlers, call } = setup();
  assert.deepEqual(await call(handlers.setManagedRole(true), { discordId: 'abc', roleId: DELTA }), [400, { error: 'invalid_id' }]);
  assert.deepEqual(await call(handlers.setManagedRole(true), { discordId: MEMBER, roleId: '12' }), [400, { error: 'invalid_id' }]);
});

test('answers 404 not_in_guild for someone outside the server', async () => {
  const { handlers, call } = setup();
  const params = { discordId: OUTSIDER, roleId: DELTA };
  assert.deepEqual(await call(handlers.setManagedRole(true), params), [404, { error: 'not_in_guild' }]);
  assert.deepEqual(await call(handlers.setManagedRole(false), params), [404, { error: 'not_in_guild' }]);
});

test('answers 422, not 404, when an allowed role does not exist in the guild', async () => {
  const { handlers, call } = setup();
  assert.deepEqual(await call(handlers.setManagedRole(true), { discordId: MEMBER, roleId: GHOST }), [422, { error: 'role_not_found' }]);
});

test('answers 502 missing_permissions when Discord refuses the bot', async () => {
  const { saved, handlers, call } = setup();
  assert.deepEqual(await call(handlers.setManagedRole(true), { discordId: MEMBER, roleId: TOO_HIGH }), [502, { error: 'missing_permissions' }]);
  assert.deepEqual(saved, []);
});

test('the Alpha routes behave as before for stc-payments', async () => {
  const { handlers, call } = setup({});
  assert.deepEqual(await call(handlers.setAlphaRole(true), { discordId: MEMBER }, { reason: 'pago' }), [200, { id: MEMBER, roles: ['everyone', 'Alpha'] }]);
  assert.deepEqual(await call(handlers.setAlphaRole(false), { discordId: MEMBER }), [200, { id: MEMBER, roles: ['everyone'] }]);
  assert.deepEqual(await call(handlers.setAlphaRole(true), { discordId: OUTSIDER }), [404, { error: 'not_in_guild' }]);
  assert.deepEqual(await call(handlers.setAlphaRole(true), { discordId: 'x' }), [400, { error: 'invalid_id' }]);
});

test('Alpha is found by ALPHA_ROLE_ID when set, and reported when missing', async () => {
  const byId = setup({ ALPHA_ROLE_ID: ALPHA });
  assert.equal((await byId.call(byId.handlers.setAlphaRole(true), { discordId: MEMBER }))[0], 200);
  const missing = setup({ ALPHA_ROLE_ID: GHOST });
  assert.deepEqual(await missing.call(missing.handlers.setAlphaRole(true), { discordId: MEMBER }), [500, { error: 'alpha_role_not_found' }]);
});

test('join adds an outsider (201) and reports an existing member (200)', async () => {
  const { handlers, call } = setup();
  assert.deepEqual(await call(handlers.joinGuild, { discordId: OUTSIDER }, { accessToken: 'good' }), [201, { id: OUTSIDER, joined: true }]);
  assert.deepEqual(await call(handlers.joinGuild, { discordId: OUTSIDER }, { accessToken: 'good' }), [200, { id: OUTSIDER, joined: false }]);
  // …and now the role can be granted.
  assert.equal((await call(handlers.setManagedRole(true), { discordId: OUTSIDER, roleId: DELTA }))[0], 200);
});

test('join answers 400 invalid_token for a missing, rejected or under-scoped token', async () => {
  const { handlers, call } = setup();
  const params = { discordId: OUTSIDER };
  assert.deepEqual(await call(handlers.joinGuild, params, undefined), [400, { error: 'invalid_token' }]);
  assert.deepEqual(await call(handlers.joinGuild, params, { accessToken: 'bad' }), [400, { error: 'invalid_token' }]);
  assert.deepEqual(await call(handlers.joinGuild, params, { accessToken: 'noscope' }), [400, { error: 'invalid_token' }]);
});

test('join answers 403 for a banned user and 400 for a malformed id', async () => {
  const { handlers, call } = setup();
  assert.deepEqual(await call(handlers.joinGuild, { discordId: BANNED }, { accessToken: 'good' }), [403, { error: 'banned' }]);
  assert.deepEqual(await call(handlers.joinGuild, { discordId: 'nope' }, { accessToken: 'good' }), [400, { error: 'invalid_id' }]);
});
