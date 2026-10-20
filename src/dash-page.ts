/**
 * Readonly page served by `bolt dash`. It reads the session JSON endpoints.
 * Field names are the session record fields. It does not guess process liveness.
 */
export const DASH_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>bolt dash</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; color: #1c1917; background: #f6f5f2; }
  header { padding: 14px 18px; border-bottom: 1px solid #e4e1da; background: #fff; }
  header strong { font-size: 16px; }
  header p { margin: 4px 0 0; color: #57534e; }
  main { display: grid; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr) minmax(240px, 320px); min-height: calc(100vh - 72px); }
  section { padding: 14px 16px; border-right: 1px solid #e4e1da; }
  section:last-child { border-right: 0; background: #fff; }
  h2 { margin: 0 0 10px; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; color: #78716c; }
  button.row, button.node { display: grid; gap: 2px; width: 100%; margin: 0 0 8px; padding: 8px 10px; text-align: left; border: 1px solid #d6d3d1; border-radius: 8px; background: #fff; color: inherit; cursor: pointer; }
  button.row .time, button.node .idx { color: #78716c; font-variant-numeric: tabular-nums; }
  button.row .status, button.node .st { font-weight: 650; }
  .failed { border-color: #b42318; background: #fff6f5; }
  .running { border-color: #b54708; background: #fff8ef; }
  .interrupted { border-color: #57534e; }
  .ok { border-color: #067647; }
  button.node.current { box-shadow: inset 3px 0 0 #1c1917; }
  #graph { display: flex; flex-direction: column; }
  .label { margin: 10px 0 2px; color: #78716c; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  .code, .message, .hint, .ref { margin: 0; white-space: pre-wrap; }
  .code { font: 13px/1.4 ui-monospace, monospace; font-weight: 650; }
  pre.result { margin: 8px 0 0; padding: 8px; overflow: auto; background: #f6f5f2; border-radius: 6px; font: 12px/1.4 ui-monospace, monospace; }
  .empty, .log-note { color: #57534e; }
  @media (max-width: 860px) {
    main { grid-template-columns: 1fr; }
    section { border-right: 0; border-bottom: 1px solid #e4e1da; }
  }
</style>
</head>
<body>
<header>
  <strong>bolt dash</strong>
  <p>Local readonly observer for this project's execute sessions. Same records as <code>bolt session list</code> and <code>bolt session show</code>. Not CI.</p>
</header>
<main>
  <section id="session-list" aria-label="Execute sessions">
    <h2>Sessions</h2>
    <div id="list"></div>
  </section>
  <section id="step-graph" aria-label="Step graph">
    <h2>Steps</h2>
    <div id="graph"></div>
  </section>
  <section id="stuck" aria-label="Stuck step">
    <h2>Stuck</h2>
    <div id="drawer"></div>
  </section>
</main>
<script>
const listEl = document.querySelector("#list");
const graphEl = document.querySelector("#graph");
const drawerEl = document.querySelector("#drawer");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  return res.json();
}

function renderList(sessions) {
  listEl.replaceChildren();
  if (!sessions.length) {
    listEl.append(el("p", "empty", "No execute sessions. Preview and dry-run records stay hidden."));
    return;
  }
  for (const session of sessions) {
    const button = el("button", "row " + session.status);
    button.type = "button";
    const focus = session.step;
    button.append(
      el("span", "time", session.started_at),
      el("span", "entry", session.entry),
      el("span", "names", Array.isArray(session.names) && session.names.length ? session.names.join(", ") : "(none)"),
      el("span", "status", session.status),
      el("span", "focus", focus ? focus.ref : ""),
    );
    button.addEventListener("click", () => openSession(session.session_id, focus));
    listEl.append(button);
  }
}

function renderGraph(record, selected) {
  graphEl.replaceChildren();
  graphEl.append(el("p", "meta", record.session_id + "  " + record.status));
  for (const step of record.steps) {
    const current = step.index === selected ? " current" : "";
    const button = el("button", "node " + step.status + current);
    button.type = "button";
    button.append(
      el("span", "idx", String(step.index)),
      el("span", "ref", step.ref),
      el("span", "st", step.status),
    );
    button.addEventListener("click", () => {
      renderGraph(record, step.index);
      renderDrawer(record, step.index);
    });
    graphEl.append(button);
  }
}

function renderDrawer(record, index) {
  const step = record.steps.find((item) => item.index === index) || record.steps[0];
  drawerEl.replaceChildren();
  if (!step) {
    drawerEl.append(el("p", "empty", "No steps."));
    return;
  }
  const error = step.error || null;
  drawerEl.append(el("p", "ref", step.ref));
  drawerEl.append(el("p", "label", "status"));
  drawerEl.append(el("p", "", step.status));
  drawerEl.append(el("p", "label", "code"));
  drawerEl.append(el("p", "code", error ? error.code : ""));
  drawerEl.append(el("p", "label", "message"));
  drawerEl.append(el("p", "message", error ? error.message : ""));
  drawerEl.append(el("p", "label", "hint"));
  drawerEl.append(el("p", "hint", error ? error.hint : ""));
  if (step.result !== undefined) {
    drawerEl.append(el("p", "label", "result"));
    drawerEl.append(el("pre", "result", JSON.stringify(step.result, null, 2)));
  }
  if (record.log_run_id) {
    drawerEl.append(el("p", "label", "log_run_id"));
    drawerEl.append(el("p", "", record.log_run_id));
    drawerEl.append(el("p", "log-note", "Log text is not loaded here."));
  }
}

async function openSession(id, focus) {
  const env = await getJson("/sessions/" + encodeURIComponent(id));
  const record = env.data;
  if (!record) {
    const issue = (env.errors && env.errors[0]) || { code: "", message: "Session not found." };
    graphEl.replaceChildren(el("p", "", issue.code));
    drawerEl.replaceChildren(el("p", "message", issue.message));
    return;
  }
  const selected = focus && Number.isInteger(focus.index) ? focus.index : 0;
  renderGraph(record, selected);
  renderDrawer(record, selected);
}

async function loadList() {
  const env = await getJson("/sessions");
  const sessions = env.data && Array.isArray(env.data.sessions) ? env.data.sessions : [];
  renderList(sessions);
  if (sessions[0]) openSession(sessions[0].session_id, sessions[0].step);
}

loadList();
</script>
</body>
</html>
`;
