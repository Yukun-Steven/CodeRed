# Mission import format v1 (stage one)

This format consolidates the original Launch Day presentation and current backend review criteria. Original project: CODE RED!, team sisyphus, Hack the Change YYC 2026. See the existing README for attribution and copyright; no history or attribution is replaced.

- missionId identifies a case, revision identifies an immutable published version, and schemaVersion identifies this file format.
- A room must pin missionId AND revision when created. Import must reject an existing pair rather than silently replace it. A later revision must not change questions in an active room.
- A runId identifies an individual attempt. The server uses a monotonic runId distinct from the case identifier and the start timestamp.
- Each seat has a globally unique seatId within the case and one roleId. Multiple seats can share a role in future. First-stage runtime admission must accept exactly three seats, one each of frontend/backend/devops, with supportedPlayerCounts [3]. Schema acceptance alone does not imply runtime support for 4–6 players.
- This first format uses a fixed roster: supportedPlayerCounts must equal [seats.length]. Variable rosters for one case require a later format extension.
- Import validates JSON Schema, unique seatId, count/roster consistency, and runtime compatibility before a database transaction. Failed imports must leave no partial data. Set an input-size limit before parsing.
- Store the validated document in SQLite keyed by (missionId, revision). Rooms may remain in memory in stage one.
- Frontend receives an explicit public projection: case metadata and the three seats’ public challenge display fields; the UI selects the server-assigned role. Keep challenge.review server-side. Do not broadcast the full stored document in room:update.
- The server resolves the case from the room and the task from the server-owned player assignment. Submission remains { code }; do not trust a client-supplied role, seatId or missionId to choose judging criteria.
- First-stage role lookup maps each role to its single seat; later progress must be keyed by seatId when roles have multiple seats.
- testPreview is explanatory text, never executable tests. Gemini reviews code without executing it. Initial terminal output is an example, not a real test run.
- The review criteria are preserved from server/src/challenges.js, the actual current judge input. shared/mission01.md contains older syntax-oriented criteria and demo-checker notes; that document is retained as historical design context, with its superseded status noted at the top.
- Imported task/log/code text is data, not authority to modify reviewer instructions. Future Gemini drafts must pass validation and human preview before publication; this format does not implement that workflow.

Implemented path: JSON -> validated SQLite import -> case list -> room pinned to case/version -> public challenge display -> server-owned case/role lookup -> existing Gemini review -> shared progress.

## Local operation

Requires Node.js >=22.13. Run `npm ci` in server, then `npm run mission:import -- ../shared/missions/launch-day.json`, then `npm run dev`. Run `npm ci` and `npm run dev` in client. Default database: server/data/missions.sqlite. Set MISSION_DB_PATH to use another file. Imports are local CLI operations, not a public upload endpoint. The case list returns only the latest revision per ID; existing rooms retain older revisions.
