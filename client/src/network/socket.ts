import { io, type Socket } from 'socket.io-client';

// Shared game data from shared/socket-contract.md (v1.0).
// These types can move to src/types/game.ts later.
export type Role = 'frontend' | 'backend' | 'devops';
export type Avatar = 'purple' | 'white' | 'yellow';
export type Stage = 'lobby' | 'mission' | 'complete';
export type Facing = 'front' | 'back' | 'side';

export type Player = {
  id: string;
  name: string;
  avatar: Avatar;
  role: Role | null;
  ready: boolean;
  x: number;
  y: number;
};

export type Progress = {
  frontend: boolean;
  backend: boolean;
  devops: boolean;
};

export type MissionSummary = {
  missionId: string; revision: number; title: string; description: string;
  supportedPlayerCounts: number[];
  attribution: { team: string; project: string; event: string; sourceRepository: string; copyright: string };
};
export type MissionChallenge = {
  title: string; description: string; filename: string; editorLanguage: string;
  starterCode: string; initialTerminal: string; hint: string;
  testPreview: { filename: string; language: string; content: string; executable: false };
};
export type PublicMission = MissionSummary & {
  seats: { seatId: string; roleId: Role; roleLabel: string; challenge: MissionChallenge }[];
};
export type Room = {
  missionId: string;
  missionRevision: number;
  mission: PublicMission;
  code: string;
  hostId: string;
  stage: Stage;
  players: Player[];
  progress: Progress;
};

export type ChatMessage = {
  playerId: string;
  user: string;
  text: string;
  time: number;
};

export type ErrorCode =
  | 'MISSION_NOT_FOUND'
  | 'INVALID_NAME'
  | 'INVALID_ROOM_CODE'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_ALREADY_STARTED'
  | 'ALREADY_IN_ROOM'
  | 'NOT_IN_ROOM'
  | 'NOT_IN_LOBBY'
  | 'NOT_IN_MISSION'
  | 'INVALID_ROLE'
  | 'ROLE_TAKEN'
  | 'NO_ROLE'
  | 'NOT_HOST'
  | 'NOT_ENOUGH_PLAYERS'
  | 'NOT_ALL_READY'
  | 'INVALID_CODE'
  | 'CODE_TOO_LONG'
  | 'NOT_ALL_COMPLETE'
  | 'ALREADY_COMPLETE'
  | 'REVIEW_IN_PROGRESS'
  | 'REVIEW_UNAVAILABLE';

export type Ack<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: ErrorCode };

export type JoinAck = Ack<{ room: Room; you: string }>;
export type ChallengeAck = Ack<{ passed: boolean; terminal: string }>;

// Events sent FROM the backend TO the frontend.
interface ServerToClientEvents {
  'room:update': (room: Room) => void;
  'player:moved': (data: {
    id: string;
    x: number;
    y: number;
    facing: Facing;
    flipX: boolean;
  }) => void;
  'game:started': (data: { room: Room }) => void;
  'chat:message': (message: ChatMessage) => void;
  'mission:progress': (data: {
    progress: Progress;
    completed: number;
  }) => void;
  'mission:complete': (data: {
    room: Room;
    durationMs: number;
  }) => void;
}

// Events sent FROM the frontend TO the backend.
interface ClientToServerEvents {
  'mission:list': (data: object, callback: (reply: Ack<{ missions: MissionSummary[] }>) => void) => void;
  'room:join': (
    data: { name: string; roomCode?: string; missionId?: string; revision?: number },
    callback: (reply: JoinAck) => void
  ) => void;
  'room:leave': (data: object) => void;
  'player:move': (data: {
    x: number;
    y: number;
    facing: Facing;
    flipX: boolean;
  }) => void;
  'role:select': (
    data: { role: Role },
    callback: (reply: Ack) => void
  ) => void;
  'role:cancel': (data: object, callback: (reply: Ack) => void) => void;
  'player:ready': (
    data: { ready: boolean },
    callback: (reply: Ack) => void
  ) => void;
  'game:start': (data: object, callback: (reply: Ack) => void) => void;
  'chat:send': (data: { text: string }) => void;
  'challenge:submit': (
    data: { code: string },
    callback: (reply: ChallengeAck) => void
  ) => void;
  'deployment:request': (
    data: object,
    callback: (reply: Ack) => void
  ) => void;
}

// Set VITE_SOCKET_URL when the server runs on another computer.
const SERVER_URL =
  import.meta.env.VITE_SOCKET_URL?.trim() || 'http://localhost:3001';

// One shared connection for the entire React + Phaser frontend.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> =
  io(SERVER_URL, {
    autoConnect: false,
    reconnection: true,
  });

export function connectSocket() {
  if (!socket.connected) socket.connect();
}

export function disconnectSocket() {
  socket.disconnect();
}
