const adjectives = [
  "bold", "calm", "dark", "fast", "keen",
  "loud", "neat", "pure", "safe", "warm",
  "blue", "cold", "deep", "firm", "gray",
  "lean", "mild", "open", "rare", "soft",
];

const nouns = [
  "arc", "bay", "cup", "dot", "elm",
  "fox", "gem", "hub", "ink", "jet",
  "key", "log", "map", "net", "orb",
  "pin", "ray", "sun", "tip", "vue",
];

export function randomName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}-${noun}-${num}`;
}
