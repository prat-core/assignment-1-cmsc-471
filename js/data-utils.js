(function (root) {
  "use strict";

  const DAY = 86400000;
  const START = Date.UTC(2017, 0, 1);
  const END = Date.UTC(2017, 11, 31);

  function parseDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const timestamp = Date.parse(value + "T00:00:00Z");
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
  }
  function iso(timestamp) { return new Date(timestamp).toISOString().slice(0, 10); }
  function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }

  function normalizeRange(start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("Invalid date range");
    const first = clamp(Math.round(start / DAY) * DAY, START, END);
    const last = clamp(Math.round(end / DAY) * DAY, START, END);
    return [Math.min(first, last), Math.max(first, last)];
  }

  function parseTemperature(row) {
    const text = String(row.tmax_f ?? "").trim();
    const hasQualityFlag = String(row.quality_flag ?? "").trim() !== "";
    const temperature = text === "" || hasQualityFlag ? null : Number(text);

    if (temperature !== null && (!Number.isFinite(temperature) || temperature < -150 || temperature > 150)) {
      throw new Error("Invalid temperature in CSV");
    }

    return temperature;
  }

  function parseRows(rows, stations) {
    const identifiers = new Set(stations.map(station => station.id));
    const keys = new Set();

    return rows.map(row => {
      const time = parseDate(row.date);
      if (!identifiers.has(row.station) || time === null || time < START || time > END) throw new Error("Unexpected station or date in CSV");
      const key = row.station + "/" + row.date;
      if (keys.has(key)) throw new Error("Duplicate station/date in CSV");
      keys.add(key);

      return {
        station: row.station,
        date: row.date,
        time,
        temperature: parseTemperature(row)
      };
    }).sort((a, b) => a.time - b.time || a.station.localeCompare(b.station));
  }

  function summarize(rows, stations, selectedIds, start, end, threshold) {
    const selected = new Set(selectedIds);

    return stations.filter(station => selected.has(station.id)).map(station => {
      const valid = rows.filter(row => row.station === station.id && row.time >= start && row.time <= end && Number.isFinite(row.temperature));

      const aggregate = valid.reduce((summary, row) => {
        if (row.temperature >= threshold) summary.qualifying += 1;
        if (summary.peak === null || row.temperature > summary.peak) {
          summary.peak = row.temperature;
          summary.peakDate = row.date;
        }
        return summary;
      }, { qualifying: 0, peak: null, peakDate: null });

      return {
        ...station,
        observed: valid.length,
        qualifying: aggregate.qualifying,
        percent: valid.length ? 100 * aggregate.qualifying / valid.length : null,
        peak: aggregate.peak,
        peakDate: aggregate.peakDate,
        days: Math.round((end - start) / DAY) + 1
      };
    });
  }

  function buildSeries(rows, stations) {
    const rowsByStation = new Map(stations.map(station => [station.id, new Map()]));
    rows.forEach(row => rowsByStation.get(row.station).set(row.time, row));

    return stations.map(station => {
      const values = rowsByStation.get(station.id);
      const points = [];
      for (let time = START; time <= END; time += DAY) points.push(values.get(time) || { station: station.id, date: iso(time), time, temperature: null });
      return { ...station, points };
    });
  }

  const api = { DAY, START, END, parseDate, iso, clamp, normalizeRange, parseRows, summarize, buildSeries };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WeatherData = api;
})(typeof window !== "undefined" ? window : globalThis);
