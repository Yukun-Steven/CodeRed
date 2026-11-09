import { getMissionStore, publicMission } from './missionStore.js';

// Creates rooms, joins players, manages room capacity, and handles disconnections.
//
// This file only knows about rooms and players. It never talks to Socket.IO directly,
// so the rules of the game live in one place and are easy to read and test.

const MAX_PLAYERS = 3;
const MAX_NAME_LENGTH = 16;

// Each seat in a room has a fixed avatar colour and lobby starting spot.
// Seat 0 = purple, seat 1 = white, seat 2 = yellow (same order as the frontend images).
const SEATS = [
  { avatar: 'purple', x: 480, y: 475 },
  { avatar: 'white', x: 335, y: 465 },
  { avatar: 'yellow', x: 640, y: 465 },
];

// Letters used for room codes. I and O are left out so nobody confuses them with 1 and 0.
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// All rooms live here, in memory. Key = room code ("KQZD"), value = the room object.
// Restarting clears rooms; imported mission definitions persist separately in SQLite.
const rooms = new Map();

// ---------- helpers ----------

function makeRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    }
  } while (rooms.has(code)); // try again in the rare case the code is already used
  return code;
}

// Returns the cleaned-up name, or null if it isn't a valid name.
function cleanName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_NAME_LENGTH) return null;
  return trimmed;
}

// Finds the first seat nobody is sitting in.
// (If the white player leaves, the next person to join gets white.)
function freeSeat(room) {
  const taken = room.players.map(p => p.avatar);
  return SEATS.find(seat => !taken.includes(seat.avatar));
}

function makePlayer(id, name, seat) {
  return {
    id,
    name,
    avatar: seat.avatar,
    role: null,
    ready: false,
    x: seat.x,
    y: seat.y,
  };
}

// ---------- the functions other files use ----------

// Makes a brand-new room with this player inside as the host.
// Returns { room } on success or { error } on failure.
export function createRoom(playerId, name, missionId, revision) {
  const cleaned = cleanName(name);
  if (!cleaned) return { error: 'INVALID_NAME' };

  const mission = getMissionStore().get(missionId, revision);
  if (!mission) return { error: 'MISSION_NOT_FOUND' };

  const room = {
    missionId: mission.missionId,
    missionRevision: mission.revision,
    mission: publicMission(mission),
    code: makeRoomCode(),
    hostId: playerId,
    stage: 'lobby',
    players: [],
    progress: { frontend: false, backend: false, devops: false },
  };
  room.players.push(makePlayer(playerId, cleaned, SEATS[0]));

  rooms.set(room.code, room);
  return { room };
}

// Puts this player into an existing room.
// Returns { room } on success or { error } on failure.
export function joinRoom(code, playerId, name) {
  const cleaned = cleanName(name);
  if (!cleaned) return { error: 'INVALID_NAME' };

  // A room code must be exactly 4 letters. We uppercase it first, so "kqzd" finds room "KQZD".
  const cleanCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!/^[A-Z]{4}$/.test(cleanCode)) return { error: 'INVALID_ROOM_CODE' };

  const room = rooms.get(cleanCode);
  if (!room) return { error: 'ROOM_NOT_FOUND' };
  if (room.stage !== 'lobby') return { error: 'GAME_ALREADY_STARTED' };
  if (room.players.length >= MAX_PLAYERS) return { error: 'ROOM_FULL' };

  room.players.push(makePlayer(playerId, cleaned, freeSeat(room)));
  return { room };
}

// Takes this player out of their room.
// Returns the updated room, or null if the room is now empty (and has been deleted).
export function leaveRoom(code, playerId) {
  const room = rooms.get(code);
  if (!room) return null;

  room.players = room.players.filter(p => p.id !== playerId);

  // Last person left: throw the room away.
  if (room.players.length === 0) {
    rooms.delete(code);
    return null;
  }

  // The host left: the player who has been in the room longest becomes the new host.
  if (room.hostId === playerId) {
    room.hostId = room.players[0].id;
  }

  // Someone left in the middle of a mission: the team can't finish without them,
  // so send everyone back to the lobby. They keep their roles but must press Ready again.
  // (If the game is already 'complete', nothing changes and results stay on screen.)
  if (room.stage === 'mission') {
    room.stage = 'lobby';
    room.progress = { frontend: false, backend: false, devops: false };
    for (const player of room.players) player.ready = false;
  }

  return room;
}

export function getRoom(code) {
  return rooms.get(code) ?? null;
}
