// Coordinate reference systems of the Regione Toscana sources, to and from WGS84 lat/lon (degrees).
// - CTR 1:2000 (2019): EPSG:6707, RDN2008 / UTM 32N on GRS80. RDN2008 (ETRF2000) and WGS84 agree
//   within a few centimetres here, so no datum shift.
// - LiDAR, 10 m DTM, land cover: EPSG:3003, Monte Mario / Gauss-Boaga west, on the International
//   1924 ellipsoid. The datum shift is the EPSG:1660 Helmert ("Monte Mario to WGS 84 (4)", mainland
//   Italy, a few metres); `GB_RESIDUAL` removes what is left, fitted on Monzone's buildings.
// Transverse Mercator uses Krüger's series to n³, sub-millimetre within 3° of the central meridian.

import { Ops } from "@typeonce/ritmo-math"

interface Ellipsoid {
  readonly a: number
  readonly f: number
}
const GRS80: Ellipsoid = { a: 6378137, f: 1 / 298.257222101 }
const WGS84: Ellipsoid = { a: 6378137, f: 1 / 298.257223563 }
const HAYFORD: Ellipsoid = { a: 6378388, f: 1 / 297 }
const RAD = Math.PI / 180

/** Krüger coefficients of an ellipsoid: rectifying radius A, forward α and inverse β/δ series. */
const kruger = ({ a, f }: Ellipsoid) => {
  const n = f / (2 - f),
    n3 = n * n * n
  return {
    n,
    A: (a / (1 + n)) * (1 + (n * n) / 4 + (n3 * n) / 64),
    alpha: [
      n / 2 - (2 * n * n) / 3 + (5 * n3) / 16,
      (13 * n * n) / 48 - (3 * n3) / 5,
      (61 * n3) / 240,
    ],
    beta: [n / 2 - (2 * n * n) / 3 + (37 * n3) / 96, (n * n) / 48 + n3 / 15, (17 * n3) / 480],
    delta: [2 * n - (2 * n * n) / 3 - 2 * n3, (7 * n * n) / 3 - (8 * n3) / 5, (56 * n3) / 15],
  }
}

interface Tm {
  readonly ell: Ellipsoid
  readonly lon0: number
  readonly k0: number
  readonly fe: number
}
const UTM32: Tm = { ell: GRS80, lon0: 9, k0: 0.9996, fe: 500000 }
const GB_WEST: Tm = { ell: HAYFORD, lon0: 9, k0: 0.9996, fe: 1500000 }

const tmInverse = (tm: Tm, e: number, nth: number): [number, number] => {
  const k = kruger(tm.ell)
  const xi = nth / (tm.k0 * k.A),
    eta = (e - tm.fe) / (tm.k0 * k.A)
  let xp = xi,
    ep = eta
  for (let j = 1; j <= 3; j++) {
    xp -= k.beta[j - 1]! * Ops.sin(2 * j * xi) * Ops.cosh(2 * j * eta)
    ep -= k.beta[j - 1]! * Ops.cos(2 * j * xi) * Ops.sinh(2 * j * eta)
  }
  const chi = Ops.asin(Ops.sin(xp) / Ops.cosh(ep))
  let lat = chi
  for (let j = 1; j <= 3; j++) lat += k.delta[j - 1]! * Ops.sin(2 * j * chi)
  return [lat / RAD, tm.lon0 + Ops.atan2(Ops.sinh(ep), Ops.cos(xp)) / RAD]
}

const tmForward = (tm: Tm, lat: number, lon: number): [number, number] => {
  const k = kruger(tm.ell),
    phi = lat * RAD,
    dl = (lon - tm.lon0) * RAD
  const c = (2 * Math.sqrt(k.n)) / (1 + k.n)
  const t = Ops.sinh(Ops.atanh(Ops.sin(phi)) - c * Ops.atanh(c * Ops.sin(phi)))
  const xp = Ops.atan2(t, Ops.cos(dl)),
    ep = Ops.atanh(Ops.sin(dl) / Math.sqrt(1 + t * t))
  let xi = xp,
    eta = ep
  for (let j = 1; j <= 3; j++) {
    xi += k.alpha[j - 1]! * Ops.sin(2 * j * xp) * Ops.cosh(2 * j * ep)
    eta += k.alpha[j - 1]! * Ops.cos(2 * j * xp) * Ops.sinh(2 * j * ep)
  }
  return [tm.fe + tm.k0 * k.A * eta, tm.k0 * k.A * xi]
}

const toEcef = ({ a, f }: Ellipsoid, lat: number, lon: number): [number, number, number] => {
  const e2 = f * (2 - f),
    p = lat * RAD,
    l = lon * RAD,
    nu = a / Math.sqrt(1 - e2 * Ops.sin(p) ** 2)
  return [nu * Ops.cos(p) * Ops.cos(l), nu * Ops.cos(p) * Ops.sin(l), nu * (1 - e2) * Ops.sin(p)]
}

const fromEcef = ({ a, f }: Ellipsoid, x: number, y: number, z: number): [number, number] => {
  const e2 = f * (2 - f),
    p = Math.hypot(x, y)
  let lat = Ops.atan2(z, p * (1 - e2))
  for (let i = 0; i < 5; i++)
    lat = Ops.atan2(z + (e2 * a * Ops.sin(lat)) / Math.sqrt(1 - e2 * Ops.sin(lat) ** 2), p)
  return [lat / RAD, Ops.atan2(y, x) / RAD]
}

/** EPSG:1660 Monte Mario -> WGS84, position vector: dx, dy, dz (m), rx, ry, rz (arc seconds), ds (ppm). */
const MM_TO_WGS = [-104.1, -49.1, -9.9, 0.971, -2.917, 0.714, -11.68] as const

/** The Helmert transform (sign -1: its inverse, exact to well under a millimetre at these angles). */
const helmert = (
  sign: 1 | -1,
  [x, y, z]: readonly [number, number, number],
): [number, number, number] => {
  const [tx, ty, tz, rx, ry, rz, ds] = MM_TO_WGS.map((v) => v * sign)
  const s = 1 + ds! * 1e-6,
    r = Math.PI / (180 * 3600)
  const [ax, ay, az] = [rx! * r, ry! * r, rz! * r]
  return [
    tx! + s * (x - az * y + ay * z),
    ty! + s * (az * x + y - ax * z),
    tz! + s * (-ay * x + ax * y + z),
  ]
}

/**
 * What the EPSG:1660 shift leaves at Monzone (m, Gauss-Boaga east and north), fitted by matching
 * the 2010 LiDAR surface model to the 2019 CTR building outlines.
 */
const GB_RESIDUAL = { e: -0.4, n: 0.5 }

/** EPSG:6707 (CTR) easting, northing -> WGS84 lat, lon. */
export const utm32ToLatLon = (e: number, n: number): [number, number] => tmInverse(UTM32, e, n)

/** WGS84 lat, lon -> RDN2008 / UTM 32N easting, northing (EPSG:6707 and 7791: the DSM 2021, Emilia-Romagna's DTM). */
export const latLonToUtm32 = (lat: number, lon: number): [number, number] =>
  tmForward(UTM32, lat, lon)

/** WGS84 lat, lon -> EPSG:3003 (LiDAR) easting, northing. */
export const latLonToGaussBoaga = (lat: number, lon: number): [number, number] => {
  const [la, lo] = fromEcef(HAYFORD, ...helmert(-1, toEcef(WGS84, lat, lon)))
  const [e, n] = tmForward(GB_WEST, la, lo)
  return [e + GB_RESIDUAL.e, n + GB_RESIDUAL.n]
}

/** EPSG:3003 easting, northing -> WGS84 lat, lon: the inverse of `latLonToGaussBoaga`. */
export const gaussBoagaToLatLon = (e: number, n: number): [number, number] =>
  fromEcef(
    WGS84,
    ...helmert(1, toEcef(HAYFORD, ...tmInverse(GB_WEST, e - GB_RESIDUAL.e, n - GB_RESIDUAL.n))),
  )
