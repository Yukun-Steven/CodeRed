import { getMissionStore, readMissionFile } from './missionStore.js';

let store;
try {
  const filename = process.argv[2];
  if (!filename) throw new Error('Usage: npm run mission:import -- <case.json>');
  const mission = readMissionFile(filename);
  store = getMissionStore();
  store.import(mission);
  console.log(`Imported ${mission.missionId} revision ${mission.revision}: ${mission.title}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { store?.close(); }
