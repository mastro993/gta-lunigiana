/**
 * The full map's overview (src/tools/overview.ts) as it holds the picture: downloaded once,
 * decoded at each opening and let go at each closing.
 *
 * @module hud/overview-bitmap
 */

/**
 * The overview's bitmap as the full map holds it: its file downloaded the first time the map opens
 * (`want`; a failed download is tried again at the next opening), decoded at each opening still open
 * when the file is in (so openings while it downloads decode it once), and released when the map
 * closes (`release`), as Lunigiana's decodes to about 56 MB (3410 × 4096 × 4 B). `ready` hears that
 * the bitmap came while the map is still open; one that comes after it closed is let go at once.
 */
export const overviewBitmap = <B extends { close(): void }>(
  download: () => Promise<Blob>,
  decode: (file: Blob) => Promise<B>,
  ready: () => void,
) => {
  let file: Promise<Blob> | undefined,
    bitmap: B | undefined,
    openings = 0,
    /** The current opening's number; 0 while the map is closed. */
    open = 0
  return {
    /** The decoded overview, while the map is open and it has come. */
    get bitmap(): B | undefined {
      return bitmap
    },
    /** The map opened: download the overview if it has not been, and decode it. */
    want: (): void => {
      if (open !== 0) return
      const opening = (open = ++openings),
        pending = (file ??= download())
      // A failed download (or decode) is tried again at the next opening, whenever it failed.
      const failed = () => {
        if (file === pending) file = undefined
      }
      pending.then((blob) => {
        // An opening closed before the file came decodes nothing: only the current one does.
        if (open !== opening) return
        decode(blob).then((decoded) => {
          if (open === opening) {
            bitmap = decoded
            ready()
          } else decoded.close()
        }, failed)
      }, failed)
    },
    /** The map closed: let the decoded overview go. */
    release: (): void => {
      open = 0
      bitmap?.close()
      bitmap = undefined
    },
  }
}
