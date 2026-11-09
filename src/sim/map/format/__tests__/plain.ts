// What the format's tests compare: a decoded value as plain data.

/** The value with its typed arrays as plain arrays, for deepEqual. */
export const plain = (value: unknown): unknown =>
  ArrayBuffer.isView(value)
    ? Array.from(value as unknown as ArrayLike<number>)
    : Array.isArray(value)
      ? value.map(plain)
      : typeof value === "object" && value !== null
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]))
        : value
