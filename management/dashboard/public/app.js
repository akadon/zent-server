const TOKEN = localStorage.getItem('dashboard_token') || prompt('Enter dashboard token:');
if (TOKEN) localStorage.setItem('dashboard_token', TOKEN);
const API = '/api';
let autoRefreshInterval = null;
let currentPage = 'dashboard';
let logEventSource = null;
let terminalWs = null;
let terminalHistory = [];
let terminalHistoryIdx = -1;

// --- Fetch helper ---
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { localStorage.removeItem('dashboard_token'); location.reload(); }
  return res.json();
}

async function action(name, args = {}) {
  showModal(name);
  const data = await api('/action', { method: 'POST', body: { action: name, args } });
  document.getElementById('modal-output').textContent = data.output || data.error || 'Done';
}

async function k8sAction(name, args = {}) {
  showModal(name);
  const data = await api('/k8s/action', { method: 'POST', body: { action: name, args } });
  document.getElementById('modal-output').textContent = data.output || data.error || 'Done';
}

// --- Navigation ---
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    const page = el.dataset.page;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    document.getElementById(`page-${page}`).classList.add('active');
    currentPage = page;
    refreshPage();
  });
});

// --- Auto refresh ---
document.getElementById('auto-refresh').addEventListener('change', e => {
  if (e.target.checked) startAutoRefresh();
  else stopAutoRefresh();
});

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshInterval = setInterval(refreshPage, 15000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  autoRefreshInterval = null;
}

function updateTimestamp() {
  document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
}

// --- Modal ---
function showModal(title) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-output').textContent = 'Loading...';
  document.getElementById('action-modal').classList.remove('hidden');
}
function closeModal() { document.getElementById('action-modal').classList.add('hidden'); }

// --- Refresh current page ---
async function refreshPage() {
  updateTimestamp();
  const loaders = {
    dashboard: loadDashboard,
    services: loadServices,
    redis: loadRedis,
    logs: () => {},
    actions: loadActions,
    terminal: loadTerminal,
    'k8s-overview': loadK8sOverview,
    'k8s-pods': loadK8sPods,
    'k8s-deployments': loadK8sDeployments,
    'k8s-services': loadK8sServices,
    'k8s-nodes': loadK8sNodes,
    'k8s-events': loadK8sEvents,
    'k8s-terminal': loadK8sTerminal,
  };
  if (loaders[currentPage]) await loaders[currentPage]();
}

// --- Parse helpers ---
function badge(status) {
  if (/healthy|running|ok|ready|pong/i.test(status)) return `<span class="badge badge-green">${status}</span>`;
  if (/warning|pending|draining/i.test(status)) return `<span class="badge badge-yellow">${status}</span>`;
  if (/down|error|crash|fail|notready/i.test(status)) return `<span class="badge badge-red">${status}</span>`;
  return `<span class="badge badge-blue">${status}</span>`;
}

function progressBar(pct, color) {
  const c = pct > 90 ? 'var(--red)' : pct > 70 ? 'var(--yellow)' : 'var(--green)';
  return `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${color || c}"></div></div>`;
}

function tryParseJSON(s) { try { return JSON.parse(s); } catch { return null; } }

// ===== DASHBOARD =====
async function loadDashboard() {
  const el = document.getElementById('page-dashboard');
  el.innerHTML = '<h2>Dashboard</h2><div class="loading">Loading...</div>';

  const [health, stats, sys, ssl] = await Promise.all([
    api('/health'), api('/docker/stats'), api('/system'), api('/ssl'),
  ]);

  // Parse system resources
  const memParts = sys.mem?.split(/\s+/) || [];
  const memTotal = parseInt(memParts[1]) || 1;
  const memUsed = parseInt(memParts[2]) || 0;
  const memPct = ((memUsed / memTotal) * 100).toFixed(1);
  const memGB = (memUsed / 1073741824).toFixed(1);
  const memTotalGB = (memTotal / 1073741824).toFixed(1);

  const diskParts = sys.disk?.split(/\s+/) || [];
  const diskTotal = parseInt(diskParts[1]) || 1;
  const diskUsed = parseInt(diskParts[2]) || 0;
  const diskPct = ((diskUsed / diskTotal) * 100).toFixed(1);

  const loadParts = sys.load?.split(' ') || [];
  const upSec = parseFloat(sys.uptime) || 0;
  const upDays = Math.floor(upSec / 86400);
  const upHours = Math.floor((upSec % 86400) / 3600);

  // Parse health
  const apiHealth = tryParseJSON(health.api);
  const authHealth = tryParseJSON(health.auth);
  const gwHealths = (health.gateways || []).map(g => tryParseJSON(g));
  const totalConns = gwHealths.reduce((s, g) => s + (g?.connections || 0), 0);

  let gwCards = '';
  gwHealths.forEach((g, i) => {
    const st = g?.status || 'down';
    gwCards += `<div class="card"><div class="card-title">Gateway ${i + 1}</div><div>${badge(st)}</div>
      ${g ? `<div style="margin-top:8px;font-size:13px">${g.connections || 0} conns | lag: ${g.eventLoopLag?.toFixed(1) || '?'}ms</div>` : ''}</div>`;
  });

  // SSL
  let sslHtml = ssl.certs?.map(c => {
    const match = c.expiry?.match(/notAfter=(.*)/);
    const exp = match ? new Date(match[1]) : null;
    const days = exp ? Math.floor((exp - Date.now()) / 86400000) : -1;
    const cls = days < 7 ? 'badge-red' : days < 30 ? 'badge-yellow' : 'badge-green';
    return `<div>${c.domain}: <span class="badge ${cls}">${days > 0 ? days + 'd' : 'error'}</span></div>`;
  }).join('') || '';

  el.innerHTML = `
    <h2>Dashboard</h2>
    <div class="grid grid-4">
      <div class="card"><div class="card-title">API</div>${badge(apiHealth?.status || (health.api === 'down' ? 'down' : 'ok'))}
        ${apiHealth?.eventLoopLag ? `<div style="margin-top:4px;font-size:12px">lag: ${apiHealth.eventLoopLag.toFixed(1)}ms</div>` : ''}</div>
      <div class="card"><div class="card-title">Auth</div>${badge(authHealth?.status || (health.auth === 'down' ? 'down' : 'ok'))}
        ${authHealth?.eventLoopLag ? `<div style="margin-top:4px;font-size:12px">lag: ${authHealth.eventLoopLag.toFixed(1)}ms</div>` : ''}</div>
      <div class="card"><div class="card-title">Redis</div>${badge(health.redis?.includes('PONG') ? 'ok' : 'down')}</div>
      <div class="card"><div class="card-title">Total Connections</div><div class="card-value">${totalConns}</div></div>
    </div>
    <div class="grid grid-4">${gwCards}</div>
    <h3>System Resources</h3>
    <div class="grid grid-3">
      <div class="card"><div class="card-title">Memory</div><div class="card-value">${memGB}/${memTotalGB} GB</div>${progressBar(memPct)}</div>
      <div class="card"><div class="card-title">Disk</div><div class="card-value">${diskPct}%</div>${progressBar(diskPct)}</div>
      <div class="card"><div class="card-title">Load / Uptime</div><div>${loadParts.slice(0, 3).join(' ')}</div><div style="margin-top:4px;font-size:13px">${upDays}d ${upHours}h</div></div>
    </div>
    <h3>SSL Certificates</h3>
    <div class="card">${sslHtml}</div>
    <h3>Container Stats</h3>
    <div class="card"><table><tr><th>Container</th><th>CPU</th><th>Memory</th><th>Net I/O</th><th>PIDs</th></tr>
      ${(stats.stats || []).map(s => `<tr><td>${s.name}</td><td>${s.cpu}</td><td>${s.mem}</td><td>${s.net}</td><td>${s.pids}</td></tr>`).join('')}
    </table></div>`;
}

// ===== SERVICES =====
async function loadServices() {
  const el = document.getElementById('page-services');
  el.innerHTML = '<h2>Services</h2><div class="loading">Loading...</div>';
  const data = await api('/docker/ps');
  el.innerHTML = `<h2>Services</h2>
    <div class="card"><table><tr><th>Name</th><th>Status</th><th>Image</th><th>Actions</th></tr>
    ${(data.containers || []).map(c => {
      const isUp = /up/i.test(c.status);
      return `<tr><td>${c.name}</td><td>${badge(isUp ? (/healthy/i.test(c.status) ? 'healthy' : 'running') : 'down')}<br><small>${c.status}</small></td><td><small>${c.image}</small></td>
        <td><button class="btn btn-sm" onclick="action('restart-container',{name:'${c.name}'})">Restart</button>
        ${!isUp ? `<button class="btn btn-sm btn-green" onclick="action('start-container',{name:'${c.name}'})">Start</button>` : ''}</td></tr>`;
    }).join('')}</table></div>`;
}

// ===== REDIS =====
async function loadRedis() {
  const el = document.getElementById('page-redis');
  el.innerHTML = '<h2>Redis</h2><div class="loading">Loading...</div>';
  const [memInfo, statsInfo, keys] = await Promise.all([
    api('/redis/info?section=memory'), api('/redis/info?section=stats'), api('/redis/keys'),
  ]);

  function parseInfo(text) {
    const obj = {};
    (text || '').split('\n').forEach(l => { const [k, v] = l.split(':'); if (k && v) obj[k.trim()] = v.trim(); });
    return obj;
  }
  const mem = parseInfo(memInfo.info);
  const st = parseInfo(statsInfo.info);
  const usedMB = parseInt(mem.used_memory || 0) / 1048576;
  const maxMB = parseInt(mem.maxmemory || 1) / 1048576;
  const memPct = maxMB > 0 ? (usedMB / maxMB * 100).toFixed(1) : 0;
  const hitRate = (parseInt(st.keyspace_hits || 0) / (parseInt(st.keyspace_hits || 0) + parseInt(st.keyspace_misses || 1)) * 100).toFixed(1);

  const maxKey = Math.max(...Object.values(keys.counts || {}), 1);

  el.innerHTML = `<h2>Redis</h2>
    <div class="grid grid-3">
      <div class="card"><div class="card-title">Memory</div><div class="card-value">${usedMB.toFixed(0)}MB / ${(maxMB / 1024).toFixed(1)}GB</div>${progressBar(memPct)}
        <div style="margin-top:8px;font-size:12px">RSS: ${mem.used_memory_rss_human || '?'} | Peak: ${mem.used_memory_peak_human || '?'} | Frag: ${mem.mem_fragmentation_ratio || '?'}</div></div>
      <div class="card"><div class="card-title">Performance</div>
        <div>Ops/s: <b>${st.instantaneous_ops_per_sec || '?'}</b></div>
        <div>Hit rate: ${badge(hitRate > 90 ? hitRate + '%' : hitRate + '%')}</div>
        <div style="font-size:12px;margin-top:4px">Evicted: ${st.evicted_keys || 0} | Expired: ${st.expired_keys || 0}</div></div>
      <div class="card"><div class="card-title">Keys</div><div class="card-value">${keys.total}</div>
        <div style="font-size:12px;margin-top:4px">Clients: ${st.connected_clients || '?'}</div></div>
    </div>
    <h3>Key Distribution</h3>
    <div class="card"><div class="bar-chart">
      ${Object.entries(keys.counts || {}).map(([k, v]) =>
        `<div class="bar-row"><div class="bar-label">${k}</div><div class="bar-fill" style="width:${(v / maxKey * 100).toFixed(0)}%;background:var(--accent)">${v}</div></div>`
      ).join('')}
    </div></div>
    <div class="toolbar" style="margin-top:16px">
      <button class="btn" onclick="action('flush-ratelimits')">Flush Rate Limits</button>
      <button class="btn" onclick="action('redis-info')">Full INFO</button>
      <button class="btn" onclick="loadSlowlog()">Slowlog</button>
      <button class="btn" onclick="loadPubsub()">Pub/Sub</button>
    </div>`;
}

async function loadSlowlog() {
  showModal('Redis Slowlog');
  const data = await api('/redis/slowlog');
  document.getElementById('modal-output').textContent = data.slowlog;
}

async function loadPubsub() {
  showModal('Redis Pub/Sub');
  const data = await api('/redis/pubsub');
  document.getElementById('modal-output').textContent = `Active channels: ${data.channels.length}\n\n${data.channels.join('\n')}`;
}

// ===== LOGS =====
function loadLogs() {
  const el = document.getElementById('page-logs');
  if (el.querySelector('.log-box')) return; // Already initialized
  el.innerHTML = `<h2>Logs</h2>
    <div class="toolbar">
      <select id="log-source"><option value="api">API</option><option value="auth">Auth</option>
        <option value="gateway-1">Gateway 1</option><option value="gateway-2">Gateway 2</option>
        <option value="gateway-3">Gateway 3</option><option value="gateway-4">Gateway 4</option>
        <option value="redis">Redis</option><option value="system">System</option>
        <option value="nginx-access">Nginx Access</option><option value="nginx-error">Nginx Error</option></select>
      <button class="btn btn-green" onclick="startLogs()">Stream</button>
      <button class="btn btn-danger" onclick="stopLogs()">Stop</button>
      <button class="btn" onclick="clearLogs()">Clear</button>
      <button class="btn" onclick="downloadLogs()">Download</button>
      <button class="btn btn-danger" onclick="action('truncate-logs')">Truncate Docker Logs</button>
    </div>
    <div class="log-box" id="log-output"></div>`;
}

function startLogs() {
  stopLogs();
  const source = document.getElementById('log-source').value;
  const logBox = document.getElementById('log-output');
  logEventSource = new EventSource(`${API}/logs/stream?source=${source}&token=${TOKEN}`);
  logEventSource.onmessage = e => {
    logBox.textContent += e.data + '\n';
    logBox.scrollTop = logBox.scrollHeight;
  };
}

function stopLogs() {
  if (logEventSource) { logEventSource.close(); logEventSource = null; }
}

function clearLogs() { const el = document.getElementById('log-output'); if (el) el.textContent = ''; }

function downloadLogs() {
  const text = document.getElementById('log-output')?.textContent || '';
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `logs-${Date.now()}.log`;
  a.click();
}

// ===== ACTIONS =====
function loadActions() {
  const el = document.getElementById('page-actions');
  el.innerHTML = `<h2>Actions</h2>
    <h3>Docker</h3>
    <div class="actions-grid">
      <div class="action-btn" onclick="action('restart-gateways')"><div class="label">Restart All Gateways</div></div>
      <div class="action-btn" onclick="action('deploy-stack')"><div class="label">Deploy Stack</div></div>
      <div class="action-btn" onclick="action('pull-images')"><div class="label">Pull Images</div></div>
      <div class="action-btn" onclick="if(confirm('Build + deploy?')) action('build-deploy')"><div class="label">Build & Deploy</div></div>
      <div class="action-btn" onclick="if(confirm('Prune all?')) action('docker-prune')"><div class="label">Docker Prune</div></div>
    </div>
    <h3>Nginx</h3>
    <div class="actions-grid">
      <div class="action-btn" onclick="action('nginx-reload')"><div class="label">Reload Nginx</div></div>
      <div class="action-btn" onclick="action('nginx-test')"><div class="label">Test Config</div></div>
      <div class="action-btn" onclick="action('nginx-conns')"><div class="label">Show Connections</div></div>
    </div>
    <h3>Security</h3>
    <div class="actions-grid">
      <div class="action-btn" onclick="action('fail2ban-status')"><div class="label">Fail2ban Status</div></div>
      <div class="action-btn" onclick="action('banned-ips')"><div class="label">Banned IPs</div></div>
      <div class="action-btn" onclick="action('ufw-status')"><div class="label">UFW Rules</div></div>
      <div class="action-btn" onclick="blockIP()"><div class="label">Block IP</div></div>
    </div>
    <h3>System</h3>
    <div class="actions-grid">
      <div class="action-btn" onclick="action('network-conns')"><div class="label">Network Connections</div></div>
      <div class="action-btn" onclick="action('top-processes')"><div class="label">Top Processes</div></div>
      <div class="action-btn" onclick="action('sysctl-apply')"><div class="label">Apply Sysctl</div></div>
    </div>`;
}

function blockIP() {
  const ip = prompt('Enter IP to block:');
  if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) action('block-ip', { ip });
}

// ===== TERMINAL =====
function loadTerminal() {
  const el = document.getElementById('page-terminal');
  if (el.querySelector('.terminal')) return;
  el.innerHTML = `<h2>Terminal</h2>
    <div class="toolbar">
      <select id="term-target"><option value="a1flex">A1.Flex (Zent)</option><option value="micro1">Micro 1 (S3)</option><option value="micro2">Micro 2</option><option value="local">Local</option></select>
      <button class="btn" onclick="reconnectTerminal()">Reconnect</button>
    </div>
    <div class="terminal" id="term-output"></div>
    <div class="terminal-input"><span>$</span><input id="term-input" placeholder="Enter command..." onkeydown="termKeydown(event)"></div>`;
  connectTerminal();
}

function connectTerminal() {
  const target = document.getElementById('term-target')?.value || 'a1flex';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  terminalWs = new WebSocket(`${proto}//${location.host}/ws?token=${TOKEN}&target=${target}&mode=shell`);
  terminalWs.onmessage = e => {
    const msg = JSON.parse(e.data);
    const out = document.getElementById('term-output');
    if (msg.type === 'stdout' || msg.type === 'stderr') { out.textContent += msg.data; out.scrollTop = out.scrollHeight; }
    if (msg.type === 'exit') { out.textContent += `\n[exit ${msg.code}]\n`; out.scrollTop = out.scrollHeight; }
  };
}

function reconnectTerminal() {
  if (terminalWs) terminalWs.close();
  document.getElementById('term-output').textContent = '';
  connectTerminal();
}

function termKeydown(e) {
  if (e.key === 'Enter') {
    const input = e.target;
    const cmd = input.value.trim();
    if (!cmd) return;
    terminalHistory.push(cmd);
    terminalHistoryIdx = terminalHistory.length;
    document.getElementById('term-output').textContent += `$ ${cmd}\n`;
    if (terminalWs?.readyState === 1) terminalWs.send(cmd);
    input.value = '';
  } else if (e.key === 'ArrowUp') {
    if (terminalHistoryIdx > 0) e.target.value = terminalHistory[--terminalHistoryIdx];
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    if (terminalHistoryIdx < terminalHistory.length - 1) e.target.value = terminalHistory[++terminalHistoryIdx];
    else { terminalHistoryIdx = terminalHistory.length; e.target.value = ''; }
    e.preventDefault();
  }
}

// ===== K8S OVERVIEW =====
async function loadK8sOverview() {
  const el = document.getElementById('page-k8s-overview');
  el.innerHTML = '<h2>Kubernetes Overview</h2><div class="loading">Loading...</div>';
  const [cluster, ns] = await Promise.all([api('/k8s/cluster'), api('/k8s/namespaces')]);
  const nodesLines = (cluster.nodes || '').split('\n').filter(Boolean);
  const nodes = nodesLines.map(l => { const p = l.trim().split(/\s+/); return { name: p[0], status: p[1], version: p[4] }; });

  el.innerHTML = `<h2>Kubernetes Overview</h2>
    <div class="grid grid-2">
      <div class="card"><div class="card-title">Cluster Info</div><pre style="font-size:12px;white-space:pre-wrap">${cluster.info || 'N/A'}</pre></div>
      <div class="card"><div class="card-title">Version</div><pre style="font-size:12px;white-space:pre-wrap">${cluster.version || 'N/A'}</pre></div>
    </div>
    <h3>Nodes</h3>
    <div class="card"><table><tr><th>Name</th><th>Status</th><th>Version</th></tr>
      ${nodes.map(n => `<tr><td>${n.name}</td><td>${badge(n.status)}</td><td>${n.version || '?'}</td></tr>`).join('')}
    </table></div>
    <h3>Namespaces</h3>
    <div class="card"><pre style="font-size:12px">${cluster.namespaces || ns.namespaces || 'N/A'}</pre></div>
    <h3>Component Status</h3>
    <div class="card"><pre style="font-size:12px">${cluster.components || 'N/A'}</pre></div>`;
}

// ===== K8S PODS =====
async function loadK8sPods() {
  const el = document.getElementById('page-k8s-pods');
  el.innerHTML = '<h2>Pods</h2><div class="loading">Loading...</div>';
  const ns = await api('/k8s/namespaces');
  const data = await api('/k8s/pods?ns=all');
  const lines = (data.pods || '').split('\n').filter(Boolean);
  const pods = lines.map(l => { const p = l.trim().split(/\s+/); return { ns: p[0], name: p[1], ready: p[2], status: p[3], restarts: p[4], age: p[5] }; });

  const nsList = (ns.namespaces || '').split('\n').filter(Boolean).map(l => l.trim().split(/\s+/)[0]);

  el.innerHTML = `<h2>Pods</h2>
    <div class="toolbar">
      <select id="pod-ns" onchange="filterPods()"><option value="all">All Namespaces</option>${nsList.map(n => `<option value="${n}">${n}</option>`).join('')}</select>
      <select id="pod-status" onchange="filterPods()"><option value="">All Status</option><option>Running</option><option>CrashLoopBackOff</option><option>Pending</option><option>Completed</option><option>Error</option></select>
      <button class="btn" onclick="loadK8sPods()">Refresh</button>
    </div>
    <div class="card"><table><tr><th>Namespace</th><th>Name</th><th>Ready</th><th>Status</th><th>Restarts</th><th>Age</th><th>Actions</th></tr>
      ${pods.map(p => `<tr class="pod-row" data-ns="${p.ns}" data-status="${p.status}">
        <td><span class="badge badge-blue">${p.ns}</span></td><td>${p.name}</td><td>${p.ready}</td><td>${badge(p.status)}</td><td>${p.restarts}</td><td>${p.age}</td>
        <td><button class="btn btn-sm" onclick="k8sAction('pod-logs',{pod:'${p.name}',ns:'${p.ns}'})">Logs</button>
        <button class="btn btn-sm" onclick="k8sAction('pod-describe',{pod:'${p.name}',ns:'${p.ns}'})">Describe</button>
        <button class="btn btn-sm btn-danger" onclick="if(confirm('Delete pod ${p.name}?'))k8sAction('pod-delete',{pod:'${p.name}',ns:'${p.ns}'})">Delete</button></td></tr>`).join('')}
    </table></div>`;
}

function filterPods() {
  const ns = document.getElementById('pod-ns')?.value;
  const status = document.getElementById('pod-status')?.value;
  document.querySelectorAll('.pod-row').forEach(r => {
    const show = (!ns || ns === 'all' || r.dataset.ns === ns) && (!status || r.dataset.status === status);
    r.style.display = show ? '' : 'none';
  });
}

// ===== K8S DEPLOYMENTS =====
async function loadK8sDeployments() {
  const el = document.getElementById('page-k8s-deployments');
  el.innerHTML = '<h2>Deployments</h2><div class="loading">Loading...</div>';
  const data = await api('/k8s/deployments?ns=all');
  const lines = (data.deployments || '').split('\n').filter(Boolean);
  const deps = lines.map(l => { const p = l.trim().split(/\s+/); return { ns: p[0], name: p[1], ready: p[2], upToDate: p[3], available: p[4], age: p[5] }; });

  el.innerHTML = `<h2>Deployments</h2>
    <div class="card"><table><tr><th>Namespace</th><th>Name</th><th>Ready</th><th>Up-to-date</th><th>Available</th><th>Age</th><th>Actions</th></tr>
      ${deps.map(d => `<tr><td><span class="badge badge-blue">${d.ns}</span></td><td>${d.name}</td><td>${d.ready}</td><td>${d.upToDate}</td><td>${d.available}</td><td>${d.age}</td>
        <td><button class="btn btn-sm" onclick="k8sAction('rollout-status',{deploy:'${d.name}',ns:'${d.ns}'})">Status</button>
        <button class="btn btn-sm" onclick="if(confirm('Restart ${d.name}?'))k8sAction('rollout-restart',{deploy:'${d.name}',ns:'${d.ns}'})">Restart</button>
        <button class="btn btn-sm" onclick="scaleK8s('${d.name}','${d.ns}')">Scale</button></td></tr>`).join('')}
    </table></div>`;
}

function scaleK8s(deploy, ns) {
  const n = prompt(`Scale ${deploy} to how many replicas?`);
  if (n && /^\d+$/.test(n)) k8sAction('scale-deploy', { deploy, ns, replicas: n });
}

// ===== K8S SERVICES =====
async function loadK8sServices() {
  const el = document.getElementById('page-k8s-services');
  el.innerHTML = '<h2>Services & Ingresses</h2><div class="loading">Loading...</div>';
  const data = await api('/k8s/services?ns=all');
  el.innerHTML = `<h2>Services & Ingresses</h2>
    <h3>Services</h3><div class="card"><pre style="font-size:12px">${data.services || 'None'}</pre></div>
    <h3>Ingresses</h3><div class="card"><pre style="font-size:12px">${data.ingresses || 'None'}</pre></div>`;
}

// ===== K8S NODES =====
async function loadK8sNodes() {
  const el = document.getElementById('page-k8s-nodes');
  el.innerHTML = '<h2>Nodes</h2><div class="loading">Loading...</div>';
  const data = await api('/k8s/nodes');
  let nodesJson;
  try { nodesJson = JSON.parse(data.nodes); } catch { el.innerHTML = `<h2>Nodes</h2><div class="card"><pre>${data.nodes}</pre></div>`; return; }

  el.innerHTML = `<h2>Nodes</h2>
    ${(nodesJson.items || []).map(n => {
      const info = n.status?.nodeInfo || {};
      const conds = (n.status?.conditions || []);
      const ready = conds.find(c => c.type === 'Ready');
      return `<div class="card" style="margin-bottom:16px">
        <h3>${n.metadata?.name} ${badge(ready?.status === 'True' ? 'Ready' : 'NotReady')}</h3>
        <div class="grid grid-2" style="margin-top:8px">
          <div><small>OS: ${info.osImage}<br>Kernel: ${info.kernelVersion}<br>Runtime: ${info.containerRuntimeVersion}<br>Arch: ${info.architecture}</small></div>
          <div><small>CPU: ${n.status?.capacity?.cpu || '?'} (alloc: ${n.status?.allocatable?.cpu || '?'})<br>
            Mem: ${n.status?.capacity?.memory || '?'} (alloc: ${n.status?.allocatable?.memory || '?'})<br>
            Pods: ${n.status?.capacity?.pods || '?'}</small></div>
        </div>
        <div style="margin-top:8px">${conds.map(c => `<span class="badge ${c.status === 'False' || (c.type === 'Ready' && c.status === 'True') ? 'badge-green' : 'badge-red'}" style="margin:2px">${c.type}</span>`).join('')}</div>
      </div>`;
    }).join('')}`;
}

// ===== K8S EVENTS =====
async function loadK8sEvents() {
  const el = document.getElementById('page-k8s-events');
  el.innerHTML = '<h2>Events</h2><div class="loading">Loading...</div>';
  const data = await api('/k8s/events?ns=all');
  el.innerHTML = `<h2>Events</h2>
    <div class="toolbar">
      <select onchange="loadK8sEventsFilter(this.value)"><option value="">All Types</option><option value="Warning">Warning</option><option value="Normal">Normal</option></select>
      <button class="btn" onclick="loadK8sEvents()">Refresh</button>
    </div>
    <div class="card"><pre style="font-size:12px;white-space:pre-wrap">${data.events || 'No events'}</pre></div>`;
}

async function loadK8sEventsFilter(type) {
  const data = await api(`/k8s/events?ns=all${type ? '&type=' + type : ''}`);
  document.querySelector('#page-k8s-events .card pre').textContent = data.events || 'No events';
}

// ===== K8S TERMINAL =====
function loadK8sTerminal() {
  const el = document.getElementById('page-k8s-terminal');
  if (el.querySelector('.terminal')) return;
  el.innerHTML = `<h2>kubectl Terminal</h2>
    <div class="toolbar">
      <button class="btn" onclick="reconnectK8sTerminal()">Reconnect</button>
      <button class="btn" onclick="k8sAction('top-nodes')">Top Nodes</button>
      <button class="btn" onclick="k8sAction('top-pods')">Top Pods</button>
      <button class="btn" onclick="if(confirm('Delete all failed pods?'))k8sAction('delete-failed')">Delete Failed Pods</button>
    </div>
    <div class="terminal" id="k8s-term-output"></div>
    <div class="terminal-input"><span>kubectl</span><input id="k8s-term-input" placeholder="get pods -A" onkeydown="k8sTermKeydown(event)"></div>`;
  connectK8sTerminal();
}

let k8sTermWs = null;
let k8sHistory = [];
let k8sHistoryIdx = -1;

function connectK8sTerminal() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  k8sTermWs = new WebSocket(`${proto}//${location.host}/ws?token=${TOKEN}&mode=kubectl`);
  k8sTermWs.onmessage = e => {
    const msg = JSON.parse(e.data);
    const out = document.getElementById('k8s-term-output');
    if (msg.type === 'stdout' || msg.type === 'stderr') { out.textContent += msg.data; out.scrollTop = out.scrollHeight; }
    if (msg.type === 'exit') { out.textContent += '\n'; out.scrollTop = out.scrollHeight; }
  };
}

function reconnectK8sTerminal() {
  if (k8sTermWs) k8sTermWs.close();
  document.getElementById('k8s-term-output').textContent = '';
  connectK8sTerminal();
}

function k8sTermKeydown(e) {
  if (e.key === 'Enter') {
    const cmd = e.target.value.trim();
    if (!cmd) return;
    k8sHistory.push(cmd);
    k8sHistoryIdx = k8sHistory.length;
    document.getElementById('k8s-term-output').textContent += `$ kubectl ${cmd}\n`;
    if (k8sTermWs?.readyState === 1) k8sTermWs.send(cmd);
    e.target.value = '';
  } else if (e.key === 'ArrowUp') {
    if (k8sHistoryIdx > 0) e.target.value = k8sHistory[--k8sHistoryIdx];
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    if (k8sHistoryIdx < k8sHistory.length - 1) e.target.value = k8sHistory[++k8sHistoryIdx];
    else { k8sHistoryIdx = k8sHistory.length; e.target.value = ''; }
    e.preventDefault();
  }
}

// --- Init ---
loadLogs(); // Pre-init logs page
refreshPage();
startAutoRefresh();
