# Inventory Management Concurrency Control Simulator

A REST API demonstrating pessimistic and optimistic locking strategies for managing concurrent inventory updates.

## Architecture

- **Backend**: Node.js with Express
- **Database**: PostgreSQL 15
- **Containerization**: Docker & Docker Compose

## Features

### Locking Strategies

1.  **Pessimistic Locking (`/api/orders/pessimistic`)**:
    - Uses `SELECT ... FOR UPDATE` to acquire a row-level lock.
    - Prevents other transactions from reading or writing until completion.
    - Ideal for high-contention environments.

2.  **Optimistic Locking (`/api/orders/optimistic`)**:
    - Uses version numbers to detect concurrent modifications.
    - Implements **3 retry attempts** with **exponential backoff**.
    - Returns `409 Conflict` if retries are exhausted.
    - Better for low-contention environments but more complex logic.

## Setup and Installation

1.  **Prerequisites**: Docker Desktop installed and running.
2.  **Clone the repository**.
3.  **Environment Setup**:
    ```bash
    cp .env.example .env
    ```
4.  **Start Services**:
    ```bash
    docker compose up --build -d
    ```
4.  **Health Check**:
    ```bash
    curl http://localhost:8081/health
    ```

## API Endpoints

- `GET /api/products/:id`: Get product stock and version.
- `POST /api/products/reset`: Reset inventory to initial state (100 Super Widget, 50 Mega Gadget).
- `POST /api/orders/pessimistic`: Place an order using pessimistic locking.
- `POST /api/orders/optimistic`: Place an order using optimistic locking.
- `GET /api/orders/stats`: View success/failure counts.

## Verification

### Automated Concurrency Test
Run simulations for both strategies:
```bash
# On Windows (using PowerShell)
.\concurrent-test.ps1 pessimistic
.\concurrent-test.ps1 optimistic

# On Windows (using Git Bash) or Linux
./concurrent-test.sh pessimistic
./concurrent-test.sh optimistic
```

### Monitoring Locks
Monitor active PostgreSQL locks:
```bash
# On Windows (using PowerShell/Git Bash)
./monitor-locks.sh
```

## Results
- **Pessimistic Locking**: Guaranteed consistency by blocking concurrent access to the same product row. Wait times increase under high load.
- **Optimistic Locking**: Higher throughput initially, but frequent `409 Conflict` errors occur when multiple clients attempt to update the same record simultaneously, requiring application-level retries.
