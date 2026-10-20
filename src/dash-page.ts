/**
 * Readonly page served by `bolt dash`. It reads the session JSON endpoints.
 * Plan nodes come from `steps[].node`. A missing node is filled from inspect.
 * Field names are the session record fields. It does not guess the next step.
 */
export const DASH_POLL_MS = 1000;

/** Poll only while some session is running and the page is visible. */
export function shouldPollDash(
  status: string | undefined,
  listRunning: boolean,
  pageVisible: boolean,
): boolean {
  if (!pageVisible) return false;
  return status === "running" || listRunning;
}

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
  .code, .message, .hint, .ref, .plan, .exec { margin: 0; white-space: pre-wrap; }
  .code { font: 13px/1.4 ui-monospace, monospace; font-weight: 650; }
  pre.result { margin: 8px 0 0; padding: 8px; overflow: auto; max-height: 280px; background: #f6f5f2; border-radius: 6px; font: 12px/1.4 ui-monospace, monospace; }
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
  <p>Local readonly observer for this project's execute sessions. Same records as <code>bolt session list</code> and <code>bolt session show</code>. Not CI, Jenkins, or GitHub Actions.</p>
</header>
<main>
  <section id="session-list" aria-label="Execute sessions">
    <h2>Sessions</h2>
    <div id="list"></div>
  </section>
  <section id="step-graph" aria-label="Plan versus execute">
    <h2>Plan vs execute</h2>
    <div id="graph"></div>
  </section>
  <section id="stuck" aria-label="Stuck step">
    <h2>Stuck</h2>
    <div id="drawer"></div>
    <h2>Log</h2>
    <div id="log"></div>
  </section>
</main>
<script>
const listEl = document.querySelector("#list");
const graphEl = document.querySelector("#graph");
const drawerEl = document.querySelector("#drawer");
const logEl = document.querySelector("#log");
let openId = null;
let selectedIndex = 0;
let planNodes = [];
let current = null;
let pollTimer = 0;

function shouldPollDash(status, listRunning, pageVisible) {
  if (!pageVisible) return false;
  return status === "running" || listRunning;
}

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

function pageVisible() {
  return document.visibilityState !== "hidden";
}

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = 0;
}

function armPoll(status, listRunning) {
  if (!shouldPollDash(status, listRunning, pageVisible())) {
    stopPoll();
    return;
  }
  if (pollTimer) return;
  pollTimer = setInterval(() => { void refresh(); }, ${DASH_POLL_MS});
}

document.addEventListener("visibilitychange", () => {
  if (!pageVisible()) stopPoll();
  else void refresh();
});

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

function planNodeFor(step, fallback) {
  if (step.node && typeof step.node === "object") return step.node;
  return fallback || null;
}

function planText(node) {
  if (!node || typeof node !== "object") return "(plan node missing)";
  if (node.kind === "run") return "run  " + (node.command || "");
  if (node.kind === "uses") return "uses  " + (node.ref || "");
  if (node.kind === "call") return "call  " + (node.name || "");
  return String(node.kind || "node");
}

function flattenPlan(tasks) {
  const nodes = [];
  const walk = (list) => {
    for (const node of list || []) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "call" && Array.isArray(node.nodes)) {
        walk(node.nodes);
        continue;
      }
      nodes.push(node);
    }
  };
  for (const task of tasks || []) walk(task.nodes);
  return nodes;
}

function renderGraph(record, selected) {
  graphEl.replaceChildren();
  const hash = record.plan_hash ? "  " + record.plan_hash : "";
  graphEl.append(el("p", "meta", record.session_id + "  " + record.status + hash));
  for (const step of record.steps) {
    const current = step.index === selected ? " current" : "";
    const button = el("button", "node " + step.status + current);
    button.type = "button";
    const node = planNodeFor(step, planNodes[step.index]);
    button.append(
      el("span", "idx", String(step.index)),
      el("span", "plan", "plan  " + planText(node)),
      el("span", "exec", "exec  " + step.ref + "  " + step.status),
    );
    if (step.error && step.error.code) button.append(el("span", "code", step.error.code));
    button.addEventListener("click", () => {
      selectedIndex = step.index;
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
}

async function refresh() {
  const env = await getJson("/sessions");
  const sessions = env.data && Array.isArray(env.data.sessions) ? env.data.sessions : [];
  renderList(sessions);
  let record = null;
  if (openId) {
    const detail = await getJson("/sessions/" + encodeURIComponent(openId));
    record = detail.data || null;
    if (!record) {
      const issue = (detail.errors && detail.errors[0]) || { code: "", message: "Session not found." };
      graphEl.replaceChildren(el("p", "", issue.code));
      drawerEl.replaceChildren(el("p", "message", issue.message));
      current = null;
    } else {
      current = record;
      renderGraph(record, selectedIndex);
      renderDrawer(record, selectedIndex);
    }
  }
  const listRunning = sessions.some((session) => session.status === "running");
  armPoll(record ? record.status : undefined, listRunning);
}

async function ensurePlan(record) {
  const missing = record.steps.some((step) => !step.node || typeof step.node !== "object");
  if (!missing) {
    planNodes = [];
    return;
  }
  const planEnv = await getJson("/sessions/" + encodeURIComponent(record.session_id) + "/plan");
  const tasks = planEnv.data && Array.isArray(planEnv.data.tasks) ? planEnv.data.tasks : [];
  planNodes = flattenPlan(tasks);
  renderGraph(record, selectedIndex);
  renderDrawer(record, selectedIndex);
}

async function loadLog(record) {
  logEl.replaceChildren();
  if (!record.log_run_id) {
    logEl.append(el("p", "log-note", "No log_run_id. Log cannot be linked."));
    return;
  }
  logEl.append(el("p", "label", "log_run_id"));
  logEl.append(el("p", "", record.log_run_id));
  logEl.append(el("p", "log-note", "Log text is evidence. error.code comes from the session step."));
  const res = await fetch("/sessions/" + encodeURIComponent(record.session_id) + "/log", {
    headers: { accept: "text/plain" },
  });
  const text = await res.text();
  if (!res.ok) {
    logEl.append(el("p", "message", text.trim()));
    return;
  }
  if (res.headers.get("x-bolt-log-truncated") === "1") {
    logEl.append(el("p", "log-note", "Showing the tail of the log."));
  }
  logEl.append(el("pre", "result", text));
}

async function openSession(id, focus) {
  openId = id;
  selectedIndex = focus && Number.isInteger(focus.index) ? focus.index : 0;
  planNodes = [];
  await refresh();
  if (!current || current.session_id !== id) return;
  await ensurePlan(current);
  await loadLog(current);
}

async function loadList() {
  await refresh();
  const env = await getJson("/sessions");
  const sessions = env.data && Array.isArray(env.data.sessions) ? env.data.sessions : [];
  if (sessions[0]) await openSession(sessions[0].session_id, sessions[0].step);
}

loadList();
</script>
</body>
</html>
`;
