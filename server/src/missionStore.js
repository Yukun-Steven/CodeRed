import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../../shared/mission.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(schema);
export const MAX_IMPORT_BYTES = 1024 * 1024;

export function validateMission(mission) {
  if (!validate(mission)) throw new Error('INVALID_MISSION: ' + ajv.errorsText(validate.errors));
  if (new Set(mission.seats.map(s => s.seatId)).size !== mission.seats.length) {
    throw new Error('DUPLICATE_SEAT');
  }
  if (mission.supportedPlayerCounts.length !== 1 || mission.supportedPlayerCounts[0] !== mission.seats.length) {
    throw new Error('INVALID_PLAYER_COUNT');
  }
  const roles = mission.seats.map(s => s.roleId).sort().join(',');
  if (roles !== 'backend,devops,frontend') throw new Error('UNSUPPORTED_ROSTER: stage one requires three distinct standard roles');
  if (!Number.isSafeInteger(mission.revision)) throw new Error('INVALID_REVISION');
  return mission;
}

export function readMissionFile(filename) {
  if (statSync(filename).size > MAX_IMPORT_BYTES) throw new Error('MISSION_TOO_LARGE');
  const bytes = readFileSync(filename);
  if (bytes.length > MAX_IMPORT_BYTES) throw new Error('MISSION_TOO_LARGE');
  return validateMission(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
}

export function missionSummary(m) {
  return { missionId: m.missionId, revision: m.revision, title: m.title,
    description: m.description, supportedPlayerCounts: m.supportedPlayerCounts, attribution: m.attribution };
}

// Explicit allowlist. No reviewer criteria or expected answers leave the backend.
export function publicMission(m) {
  return { ...missionSummary(m), seats: m.seats.map(({ seatId, roleId, roleLabel, challenge: c }) => ({
    seatId, roleId, roleLabel, challenge: {
      title: c.title, description: c.description, filename: c.filename, editorLanguage: c.editorLanguage,
      starterCode: c.starterCode, initialTerminal: c.initialTerminal, hint: c.hint, testPreview: c.testPreview,
    },
  })) };
}

export function openMissionStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`CREATE TABLE IF NOT EXISTS missions (
    mission_id TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL,
    PRIMARY KEY (mission_id, revision)
  )`);
  return {
    import(mission) {
      validateMission(mission);
      const document = JSON.stringify(mission);
      if (Buffer.byteLength(document) > MAX_IMPORT_BYTES) throw new Error('MISSION_TOO_LARGE');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT 1 FROM missions WHERE mission_id = ? AND revision = ?').get(mission.missionId, mission.revision)) {
          throw new Error('MISSION_ALREADY_EXISTS');
        }
        db.prepare('INSERT INTO missions VALUES (?, ?, ?)').run(mission.missionId, mission.revision, document);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    get(missionId, revision) {
      if (typeof missionId !== 'string' || !Number.isSafeInteger(revision) || revision < 1) return null;
      const row = db.prepare('SELECT document FROM missions WHERE mission_id = ? AND revision = ?').get(missionId, revision);
      return row ? JSON.parse(row.document) : null;
    },
    list() {
      return db.prepare(`SELECT document FROM missions m WHERE revision =
        (SELECT MAX(revision) FROM missions WHERE mission_id = m.mission_id) ORDER BY mission_id`)
        .all().map(row => missionSummary(JSON.parse(row.document)));
    },
    close() { db.close(); },
  };
}

let defaultStore;
export function getMissionStore() {
  defaultStore ??= openMissionStore(process.env.MISSION_DB_PATH || fileURLToPath(new URL('../data/missions.sqlite', import.meta.url)));
  return defaultStore;
}
