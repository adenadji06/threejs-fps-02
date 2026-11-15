// The look plan, in one place: a dusk foundry yard — cold steel, warm ember light.
// Every colour in the game and the page comes from these six names; the CSS in
// index.html uses the same six custom properties.
export const PALETTE = {
  canvas: '#211a15', // dusk sky / page background
  surface: '#2e2a25', // concrete and steel panels
  hairline: '#4a4238', // crates, trim, low cover
  ink: '#ece5d8', // warm off-white: HUD text, tracer light
  muted: '#9a8f80', // secondary text, distant steel
  accent: '#ff7a1a', // ember orange: sites, tracers, the enemy team
  ally: '#57b8ff', // Vanguard blue: the player's team
};

export function shade(name) {
  return PALETTE[name];
}
