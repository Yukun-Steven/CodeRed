> Stage-one case extension: the section immediately below supersedes fixed Mission 01 assumptions and the original room/create payload definitions. Other lobby and game events remain compatible.

## Case selection and pinned rooms

- Client sends `mission:list` with `{}`; ACK: `{ ok: true, missions: MissionSummary[] }`. Each summary includes missionId, revision, title, description, supportedPlayerCounts, attribution. Returns latest revision per ID.
- Create via `room:join` with `{ name, missionId, revision }`. Missing or unknown case/version returns `MISSION_NOT_FOUND`.
- Join via `room:join` with `{ name, roomCode }`; supplied case fields are ignored when joining an existing room.
- All Room payloads add `missionId`, `missionRevision`, and `mission` (public metadata and seats with display-only challenges). Each seat has seatId, roleId, roleLabel, challenge. No challenge.review fields are sent.
- `challenge:submit` remains `{ code }`. The backend obtains case/version from the room and role from the authenticated socket’s player. Arbitrary client case/role fields do not select the reviewer task.
- Each new run receives a monotonic server-only runId; late AI results from an earlier run are discarded.
- Stage one still requires exactly three distinct standard roles. A role maps to exactly one case seat. Same-role multiple-seat gameplay is deferred.

<!-- CODE RED! multiplayer protocol. Both frontend and backend must implement the same event names and payloads. -->

# CODE RED! — Socket.IO Contract (v1.0)

This document defines the **complete MVP multiplayer protocol** between the frontend (React + Phaser + Monaco) and backend (Node.js + Socket.IO).

**Status:** Proposed v1.0 — ready for team review. **Both frontend and backend must approve this version before integration.**

**Main flow:** Room Entry → Lobby → 3 players choose roles and Ready → Mission → Run Tests → Team Progress 3/3 → **Deploy to Production** → Results.

**Files:** `shared/socket-contract.md` (this document), `client/src/network/socket.ts`, and the server Socket.IO handlers.

---

## 1. Basics and rules

| Setting | Value |
|---|---|
| Development backend | `http://localhost:3001` |
| Development frontend | `http://localhost:5173` |
| Room code | Exactly 4 uppercase English letters, e.g. `KQZD` |
| Room size | 1–3 players in Lobby; **exactly 3** required to start |
| Roles | `frontend`, `backend`, `devops` |
| Avatars | `purple`, `white`, `yellow`; server assigns first available in join order |
| Player name | 1–16 characters after trimming whitespace |
| Event style | Lowercase `thing:action`, e.g. `room:join` |
| Authority | **Server owns** rooms, roles, ready states, progress, mission stage, and deployment |
| Storage (MVP) | In-memory rooms; restarting the server loses active rooms |

Rules:

1. The frontend **requests** actions. It never marks a role, challenge, deployment, or stage as successful until the server confirms it.
2. `Room` snapshots are authoritative. Lobby changes arrive through `room:update`; starting and finishing a mission also include full `Room` snapshots in their respective events. Movement and mission progress have smaller update events.
3. Use **Socket.IO acknowledgements** for events marked **(ack)**. Every such request must receive either a success or error acknowledgement. The frontend should also handle timeouts/disconnection.
4. Every socket may belong to **only one CODE RED! game room**. Leave before creating or joining another.
5. The backend checks room membership and current stage on every gameplay event. Never trust client-provided role, player ID, PASS/FAIL, or completion state.
6. `localhost` is for the same machine. Other computers must connect to the actual server IP/host. Production CORS must use the real frontend origin; do not use an unrestricted origin in deployment.

### Acknowledgement shapes

```ts
type AckError = { ok: false; error: ErrorCode };
type AckSuccess = { ok: true };

// Examples (individual events may return extra fields):
{ ok: true }
{ ok: false, error: 'ROLE_TAKEN' }
```

Client-side example:

```ts
socket.timeout(5000).emit('role:select', { role: 'backend' }, (err, res) => {
  if (err) {
    showError('Server did not respond');
    return;
  }
  if (!res.ok) showError(res.error);
});
```

---

## 2. Shared types

These are the data shapes that **both teams implement**. They are TypeScript examples; the backend may use plain JavaScript objects.

```ts
type Role = 'frontend' | 'backend' | 'devops';
type Avatar = 'purple' | 'white' | 'yellow';
type Stage = 'lobby' | 'mission' | 'complete';

type Player = {
  id: string;                  // server-provided socket.id
  name: string;                // 1–16 characters
  avatar: Avatar;
  role: Role | null;
  ready: boolean;
  x: number;                   // Phaser world coordinates (Lobby)
  y: number;
};

type Progress = {
  frontend: boolean;
  backend: boolean;
  devops: boolean;
};

type Room = {
  code: string;                // 4 uppercase letters
  hostId: string;              // current host's player ID
  stage: Stage;
  players: Player[];           // 1–3 players while the room exists
  progress: Progress;
};

type ChatMessage = {
  playerId: string;
  user: string;                // sender name
  text: string;                // 1–200 characters
  time: number;                // server Date.now(), Unix milliseconds
};

type Facing = 'front' | 'back' | 'side';
```

`progress` always begins as `{ frontend: false, backend: false, devops: false }`.

A role is **available** when no player in the room currently owns it. A player can have only one role. A player may change their role in the Lobby, provided the requested role is free.

---

## 3. Socket.IO events

Direction: **Client → Server** means the browser emits the event. **Server → Client(s)** means the server emits the event.

### 3.1 Create room, join room, leave room

| Event | Direction | Payload | Response / behavior |
|---|---|---|---|
| `room:join` **(ack)** | Client → Server | `{ name: string, roomCode?: string }` | Without `roomCode`, create a new room and become host. With `roomCode`, join that room. Success: `{ ok: true, room: Room, you: string }`. |
| `room:leave` | Client → Server | `{}` | Remove this player from the room; the leaving client returns to Room Entry. |
| `room:update` | Server → All in room | `Room` | Send after join, leave, role change, ready change, host change, or mission reset. |

Example:

```ts
// Create a room
socket.emit('room:join', { name: 'Alice' }, (res) => {
  if (res.ok) {
    setMyPlayerId(res.you);
    setRoom(res.room);
  }
});

// Join a friend's room
socket.emit('room:join', { name: 'Bob', roomCode: 'KQZD' }, (res) => {
  if (res.ok) {
    setMyPlayerId(res.you);
    setRoom(res.room);
  }
});
```

Room rules:

- A room code must be exactly four uppercase letters. The frontend may uppercase input before sending; the backend validates it.
- A room has **at most three** players. The fourth player receives `ROOM_FULL`.
- Joining is allowed **only when** `room.stage === 'lobby'`. Otherwise return `GAME_ALREADY_STARTED`.
- A socket already in a game room must `room:leave` before another `room:join`; otherwise return `ALREADY_IN_ROOM`.
- The first player is the host. If the host leaves, the **oldest remaining player** becomes host.
- Reuse the first available avatar from `purple`, `white`, `yellow` when a player joins.
- If the final player leaves/disconnects, delete the empty room.
- The server sends `room:update` **including the newly joined player** after a successful join.

Errors: `INVALID_NAME`, `INVALID_ROOM_CODE`, `ROOM_NOT_FOUND`, `ROOM_FULL`, `GAME_ALREADY_STARTED`, `ALREADY_IN_ROOM`.

### 3.2 Lobby movement

| Event | Direction | Payload | Behavior |
|---|---|---|---|
| `player:move` | Client → Server | `{ x: number, y: number, facing: Facing, flipX: boolean }` | Client sends only when moving, maximum **15 updates/second**. No ack. |
| `player:moved` | Server → Other players | `{ id: string, x: number, y: number, facing: Facing, flipX: boolean }` | Broadcast to everyone **except the moving player**. |

- Movement works only in the Lobby. The backend records the latest valid `x`, `y` for subsequent `room:update` snapshots.
- The server ignores malformed coordinates or directions. Use reasonable world bounds; never trust arbitrary coordinates.
- `front` uses `player_<avatar>.png`, `back` uses `_back`, and `side` uses `_side`; `flipX` mirrors the side sprite.
- The local player is controlled by Phaser; remote players render from `room.players` initially and `player:moved` afterward.

#### Lobby movement boundaries

| Setting | Value |
|---|---|
| Phaser world size | 960 × 540 pixels |
| Valid `x` | 0 to 960 (inclusive) |
| Valid `y` | 0 to 540 (inclusive) |
| Player movement speed | 170 pixels/second |
| Player scale | 0.67 |
| Player physics body | 43 × 21 (before scaling) |
| World boundary collision | Enabled |
| Movement update rate | Maximum 15 updates/second |

Desk collision zones (handled by the client with Phaser Arcade Physics):

| Desk | Center | Size |
|---|---|---|
| Frontend | (240, 202) | 155 × 65 |
| Backend | (480, 202) | 155 × 65 |
| DevOps | (720, 202) | 155 × 65 |

The server **rejects** (silently ignores) a `player:move` when `x` or `y` is not a finite number, is outside the world bounds, `facing` is not a valid `Facing`, or `flipX` is not a boolean. Valid movement is saved on the player and broadcast with `player:moved`.

### 3.3 Select/cancel roles (E key)

| Event | Direction | Payload | Ack |
|---|---|---|---|
| `role:select` **(ack)** | Client → Server | `{ role: Role }` | `{ ok: true }` or error |
| `role:cancel` **(ack)** | Client → Server | `{}` | `{ ok: true }` or error |

- Frontend only offers role selection when the local avatar is near the correct desk.
- Server validates that the requested role exists and is not owned by a different player.
- Selecting a new role replaces the player's previous role (if any). The server does **not** temporarily reserve the old role.
- Selecting, changing, or cancelling a role resets that player's `ready` to `false`.
- After a successful change, the server broadcasts `room:update` to everyone.
- On an error, the frontend keeps the role shown by the last server state and displays a message.

Errors: `NOT_IN_ROOM`, `NOT_IN_LOBBY`, `INVALID_ROLE`, `ROLE_TAKEN`.

### 3.4 Ready state (R key)

| Event | Direction | Payload | Ack |
|---|---|---|---|
| `player:ready` **(ack)** | Client → Server | `{ ready: boolean }` | `{ ok: true }` or error |

- A player must have a role to set `ready: true`.
- Setting `ready: false` is allowed in the Lobby.
- The server broadcasts `room:update` after a valid change.

Errors: `NOT_IN_ROOM`, `NOT_IN_LOBBY`, `NO_ROLE`.

### 3.5 Start Mission

| Event | Direction | Payload | Response / behavior |
|---|---|---|---|
| `game:start` **(ack)** | Client → Server | `{}` | Host requests start; success `{ ok: true }`. |
| `game:started` | Server → All in room | `{ room: Room }` | Room stage is now `mission`. Every client enters `MissionScene`. |

The server accepts `game:start` **only if all four conditions are true**:

1. The sender is the current host.
2. The room contains exactly three players.
3. Each role is owned by exactly one player.
4. Every player is `ready: true`.

On success, the server sets `room.stage = 'mission'`, clears progress to three `false` values, records the mission start time, acknowledges success, and emits `game:started` with the updated Room. The order of ack and broadcast is **not guaranteed**; the client must use `game:started` to switch scenes, not just a successful ack.

The frontend enables **Start Mission** only when these conditions appear true, but the server checks them again.

Errors: `NOT_IN_ROOM`, `NOT_IN_LOBBY`, `NOT_HOST`, `NOT_ENOUGH_PLAYERS`, `NOT_ALL_READY`.

### 3.6 Team Chat (T key)

| Event | Direction | Payload | Behavior |
|---|---|---|---|
| `chat:send` | Client → Server | `{ text: string }` | Send a message in Lobby or Mission. No ack. |
| `chat:message` | Server → All in room | `ChatMessage` | Broadcast to **everyone, including sender**, in server arrival order. |

- Trim whitespace. Ignore empty messages and messages longer than 200 characters.
- The server fills in `playerId`, `user`, and `time`; clients must not provide or trust these fields.
- The frontend should show only `chat:message` broadcasts, **not** append a second local copy when sending.
- Never interpret chat text as HTML.

### 3.7 Code challenges (Run Tests)

| Event | Direction | Payload | Response / behavior |
|---|---|---|---|
| `challenge:submit` **(ack)** | Client → Server | `{ code: string }` | Success ack: `{ ok: true, passed: boolean, terminal: string }`. |
| `mission:progress` | Server → All in room | `{ progress: Progress, completed: number }` | Broadcast **only when a role changes from incomplete to passed**. |

- Every player submits **only their Monaco editor code**. The server gets their role from the player's server-side room state. **Do not send a role or client-calculated `passed`.**
- Maximum code length: 10,000 characters. Code must be a string.
- **Gemini AI decides PASS/FAIL** (team decision, replaces the earlier deterministic-rules plan). The server sends the task, acceptance criteria (`shared/mission01.md`), starter code and the player's code to Gemini (`server/src/aiReview.js`), and returns PASS/FAIL plus Gemini's explanation and hint as `terminal` text. The API key stays on the server only.
- **A review takes 1–15 seconds.** The server gives up after 15 s. The client must use a `challenge:submit` timeout of **at least 20 seconds** (not the 5 s from the example in section 1) and show a "Reviewing…" state meanwhile.
- One review at a time per player. A second `challenge:submit` while one is still running gets `REVIEW_IN_PROGRESS`.
- If Gemini is unreachable, times out, or no API key is configured, the ack is `REVIEW_UNAVAILABLE`. The player can simply try again.
- If the mission is reset while a review is running (a player left), the result is discarded and the ack is `NOT_IN_MISSION`.
- Challenge descriptions, starter code, and hints may remain in `client/src/game/data/challenges.ts`. Its local `checkDemoCode()` is only for offline UI testing; it is **not** authoritative in multiplayer.
- Never execute arbitrary submitted code directly with `eval`, `Function`, or unrestricted OS processes. The AI only reads the code; do not describe the review as real compilation or test execution.
- On a first PASS, set `room.progress[player.role] = true`, then broadcast `mission:progress` to all players. Subsequent PASS submissions for that role must **not** increment progress again.
- `completed` is the number of roles with `true` progress, from 0 through 3.
- **Important:** At `completed === 3`, the mission does **not** finish automatically. All clients unlock the Deploy phase; see the next section.

Errors: `NOT_IN_ROOM`, `NOT_IN_MISSION`, `NO_ROLE`, `INVALID_CODE`, `CODE_TOO_LONG`, `REVIEW_IN_PROGRESS`, `REVIEW_UNAVAILABLE`.

### 3.8 Deploy to Production (after Team Progress 3/3)

**This section is new in v1.0. It replaces the v0.1 rule that immediately finished the mission after all three challenges passed.**

| Event | Direction | Payload | Response / behavior |
|---|---|---|---|
| `deployment:request` **(ack)** | Client → Server | `{}` | The **host** clicks Deploy. Success `{ ok: true }`. |
| `mission:complete` | Server → All in room | `{ room: Room, durationMs: number }` | Deployment succeeded. Room stage is now `complete`; all clients show Results. |

Deploy is permitted only when:

1. The sender is the current host.
2. `room.stage === 'mission'`.
3. `room.progress.frontend`, `.backend`, and `.devops` are **all `true`**.

On success, the backend sets `room.stage = 'complete'`, calculates `durationMs` from the server's mission start time, acknowledges `{ ok: true }`, and broadcasts `mission:complete` **once** to all players. As with start, ack/broadcast delivery order is not guaranteed. The client changes to Results **only on `mission:complete`**, not on ack alone.

- Host sees **Deploy to Production** enabled at 3/3. Other players see **Waiting for host to deploy**.
- While awaiting an acknowledgement, disable the button to avoid duplicate clicks.
- The backend must reject duplicate deployment requests; only one completion broadcast is allowed.
- The results page uses `room.players`, `room.progress`, and `durationMs`. There is no separate results-fetch event for MVP.

Errors: `NOT_IN_ROOM`, `NOT_IN_MISSION`, `NOT_HOST`, `NOT_ALL_COMPLETE`, `ALREADY_COMPLETE`.

### 3.9 Leave, disconnect, reconnect and failure behavior

No additional event names are required for MVP:

| Situation | Required server behavior | Required frontend behavior |
|---|---|---|
| Player leaves during Lobby | Remove player, reassign host if necessary, send `room:update` | Return leaving player to Room Entry; others update players/roles |
| Player disconnects during Lobby | Same as leaving | Others show updated room |
| Player leaves/disconnects during Mission | **Abort this mission**. Remove player; set room stage to `lobby`, reset all progress and all remaining players' ready states; keep remaining players' roles; broadcast `room:update` | Remaining players return to Lobby, display "Player disconnected — mission reset" |
| Player disconnects after completion | Remove player and update the room for remaining clients; keep `stage = 'complete'` and the already shown results | Keep Results visible |
| Client temporarily loses server connection | Socket.IO connection ends; server applies the same disconnect rules | Show Disconnected; disable network actions; rejoin by room code and name after reconnect if the room is available |
| Last player leaves | Delete the room | A subsequent join with that old code fails with `ROOM_NOT_FOUND` |

For the MVP there is **no mid-mission resume**, no countdown/loss timer, and no Play Again event. To replay, users leave and create/join a new room. These can be added in a future contract version.

The frontend must listen for `room:update` changing `stage` from `mission` back to `lobby`; do **not** rely only on `game:started` and `mission:complete` for scene changes.

---

## 4. Error codes

All ack errors use `{ ok: false, error: ErrorCode }`.

| Error code | Meaning |
|---|---|
| `INVALID_NAME` | Name missing or longer than 16 characters after trimming |
| `INVALID_ROOM_CODE` | Room code is not four uppercase letters |
| `ROOM_NOT_FOUND` | No room exists with that code |
| `ROOM_FULL` | Room already has three players |
| `GAME_ALREADY_STARTED` | Cannot join after Lobby stage |
| `ALREADY_IN_ROOM` | Socket is already in a CODE RED! room |
| `NOT_IN_ROOM` | Player has not joined a room |
| `NOT_IN_LOBBY` | Lobby-only action attempted outside Lobby |
| `NOT_IN_MISSION` | Mission-only action attempted outside Mission |
| `INVALID_ROLE` | Unknown role value |
| `ROLE_TAKEN` | Another player already has the requested role |
| `NO_ROLE` | Player needs to choose a role first |
| `NOT_HOST` | Only room host can perform this action |
| `NOT_ENOUGH_PLAYERS` | Mission requires exactly three players |
| `NOT_ALL_READY` | Some roles are missing or some players are not ready |
| `INVALID_CODE` | Submitted code is not a string |
| `CODE_TOO_LONG` | Code is longer than 10,000 characters |
| `REVIEW_IN_PROGRESS` | This player's previous submission is still being reviewed |
| `REVIEW_UNAVAILABLE` | Gemini could not review the code (no API key, timeout, or service error); try again |
| `NOT_ALL_COMPLETE` | All three challenges have not passed yet |
| `ALREADY_COMPLETE` | Deployment has already completed |

Socket disconnection or a response timeout is **not** an application error code. Display an appropriate connection message instead.

---

## 5. Full game flow

```text
Player A (host)              Server                     Player B + Player C
     |                          |                                |
     |-- room:join {name} ----->| create KQZD                    |
     |<- ack {ok, room, you} ---|                                |
     |                          |<-- room:join {name, roomCode} --|
     |<--------- room:update ---+---------- room:update -------->|
     |                          |                                |
     |-- player:move ---------> |--- player:moved -------------->|
     |-- role:select ---------> |--- room:update --------------->|
     |-- player:ready --------> |--- room:update --------------->|
     |                          | (all 3 choose roles + Ready)   |
     |-- game:start ----------> | validate 3 players/roles/Ready|
     |<- game:started ----------+---------- game:started ------->|
     |                          | stage = mission                |
     |-- challenge:submit ----->| check A's code                 |
     |<- ack {passed,terminal} -|                                |
     |<- mission:progress ------+---------- mission:progress --->|
     |                          | (B and C pass as well)         |
     |<- mission:progress 3/3 --+---------- mission:progress --->|
     |                          |                                |
     | [Deploy button enabled]  |   [Waiting for host to deploy] |
     |-- deployment:request --> | confirm all 3 passed          |
     |<- ack {ok:true} ---------| stage = complete               |
     |<- mission:complete ------+---------- mission:complete --->|
     |                          |                                |
     | [Results Screen]         |             [Results Screen]   |
```

**One complete match:** Room Entry → Lobby → roles/Ready → Mission → three PASS results → Team Progress 3/3 → host Deploy → Results.

---

## 6. Frontend integration checklist

| File | What to implement |
|---|---|
| `client/src/network/socket.ts` | One shared Socket.IO client instance; dev server URL; connect/disconnect handling |
| `client/src/components/RoomEntry.tsx` | Name field, Create Room, Join with 4-letter code, error display |
| `client/src/App.tsx` | Store `myPlayerId`, `room`, chat messages and scene stage; listen to server events; remove multiplayer demo assumptions |
| `client/src/components/PlayerBar.tsx` | Show `room.players`, real roles and Ready status; identify host |
| `client/src/game/scenes/LobbyScene.ts` | Emit movement/role requests; show other players; listen to server-backed role state |
| `client/src/components/TeamChat.tsx` | Send `chat:send`, render `chat:message` |
| `client/src/components/CodeWorkspace.tsx` | Send `challenge:submit`, show ack `terminal`; do not declare PASS locally |
| `client/src/components/DeployPanel.tsx` | Enable host Deploy at 3/3; emit `deployment:request` |
| `client/src/components/ResultsScreen.tsx` | Render on `mission:complete` with `durationMs` and role results |

These paths describe **planned integration targets**. A file mentioned here does not necessarily exist yet.

## 7. Backend implementation checklist

| File | What to implement |
|---|---|
| `server/src/index.js` | Express + HTTP + Socket.IO setup, development CORS |
| `server/src/rooms.js` | In-memory room Map, room code creation, join/leave, avatar assignment, host reassignment |
| `server/src/socketHandlers.js` | Register all socket event handlers, validate membership/stage, send acks and broadcasts |
| `server/src/gameState.js` | Role/ready rules, stage transitions, progress, mission start time and completion |
| `server/src/challenges.js` | The three Mission 01 tasks and terminal messages |
| `server/src/aiReview.js` | Sends a submission to Gemini and reads back PASS/FAIL, explanation and hint |

## 8. Recommended build and test order

1. **Room Entry:** Three browser tabs join the same 4-letter code; fourth is rejected; closing a tab updates the others.
2. **Movement:** Each browser sees the other two avatars move.
3. **Roles/Ready:** No duplicate roles; status is identical in all tabs.
4. **Chat:** A message sent in one tab appears once in all three.
5. **Start:** Only the host can start when all three are ready; all tabs enter Mission together.
6. **Run Tests:** Each player submits code; only the server determines PASS; all tabs display identical progress.
7. **Deploy:** At 3/3, only host can deploy; all tabs enter Results; repeated Deploy cannot complete twice.
8. **Disconnect:** Disconnect one player during Mission; the others return to Lobby with progress reset.

---

## 9. Changes from the team's v0.1 draft

- **Preserved** existing event names: `room:join`, `room:update`, `player:move`, `player:moved`, `role:select`, `role:cancel`, `player:ready`, `game:start`, `game:started`, `chat:send`, `chat:message`, `challenge:submit`, `mission:progress`, and `mission:complete`.
- **Added** `deployment:request` so completion happens after the Deploy action, not automatically at 3/3.
- **Added** `durationMs` to `mission:complete` for the Results screen.
- **Resolved** v0.1 questions for this MVP: frontend builds Room Entry; a disconnect during Mission resets to Lobby; timer, mid-mission resume and replay are out of scope.
- **Clarified** acknowledgements, error codes, host authority, duplicate PASS handling, and room/scene synchronization.

**Team agreement needed:** This document contains proposed decisions beyond v0.1 (especially **host-only Deploy** and **reset-on-disconnect**). The backend and frontend owners should approve them together before implementation.
