import { getMissionStore } from './missionStore.js';
// Registers Socket.IO handlers for rooms, movement, roles, Ready, chat, and missions.
//
// This file is the "switchboard". It listens for messages from one player's browser,
// asks rooms.js to apply the rules, then tells the players in that room what changed.
// Event names and data shapes come from shared/socket-contract.md.

import { createRoom, joinRoom, leaveRoom, getRoom } from './rooms.js';
import {
  movePlayer, selectRole, cancelRole, setReady, startMission, createChatMessage,
  checkCanSubmit, getMissionRunId, recordPass, deployMission,
} from './gameState.js';
import { reviewSubmission } from './challenges.js';

// Called once for every player who connects.
// `io` = the whole server (can talk to everyone). `socket` = this one player's connection.
export function registerSocketHandlers(io, socket, reviewer = reviewSubmission) {
  // Sends the latest room to everyone inside it.
  function sendRoomUpdate(room) {
    io.to(room.code).emit('room:update', room);
  }

  // Shared by "room:leave" and closing the tab.
  function leaveCurrentRoom() {
    const code = socket.data.roomCode;
    if (!code) return; // not in a room, nothing to do

    socket.leave(code);
    socket.data.roomCode = null;

    const room = leaveRoom(code, socket.id);
    if (room) sendRoomUpdate(room); // tell the players still inside
  }

  // Shared by every request that gets a reply (role:select, role:cancel, player:ready, game:start).
  // They all work the same way:
  //   1. find this player's room   2. apply a rule from gameState.js
  //   3. reply to this player      4. if it worked, tell everyone in the room
  // `applyRule` is the rule to run. Each listener below passes in a different one.
  // `announce` is how to tell everyone. Most send room:update; game:start sends game:started.
  function handleRequest(reply, applyRule, announce = sendRoomUpdate) {
    if (typeof reply !== 'function') reply = () => {};

    const room = getRoom(socket.data.roomCode);
    if (!room) {
      reply({ ok: false, error: 'NOT_IN_ROOM' });
      return;
    }

    const result = applyRule(room);
    if (result.error) {
      reply({ ok: false, error: result.error });
      return;
    }

    reply({ ok: true });
    announce(room, result); // `result` carries extras, like durationMs for deploy
  }

  socket.on('mission:list', (_data, reply) => {
    if (typeof reply === 'function') reply({ ok: true, missions: getMissionStore().list() });
  });

  // ---------- room:join ----------
  // data = { name, roomCode? }. No roomCode means "create a new room for me".
  socket.on('room:join', (data, reply) => {
    // The browser might forget the reply callback or send junk. Don't crash if it does.
    if (typeof reply !== 'function') reply = () => {};
    const { name, roomCode, missionId, revision } = data ?? {};

    // One room at a time. The player must send room:leave before joining another.
    if (socket.data.roomCode) {
      reply({ ok: false, error: 'ALREADY_IN_ROOM' });
      return;
    }

    const result = roomCode
      ? joinRoom(roomCode, socket.id, name)
      : createRoom(socket.id, name, missionId, revision);

    if (result.error) {
      reply({ ok: false, error: result.error });
      return;
    }

    const { room } = result;
    socket.join(room.code);           // Socket.IO group, so io.to(code) reaches this player
    socket.data.roomCode = room.code; // remember which room this player is in

    reply({ ok: true, room, you: socket.id });
    sendRoomUpdate(room);
    console.log(`${name} joined room ${room.code} (${room.players.length}/3)`);
  });

  // ---------- player:move ----------
  // data = { x, y, facing, flipX }. Sent up to 15 times a second, so there's no reply.
  // Bad data is simply ignored.
  socket.on('player:move', (data) => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return; // not in a room

    const move = movePlayer(room, socket.id, data);
    if (!move) return; // invalid move, ignore it

    // socket.to(...) means "everyone in the room EXCEPT me". The mover already knows where they are.
    socket.to(room.code).emit('player:moved', move);
  });

  // ---------- role:select ----------
  // data = { role }. Pressing E at a desk.
  socket.on('role:select', (data, reply) => {
    handleRequest(reply, (room) => selectRole(room, socket.id, data?.role));
  });

  // ---------- role:cancel ----------
  // data = {}. Pressing E again to leave the desk.
  socket.on('role:cancel', (data, reply) => {
    handleRequest(reply, (room) => cancelRole(room, socket.id));
  });

  // ---------- player:ready ----------
  // data = { ready: true | false }. Pressing R.
  socket.on('player:ready', (data, reply) => {
    handleRequest(reply, (room) => setReady(room, socket.id, data?.ready));
  });

  // ---------- game:start ----------
  // data = {}. The host presses Start Mission.
  // On success, everyone gets game:started (not room:update) and switches to the mission screen.
  socket.on('game:start', (data, reply) => {
    handleRequest(
      reply,
      (room) => startMission(room, socket.id),
      (room) => {
        io.to(room.code).emit('game:started', { room });
        console.log(`Room ${room.code} started the mission`);
      },
    );
  });

  // ---------- challenge:submit ----------
  // data = { code }. The player clicks Run Tests. Gemini decides PASS or FAIL.
  // This one is `async` because we have to WAIT for Gemini's answer (1-15 seconds).
  socket.on('challenge:submit', async (data, reply) => {
    if (typeof reply !== 'function') reply = () => {};

    const room = getRoom(socket.data.roomCode);
    if (!room) {
      reply({ ok: false, error: 'NOT_IN_ROOM' });
      return;
    }

    // Cheap checks first (right stage, has a role, code not too long), so we never
    // pay for a Gemini request that was going to be rejected anyway.
    const check = checkCanSubmit(room, socket.id, data?.code);
    if (check.error) {
      reply({ ok: false, error: check.error });
      return;
    }

    // One review at a time per player. Stops button-mashing from using up the Gemini quota.
    if (socket.data.reviewing) {
      reply({ ok: false, error: 'REVIEW_IN_PROGRESS' });
      return;
    }

    const role = check.player.role;
    const runId = getMissionRunId(room); // remember which mission this was for

    let result;
    socket.data.reviewing = true;
    try {
      result = await reviewer(room.missionId, room.missionRevision, role, data.code); // ...wait for Gemini...
    } catch (err) {
      console.error(`Gemini review failed for room ${room.code}: ${err.message}`);
      reply({ ok: false, error: 'REVIEW_UNAVAILABLE' });
      return;
    } finally {
      socket.data.reviewing = false; // always runs, even after an error
    }

    // While we waited, things may have changed: someone left, so the mission was reset.
    // Only count the result if it's still the same mission and this player still has this role.
    const stillSameMission = room.stage === 'mission'
      && getMissionRunId(room) === runId
      && room.players.some(p => p.id === socket.id && p.role === role);
    if (!stillSameMission) {
      console.log(`Room ${room.code}: ${role} review discarded (mission changed while waiting)`);
      reply({ ok: false, error: 'NOT_IN_MISSION' });
      return;
    }

    console.log(`Room ${room.code}: ${role} review -> ${result.passed ? 'PASS' : 'FAIL'}`);
    reply({ ok: true, passed: result.passed, terminal: result.terminal });

    // First PASS for this role: update the team scoreboard for everyone.
    if (result.passed) {
      const update = recordPass(room, role);
      if (update) {
        io.to(room.code).emit('mission:progress', update);
        console.log(`Room ${room.code}: ${role} passed (${update.completed}/3)`);
      }
    }
  });

  // ---------- deployment:request ----------
  // data = {}. The host clicks Deploy to Production once Team Progress is 3/3.
  // On success, everyone gets mission:complete and shows the results screen.
  socket.on('deployment:request', (data, reply) => {
    handleRequest(
      reply,
      (room) => deployMission(room, socket.id),
      (room, result) => {
        io.to(room.code).emit('mission:complete', { room, durationMs: result.durationMs });
        console.log(`Room ${room.code} deployed! Mission complete in ${Math.round(result.durationMs / 1000)}s`);
      },
    );
  });

  // ---------- chat:send ----------
  // data = { text }. No reply: the sender knows it worked when their own message comes back.
  socket.on('chat:send', (data) => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return; // not in a room

    const message = createChatMessage(room, socket.id, data?.text);
    if (!message) return; // empty, too long, or wrong stage: ignore it

    // io.to(...) = everyone in the room INCLUDING the sender, so all 3 chats match exactly.
    io.to(room.code).emit('chat:message', message);
  });

  // ---------- room:leave ----------
  socket.on('room:leave', () => {
    leaveCurrentRoom();
  });

  // ---------- disconnect ----------
  // Fires automatically when the tab closes, the page refreshes, or the internet drops.
  socket.on('disconnect', () => {
    leaveCurrentRoom();
  });
}
