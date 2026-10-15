(function () {
  "use strict";

  const data = window.WeatherData;
  const byId = id => document.getElementById(id);
  const longDate = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  const shortDate = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

  const DEFAULT_THRESHOLD = 90;
  const DEFAULT_INSPECTED_DATE = Date.UTC(2017, 5, 20);
  const TEMPERATURE_DOMAIN = [0, 140];
  const TEMPERATURE_TICKS = [0, 20, 40, 60, 80, 100, 120, 140];

  const state = {
    selected: [],
    start: data.START,
    end: data.END,
    threshold: DEFAULT_THRESHOLD,
    inspected: DEFAULT_INSPECTED_DATE
  };

  let stations = [], rows = [], series = [], summaries = [], brush = null, brushGroup = null;
  let syncingBrush = false, highlightId = null, lineGeometry = null, resizeFrame = null;
  const tooltip = byId("tooltip");

  function setDisabled(disabled) {
    document.querySelectorAll("#explorer button, #explorer input").forEach(control => { control.disabled = disabled; });
  }
  function formatPercent(value) { return value === null ? "No data" : value.toFixed(1) + "%"; }
  function formatRange() { return shortDate.format(state.start) + " – " + shortDate.format(state.end) + ", 2017"; }
  function chosenSeries() { return series.filter(station => state.selected.includes(station.id)); }
  function daysInRange() { return Math.round((state.end - state.start) / data.DAY) + 1; }
  function message(text) { byId("filter-message").textContent = text; }
  function hideTooltip() { tooltip.hidden = true; }

  function tooltipAt(content, event, element) {
    tooltip.innerHTML = content;
    tooltip.hidden = false;
    const touch = event && event.touches && event.touches[0];
    const rect = element ? element.getBoundingClientRect() : { left: 40, top: 40, width: 0 };
    const pointerX = touch ? touch.clientX : event && Number.isFinite(event.clientX) && event.type !== "focus" ? event.clientX : rect.left + rect.width / 2;
    const pointerY = touch ? touch.clientY : event && Number.isFinite(event.clientY) && event.type !== "focus" ? event.clientY : rect.top;
    const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
    const left = data.clamp(pointerX + 15, 8, Math.max(8, window.innerWidth - width - 8));
    const top = data.clamp(pointerY - height - 12, 8, Math.max(8, window.innerHeight - height - 8));
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  }

  function highlight(stationId) {
    highlightId = stationId;
    d3.selectAll(".temperature-line,.overview-line,.single-dot").classed("dimmed", station => !!stationId && station.id !== stationId);
    d3.selectAll(".temperature-line").classed("highlighted", station => station.id === stationId);
    d3.selectAll(".bar-row").classed("dimmed", station => !!stationId && station.id !== stationId);
  }

  function makeStationControls() {
    const host = byId("station-controls");
    stations.forEach(station => {
      const label = document.createElement("label");
      label.className = "station-choice";
      label.style.setProperty("--station-color", station.color);
      label.title = station.name + " · " + station.id;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = station.id;
      input.checked = true;
      input.setAttribute("aria-label", station.label + ", " + station.state);
      const dot = document.createElement("span");
      dot.className = "station-dot";
      dot.style.borderTopStyle = station.dash === "" ? "solid" : station.dash === "7,3" ? "dashed" : "dotted";
      dot.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.textContent = station.label;
      label.append(input, dot, name);
      input.addEventListener("change", () => {
        state.selected = stations.filter(item => host.querySelector('input[value="' + item.id + '"]').checked).map(item => item.id);
        label.classList.toggle("is-off", !input.checked);
        highlightId = null;
        message("");
        render();
        drawBrush();
      });
      host.append(label);
    });
  }

  function ticksForRange() {
    const days = daysInRange();
    if (days > 120) {
      return Array.from({ length: 12 }, (_, month) => new Date(Date.UTC(2017, month, 1))).filter(date => +date >= state.start && +date <= state.end);
    }
    if (days === 1) return [new Date(state.start)];
    const step = Math.max(1, Math.ceil((days - 1) / 5));
    const ticks = [];
    for (let day = state.start; day <= state.end; day += data.DAY * step) ticks.push(new Date(day));
    return ticks;
  }

  function drawLine() {
    const host = byId("line-chart");
    host.innerHTML = "";
    const width = Math.max(240, Math.round(host.getBoundingClientRect().width));
    const height = width < 430 ? 285 : 310;
    const margin = { top: 21, right: 16, bottom: 40, left: 36 };
    const innerWidth = width - margin.left - margin.right, innerHeight = height - margin.top - margin.bottom;
    const oneDay = state.start === state.end;
    const x = d3.time.scale.utc().domain(oneDay ? [new Date(state.start - data.DAY / 2), new Date(state.end + data.DAY / 2)] : [new Date(state.start), new Date(state.end)]).range([0, innerWidth]);
    const y = d3.scale.linear().domain(TEMPERATURE_DOMAIN).range([innerHeight, 0]);
    const svg = d3.select(host).append("svg").attr("viewBox", "0 0 " + width + " " + height).attr("role", "group").attr("aria-label", "Daily highs by date, in degrees Fahrenheit. Exact values are available below.");
    svg.append("title").text("Daily highs: " + formatRange());
    const graph = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");
    graph.append("rect").attr("width", innerWidth).attr("height", y(state.threshold)).attr("fill", "#f7f9f4");
    graph.append("g").attr("class", "grid").call(d3.svg.axis().scale(y).orient("left").tickValues(TEMPERATURE_TICKS).tickSize(-innerWidth).tickFormat(""));
    graph.append("g").attr("class", "axis y-axis").call(d3.svg.axis().scale(y).orient("left").tickValues(TEMPERATURE_TICKS).tickSize(0).tickPadding(8));
    const days = daysInRange();
    graph.append("g").attr("class", "axis x-axis").attr("transform", "translate(0," + innerHeight + ")")
      .call(d3.svg.axis().scale(x).orient("bottom").tickValues(ticksForRange()).tickFormat(d3.time.format.utc(days > 120 ? "%b" : "%b %d")).tickSize(4).tickPadding(9));
    graph.append("text").attr("class", "axis-title").attr("x", 0).attr("y", -8).text("Daily high (°F)");
    graph.append("line").attr("class", "threshold-line").attr("x1", 0).attr("x2", innerWidth).attr("y1", y(state.threshold)).attr("y2", y(state.threshold));
    graph.append("text").attr("class", "threshold-label").attr("x", innerWidth - 3).attr("y", Math.max(10, y(state.threshold) - 6)).attr("text-anchor", "end").text("≥ " + state.threshold + "°F");
    const selected = chosenSeries();
    const line = d3.svg.line().defined(point => Number.isFinite(point.temperature)).x(point => x(new Date(point.time))).y(point => y(point.temperature));
    graph.selectAll(".temperature-line").data(selected, station => station.id).enter().append("path")
      .attr("class", "temperature-line").attr("data-station", station => station.id)
      .attr("stroke", station => station.color).attr("stroke-dasharray", station => station.dash)
      .attr("d", station => line(station.points.filter(point => point.time >= state.start && point.time <= state.end)));
    if (days <= 14) {
      selected.forEach(station => {
        station.points.filter(point => point.time >= state.start && point.time <= state.end && Number.isFinite(point.temperature)).forEach(point => {
          graph.append("circle").datum(station).attr("class", "single-dot").attr("cx", x(new Date(point.time))).attr("cy", y(point.temperature)).attr("r", days === 1 ? 5 : 2.8).attr("fill", station.color);
        });
      });
    }
    if (!selected.length) graph.append("text").attr("class", "chart-empty").attr("x", innerWidth / 2).attr("y", innerHeight / 2).text("Select a station.");
    const crosshair = graph.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", innerHeight).style("display", "none");
    const overlay = graph.append("rect").attr("class", "chart-overlay").attr("width", innerWidth).attr("height", innerHeight)
      .attr("tabindex", 0).attr("role", "slider").attr("aria-label", "Use the arrow keys to select a date")
      .attr("aria-valuemin", 0).attr("aria-valuemax", days - 1);
    lineGeometry = { x, y, crosshair, overlay, innerWidth };
    overlay.on("mousemove", function () {
      if (!selected.length) return;
      const time = +x.invert(data.clamp(d3.mouse(this)[0], 0, innerWidth));
      setInspected(data.clamp(Math.round(time / data.DAY) * data.DAY, state.start, state.end));
      showDayTooltip(d3.event, this);
    }).on("mouseleave", () => { hideTooltip(); crosshair.style("display", "none"); })
      .on("touchstart", function () {
        if (!selected.length) return;
        const touches = d3.touches(this);
        if (touches.length) {
          const time = +x.invert(data.clamp(touches[0][0], 0, innerWidth));
          setInspected(data.clamp(Math.round(time / data.DAY) * data.DAY, state.start, state.end));
          showDayTooltip(d3.event, this);
        }
      }).on("focus", () => setInspected(state.inspected)).on("blur", () => { hideTooltip(); crosshair.style("display", "none"); })
      .on("keydown", function () {
        const event = d3.event;
        let next = state.inspected;
        if (event.key === "ArrowRight") next += data.DAY;
        else if (event.key === "ArrowLeft") next -= data.DAY;
        else if (event.key === "Home") next = state.start;
        else if (event.key === "End") next = state.end;
        else if (event.key === "Escape") { hideTooltip(); crosshair.style("display", "none"); return; }
        else return;
        event.preventDefault();
        setInspected(data.clamp(next, state.start, state.end));
      });
    updateCrosshair(false);
  }

  function updateCrosshair(visible = true) {
    if (!lineGeometry) return;
    const position = lineGeometry.x(new Date(state.inspected));
    lineGeometry.crosshair.attr("x1", position).attr("x2", position).style("display", visible && state.selected.length ? null : "none");
    lineGeometry.overlay.attr("aria-valuenow", Math.round((state.inspected - state.start) / data.DAY)).attr("aria-valuetext", longDate.format(state.inspected));
  }

  function drawBrush() {
    const host = byId("brush-chart");
    host.innerHTML = "";
    const width = Math.max(240, Math.round(host.getBoundingClientRect().width));
    const margin = { left: 36, right: 16, top: 6, bottom: 23 }, height = 78;
    const innerWidth = width - margin.left - margin.right, innerHeight = height - margin.top - margin.bottom;
    const x = d3.time.scale.utc().domain([new Date(data.START), new Date(data.END + data.DAY)]).range([0, innerWidth]);
    const y = d3.scale.linear().domain(TEMPERATURE_DOMAIN).range([innerHeight, 0]);
    const svg = d3.select(host).append("svg").attr("viewBox", "0 0 " + width + " " + height).attr("role", "img").attr("aria-label", "2017 overview. Drag to select dates, or use the date fields.");
    const graph = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");
    graph.append("rect").attr("width", innerWidth).attr("height", innerHeight).attr("fill", "#f4f6f0");
    const line = d3.svg.line().defined(point => Number.isFinite(point.temperature)).x(point => x(new Date(point.time + data.DAY / 2))).y(point => y(point.temperature));
    graph.selectAll(".overview-line").data(chosenSeries(), station => station.id).enter().append("path")
      .attr("class", "overview-line").attr("stroke", station => station.color).attr("stroke-dasharray", station => station.dash).attr("d", station => line(station.points));
    graph.append("g").attr("class", "axis").attr("transform", "translate(0," + innerHeight + ")")
      .call(d3.svg.axis().scale(x).orient("bottom").tickValues([0, 3, 6, 9].map(month => new Date(Date.UTC(2017, month, 1)))).tickFormat(d3.time.format.utc("%b")).tickSize(3).tickPadding(5));
    brush = d3.svg.brush().x(x).on("brush", function () {
      if (syncingBrush || !d3.event.sourceEvent) return;
      if (brush.empty()) { state.start = data.START; state.end = data.END; }
      else {
        const extent = brush.extent();
        const start = Math.floor(+extent[0] / data.DAY) * data.DAY;
        const end = Math.ceil(+extent[1] / data.DAY) * data.DAY - data.DAY;
        [state.start, state.end] = data.normalizeRange(start, Math.max(start, end));
      }
      message("");
      render(false);
    }).on("brushend", function () { if (!syncingBrush) syncBrush(); });
    brushGroup = graph.append("g").attr("class", "brush").call(brush);
    brushGroup.selectAll("rect").attr("height", innerHeight);
    brushGroup.selectAll(".background").style("fill-opacity", 0);
    syncBrush();
    highlight(highlightId);
  }

  function syncBrush() {
    if (!brush || !brushGroup) return;
    syncingBrush = true;
    brush.extent([new Date(state.start), new Date(state.end + data.DAY)]);
    brushGroup.call(brush);
    syncingBrush = false;
  }

  function drawBars() {
    const host = byId("bar-chart");
    host.innerHTML = "";
    const width = Math.max(230, Math.round(host.getBoundingClientRect().width));
    const margin = { left: 3, right: 10, top: 7, bottom: 35 };
    const rowHeight = 85, height = Math.max(3, summaries.length) * rowHeight + margin.top + margin.bottom;
    const innerWidth = width - margin.left - margin.right;
    const svg = d3.select(host).append("svg").attr("viewBox", "0 0 " + width + " " + height).attr("role", "group").attr("aria-label", "Recorded days at or above the cutoff, from 0 to 100 percent.");
    const graph = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");
    const x = d3.scale.linear().domain([0, 100]).range([0, innerWidth]);
    const groups = graph.selectAll(".bar-row").data(summaries, station => station.id).enter().append("g")
      .attr("class", "bar-row").attr("data-station", station => station.id).attr("transform", (station, index) => "translate(0," + index * rowHeight + ")")
      .attr("tabindex", 0).attr("role", "img").attr("aria-label", station => station.label + ": " + formatPercent(station.percent) + ", " + station.qualifying + " of " + station.observed + " recorded days at or above " + state.threshold + " degrees Fahrenheit")
      .on("mouseenter", function (station) { highlight(station.id); showBarTooltip(station, d3.event, this); })
      .on("mousemove", function (station) { showBarTooltip(station, d3.event, this); })
      .on("mouseleave", () => { highlight(null); hideTooltip(); })
      .on("focus", function (station) { highlight(station.id); showBarTooltip(station, d3.event, this); })
      .on("blur", () => { highlight(null); hideTooltip(); })
      .on("keydown", () => { if (d3.event.key === "Escape") { hideTooltip(); highlight(null); } });
    groups.append("rect").attr("width", innerWidth).attr("height", rowHeight - 5).attr("fill", "transparent");
    groups.append("text").attr("class", "bar-label").attr("x", 0).attr("y", 20).text(station => station.label);
    groups.append("text").attr("class", "bar-percent").attr("x", innerWidth).attr("y", 20).attr("text-anchor", "end").text(station => formatPercent(station.percent));
    groups.append("rect").attr("class", "bar-track").attr("y", 31).attr("width", innerWidth).attr("height", 15).attr("rx", 3);
    groups.append("rect").attr("class", "bar-fill").attr("y", 31).attr("width", station => x(station.percent || 0)).attr("height", 15).attr("rx", 3).attr("fill", station => station.color);
    groups.append("text").attr("class", "bar-count").attr("x", 0).attr("y", 64).text(station => station.observed ? station.qualifying + " / " + station.observed + " recorded days" : "No data for these dates");
    graph.append("g").attr("class", "axis").attr("transform", "translate(0," + (height - margin.top - margin.bottom) + ")")
      .call(d3.svg.axis().scale(x).orient("bottom").tickValues([0, 25, 50, 75, 100]).tickFormat(value => value + "%").tickSize(3).tickPadding(8));
    if (!summaries.length) graph.append("text").attr("class", "chart-empty").attr("x", innerWidth / 2).attr("y", 125).text("No stations selected.");
  }

  function showBarTooltip(station, event, element) {
    const observed = station.observed ? `${station.qualifying} of ${station.observed} recorded days (${formatPercent(station.percent)})` : "No data";
    tooltipAt(`<strong>${station.label} · ${station.state}</strong><div>${observed}</div><div class="tooltip-sub">At or above ${state.threshold}°F · ${formatRange()}</div><div class="tooltip-sub">${station.peak === null ? "No data" : "Highest: " + station.peak + "°F"}</div>`, event, element);
  }

  function selectedDayValues() {
    const index = Math.round((state.inspected - data.START) / data.DAY);
    return chosenSeries().map(station => ({ ...station, point: station.points[index] }));
  }
  function showDayTooltip(event, element) {
    const content = selectedDayValues().map(station => `<div class="tooltip-row"><span>${station.label}</span><span>${Number.isFinite(station.point.temperature) ? station.point.temperature + "°F" : "No data"}</span></div>`).join("");
    tooltipAt(`<strong>${longDate.format(state.inspected)}</strong>${content}<span class="tooltip-sub">Daily high · rounded to whole °F</span>`, event, element);
  }
  function setInspected(timestamp) {
    state.inspected = data.clamp(timestamp, state.start, state.end);
    byId("inspect-date").value = data.iso(state.inspected);
    drawInspector();
    updateCrosshair(true);
  }
  function drawInspector() {
    const host = byId("day-values");
    host.innerHTML = "";
    const values = selectedDayValues();
    if (!values.length) {
      const empty = document.createElement("p"); empty.className = "inspector-empty"; empty.textContent = "Select a station."; host.append(empty); return;
    }
    values.forEach(station => {
      const temperature = station.point.temperature, valid = Number.isFinite(temperature), meets = valid && temperature >= state.threshold;
      const card = document.createElement("div"); card.className = "day-value";
      const name = document.createElement("span"); name.className = "day-station"; name.textContent = station.label; name.style.color = station.color;
      const number = document.createElement("span"); number.className = "day-temp"; number.textContent = valid ? temperature + "°F" : "—";
      const status = document.createElement("span"); status.className = "day-status" + (meets ? " meets" : ""); status.textContent = !valid ? "No data" : meets ? "✓ At or above " + state.threshold + "°F" : "Below " + state.threshold + "°F";
      card.append(name, number, status); host.append(card);
    });
  }

  function updateFinding() {
    const available = summaries.filter(station => station.observed > 0);
    let text;
    if (!summaries.length) text = "Select a station.";
    else if (!available.length) text = "No data for these dates.";
    else if (available.every(station => station.qualifying === 0)) text = "No recorded days reached " + state.threshold + "°F.";
    else if (available.length === 1) {
      const station = available[0];
      text = station.label + ": " + formatPercent(station.percent) + " of recorded days at or above " + state.threshold + "°F.";
    } else {
      const maximum = Math.max(...available.map(station => station.percent));
      const leaders = available.filter(station => Math.abs(station.percent - maximum) < 1e-9);
      text = leaders.length === 1 ? leaders[0].label + " has the highest percentage: " + formatPercent(maximum) + "." : leaders.map(station => station.label).join(" and ") + " tie at " + formatPercent(maximum) + ".";
    }
    byId("finding-text").textContent = text;
  }

  function updateTable() {
    const body = byId("summary-body"); body.innerHTML = "";
    summaries.forEach(station => {
      const row = document.createElement("tr");
      const values = [station.label + " (" + station.state + ")", station.observed + " / " + station.days, station.qualifying, formatPercent(station.percent), station.peak === null ? "No data" : station.peak + "°F", station.peakDate || "—"];
      values.forEach((value, index) => { const cell = document.createElement(index ? "td" : "th"); if (!index) cell.scope = "row"; cell.textContent = value; row.append(cell); });
      body.append(row);
    });
    if (!summaries.length) { const row = document.createElement("tr"), cell = document.createElement("td"); cell.colSpan = 6; cell.textContent = "No stations selected."; row.append(cell); body.append(row); }
    byId("table-caption").textContent = formatRange() + " · cutoff ≥ " + state.threshold + "°F · start and end included";
    byId("export").disabled = !summaries.length;
  }

  function render(moveBrush = true) {
    hideTooltip();
    state.inspected = data.clamp(state.inspected, state.start, state.end);
    summaries = data.summarize(rows, stations, state.selected, state.start, state.end, state.threshold);
    byId("threshold").value = state.threshold;
    byId("threshold").setAttribute("aria-valuetext", state.threshold + " degrees Fahrenheit");
    byId("threshold-output").textContent = state.threshold + "°F";
    byId("start-date").value = data.iso(state.start); byId("end-date").value = data.iso(state.end);
    byId("inspect-date").min = data.iso(state.start); byId("inspect-date").max = data.iso(state.end); byId("inspect-date").value = data.iso(state.inspected);
    byId("range-label").textContent = formatRange();
    byId("bar-caption").textContent = "% of recorded days at or above " + state.threshold + "°F · " + daysInRange() + " days selected.";
    const coverage = summaries.reduce((sum, station) => sum + station.observed, 0);
    const expected = summaries.reduce((sum, station) => sum + station.days, 0);
    byId("coverage-text").textContent = coverage + " / " + expected + " daily records";
    document.querySelectorAll("[data-preset]").forEach(button => {
      const preset = presetRange(button.dataset.preset);
      button.setAttribute("aria-pressed", String(state.start === preset[0] && state.end === preset[1]));
    });
    drawLine(); drawBars(); drawInspector(); updateFinding(); updateTable();
    if (moveBrush) syncBrush();
    highlight(highlightId);
  }

  function presetRange(name) {
    if (name === "summer") return [Date.UTC(2017, 5, 1), Date.UTC(2017, 7, 31)];
    if (name === "july") return [Date.UTC(2017, 6, 1), Date.UTC(2017, 6, 31)];
    return [data.START, data.END];
  }
  function resetAll() {
    Object.assign(state, {
      selected: stations.map(station => station.id),
      start: data.START,
      end: data.END,
      threshold: DEFAULT_THRESHOLD,
      inspected: DEFAULT_INSPECTED_DATE
    });
    byId("station-controls").querySelectorAll("input").forEach(input => { input.checked = true; input.parentElement.classList.remove("is-off"); });
    highlightId = null; message(""); render(); drawBrush();
  }
  function changeDates() {
    const start = data.parseDate(byId("start-date").value), end = data.parseDate(byId("end-date").value);
    if (start === null || end === null || start < data.START || end > data.END || start > end) {
      message("Choose 2017 dates with the start on or before the end.");
      byId("start-date").value = data.iso(state.start); byId("end-date").value = data.iso(state.end); return;
    }
    state.start = start; state.end = end; message(""); render();
  }
  function exportSummary() {
    const header = ["station", "station_id", "start_date", "end_date", "threshold_f", "calendar_days", "observed_days", "qualifying_days", "percent", "peak_f", "first_peak_date"];
    const values = summaries.map(station => [station.label, station.id, data.iso(state.start), data.iso(state.end), state.threshold, station.days, station.observed, station.qualifying, station.percent === null ? "" : station.percent.toFixed(6), station.peak ?? "", station.peakDate ?? ""]);
    const csv = [header, ...values].map(row => row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "weather-summary-" + data.iso(state.start) + "-" + data.iso(state.end) + ".csv"; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function wireControls() {
    byId("controls").addEventListener("submit", event => event.preventDefault());
    byId("threshold").addEventListener("input", event => { state.threshold = data.clamp(Number(event.target.value), 0, 130); render(); });
    byId("reset").addEventListener("click", resetAll);
    ["start-date", "end-date"].forEach(id => byId(id).addEventListener("change", changeDates));
    byId("inspect-date").addEventListener("change", event => {
      const time = data.parseDate(event.target.value);
      if (time === null || time < state.start || time > state.end) { event.target.value = data.iso(state.inspected); message("Choose a date within the selected range."); return; }
      message(""); setInspected(time);
    });
    document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => {
      [state.start, state.end] = presetRange(button.dataset.preset); message(""); render();
    }));
    byId("june-story").addEventListener("click", () => { resetAll(); state.start = Date.UTC(2017, 5, 1); state.end = Date.UTC(2017, 5, 30); state.threshold = 110; state.inspected = Date.UTC(2017, 5, 20); render(); });
    byId("september-story").addEventListener("click", () => { resetAll(); state.start = Date.UTC(2017, 8, 1); state.end = Date.UTC(2017, 8, 30); state.threshold = 85; state.inspected = Date.UTC(2017, 8, 26); render(); });
    byId("export").addEventListener("click", exportSummary);
    document.addEventListener("keydown", event => { if (event.key === "Escape") { hideTooltip(); highlight(null); } });
    window.addEventListener("scroll", hideTooltip, { passive: true });
    window.addEventListener("resize", () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { render(); drawBrush(); });
    });
  }

  async function load() {
    setDisabled(true);
    try {
      if (!window.d3 || d3.version !== "3.5.6") throw new Error("D3 did not load.");
      let csv;
      if (window.WEATHER_BOOTSTRAP) { stations = window.WEATHER_BOOTSTRAP.stations; csv = window.WEATHER_BOOTSTRAP.csv; }
      else {
        const responses = await Promise.all([fetch("./data/stations.json"), fetch("./data/weather_subset.csv")]);
        if (responses.some(response => !response.ok)) throw new Error("A data file did not load.");
        stations = await responses[0].json(); csv = await responses[1].text();
      }

      rows = data.parseRows(d3.csv.parse(csv), stations);
      if (rows.length !== stations.length * 365) throw new Error("Unexpected number of CSV records.");
      series = data.buildSeries(rows, stations);
      state.selected = stations.map(station => station.id);

      makeStationControls(); wireControls(); setDisabled(false); render(); drawBrush();
      byId("load-status").hidden = true;
      document.body.dataset.ready = "true";
    } catch (error) {
      console.error(error);
      byId("load-status").classList.add("error");
      byId("load-status").textContent = "Charts could not load. Use Live Server or run python3 -m http.server 8000 in the project folder. Keep all project folders together. " + error.message;
    }
  }
  load();
})();
