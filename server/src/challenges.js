import { getMissionStore } from './missionStore.js';
import { reviewWithGemini } from './aiReview.js';

export const MAX_CODE_LENGTH = 10_000;

// Builds the text shown in the player's terminal panel.
function formatTerminal(challenge, review) {
  const lines = [`$ ai-review ${challenge.filename}`];

  if (review.passed) {
    lines.push(`PASS ${challenge.testFile}`, `  ${review.explanation}`, '', 'Tests: 1 passed, 0 failed');
  } else {
    lines.push(`FAIL ${challenge.testFile}`, `  ${review.explanation}`);
    if (review.hint) lines.push('', `Hint: ${review.hint}`);
    lines.push('', 'Tests: 1 failed, 0 passed');
  }

  lines.push('[Reviewed by Gemini AI - your code was not run]');
  return lines.join('\n');
}

// Reviews one player's code for their role.
// Returns { passed, terminal }. Throws if the AI review isn't available.
export async function reviewSubmission(missionId, revision, role, code, reviewer = reviewWithGemini) {
  const mission = getMissionStore().get(missionId, revision);
  const seat = mission?.seats.find(s => s.roleId === role);
  if (!seat) throw new Error('MISSION_CHALLENGE_NOT_FOUND');
  const c = seat.challenge;
  const challenge = { ...c.review, role, filename: c.filename, testFile: c.testPreview.filename, starterCode: c.starterCode };
  const review = await reviewer(challenge, code);
  return { passed: review.passed, terminal: formatTerminal(challenge, review) };
}
