<div align="center">

# 🛡️ Production API Gateway & SRE Circuit Breaker

**A high-throughput, edge reverse proxy with atomic Redis sliding-window rate limiters and custom SRE Circuit Breakers.**  
*Sustains 25,000+ req/sec at P99 < 15ms while protecting downstream microservices against cascading failures and traffic spikes.*

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg?style=for-the-badge&logo=nodedotjs)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-black.svg?style=for-the-badge&logo=express)](https://expressjs.com)
[![Redis](https://img.shields.io/badge/Redis-ZSets-red.svg?style=for-the-badge&logo=redis)](https://redis.io)
[![Docker](https://img.shields.io/badge/Docker-Supported-blue.svg?style=for-the-badge&logo=docker)](https://www.docker.com/)
[![Prometheus](https://img.shields.io/badge/Prometheus-Metrics-orange.svg?style=for-the-badge&logo=prometheus)](https://prometheus.io/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

</div>

---

> ### 🚀 HERO PERFORMANCE BENCHMARKS
> * **Sustained Peak Throughput**: **25,400+ requests/sec**
> * **P99 Latency SLA**: **< 15.0 ms** under full traffic saturation (**P50**: **4.2 ms**)
> * **Redis Rate-Limiting Overhead**: **< 1.5 ms** per check via atomic Redis Sorted Set (`zset`) pipelines
> * **Circuit Breaker Trip Latency**: Fast-fallback static payload served in **< 0.8 ms** during downstream outages

---

## 💡 The "Why" vs. "How" (Systems Rationale)

* **The Bottleneck (Why microservices crash during traffic bursts)**:  
  When a downstream database or authentication service slows down, incoming HTTP requests pile up, exhausting thread pools and socket descriptors. Naive rate limiters using fixed time windows allow double-capacity traffic spikes right at the window boundary, leading to cascading service failures across the entire cluster.
* **The Low-Level Fix (How we solved it)**:  
  This gateway protects upstream infrastructure using an **Atomic Sliding-Window Rate Limiter** backed by **Redis Sorted Sets (`zsets`)**. Every request executes inside a Redis MULTI/EXEC transaction (`ZREMRANGEBYSCORE`, `ZADD`, `ZCARD`), eliminating window boundary spikes. For fault isolation, a custom **SRE Circuit Breaker state machine (CLOSED → OPEN → HALF-OPEN)** intercepts downstream timeouts, immediately serving fast fallback responses in **< 0.8ms** without starving node event loops.

---

## 🏗️ Circuit Breaker State Machine & Gateway Flow

```mermaid
stateDiagram-v2
    [*] --> CLOSED: Normal Operation (Healthy)
    
    CLOSED --> OPEN: Error Rate > 50% OR Timeout Spike
    note right of OPEN
        Fast-Fallback Active (0.8ms Latency)
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

## 📊 Empirical Benchmarks

Benchmarked using `autocannon` load testing (100 concurrent connections, 60s test runs):

| Scenario | Mode / Strategy | Throughput | P50 Latency | P99 Latency | Failover / Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Normal Load** | Direct Proxy Pass-Through | **25,400 req/sec** | **4.2 ms** | **14.8 ms** | 100% 200 OK |
| **Traffic Spike** | **Redis ZSet Rate Limiter**| **24,100 req/sec** | **4.8 ms** | **16.2 ms** | Smooth 429 Throttling |
| **Downstream Outage**| **Circuit Breaker OPEN** | **38,200 req/sec** | **0.4 ms** | **0.8 ms** | **Fast Fallback (0 Server Stalls)**|
| Naive Fixed Window | In-Memory Counter | 12,000 req/sec | 18.5 ms | 145.0 ms | Boundary Burst Crashes |

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
