// The single state store: every number the HUD, the round flow and the bots read
// lives here, in one plain object, so a round reset is one function call. The
// simulation modules never keep their own copy of round state.
export const PHASE = {
  BUY: 'buy', // freeze time: buy menu open, nobody moves
  LIVE: 'live', // round in play
  PLANTED: 'planted', // charge planted, countdown to detonation
  END: 'end', // round banner, then the next round starts
  MATCH: 'match', // match decided, overlay offers a restart
};

export const WIN_ROUNDS = 5; // first team to 5 round wins takes the match
export const ROUND_TIME = 100; // seconds per round
export const BUY_TIME = 9; // freeze time at the start of each round
export const PLANT_TIME = 35; // seconds from plant to detonation
export const START_MONEY = 800;
export const REWARD_WIN = 600;
export const REWARD_LOSS = 300;
export const REWARD_KILL = 200;
export const REWARD_PLANT = 300;
export const REWARD_DEFUSE = 300;

export function createState() {
  return {
    phase: PHASE.BUY,
    phaseT: BUY_TIME, // seconds left in the current phase
    round: 1,
    score: { vanguard: 0, ember: 0 }, // rounds won
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    plants: 0,
    defuses: 0,
    charge: 'carried', // carried | planted | defused | detonated
    site: null, // 'A' | 'B' while the charge is planted
    plantProgress: 0, // 0..1 while the player channels a plant
    defuseProgress: 0, // 0..1 while a defender channels a defuse
    defuser: null, // bot currently defusing, or null
    roundWinner: null, // 'vanguard' | 'ember' once the round ends
    roundReason: '', // 'elimination' | 'detonation' | 'defuse' | 'time'
    matchWinner: null,
    feed: [], // { text, team, t } kill-feed lines, newest first
    elapsed: 0,
  };
}

export function resetRound(state) {
  state.phase = PHASE.BUY;
  state.phaseT = BUY_TIME;
  state.charge = 'carried';
  state.site = null;
  state.plantProgress = 0;
  state.defuseProgress = 0;
  state.defuser = null;
  state.roundWinner = null;
  state.roundReason = '';
}

export function award(state, amount) {
  state.money = Math.min(9000, state.money + amount);
}

export function pushFeed(state, text, team) {
  state.feed.unshift({ text, team, t: state.elapsed });
  if (state.feed.length > 5) state.feed.length = 5;
}
