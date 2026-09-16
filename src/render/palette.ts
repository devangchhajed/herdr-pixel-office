/** Colors are packed 0xRRGGBB. -1 means "transparent" and is never drawn. */
export type Color = number;

export const TRANSPARENT: Color = -1;

export const PALETTE = {
  floorA: 0x2e323d,
  floorB: 0x333743,
  floorSeam: 0x272b34,
  wall: 0x1c1f27,
  wallTrim: 0x252935,
  rug: 0x38455a,
  rugAccent: 0x415068,

  deskTop: 0x7a5c3c,
  deskGrain: 0x6d5235,
  deskEdge: 0x54402b,
  chair: 0x3d4250,
  chairShade: 0x333747,

  monitorBody: 0x181b22,
  laptopBase: 0xa8b0bd,
  laptopKeys: 0x3f4654,
  laptopPad: 0x8992a3,
  monitorStand: 0x22262f,
  screenOff: 0x2b303a,

  speechBg: 0xf4f6fa,
  speechEdge: 0x9aa3b4,
  speechInk: 0x2b303a,

  plaqueFrame: 0x2f3542,
  plaqueSurface: 0xcdd4de,
  plaqueInk: 0x1d2330,
  clockFrame: 0x2a2f3a,
  clockSurface: 0x1b2028,
  clockInk: 0xffb454,
  alertFrame: 0xc4483c,
  alertSurface: 0xffe9a8,
  alertInk: 0x2a1c0a,
  alertIdleSurface: 0xb08a5c,
  alertIdleInk: 0x3a2a18,

  clockCase: 0x111319,
  clockBezel: 0x2a2f3a,
  clockLit: 0xffb454,
  clockDim: 0x2e2416,

  ttTop: 0x2f6f8f,
  ttEdge: 0x24566e,
  ttLine: 0xd8e4ec,
  ttNet: 0xc7d2dc,
  foosField: 0x2f6b46,
  foosFrame: 0x7a5c3c,
  foosRod: 0xb9c2cf,
  foosRed: 0xe0574d,
  foosBlue: 0x4f8ef7,
  foosGoal: 0x14161c,

  diningTop: 0x9a6f47,
  diningEdge: 0x6b4a2f,
  diningChair: 0x4a5163,
  diningPlate: 0xe8ecf2,

  barTop: 0x8a5a3c,
  barFront: 0x5e4630,
  barShelf: 0x2a2018,
  barBottleA: 0x4fa36b,
  barBottleB: 0xd2564a,
  barBottleC: 0xe0b44f,
  barGlass: 0xbfe6f0,

  poolFelt: 0x2c7a4b,
  poolRail: 0x6b4a2f,
  poolPocket: 0x14171d,
  ball: 0xf2f4f8,
  ballRed: 0xd2564a,
  ballYellow: 0xe0b44f,
  paddle: 0xc4483c,
  paddleGrip: 0x8a6a45,
  cue: 0xd8bb85,
  cup: 0xf2f4f8,
  cupLid: 0xb9452f,

  petFur: 0xc98b52,
  petFurDark: 0x9c6a3d,
  petHeart: 0xe0607a,

  gaugeTrack: 0x2c313c,
  gaugeLow: 0x5fbf7f,
  gaugeMid: 0xe0b44f,
  gaugeHigh: 0xe06c5a,

  page: 0xe8ecf2,
  pageEdge: 0xa9b2c2,

  sofa: 0x4a5573,
  sofaShade: 0x3c4762,
  sofaCushion: 0x566283,
  tableTop: 0x8a6a45,
  tableShade: 0x6d5235,
  benchTop: 0x7d6349,
  coffeeBody: 0x2f3440,
  coffeePot: 0x8c4a3a,
  frame: 0x6b5436,
  canvasA: 0x577a9b,
  canvasB: 0x8a6a8f,
  shelf: 0x6d5235,
  book: 0xc2705a,
  bin: 0x454b5c,

  plantLeaf: 0x3fa35b,
  plantLeafDark: 0x2f7e45,
  plantPot: 0x8a5a3c,
  cooler: 0x9fd8e8,
  coolerBody: 0xd8dee9,

  text: 0xc8cdd8,
  textDim: 0x767d8f,
  textBright: 0xf0f3f8,
  panel: 0x21242d,
  panelAlt: 0x1a1d24,
  accent: 0x7fb3ff,
  selection: 0xffffff,
} as const;

/** Status colors. These drive the monitor glow, the name tag and the roster. */
export const STATUS_COLOR: Record<string, Color> = {
  working: 0x8ce39b,
  blocked: 0xffb454,
  done: 0x7fb3ff,
  idle: 0x8b93a7,
  unknown: 0x5a6070,
};

export const SKIN_TONES: Color[] = [
  0xf7dcc0, 0xf1c9a5, 0xd9a377, 0xb57c50, 0x8d5a34, 0x6b4226,
];

export const HAIR_COLORS: Color[] = [
  0x2b2118, 0x4a2f1d, 0x7a4a22, 0x151515, 0xb08040, 0x5a3a5a,
];

export const SHIRT_COLORS: Color[] = [
  0x4f8ef7, 0xe0674f, 0x3fb98a, 0xb06fd4, 0xe8b33c, 0x6c7bd1,
];

export const PANTS_COLORS: Color[] = [
  0x39405a, 0x2f3442, 0x4a3b52, 0x33454a, 0x44404d, 0x2b3a4a,
];

/** Tints for workspace areas, picked by hashing the workspace id. */
export const AREA_TINTS: Color[] = [
  0x3a4a63, 0x4a3f5e, 0x3d5450, 0x5a4740, 0x40485c, 0x53414f,
];

export function areaTint(label: string): Color {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return AREA_TINTS[h % AREA_TINTS.length];
}

export function shade(color: Color, factor: number): Color {
  if (color < 0) return color;
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((color & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}

export function mix(a: Color, b: Color, t: number): Color {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
