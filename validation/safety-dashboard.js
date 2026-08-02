(function () {
  "use strict";
  const file = document.getElementById("aggregateFile");
  const summary = document.getElementById("summary");
  const tables = document.getElementById("tables");
  function escape(value) { const node = document.createElement("span"); node.textContent = String(value); return node.innerHTML; }
  function table(title, values) {
    const rows = Object.entries(values || {}).sort((a, b) => b[1] - a[1]);
    return `<section class="card"><h2>${escape(title)}</h2><table><thead><tr><th>Category</th><th>Count</th></tr></thead><tbody>${rows.map(([key, count]) => `<tr><td>${escape(key)}</td><td>${Number(count)}</td></tr>`).join("") || '<tr><td colspan="2">No events</td></tr>'}</tbody></table></section>`;
  }
  file.addEventListener("change", async event => {
    try {
      const payload = JSON.parse(await event.target.files[0].text());
      window.SafetyTelemetry.assertNoPatientPayload(payload);
      summary.innerHTML = `<section class="card"><div>Total aggregate events</div><div class="metric">${Number(payload.total || 0)}</div></section><section class="card"><div>Schema</div><div class="metric">${escape(payload.schemaVersion || "unknown")}</div></section>`;
      tables.innerHTML = table("Events", payload.byEventType) + table("Review tiers", payload.byReviewTier) + table("Error categories", payload.byErrorCategory) + table("Cancer groups", payload.byCancerType);
    } catch (error) {
      summary.innerHTML = `<section class="warning">Rejected: ${escape(error.message)}</section>`;
      tables.innerHTML = "";
    }
  });
})();
