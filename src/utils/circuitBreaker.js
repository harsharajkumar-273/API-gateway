/**
 * Custom High-Performance SRE Circuit Breaker
 */
class CircuitBreaker {
  constructor(serviceName, options = {}) {
    this.serviceName = serviceName;
    this.failureThreshold = options.failureThreshold || 3; // Number of failures to trip
    this.cooldownPeriod = options.cooldownPeriod || 10000; // Cooldown timer (10s) before half-open attempt
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF-OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
  }

  /**
   * Evaluates state and checks if request is allowed to pass
   */
  allowRequest() {
    const now = Date.now();

    if (this.state === 'OPEN') {
      // Check if cooldown period has elapsed
      if (now - this.lastFailureTime > this.cooldownPeriod) {
        this.state = 'HALF-OPEN';
        console.log(`[Circuit Breaker] ${this.serviceName} entered HALF-OPEN state. Testing traffic...`);
        return true;
      }
      return false; // Fast fail-fast rejection
    }

    return true; // CLOSED or HALF-OPEN allows requests
  }

  /**
   * Logs a successful operation, resetting counts
   */
  recordSuccess() {
    this.failureCount = 0;
    this.successCount += 1;

    if (this.state === 'HALF-OPEN') {
      // Re-close the circuit breaker
      this.state = 'CLOSED';
      this.successCount = 0;
      console.log(`[Circuit Breaker] ${this.serviceName} stabilized. Circuit returned to CLOSED.`);
    }
  }

  /**
   * Logs a failed operation, potentially tripping the circuit
   */
  recordFailure() {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();
    console.warn(`[Circuit Breaker] ${this.serviceName} failure recorded (${this.failureCount}/${this.failureThreshold})`);

    if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.error(`[Circuit Breaker] ${this.serviceName} TRIPPED to OPEN state! Fast-failing downstream requests.`);
    } else if (this.state === 'HALF-OPEN') {
      // Immediate reversion to open if half-open fails
      this.state = 'OPEN';
      console.error(`[Circuit Breaker] ${this.serviceName} verification failed. Reverted to OPEN.`);
    }
  }
}

module.exports = CircuitBreaker;
