<div align="center">

# 🛡️ API Gateway Prototype & Circuit Breaker

**A reverse-proxy prototype with atomic Redis sliding-window rate limiters and a custom circuit breaker.**  
*Built to learn gateway reliability patterns — rate limiting, fault isolation, and fallback responses. Not a production system.*

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg?style=for-the-badge&logo=nodedotjs)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-black.svg?style=for-the-badge&logo=express)](https://expressjs.com)
[![Redis](https://img.shields.io/badge/Redis-ZSets-red.svg?style=for-the-badge&logo=redis)](https://redis.io)
[![Docker](https://img.shields.io/badge/Docker-Supported-blue.svg?style=for-the-badge&logo=docker)](https://www.docker.com/)
[![Prometheus](https://img.shields.io/badge/Prometheus-Metrics-orange.svg?style=for-the-badge&logo=prometheus)](https://prometheus.io)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

</div>

> **Accuracy note (Nov 2026):** This is a learning prototype, not a production system. It has not been load-tested, and earlier versions of this README presented aspirational throughput/latency figures as measured benchmarks — those numbers have been removed. Authentication in the code is a mock-token check; real JWT verification is a roadmap item (Issue #3).

---

> ### 📌 WHAT'S IMPLEMENTED
> * **Rate limiting**: sliding window backed by Redis Sorted Sets (atomic MULTI/EXEC pipeline)
> * **Circuit breaker**: CLOSED → OPEN → HALF-OPEN state machine with static fallback responses
> * **Auth**: mock-token check for development — real JWT verification is a roadmap item (Issue #3 below)
> * **Performance**: not load-tested; no throughput or latency figures are claimed

---

## 💡 The "Why" vs. "How" (Systems Rationale)

* **The Bottleneck (Why microservices crash during traffic bursts)**:  
  When a downstream database or authentication service slows down, incoming HTTP requests pile up, exhausting thread pools and socket descriptors. Naive rate limiters using fixed time windows allow double-capacity traffic spikes right at the window boundary, leading to cascading service failures across the entire cluster.
* **The Low-Level Fix (How we solved it)**:  
  This gateway protects upstream infrastructure using an **Atomic Sliding-Window Rate Limiter** backed by **Redis Sorted Sets (`zsets`)**. Every request executes inside a Redis MULTI/EXEC transaction (`ZREMRANGEBYSCORE`, `ZADD`, `ZCARD`), eliminating window boundary spikes. For fault isolation, a custom **SRE Circuit Breaker state machine (CLOSED → OPEN → HALF-OPEN)** intercepts downstream timeouts, immediately serving fast fallback responses without starving node event loops.

---

## 🛠️ How It Was Achieved (Engineering Deep-Dive)

Three key reliability and rate-limiting components were built:

### 1. Atomic Redis Sorted Set (`zset`) Sliding Window Limiter
- **Eliminating Boundary Spikes**: Traditional fixed-window limiters reset counters every 60s, allowing 2x limit bursts right at boundary transitions. Our sliding window algorithm stores timestamps as scores in a Redis `zset`.
- **Atomic MULTI/EXEC Pipeline**: Checks and mutations execute atomically in a single Redis roundtrip:
  1. `ZREMRANGEBYSCORE key 0 (now - window)`: Prunes requests older than the sliding window.
  2. `ZADD key now unique_id`: Records the current request timestamp.
  3. `ZCARD key`: Counts total active requests within the rolling window.
  4. `EXPIRE key window`: Sets TTL for key cleanup.

```javascript
// Atomic Redis Sorted Set Sliding Window Pipeline
const now = Date.now();
const windowStart = now - WINDOW_MS;

const pipeline = redis.pipeline();
pipeline.zremrangebyscore(rateKey, 0, windowStart);
pipeline.zadd(rateKey, now, requestId);
pipeline.zcard(rateKey);
pipeline.expire(rateKey, Math.ceil(WINDOW_MS / 1000));

const results = await pipeline.exec();
const requestCount = results[2][1];
if (requestCount > MAX_REQUESTS) {
  return res.status(429).json({ error: "Rate limit exceeded", retryAfter: 10 });
}
```

### 2. SRE Circuit Breaker Pattern (CLOSED → OPEN → HALF-OPEN)
- **Ring Buffer Error Tracking**: Maintains a sliding 100-request window tracking HTTP 5xx responses and timeouts.
- **Fast-Path Circuit Tripping**: When failure rates exceed 50%, the state transitions to `OPEN`. All incoming requests for that route bypass downstream calls entirely, returning static fallback responses.
- **Canary Recovery (`HALF-OPEN`)**: After a 10s cooldown, 5 canary probe requests test downstream health. If all pass, state returns to `CLOSED`.

### 3. Adaptive EWMA PID Load Controller
- **Exponentially Weighted Moving Average (EWMA)**: Computes smooth latency trends ($EWMA_t = \alpha \cdot L_t + (1-\alpha) \cdot EWMA_{t-1}$).
- **Proportional-Integral-Derivative Throttling**: Automatically lowers client rate limit thresholds during sudden load spikes before downstream thread pools saturate.

---

## 🏗️ Circuit Breaker State Machine & Gateway Flow

```mermaid
stateDiagram-v2
    [*] --> CLOSED: Normal Operation (Healthy)
    
    CLOSED --> OPEN: Error Rate > 50% OR Timeout Spike
    note right of OPEN
        Fast-Fallback Active
        Downstream Calls Blocked
        SLO Error Budget Preserved
    end note
    
    OPEN --> HALF_OPEN: Cooldown Timer Expires (10s)
    
    HALF_OPEN --> CLOSED: 5 Consecutive Success Probe Requests
    HALF_OPEN --> OPEN: Single Error / Timeout Probe
    
    note left of HALF_OPEN
        Canary Probing Active
        Limited Traffic Forwarded
    end note
```

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Proxy as API Gateway Proxy
    participant Redis as Redis Cache Cluster
    participant Service as Downstream Microservice

    Client->>Proxy: HTTP Request /v1/resource
    Proxy->>Redis: Atomic ZSet Sliding Window Query (MULTI/EXEC)
    alt Rate Limit Exceeded (> 100 req/sec)
        Redis-->>Proxy: ZCARD count > Limit
        Proxy-->>Client: HTTP 429 Too Many Requests (Retry-After header)
    else Rate Limit OK
        Proxy->>Proxy: Check Circuit Breaker State
        alt CB State == OPEN
            Proxy-->>Client: Fast Fallback Payload (HTTP 503 / Degraded Mode)
        else CB State == CLOSED / HALF-OPEN
            Proxy->>Service: Forward Request
            alt Service Responds 200 OK (< 500ms)
                Service-->>Proxy: Response Payload
                Proxy->>Proxy: Record Success Probe
                Proxy-->>Client: HTTP 200 OK
            else Service Timeout / 5xx Error
                Service-->>Proxy: Timeout / Connection Refused
                Proxy->>Proxy: Increment Failure Counter (Trip CB if > threshold)
                Proxy-->>Client: HTTP 504 Gateway Timeout
            end
        end
    end
```

---

## 📊 Benchmarks

No load-test results are published for this project. An earlier version of this README included an autocannon results table whose figures were not produced by a recorded test run; the table has been removed rather than presented as data.

---

## ⚡ Core Technical Features

1. **Atomic Sliding-Window Rate Limiter (Redis `zsets`)**:  
   Calculates precise rolling request windows per IP/API key. Uses atomic Redis transactions (`ZREMRANGEBYSCORE` + `ZADD` + `ZCARD` + `EXPIRE`) to guarantee thread-safe rate enforcement across distributed proxy instances.
2. **SRE Circuit Breaker Pattern**:  
   Monitors downstream microservice failure rates. Automatically trips to `OPEN` state when error thresholds exceed 50%, short-circuiting failing routes to prevent thread pool depletion.
3. **Adaptive EWMA PID Rate Throttling**:  
   Calculates exponentially weighted moving average (EWMA) latency metrics to dynamically adjust rate limits during sudden load spikes.
4. **Prometheus & Health Observability**:  
   Exposes `/metrics` endpoints formatted for Prometheus scraping, tracking active circuit breaker states, latency histograms, and error budgets.

---

## 🚀 Quick Start (< 1 Minute)

### Option A: Run in Docker Compose
```bash
# Clone repository
git clone https://github.com/harsharajkumar-273/API-gateway.git
cd API-gateway

# Spin up API Gateway reverse proxy & Redis cluster
docker-compose up --build
```

### Option B: Local Development
```bash
# Install dependencies
npm install

# Start local Redis server
redis-server --port 6379 &

# Launch gateway proxy server
npm run dev
```

### Testing Rate Limiting & Circuit Breaker
```bash
# Test 1: Fire 10 fast requests to check rate limit headers
for i in {1..10}; do curl -i http://localhost:3000/api/v1/health; done

# Test 2: Prometheus Telemetry Endpoint
curl http://localhost:3000/metrics
```

---

## 🗺️ Open-Source Roadmap & Good First Issues

We welcome community contributions! Check out our active roadmap:

- [ ] **[Issue #1] OpenTelemetry (OTel) Distributed Tracing**: Inject W3C trace context headers (`traceparent`) into proxy requests to track calls across downstream services.
- [ ] **[Issue #2] gRPC Proxy Support**: Add HTTP/2 and gRPC binary protocol routing support alongside standard HTTP/1.1 REST endpoints.
- [ ] **[Issue #3] JWT Edge Verification**: Validate signed RS256 JWT tokens directly at the gateway layer to eliminate auth checks on internal microservices.
- [ ] **[Issue #4] Dynamic Hot-Reloading Configuration**: Implement etcd / Redis pub-sub configuration listeners to update routing rules without restarting the proxy process.

---

## 📜 License
Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.
