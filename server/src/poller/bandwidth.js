const previous = new Map();
const current = new Map();

export function updateBandwidth(rows) {
  const now = Date.now();
  const seen = new Set();

  for (const row of rows) {
    seen.add(row.client);
    const prev = previous.get(row.client);

    if (prev) {
      const dtSeconds = (now - prev.t) / 1000;
      if (dtSeconds > 0) {
        const rxDelta = row.rxByte - prev.rxByte;
        const txDelta = row.txByte - prev.txByte;
        current.set(row.client, {
          downBps: txDelta >= 0 ? Math.round((txDelta * 8) / dtSeconds) : 0,
          upBps: rxDelta >= 0 ? Math.round((rxDelta * 8) / dtSeconds) : 0,
        });
      }
    }

    previous.set(row.client, { rxByte: row.rxByte, txByte: row.txByte, t: now });
  }

  for (const client of previous.keys()) {
    if (!seen.has(client)) {
      previous.delete(client);
      current.delete(client);
    }
  }
}

export function getAllBandwidth() {
  return Object.fromEntries(current);
}
