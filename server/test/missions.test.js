import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as client } from 'socket.io-client';
import { openMissionStore, getMissionStore, readMissionFile, MAX_IMPORT_BYTES } from '../src/missionStore.js';

const seed = JSON.parse(readFileSync(new URL('../../shared/missions/launch-day.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(seed);

test('SQLite persists immutable versions and rejects malformed or unsupported imports atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codered-store-'));
  const filename = join(dir, 'test.sqlite');
  let store = openMissionStore(filename);
  try {
    store.import(seed);
    assert.throws(() => store.import(seed), /MISSION_ALREADY_EXISTS/);
    const invalid = clone(); invalid.seats[0].challenge.review.criteria = [];
    assert.throws(() => store.import(invalid), /INVALID_MISSION/);
    const duplicate = clone(); duplicate.seats[1].seatId = duplicate.seats[0].seatId;
    assert.throws(() => store.import(duplicate), /DUPLICATE_SEAT/);
    const roster = clone(); roster.seats[0].roleId = 'security';
    assert.throws(() => store.import(roster), /UNSUPPORTED_ROSTER/);
    const count = clone(); count.supportedPlayerCounts = [4];
    assert.throws(() => store.import(count), /INVALID_PLAYER_COUNT/);
    const extra = clone(); extra.unknown = true;
    assert.throws(() => store.import(extra), /INVALID_MISSION/);
    assert.equal(store.list().length, 1);
    const next = clone(); next.revision = 2; next.title = 'Launch Day revised'; store.import(next);
    store.close(); store = openMissionStore(filename);
    assert.equal(store.get('launch-day', 1).title, 'Launch Day');
    assert.equal(store.list()[0].revision, 2);
    assert.equal(store.get('missing', 1), null);
    assert.equal(store.get({}, '1'), null);
    const large = join(dir, 'large.json'); writeFileSync(large, ' '.repeat(MAX_IMPORT_BYTES + 1));
    assert.throws(() => readMissionFile(large), /MISSION_TOO_LARGE/);
    writeFileSync(large, '{');
    assert.throws(() => readMissionFile(large), SyntaxError);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

test('real sockets: select/create/join/start, pinned display and judging, stale review, deploy', async () => {
  process.env.MISSION_DB_PATH = ':memory:';
  const store = getMissionStore();
  store.import(seed);
  const other = clone(); other.missionId = 'another-case'; other.title = 'Another case';
  other.seats[0].challenge.starterCode = '// distinct starter';
  other.seats[0].challenge.review.task = 'Distinct case criteria'; store.import(other);
  const { reviewSubmission } = await import('../src/challenges.js');
  const { registerSocketHandlers } = await import('../src/socketHandlers.js');
  const { getRoom } = await import('../src/rooms.js');
  const { selectRole, setReady, startMission, getMissionRunId } = await import('../src/gameState.js');
  const calls = [];
  let release;
  let hold = false;
  let fail = false;
  const http = createServer();
  const io = new Server(http);
  io.on('connection', socket => registerSocketHandlers(io, socket, (id, rev, role, code) =>
    reviewSubmission(id, rev, role, code, async (challenge, submission) => {
      calls.push({ id, rev, role, challenge, submission });
      if (hold) await new Promise(resolve => { release = resolve; });
      if (fail) throw new Error('Simulated review outage');
      return { passed: submission === 'fixed', explanation: 'Controlled reviewer result', hint: '' };
    })));
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const clients = [];
  async function connect() {
    const socket = client(`http://127.0.0.1:${http.address().port}`, { transports: ['websocket'], reconnection: false, forceNew: true });
    clients.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  const ack = (socket, event, data) => socket.timeout(3000).emitWithAck(event, data);
  try {
    const a = await connect(), b = await connect(), c = await connect();
    const launchPlayer = await connect();
    const launchRoom = await ack(launchPlayer, 'room:join', { name: 'Launch', missionId: 'launch-day', revision: 1 });
    assert.equal(launchRoom.room.mission.title, 'Launch Day');
    for (const seat of seed.seats) {
      await reviewSubmission('launch-day', 1, seat.roleId, 'sample', async challenge => {
        assert.equal(challenge.starterCode, seat.challenge.starterCode);
        assert.deepEqual(challenge.criteria, seat.challenge.review.criteria);
        return { passed: false, explanation: 'Test', hint: '' };
      });
    }
    const list = await ack(a, 'mission:list', {});
    assert.equal(list.missions.length, 2);
    assert.equal((await ack(a, 'room:join', { name: 'Host', missionId: 'missing', revision: 1 })).error, 'MISSION_NOT_FOUND');
    const joined = await ack(a, 'room:join', { name: 'Host', missionId: 'another-case', revision: 1 });
    assert.equal(joined.ok, true);
    const roomCode = joined.room.code;
    assert.equal(joined.room.mission.seats[0].challenge.starterCode, '// distinct starter');
    assert.equal(JSON.stringify(joined.room).includes('Distinct case criteria'), false);
    assert.equal('review' in joined.room.mission.seats[0].challenge, false);
    // A new import cannot switch an existing room's version.
    const next = structuredClone(other); next.revision = 2; next.seats[0].challenge.review.task = 'New version'; store.import(next);
    for (const [socket, name] of [[b, 'B'], [c, 'C']]) {
      const reply = await ack(socket, 'room:join', { name, roomCode, missionId: 'launch-day', revision: 1 });
      assert.equal(reply.room.missionId, 'another-case');
      assert.equal(reply.room.missionRevision, 1);
    }
    for (const [socket, role] of [[a, 'frontend'], [b, 'backend'], [c, 'devops']]) {
      assert.equal((await ack(socket, 'role:select', { role })).ok, true);
      assert.equal((await ack(socket, 'player:ready', { ready: true })).ok, true);
    }
    assert.equal((await ack(a, 'game:start', {})).ok, true);
    assert.equal((await ack(a, 'challenge:submit', { code: 'buggy' })).passed, false);
    fail = true;
    assert.equal((await ack(a, 'challenge:submit', { code: 'fixed' })).error, 'REVIEW_UNAVAILABLE');
    fail = false;
    hold = true;
    const pending = ack(a, 'challenge:submit', { code: 'fixed' });
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await ack(a, 'challenge:submit', { code: 'fixed' })).error, 'REVIEW_IN_PROGRESS');
    const room = getRoom(roomCode), oldRun = getMissionRunId(room);
    // Reset/restart while the first run's AI result is in flight.
    room.stage = 'lobby';
    for (const p of room.players) { selectRole(room, p.id, p.role); setReady(room, p.id, true); }
    assert.ok(startMission(room, a.id).room);
    assert.notEqual(getMissionRunId(room), oldRun);
    hold = false; release();
    assert.equal((await pending).error, 'NOT_IN_MISSION');
    assert.equal(room.progress.frontend, false);
    for (const socket of [a,b,c]) {
      const result = await ack(socket, 'challenge:submit', { code: 'fixed', missionId: 'launch-day', role: 'devops' });
      assert.equal(result.passed, true);
    }
    assert.equal(calls[0].id, 'another-case');
    assert.equal(calls[0].rev, 1);
    assert.equal(calls[0].role, 'frontend');
    assert.equal(calls[0].challenge.task, 'Distinct case criteria');
    assert.equal((await ack(b, 'deployment:request', {})).error, 'NOT_HOST');
    assert.equal((await ack(a, 'deployment:request', {})).ok, true);
    assert.equal(room.stage, 'complete');
    assert.equal((await ack(a, 'deployment:request', {})).error, 'ALREADY_COMPLETE');
  } finally {
    for (const socket of clients) socket.disconnect();
    await new Promise(resolve => io.close(resolve));
    store.close();
  }
});
