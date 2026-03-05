import { createServer } from "http";
import { createGateway } from "./gateway/index.js";
import { startBackgroundJobs } from "./jobs/index.js";

const PORT = parseInt(process.env.GATEWAY_PORT || "4002");
let draining = false;

const server = createServer((req, res) => {
  if (req.url === "/health") {
    if (draining) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "draining", service: "gateway", pod: process.env.HOSTNAME }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "gateway", pod: process.env.HOSTNAME }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = createGateway(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Gateway service listening on port ${PORT}`);
});

// Background jobs run on gateway (leader election handles multi-replica)
startBackgroundJobs();

// Graceful shutdown (gateway's internal shutdown is triggered via SIGTERM in createGateway)
// Here we also mark draining so health checks fail for the load balancer
process.on("SIGTERM", () => { draining = true; });
process.on("SIGINT", () => { draining = true; });
