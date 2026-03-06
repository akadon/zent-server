const express = require('express');
const { execSync, spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const PORT = 3500;
const AUTH_TOKEN = process.env.DASHBOARD_TOKEN || 'zent-dashboard-2026';

// --- Config ---
const SERVERS = {
  a1flex: { host: '10.0.20.221', port: 2222, key: '/tmp/ssh-key', user: 'ubuntu' },
  micro1: { host: '10.0.20.208', port: 2222, key: '/tmp/ssh-key', user: 'ubuntu' },
  micro2: { host: '10.0.20.164', port: 2222, key: '/tmp/ssh-key', user: 'ubuntu' },
  local: null,
};

const ZENT_DIR = '/home/ubuntu/projects/zent-server';
const REDIS_CONTAINER = 'zent-server-redis-1';
const K8S_DIR = '/opt/oracleserver/k8s';

// --- Auth middleware ---
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// --- Helpers ---
function sshCmd(server, cmd) {
  const s = SERVERS[server];
  if (!s) return cmd;
  return `ssh -p ${s.port} -i ${s.key} -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${s.user}@${s.host} ${JSON.stringify(cmd)}`;
}

function run(cmd, timeout = 10000) {
  try {
    return execSync(cmd, { timeout, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch (e) {
    return e.stdout?.trim() || e.stderr?.trim() || e.message;
  }
}

function runOn(server, cmd, timeout = 10000) {
  return run(sshCmd(server, cmd), timeout);
}

// --- Static files ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Zent API ---
app.get('/api/health', auth, (req, res) => {
  const api = runOn('a1flex', 'curl -sf --max-time 3 http://127.0.0.1:4000/health 2>/dev/null || echo "down"');
  const authSvc = runOn('a1flex', 'curl -sf --max-time 3 http://127.0.0.1:4001/health 2>/dev/null || echo "down"');
  const redis = runOn('a1flex', `docker exec ${REDIS_CONTAINER} redis-cli PING 2>/dev/null || echo "down"`);
  const gw1 = runOn('a1flex', 'curl -sf --max-time 3 http://127.0.0.1:4002/health 2>/dev/null || echo "down"');
  const gw2 = runOn('a1flex', 'curl -sf --max-time 3 http://127.0.0.1:4012/health 2>/dev/null || echo "down"');
  const gw3 = runOn('a1flex', 'curl -sf --max-time 3 http://127.0.0.1:4022/health 2>/dev/null || echo "down"');
  const gw4 = runOn('a1flex', 'curl -sf --max-time 3 http://127.0.0.1:4032/health 2>/dev/null || echo "down"');
  res.json({ api, auth: authSvc, redis, gateways: [gw1, gw2, gw3, gw4] });
});

app.get('/api/docker/ps', auth, (req, res) => {
  const out = runOn('a1flex', 'docker ps -a --format "{{.Names}}|{{.Status}}|{{.Image}}|{{.Ports}}" --no-trunc');
  res.json({ containers: out.split('\n').filter(Boolean).map(l => {
    const [name, status, image, ports] = l.split('|');
    return { name, status, image, ports };
  })});
});

app.get('/api/docker/stats', auth, (req, res) => {
  const out = runOn('a1flex', 'docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.PIDs}}"');
  res.json({ stats: out.split('\n').filter(Boolean).map(l => {
    const [name, cpu, mem, memPct, net, pids] = l.split('|');
    return { name, cpu, mem, memPct, net, pids };
  })});
});

app.get('/api/system', auth, (req, res) => {
  const mem = runOn('a1flex', 'free -b | head -2 | tail -1');
  const disk = runOn('a1flex', 'df -B1 / | tail -1');
  const cpus = runOn('a1flex', 'nproc');
  const load = runOn('a1flex', 'cat /proc/loadavg');
  const uptime = runOn('a1flex', 'cat /proc/uptime');
  const tcp = runOn('a1flex', 'ss -s | grep TCP');
  res.json({ mem, disk, cpus, load, uptime, tcp });
});

app.get('/api/ssl', auth, (req, res) => {
  const domains = ['api.3aka.com', '3aka.com', 'gw.3aka.com'];
  const results = domains.map(d => {
    const out = runOn('a1flex', `echo | openssl s_client -servername ${d} -connect ${d}:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null || echo "error"`, 15000);
    return { domain: d, expiry: out };
  });
  res.json({ certs: results });
});

// --- Redis API ---
app.get('/api/redis/info', auth, (req, res) => {
  const section = req.query.section || 'all';
  const out = runOn('a1flex', `docker exec ${REDIS_CONTAINER} redis-cli INFO ${section}`);
  res.json({ info: out });
});

app.get('/api/redis/keys', auth, (req, res) => {
  const prefixes = ['session', 'ratelimit', 'resume', 'presence', 'guild', 'cache'];
  const counts = {};
  for (const p of prefixes) {
    counts[p] = parseInt(runOn('a1flex', `docker exec ${REDIS_CONTAINER} redis-cli --scan --pattern '${p}:*' 2>/dev/null | wc -l`)) || 0;
  }
  const total = parseInt(runOn('a1flex', `docker exec ${REDIS_CONTAINER} redis-cli DBSIZE 2>/dev/null | awk '{print $2}'`)) || 0;
  res.json({ counts, total });
});

app.get('/api/redis/slowlog', auth, (req, res) => {
  const out = runOn('a1flex', `docker exec ${REDIS_CONTAINER} redis-cli SLOWLOG GET 10`);
  res.json({ slowlog: out });
});

app.get('/api/redis/pubsub', auth, (req, res) => {
  const channels = runOn('a1flex', `docker exec ${REDIS_CONTAINER} redis-cli PUBSUB CHANNELS '*'`);
  res.json({ channels: channels.split('\n').filter(Boolean) });
});

// --- Actions ---
app.post('/api/action', auth, (req, res) => {
  const { action, args } = req.body;
  const actions = {
    'restart-container': () => runOn('a1flex', `docker restart ${args.name}`, 30000),
    'start-container': () => runOn('a1flex', `docker start ${args.name}`, 30000),
    'restart-gateways': () => runOn('a1flex', 'docker restart zent-server-gateway-1-1 zent-server-gateway-2-1 zent-server-gateway-3-1 zent-server-gateway-4-1', 60000),
    'deploy-stack': () => runOn('a1flex', `cd ${ZENT_DIR} && docker compose -f docker-compose.prod.yml up -d --remove-orphans`, 120000),
    'pull-images': () => runOn('a1flex', `cd ${ZENT_DIR} && docker compose -f docker-compose.prod.yml pull`, 120000),
    'build-deploy': () => runOn('a1flex', `cd ${ZENT_DIR} && docker compose -f docker-compose.prod.yml build --no-cache && docker compose -f docker-compose.prod.yml up -d --remove-orphans`, 300000),
    'docker-prune': () => runOn('a1flex', 'docker system prune -af', 60000),
    'nginx-reload': () => runOn('a1flex', 'nginx -t && systemctl reload nginx', 10000),
    'nginx-test': () => runOn('a1flex', 'nginx -t'),
    'nginx-conns': () => runOn('a1flex', 'ss -s && echo "---" && curl -s http://127.0.0.1/nginx_status 2>/dev/null && echo "---" && ss -tnp | grep nginx | head -30'),
    'flush-ratelimits': () => runOn('a1flex', `docker exec ${REDIS_CONTAINER} redis-cli --scan --pattern 'ratelimit:*' | head -1000 | xargs docker exec -i ${REDIS_CONTAINER} redis-cli DEL`),
    'redis-info': () => runOn('a1flex', `docker exec ${REDIS_CONTAINER} redis-cli INFO`),
    'fail2ban-status': () => runOn('a1flex', 'fail2ban-client status 2>/dev/null && echo "---" && for j in $(fail2ban-client status 2>/dev/null | grep "Jail list" | sed "s/.*://;s/,//g"); do echo "=== $j ==="; fail2ban-client status $j 2>/dev/null; done'),
    'banned-ips': () => runOn('a1flex', 'for j in $(fail2ban-client status 2>/dev/null | grep "Jail list" | sed "s/.*://;s/,//g"); do echo "=== $j ==="; fail2ban-client status $j 2>/dev/null | grep "Banned IP"; done && echo "--- Recent bans ---" && grep "Ban" /var/log/fail2ban.log 2>/dev/null | tail -20'),
    'block-ip': () => args.ip ? runOn('a1flex', `ufw deny from ${args.ip}`) : 'No IP provided',
    'ufw-status': () => runOn('a1flex', 'ufw status numbered'),
    'network-conns': () => runOn('a1flex', 'ss -s && echo "---" && ss -tn | awk \'{print $5}\' | cut -d: -f1 | sort | uniq -c | sort -rn | head -10 && echo "---" && ss -tlnp | tail -20'),
    'top-processes': () => runOn('a1flex', 'ps aux --sort=-%cpu | head -11 && echo "---" && ps aux --sort=-%mem | head -11'),
    'sysctl-apply': () => runOn('a1flex', 'sysctl --system | tail -5'),
    'truncate-logs': () => runOn('a1flex', 'truncate -s 0 /var/lib/docker/containers/*/*-json.log && echo "Logs truncated"'),
  };
  if (!actions[action]) return res.status(400).json({ error: 'Unknown action' });
  try {
    res.json({ output: actions[action]() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- K8s API ---
const KUBECTL = 'export PATH=$HOME/.local/bin:$PATH KUBECONFIG=$HOME/.kube/config OCI_CLI_CONFIG_FILE=$HOME/.oci/config; kubectl';

function kubectl(cmd, timeout = 15000) {
  return run(`${KUBECTL} ${cmd}`, timeout);
}

app.get('/api/k8s/cluster', auth, (req, res) => {
  const info = kubectl('cluster-info 2>&1 | head -5');
  const version = kubectl('version --short 2>&1');
  const nodes = kubectl('get nodes -o wide --no-headers 2>&1');
  const components = kubectl('get componentstatuses 2>&1');
  res.json({ info, version, nodes, components });
});

app.get('/api/k8s/pods', auth, (req, res) => {
  const ns = req.query.ns;
  const cmd = ns && ns !== 'all' ? `get pods -n ${ns} -o wide --no-headers` : 'get pods -A -o wide --no-headers';
  res.json({ pods: kubectl(cmd) });
});

app.get('/api/k8s/deployments', auth, (req, res) => {
  const ns = req.query.ns;
  const cmd = ns && ns !== 'all' ? `get deploy -n ${ns} --no-headers` : 'get deploy -A --no-headers';
  res.json({ deployments: kubectl(cmd) });
});

app.get('/api/k8s/services', auth, (req, res) => {
  const ns = req.query.ns;
  const svcCmd = ns && ns !== 'all' ? `get svc -n ${ns} --no-headers` : 'get svc -A --no-headers';
  const ingCmd = ns && ns !== 'all' ? `get ingress -n ${ns} --no-headers 2>/dev/null` : 'get ingress -A --no-headers 2>/dev/null';
  res.json({ services: kubectl(svcCmd), ingresses: kubectl(ingCmd) });
});

app.get('/api/k8s/nodes', auth, (req, res) => {
  res.json({ nodes: kubectl('get nodes -o json', 20000) });
});

app.get('/api/k8s/events', auth, (req, res) => {
  const ns = req.query.ns;
  const type = req.query.type;
  let cmd = 'get events';
  cmd += ns && ns !== 'all' ? ` -n ${ns}` : ' -A';
  if (type) cmd += ` --field-selector type=${type}`;
  cmd += ' --sort-by=.lastTimestamp 2>&1 | tail -50';
  res.json({ events: kubectl(cmd) });
});

app.get('/api/k8s/namespaces', auth, (req, res) => {
  res.json({ namespaces: kubectl('get ns --no-headers') });
});

app.get('/api/k8s/top', auth, (req, res) => {
  const nodes = kubectl('top nodes 2>&1');
  const pods = kubectl('top pods -A --sort-by=cpu 2>&1');
  res.json({ nodes, pods });
});

app.post('/api/k8s/action', auth, (req, res) => {
  const { action, args } = req.body;
  const ns = args?.ns || 'zent';
  const actions = {
    'pod-logs': () => kubectl(`logs ${args.pod} -n ${ns} --tail=200 2>&1`, 20000),
    'pod-describe': () => kubectl(`describe pod ${args.pod} -n ${ns} 2>&1`, 20000),
    'pod-delete': () => kubectl(`delete pod ${args.pod} -n ${ns} 2>&1`, 30000),
    'rollout-status': () => kubectl(`rollout status deploy/${args.deploy} -n ${ns} 2>&1`, 30000),
    'rollout-restart': () => kubectl(`rollout restart deploy/${args.deploy} -n ${ns} 2>&1`),
    'scale-deploy': () => kubectl(`scale deploy/${args.deploy} --replicas=${args.replicas} -n ${ns} 2>&1`),
    'apply-manifest': () => kubectl(`apply -f ${K8S_DIR}/zent/${args.file} 2>&1`),
    'apply-zent': () => kubectl(`apply -f ${K8S_DIR}/zent/ 2>&1`, 30000),
    'apply-monitoring': () => kubectl(`apply -f ${K8S_DIR}/monitoring/ 2>&1`, 30000),
    'delete-failed': () => kubectl('delete pods --all-namespaces --field-selector status.phase=Failed 2>&1'),
    'drain-node': () => kubectl(`drain ${args.node} --ignore-daemonsets --delete-emptydir-data 2>&1`, 60000),
    'uncordon-node': () => kubectl(`uncordon ${args.node} 2>&1`),
    'top-nodes': () => kubectl('top nodes 2>&1'),
    'top-pods': () => kubectl('top pods -A --sort-by=cpu 2>&1'),
    'set-image': () => kubectl(`set image deploy/${args.deploy} ${args.deploy}=ghcr.io/akadon/${args.deploy}:${args.tag} -n ${ns} 2>&1`),
  };
  if (!actions[action]) return res.status(400).json({ error: 'Unknown action' });
  try {
    res.json({ output: actions[action]() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Terminal WebSocket ---
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  if (token !== AUTH_TOKEN) { ws.close(1008, 'Unauthorized'); return; }

  const target = url.searchParams.get('target') || 'a1flex';
  const mode = url.searchParams.get('mode') || 'shell'; // shell or kubectl

  ws.on('message', (msg) => {
    const cmd = msg.toString().trim();
    if (!cmd) return;

    let fullCmd;
    if (mode === 'kubectl') {
      fullCmd = `${KUBECTL} ${cmd}`;
    } else if (target === 'local') {
      fullCmd = cmd;
    } else {
      fullCmd = sshCmd(target, cmd);
    }

    const proc = spawn('bash', ['-c', fullCmd], { timeout: 30000 });
    let output = '';
    proc.stdout.on('data', d => { output += d; ws.send(JSON.stringify({ type: 'stdout', data: d.toString() })); });
    proc.stderr.on('data', d => { output += d; ws.send(JSON.stringify({ type: 'stderr', data: d.toString() })); });
    proc.on('close', code => ws.send(JSON.stringify({ type: 'exit', code })));
    proc.on('error', e => ws.send(JSON.stringify({ type: 'error', data: e.message })));
  });
});

// --- Log streaming WebSocket ---
app.get('/api/logs/stream', auth, (req, res) => {
  const source = req.query.source || 'api';
  const logCmds = {
    api: `docker logs --tail 200 -f zent-server-api-1 2>&1`,
    auth: `docker logs --tail 200 -f zent-server-auth-1 2>&1`,
    'gateway-1': `docker logs --tail 200 -f zent-server-gateway-1-1 2>&1`,
    'gateway-2': `docker logs --tail 200 -f zent-server-gateway-2-1 2>&1`,
    'gateway-3': `docker logs --tail 200 -f zent-server-gateway-3-1 2>&1`,
    'gateway-4': `docker logs --tail 200 -f zent-server-gateway-4-1 2>&1`,
    redis: `docker logs --tail 200 -f ${REDIS_CONTAINER} 2>&1`,
    system: `journalctl -n 200 -f 2>&1`,
    'nginx-access': `tail -n 200 -f /var/log/nginx/access.log 2>&1`,
    'nginx-error': `tail -n 200 -f /var/log/nginx/error.log 2>&1`,
  };
  const cmd = logCmds[source];
  if (!cmd) return res.status(400).json({ error: 'Unknown source' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const proc = spawn('bash', ['-c', sshCmd('a1flex', cmd)]);
  proc.stdout.on('data', d => res.write(`data: ${d.toString().replace(/\n/g, '\ndata: ')}\n\n`));
  proc.stderr.on('data', d => res.write(`data: ${d.toString().replace(/\n/g, '\ndata: ')}\n\n`));
  req.on('close', () => proc.kill());
});

server.listen(PORT, '0.0.0.0', () => console.log(`Dashboard running on port ${PORT}`));
