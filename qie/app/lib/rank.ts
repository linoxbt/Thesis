/**
 * How the leaderboard ranks creators (and the "#rank" shown elsewhere).
 *
 * Skill per scored call, shrunk toward zero for short records: total skill
 * divided by (scored calls + PRIOR). A handful of lucky long shots (from one
 * wallet or many) can't outrank a long record of real edge; with more calls
 * the score approaches the plain average. Creators need MIN_SCORED scored
 * calls to be ranked at all.
 */
export const MIN_SCORED = 5;
export const PRIOR = 10;

/** The ranking score, in bps: skill / (calls + PRIOR). */
export const rankScore = (skillBps: number, calls: number) => skillBps / (calls + PRIOR);

/** Plain skill per call, for display. */
export const perCallBps = (skillBps: number, calls: number) => (calls ? skillBps / calls : 0);
