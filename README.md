# High-Performance Limit-Order-Book

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://high-performance-limit-order-book.vercel.app/)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsrinathdoggala-tech%2FHigh-Performance-Limit-Order-Book)

> **Live Interactive Web Visualizer**: [https://high-performance-limit-order-book.vercel.app/](https://high-performance-limit-order-book.vercel.app/)

This Limit Order Book (LOB) is a high-performance, configurable matching engine implementation in modern C++20 accompanied by a real-time web visualizer and benchmarking dashboard deployed live on Vercel.

It is capable of executing over **2,250,000 orders per second** and performing over **750,000 mixed operations (adds, cancels, modifies) per second**. The LOB's primary goal is to provide a robust core data structure that is concurrency-safe for electronic trading systems, HFT, and quantitative research with a focus on **efficiency, accuracy, and maintainability**.

![Order Book Hero Preview](assets/preview.jpg)

## 🌐 Live Web Visualizer & Dashboard
Experience the real-time matching engine directly in your browser:
👉 **[Open Live Dashboard](https://high-performance-limit-order-book.vercel.app/)**

- **Interactive L2 Order Book**: Live Bid & Ask depth ladder with dynamic depth percentage bars and spread indicators.
- **Liquidity Depth Chart**: Anti-aliased canvas-rendered cumulative Bid vs. Ask depth curve with live mid-market tracking.
- **Markov-Pareto Stream Simulation**: In-browser real-time order generator simulating institutional flow, fat-tailed sizes (Pareto), and Poisson price arrival.
- **Execution Tape**: Real-time Time & Sales stream displaying fills, taker sides, and nanosecond latency gauges.
- **In-Browser Benchmark Suite**: Batch stress tests (10k, 50k, 200k ops) measuring client-side matching throughput.

### Deploying to Vercel
1. Import this repository into [Vercel](https://vercel.com).
2. Framework Preset: **Other** (Root Directory: `./`).
3. Deploy! Zero build step is required—the static web app is automatically served via Vercel's global Edge network.

---

## Quick Start (C++ Engine)
Requires C++20
```sh
mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
make
cd ..
./build/Limit_Order_Book
```

## Background
### Matching Engine
A matching engine is the core component of electronic trading platforms—used by exchanges, brokers, and market simulations to facilitate the buying and selling of assets (such as stocks, crypto, or commodities). Its main purpose is to match buyers' and sellers' interests to execute trades in a fair and efficient fashion. The engine maintains an electronic order book holding buy (“bid”) and sell (“ask”) orders, organized by price and arrival time. Having a robust, high-performance matching engine enables realistic simulation, research, and strategy testing in finance. It’s the backbone for understanding market microstructure and building low-latency trading systems.

## Order Book Architecture
```
class Order
    std::uint64_t idNumber;
    Side side;
    std::uint32_t price;
    std::uint32_t initialQuantity;
    std::uint32_t remainingQuantity;
    Status status;

struct PriceLevel
    std::uint16_t price;
    std::list<OrderPointer>orders;
    std::unordered_map<std::uint64_t, std::list<OrderPointer>::iterator> orderIters;

class OrderBook
    std::unordered_map<std::uint32_t, PriceLevelPointer> bids;
    std::unordered_map<std::uint32_t, PriceLevelPointer> asks;
    std::unordered_map<std::uint64_t, OrderPointer> orders;

    PriceLevelPointer highestBidLevel;
    PriceLevelPointer lowestAskLevel;
```

The system maintains two maps: ```bids``` and ```asks```. This allows the efficient ordering of price levels to find highest bids and lowest asks. The price levels are ordered by its price property that is represented in cents as a 32 bit int. When a new order is added, it is inserted into the correct price level within either the bids or asks map, depending on whether it is a buy or sell order. Orders within each price level are stored in a doubly-linked list. This preserves their arrival sequence to ensure **time priority** at each price. It also allows O(1) order removal. Each order can be quickly retrieved by its unique ```idNumber``` through the ```orders``` unordered map, which allows for O(1) lookup during modifications or cancellations.

### Matching Logic
Buy Orders: When a new buy order arrives, the engine checks if there are any sell orders (asks) at a price less than or equal to the buy price.

Sell Orders: Similarly, a new sell order is matched against the highest available bid at a price greater than or equal to the sell price.

Matching begins at the lowest ask and highest bid and proceeds in **price-time priority**, filling as much quantity as possible. Orders that are fully filled are removed from the order book. If only a portion is filled, their remaining quantity is reduced and status set to ```PARTIALLY_FILLED```.

### Modification and Cancellation
Modify: Modifying an order is performed by canceling the existing order and then inserting a new order with the desired properties. This ensures time-priority fairness: modifications are treated as new orders at the back of the price level queue.

Cancel: Canceling an order removes it from both its price level and global tracking. Immediate physical erasure using the iterator map on each price level object.

### Efficiency
N = number of orders in a price level\
M = number of price levels\
P = Number of price levels swept during matching (often <<M in practice)

| Function         | Average Case        | Worst Case          |
|------------------|---------------------|---------------------|
| Add Order        | O(1)                | O(log M)            |
| Modify Order     | O(1)                | O(log M)            |
| Cancel Order     | O(1)                | O(log M)            |
| Match Orders     | O(1) per match      | O(P × N)            |

### Concurrency Safety
The engine architecture is designed to be concurrency-safe. Multiple producer threads are able to submit commands at the same time without interfering with each other, since they are funneled into a bounded, thread-safe queue. A dedicated worker thread consumes commands from this queue and applies them deterministically to the order book, which ensures that the order of operations is preserved and the matching logic remains consistent. The queue provides back-pressure, so if it becomes full, producers will block until space is available, preventing unbounded growth in memory usage. To improve throughput, the engine batches commands and triggers the matcher only after a threshold number of operations have been collected or when the queue becomes empty. This batching amortizes the cost of matching and reduces contention. In addition, the engine allows a user-defined error handler so that exceptions raised during command processing can be captured and dealt with gracefully without interrupting the system. This design maintains both thread safety and fairness while preserving price-time priority under heavy concurrent load.

## Benchmarking and Testing
### Order Flow Simulation
In order to benchmark the LOB, it is neccessary to simulate the market order flow to ensure the benchmarking times are realistic. I utilized a Markov chain to model shifting market states (neutral, buy pressure, and sell pressure) so that the probability of generating buy or sell orders realistically adapts over time. For each simulated order, the generator samples the next market state, then decides the order side (buy or sell) accordingly. Order prices and sizes are sampled from Pareto distributions, producing the heavy-tailed, bursty behavior observed in real-world order books. This results in a realistic, dynamic stream of limit and market orders that stress-test the engine under authentic trading conditions.

### Latency Results
Processing 5,000,000 non-concurrent  order insertions resulted in an average total elapsed time of 2.22 seconds, yielding a throughput of 2,250,000 non-concurrent  orders per second. For a mixed workload of 5,000,000 non-concurrent  general operations, including adds, cancels, and modifies, the average elapsed time was 6.67 seconds, corresponding to a throughput of 750,000 non-concurrent  operations per second. These results highlight the engine’s ability to maintain ultra-low latency and high throughput under realistic, high-frequency trading conditions.

Note: Each run yields varied results so these observations are approximate averages.

## Project Tree
```bash
Limit-Order-Book/
├── Engine/                * Concurrency-safe engine
│   ├── BoundedQueue.cpp
│   ├── BoundedQueue.h
│   ├── Engine.cpp
│   ├── Engine.h
│   └── EngineCommand.h
├── Order_Book/            * Core order book implementation
│   ├── Order.cpp
│   ├── Order.h
│   ├── OrderBook.cpp
│   └── OrderBook.h
├── Order_Generator/       * Market simulation & order flow generation
│   ├── MarkovParetoOrderGenerator.cpp
│   └── MarkovParetoOrderGenerator.h
├── Testing/               * Unit tests and benchmarking tools
│   ├── OrderBookTests.cpp
│   └── OrderBookTests.h
├── assets/                * Visualizer assets & preview cards
│   └── preview.jpg
├── index.html             * Real-time web visualizer & LOB dashboard
├── styles.css             * Cyberpunk/fintech dark design system
├── app.js                 * In-browser matching engine & depth chart logic
├── vercel.json            * Vercel edge deployment configuration
├── package.json           * Project metadata & deployment config
├── CMakeLists.txt         * C++ build configuration
├── .gitignore
└── README.md
```





