# CODE RED!

**A three-player cooperative coding game built for Hack the Change YYC 2026.**

It's launch day, and three things just broke. The frontend counter is wrong, the inventory system accepts orders it can't fulfill, and the reverse proxy points to the wrong port. Each player takes on a different engineering role, fixes their part of the app, and coordinates with the team.

We built **CODE RED!** for **Prompt 2** to help students practice debugging, communication, and teamwork in a simulated software launch.

## Play Online

The original team game is available at **[https://codered.wiki](https://codered.wiki)**. The training-case features in this Fork currently require the local setup below; they have not been deployed to that site.

In this Fork, one player selects a training case, creates a room, and shares the four-letter room code. Two teammates connect to the same frontend and join using that code.

For the best experience, use a desktop or laptop with a keyboard.

## How to Play

1. Start this Fork locally using the instructions below. Open the frontend with two teammates, or use three browser tabs to try all three roles yourself.
2. One player selects a training case, then **Create New Room** and shares the four-letter room code. The other two enter the code and select **Join Team**.
3. Move to a workstation and press **E** to choose a role. Each player must have a different role: **Frontend**, **Backend**, or **DevOps**.
4. Press **R** or use the **Ready** button. When all three players are ready, the **host** selects **Start Mission** to begin the selected case (initially **Launch Day**).
5. Edit the code in the Monaco editor and select **Run Tests** for feedback. The editor is locked while the backend reviews your submission with Gemini AI.
6. Each passing submission updates **Team Progress** for all three players. At **3/3**, the host selects **Deploy to Production** to finish the simulated launch and show the results.

**Run Tests** requests an AI code review; it does not compile or execute submitted code. **Deploy to Production** completes the game mission; it does not publish a real application.

Click the square in the top-left corner to leave the room and return to Room Entry. If a player leaves or disconnects during a mission, the mission resets to the lobby and the remaining players must ready up again.

### Controls

| Key / Button | Action |
| --- | --- |
| `W` `A` `S` `D` or arrow keys | Move in the lobby |
| `E` | Select or cancel a role at a workstation |
| `R` | Toggle ready status in the lobby |
| `T` | Open team chat |
| `Enter` in chat | Send a message |
| `Esc` | Close team chat |
| Top-left square | Leave the room and return to Room Entry |

## Run Locally

Install **Node.js 22.13 or newer (Node.js 24 recommended)** and **npm**, then clone the repository.

```bash
git clone https://github.com/Yukun-Steven/CodeRed.git
cd CodeRed
```

### 1. Configure the backend

Copy `server/.env.example` to `server/.env`. Set `GEMINI_API_KEY` to your Gemini API key from [Google AI Studio](https://aistudio.google.com/). Keep this file local; never commit the key or put it in the frontend.

| Variable | Purpose |
| --- | --- |
| `PORT` | Backend port; defaults to `3001` |
| `CLIENT_ORIGIN` | Allowed frontend origin; defaults to `http://localhost:5173` |
| `GEMINI_API_KEY` | Required for code review |
| `GEMINI_MODEL` | Gemini model used for review; see `.env.example` for the configured value |

Without a valid Gemini API key, the lobby can still run, but **Run Tests** cannot return a successful review. Review service failures are reported in the editor terminal.

### 2. Start the backend

From the project root, run the following commands in your first terminal.

```bash
cd server
npm ci
npm run mission:import -- ../shared/missions/launch-day.json
npm run dev
```

### 3. Start the frontend

Open a second terminal at the project root and run the following commands.

```bash
cd client
npm ci
npm run dev
```

Open the game at **[http://localhost:5173](http://localhost:5173)**. The backend runs on port `3001` by default. Keep both terminals running while playing.

The frontend connects to `http://localhost:3001` by default. If the backend runs at another address, set `VITE_SOCKET_URL` in `client/.env` and restart the frontend. Set the backend's `CLIENT_ORIGIN` to the frontend origin you use.

Cases are stored in SQLite at `server/data/missions.sqlite` (ignored by Git). Set `MISSION_DB_PATH` to override the database path. Room state is still stored in memory; restarting the backend clears rooms and progress, but keeps imported cases.

### Included training cases

All three cases use one Frontend, one Backend and one DevOps seat (3 players).

| Case | Frontend | Backend | DevOps |
| --- | --- | --- | --- |
| Launch Day | React counter updates | Inventory validation | Reverse proxy port |
| Payment Service Outage | In-flight checkout guard | Idempotent ledger retries | Container health check |
| Incident Dashboard Recovery | Immutable chronological sorting | One-based pagination | Container log rotation |

The two additional cases were created for this Fork after the hackathon; the original game remains credited to sisyphus. Their infrastructure snippets use fictional image names and are reviewed as text, not deployed.

Import the additional cases from the server directory, then choose **Refresh cases** on the entry screen:

```bash
npm run mission:import -- ../shared/missions/payment-outage.json
npm run mission:import -- ../shared/missions/incident-dashboard.json
```

### Import training cases

From `server`, run `npm run mission:import -- <path-to-case.json>`. Import Launch Day once using the command above; repeating an existing case ID/revision is rejected without changing it. For a new version, increment `revision`. Validation failures exit with an error and do not insert a case.

The entry screen lists the latest imported revision of each case. Select a case before creating a room; teammates only need its room code. A room pins that case and revision, so importing an update cannot change an ongoing exercise. Refresh the case list after importing. An empty database shows no available cases and disables room creation; joining existing rooms is independent of case selection.

Stage one supports three seats: one each of Frontend, Backend and DevOps. Other rosters are rejected during import. See [case format](shared/mission-format.md), [JSON Schema](shared/mission.schema.json) and [Launch Day](shared/missions/launch-day.json). Run `npm test` in `server` for SQLite and Socket.IO integration tests. Tests use a controlled reviewer and do not call Gemini.

This Fork extends the original team project into a training tool. The original project history, sisyphus team attribution, and copyright below remain intact.

## AI Usage Disclosure

Our team defined the game's theme, concept, and overall structure. We used AI tools to write and revise code based on our design, and to generate visual assets for the frontend.

Our use of AI included:

- **Code development:** AI assisted with implementation, debugging, and revisions.
- **Visual assets:** AI generated artwork used in the game's frontend.
- **In-game code review:** The backend uses Gemini AI to review players' code submissions and provide feedback. Submitted code is reviewed, not executed.

The project combines our team's design decisions with AI-assisted implementation and artwork.

## Acknowledgments

- **React**: Frontend user interface.
- **Phaser**: Game scenes, player movement, and interactions.
- **Monaco Editor**: In-game code editor.
- **Socket.IO**: Real-time multiplayer synchronization and team chat.
- **Express**: Backend web server.
- **Google Gemini**: AI-powered code review and feedback.
- **Hack the Change YYC 2026**: The hackathon that inspired this project.

## Copyright

Copyright © 2026 the CODE RED! team. All rights reserved.

Third-party software and assets are subject to their respective licenses.

---

**Project**: CODE RED!  
**Team**: sisyphus
**Maintained by**: sisyphus
