/**
 * The Monzone palette (sRGB hex), hand-tuned from photo medians of the village
 * (.research/monzone-reference.md §2). Every colour the renderer and HUD draw
 * comes from here.
 *
 * @module render/palette
 */
export const PALETTE = {
  outline: 0x17161a,
  cobbleDark: 0x363b38,
  stoneDark: 0x5f5a51,
  stoneMid: 0x8b8170,
  stoneLight: 0xb3a78f,
  limestone: 0xcfccc0,
  marbleWhite: 0xf2efe6,
  plasterGrey: 0xbdbbb6,
  plasterCream: 0xe3d3ad,
  plasterOchre: 0xd4a85e,
  plasterPink: 0xd8a18c,
  roofTileLight: 0xd98f6c,
  roofTile: 0xb0664b,
  woodBrown: 0x4a3222,
  shutterGreen: 0x3d6155,
  grassDry: 0xb4b06a,
  grass: 0x7d9447,
  forestLight: 0x62783f,
  forest: 0x47592f,
  forestDark: 0x2c3d22,
  conifer: 0x1b2c24,
  dirtTrack: 0x8f7a58,
  waterShallow: 0x8db4b0,
  waterDeep: 0x3f6d63,
  asphalt: 0x4b4d50,
  asphaltWorn: 0x74746f,
  carabinieriBlue: 0x1d2b4f,
  signalRed: 0xb8312b,
  signYellow: 0xf0c93c,
  flameOrange: 0xe8762c,
  // Not from the village photos: what the people and animals wear and bleed. A flat cap's tweed in two muted weaves, worn
  // dark leather shoes, the pink of a snout or an udder, a dark nose, a cow's pale horn, and a pool of blood, dark red as it
  // soaks into stone and asphalt.
  tweedBrown: 0x6e624d,
  tweedGrey: 0x5c5d55,
  shoe: 0x2e2621,
  snoutPink: 0xe2a29a,
  nose: 0x1c1a19,
  horn: 0xd8cdb4,
  blood: 0x6b0d10,
  // The ATR 220 "Swing" in Trenitalia's DPR livery (render/train), between it.wikipedia "Livrea DPR"'s RAL and Pantone swatches
  // and samples of Commons photos of units at Aulla, Fivizzano-Gassano and Lucca: the RAL 9006 silver side, the RAL 7021 window
  // band and cab panels, the blue of the roof, cantrail and hoods (the photos' brighter blue, not RAL 5002's), the front's RAL
  // 3020 red band, the gommagutta yellow swoosh and line, the Pantone 2296 lime doors, and the dark underframe and bogies.
  dprSilver: 0xb8bcbc,
  dprWindow: 0x2a2f33,
  dprBlue: 0x1f4fa8,
  dprRed: 0xc8161e,
  dprYellow: 0xf5b800,
  dprLime: 0xa8c23a,
  dprUnder: 0x2b2b2d,
  // Night and weather (render/sky): window glass by day, lit windows, lanterns and their light, headlight beams, rain, snow, lightning.
  windowGlass: 0x323a46,
  windowLit: 0xffc56e,
  windowAmber: 0xf09a4c,
  // A train's saloon at night (render/train): the cool white of LED strip lighting, against the homes' warm lamplight.
  cabinLit: 0xe4ecf0,
  lanternIron: 0x26241f,
  lampLight: 0xffcf8a,
  headlight: 0xfff1d0,
  rain: 0xb4c2d2,
  snowFlake: 0xf4f6fa,
  bolt: 0xe4e9ff,
  // Sky light (render/sky/light): the sun at 50° (its hue then follows the air mass), the moon, the hemisphere's sky and
  // ground by the sun's elevation (noon ≥ 30°, low sun, golden hour, sunset, blue hour, nautical twilight, night), the grey
  // of an overcast sky, a lightning flash, fog (its albedo, ≈ 0.83 linear: a thick fog reflects most light), slush ruts in snow.
  sun: 0xfff0d8,
  moonlight: 0x9fb4e0,
  skyNoon: 0xdbe8f5,
  groundNoon: 0x9a8a68,
  skyLow: 0xd8dce6,
  groundLow: 0x93795a,
  skyGolden: 0xdcbcaa,
  groundGolden: 0x8a6646,
  skySunset: 0xb49aa6,
  groundSunset: 0x684a40,
  skyBlueHour: 0x5e70a8,
  groundBlueHour: 0x2e3040,
  skyNautical: 0x4a5a8c,
  groundNautical: 0x22222e,
  skyNight: 0x46557f,
  groundNight: 0x1e1e28,
  skyOvercast: 0xa4aab2,
  flash: 0xdfe6ff,
  fog: 0xe8ebee,
  snowRut: 0x4a4640,
  // Snow lying on the ground, roofs and canopies (render/sky/surface): off-white, ≈ 0.72 linear, so a sunlit slope keeps its facets.
  snow: 0xdcdfe6,
  // The railway's static parts (render/rail, render/stations), estimated from photos of the line: grey limestone ballast, the
  // prestressed-concrete sleepers and UNI 60 rail of the 2010–12 renewal (rusty, its head polished where tyres cross it), worn
  // concrete crossing panels, the white barrier housing, the road light's grey pole and black back plate, a grey equipment
  // cabinet, the dark of a tunnel's mouth, a platform's concrete kerb, the blue of RFI's name boards (RAL 5017) and a station
  // canopy's grey metal (Gragnola's).
  ballast: 0x7f7a70,
  sleeperConcrete: 0xa9a49a,
  railSteel: 0x4d4640,
  railHead: 0x9c9a94,
  crossingPanel: 0x85827a,
  barrierWhite: 0xe4e2da,
  signalPole: 0x8d9190,
  signalBlack: 0x1e1e20,
  cabinetGrey: 0xa6aaa6,
  tunnelDark: 0x121114,
  kerb: 0xc4bfb2,
  rfiBlue: 0x0e518d,
  canopyGrey: 0x7c827f,
} as const satisfies Record<string, number>

/** `#rrggbb` CSS string of a palette (or any sRGB hex) colour. */
export const css = (hex: number): string => `#${hex.toString(16).padStart(6, "0")}`
