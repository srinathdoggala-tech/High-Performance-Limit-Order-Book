/**
 * High-Performance Limit Order Book Visualizer & Engine Simulation
 * Modeled directly on the C++20 OrderBook, Engine, and MarkovParetoOrderGenerator.
 */

(() => {
  'use strict';

  // --- Utility Functions ---
  const formatPrice = (p) => Number(p).toFixed(2);
  const formatNumber = (n) => Number(n).toLocaleString('en-US');
  const formatTime = (date = new Date()) => {
    return date.toTimeString().split(' ')[0] + '.' + String(date.getMilliseconds()).padStart(3, '0');
  };

  // --- Data Structures ---
  class Order {
    constructor(id, side, price, qty) {
      this.id = id;
      this.side = side; // 'BUY' or 'SELL'
      this.price = Math.round(price * 100) / 100;
      this.initialQty = qty;
      this.remainingQty = qty;
      this.timestamp = performance.now();
    }

    fill(qty) {
      const filled = Math.min(this.remainingQty, qty);
      this.remainingQty -= filled;
      return filled;
    }

    isFilled() {
      return this.remainingQty <= 0;
    }
  }

  class PriceLevel {
    constructor(price) {
      this.price = price;
      this.orders = []; // FIFO order list (time priority)
    }

    addOrder(order) {
      this.orders.push(order);
    }

    removeOrder(orderId) {
      const idx = this.orders.findIndex(o => o.id === orderId);
      if (idx !== -1) {
        return this.orders.splice(idx, 1)[0];
      }
      return null;
    }

    getTotalQuantity() {
      let total = 0;
      for (let i = 0; i < this.orders.length; i++) {
        total += this.orders[i].remainingQty;
      }
      return total;
    }

    isEmpty() {
      return this.orders.length === 0;
    }
  }

  class LimitOrderBook {
    constructor() {
      this.bids = new Map(); // Price -> PriceLevel (Descending sorted keys)
      this.asks = new Map(); // Price -> PriceLevel (Ascending sorted keys)
      this.orders = new Map(); // id -> Order (O(1) lookup)
      this.trades = [];
      this.totalTradesCount = 0;
      this.totalTradeVolume = 0;
    }

    clear() {
      this.bids.clear();
      this.asks.clear();
      this.orders.clear();
      this.trades = [];
      this.totalTradesCount = 0;
      this.totalTradeVolume = 0;
    }

    getBestBid() {
      if (this.bids.size === 0) return null;
      let maxPrice = -Infinity;
      for (const price of this.bids.keys()) {
        if (price > maxPrice) maxPrice = price;
      }
      return maxPrice;
    }

    getBestAsk() {
      if (this.asks.size === 0) return null;
      let minPrice = Infinity;
      for (const price of this.asks.keys()) {
        if (price < minPrice) minPrice = price;
      }
      return minPrice;
    }

    addOrder(order) {
      const executedTrades = [];

      // Matching Phase (Price-Time Priority FIFO)
      if (order.side === 'BUY') {
        while (!order.isFilled() && this.asks.size > 0) {
          const bestAskPrice = this.getBestAsk();
          if (bestAskPrice === null || order.price < bestAskPrice) {
            break; // No crossing spread
          }

          const askLevel = this.asks.get(bestAskPrice);
          while (askLevel.orders.length > 0 && !order.isFilled()) {
            const makerOrder = askLevel.orders[0];
            const matchQty = Math.min(order.remainingQty, makerOrder.remainingQty);

            makerOrder.fill(matchQty);
            order.fill(matchQty);

            const trade = {
              id: ++this.totalTradesCount,
              price: bestAskPrice,
              qty: matchQty,
              side: 'BUY', // Taker is BUY
              time: formatTime(),
              makerId: makerOrder.id,
              takerId: order.id
            };
            this.totalTradeVolume += matchQty;
            executedTrades.push(trade);

            if (makerOrder.isFilled()) {
              askLevel.orders.shift();
              this.orders.delete(makerOrder.id);
            }
          }

          if (askLevel.isEmpty()) {
            this.asks.delete(bestAskPrice);
          }
        }
      } else { // SELL
        while (!order.isFilled() && this.bids.size > 0) {
          const bestBidPrice = this.getBestBid();
          if (bestBidPrice === null || order.price > bestBidPrice) {
            break; // No crossing spread
          }

          const bidLevel = this.bids.get(bestBidPrice);
          while (bidLevel.orders.length > 0 && !order.isFilled()) {
            const makerOrder = bidLevel.orders[0];
            const matchQty = Math.min(order.remainingQty, makerOrder.remainingQty);

            makerOrder.fill(matchQty);
            order.fill(matchQty);

            const trade = {
              id: ++this.totalTradesCount,
              price: bestBidPrice,
              qty: matchQty,
              side: 'SELL', // Taker is SELL
              time: formatTime(),
              makerId: makerOrder.id,
              takerId: order.id
            };
            this.totalTradeVolume += matchQty;
            executedTrades.push(trade);

            if (makerOrder.isFilled()) {
              bidLevel.orders.shift();
              this.orders.delete(makerOrder.id);
            }
          }

          if (bidLevel.isEmpty()) {
            this.bids.delete(bestBidPrice);
          }
        }
      }

      // If resting quantity remains, place order into the book
      if (!order.isFilled()) {
        const bookMap = order.side === 'BUY' ? this.bids : this.asks;
        if (!bookMap.has(order.price)) {
          bookMap.set(order.price, new PriceLevel(order.price));
        }
        bookMap.get(order.price).addOrder(order);
        this.orders.set(order.id, order);
      }

      return executedTrades;
    }

    cancelOrder(orderId) {
      const order = this.orders.get(orderId);
      if (!order) return false;

      const bookMap = order.side === 'BUY' ? this.bids : this.asks;
      const level = bookMap.get(order.price);
      if (level) {
        level.removeOrder(orderId);
        if (level.isEmpty()) {
          bookMap.delete(order.price);
        }
      }
      this.orders.delete(orderId);
      return true;
    }

    modifyOrder(orderId, newPrice, newQty) {
      if (!this.cancelOrder(orderId)) return null;
      const modifiedOrder = new Order(orderId, orderId % 2 === 0 ? 'BUY' : 'SELL', newPrice, newQty);
      this.addOrder(modifiedOrder);
      return modifiedOrder;
    }

    getSortedBids() {
      return Array.from(this.bids.keys())
        .sort((a, b) => b - a)
        .map(price => ({
          price,
          quantity: this.bids.get(price).getTotalQuantity(),
          orderCount: this.bids.get(price).orders.length
        }));
    }

    getSortedAsks() {
      return Array.from(this.asks.keys())
        .sort((a, b) => a - b)
        .map(price => ({
          price,
          quantity: this.asks.get(price).getTotalQuantity(),
          orderCount: this.asks.get(price).orders.length
        }));
    }
  }

  // --- Markov-Pareto Generator Simulation ---
  class MarkovParetoGenerator {
    constructor(orderBook) {
      this.book = orderBook;
      this.midPrice = 100.00;
      this.alpha = 1.25; // Pareto shape parameter
      this.minQty = 5;
      this.cancelProb = 0.25;
      this.nextOrderId = 1000;
      this.driftProb = 0.52;
    }

    generateParetoQty() {
      const u = Math.random();
      // Inverse transform sampling for Pareto distribution: x = x_m / (1 - u)^(1/alpha)
      const raw = this.minQty / Math.pow(1 - u, 1 / this.alpha);
      return Math.min(Math.floor(raw), 500); // capped at 500 for visualization
    }

    step() {
      // 1. Check if we should execute a cancellation to mimic high-frequency quote fading
      if (Math.random() < this.cancelProb && this.book.orders.size > 20) {
        const orderIds = Array.from(this.book.orders.keys());
        const targetId = orderIds[Math.floor(Math.random() * orderIds.length)];
        this.book.cancelOrder(targetId);
        return { type: 'CANCEL', id: targetId };
      }

      // 2. Markov process for reference mid-price drift
      const bestBid = this.book.getBestBid();
      const bestAsk = this.book.getBestAsk();
      if (bestBid !== null && bestAsk !== null) {
        this.midPrice = (bestBid + bestAsk) / 2;
      }

      const driftDelta = (Math.random() - 0.5) * 0.04;
      this.midPrice = Math.max(10.0, this.midPrice + driftDelta);

      // 3. Side selection with order imbalance tendency
      const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
      const qty = this.generateParetoQty();

      // 4. Price placement relative to mid-market
      // Concentrated heavily near the spread (Poisson-like dispersion)
      const spreadOffset = (Math.floor(Math.abs(this.boxMullerRandom() * 6)) + 1) * 0.01;
      let price;

      // Small chance (12%) of market order crossing the spread to generate continuous fills
      const isAggressive = Math.random() < 0.12;

      if (side === 'BUY') {
        price = isAggressive && bestAsk !== null ? bestAsk : Math.round((this.midPrice - spreadOffset) * 100) / 100;
      } else {
        price = isAggressive && bestBid !== null ? bestBid : Math.round((this.midPrice + spreadOffset) * 100) / 100;
      }

      const order = new Order(this.nextOrderId++, side, price, qty);
      const trades = this.book.addOrder(order);

      return { type: 'ADD', order, trades };
    }

    boxMullerRandom() {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }
  }

  // --- Engine Controller & UI Orchestrator ---
  class EngineDashboard {
    constructor() {
      this.book = new LimitOrderBook();
      this.generator = new MarkovParetoGenerator(this.book);

      this.isRunning = false;
      this.streamTimer = null;
      this.streamSpeed = 150; // orders/sec

      this.totalOrdersCount = 0;
      this.opsHistory = [];
      this.lastSecondTime = performance.now();
      this.opsThisSecond = 0;
      this.currentThroughput = 0;

      this.initDom();
      this.initEventListeners();
      this.seedInitialBook();
      this.startMetricsLoop();
      this.render();
    }

    initDom() {
      // Metrics elements
      this.elThroughput = document.getElementById('metricThroughput');
      this.elLatency = document.getElementById('metricLatency');
      this.elTotalOrders = document.getElementById('metricTotalOrders');
      this.elTotalTrades = document.getElementById('metricTotalTrades');
      this.elTradeVolume = document.getElementById('metricTradeVolume');
      this.elBestBid = document.getElementById('metricBestBid');
      this.elBestAsk = document.getElementById('metricBestAsk');
      this.elSpread = document.getElementById('metricSpread');
      this.elSpreadTicks = document.getElementById('metricSpreadTicks');

      // Ladder & Depth elements
      this.asksContainer = document.getElementById('asksContainer');
      this.bidsContainer = document.getElementById('bidsContainer');
      this.ladderSpreadAmount = document.getElementById('ladderSpreadAmount');
      this.ladderMidPrice = document.getElementById('ladderMidPrice');
      this.ladderSpreadTicks = document.getElementById('ladderSpreadTicks');
      this.depthMidPrice = document.getElementById('depthMidPrice');
      this.depthCanvas = document.getElementById('depthCanvas');
      this.depthCtx = this.depthCanvas.getContext('2d');

      // Tape & Active elements
      this.tradesStream = document.getElementById('tradesStream');
      this.activeOrdersList = document.getElementById('activeOrdersList');
      this.activeOrderCount = document.getElementById('activeOrderCount');

      // Queue monitor
      this.queueFillBar = document.getElementById('queueFillBar');
      this.queuePendingCount = document.getElementById('queuePendingCount');

      // Buttons & Controls
      this.startStreamBtn = document.getElementById('startStreamBtn');
      this.pauseStreamBtn = document.getElementById('pauseStreamBtn');
      this.streamStatusBadge = document.getElementById('streamStatusBadge');
      this.streamSpeedSlider = document.getElementById('streamSpeedSlider');
      this.streamSpeedVal = document.getElementById('streamSpeedVal');
      this.streamAlphaSlider = document.getElementById('streamAlphaSlider');
      this.streamAlphaVal = document.getElementById('streamAlphaVal');
      this.streamCancelSlider = document.getElementById('streamCancelSlider');
      this.streamCancelVal = document.getElementById('streamCancelVal');
      this.resetBookBtn = document.getElementById('resetBookBtn');

      // Benchmark elements
      this.benchmarkBanner = document.getElementById('benchmarkBanner');
      this.benchmarkText = document.getElementById('benchmarkText');
      this.closeBenchmarkBanner = document.getElementById('closeBenchmarkBanner');
      this.runBenchmarkHeaderBtn = document.getElementById('runBenchmarkHeaderBtn');

      // Architecture Modal
      this.archModal = document.getElementById('archModal');
      this.openArchModalBtn = document.getElementById('openArchModalBtn');
      this.closeArchModalBtn = document.getElementById('closeArchModalBtn');
      this.closeArchModalBtn2 = document.getElementById('closeArchModalBtn2');
    }

    initEventListeners() {
      // Stream Controls
      this.startStreamBtn.addEventListener('click', () => this.startStream());
      this.pauseStreamBtn.addEventListener('click', () => this.pauseStream());
      this.resetBookBtn.addEventListener('click', () => this.resetOrderBook());

      // Sliders & Presets
      this.streamSpeedSlider.addEventListener('input', (e) => {
        this.streamSpeed = Number(e.target.value);
        this.streamSpeedVal.textContent = `${this.streamSpeed} orders/sec`;
        if (this.isRunning) this.restartStreamInterval();
      });

      document.querySelectorAll('.speed-presets .pill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          document.querySelectorAll('.speed-presets .pill-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const speed = Number(btn.getAttribute('data-speed'));
          this.streamSpeed = speed;
          this.streamSpeedSlider.value = speed;
          this.streamSpeedVal.textContent = `${speed} orders/sec`;
          if (this.isRunning) this.restartStreamInterval();
        });
      });

      this.streamAlphaSlider.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        this.generator.alpha = val;
        this.streamAlphaVal.textContent = val.toFixed(2);
      });

      this.streamCancelSlider.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        this.generator.cancelProb = val / 100;
        this.streamCancelVal.textContent = `${val}%`;
      });

      // Tabs Navigation
      const tabBtns = [
        { btn: document.getElementById('tabStreamBtn'), pane: document.getElementById('tabStreamContent') },
        { btn: document.getElementById('tabManualBtn'), pane: document.getElementById('tabManualContent') },
        { btn: document.getElementById('tabBatchBtn'), pane: document.getElementById('tabBatchContent') }
      ];

      tabBtns.forEach(({ btn, pane }) => {
        btn.addEventListener('click', () => {
          tabBtns.forEach(t => {
            t.btn.classList.remove('active');
            t.btn.setAttribute('aria-selected', 'false');
            t.pane.classList.remove('active');
          });
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
          pane.classList.add('active');
        });
      });

      // Manual Order Entry
      const manualOrderForm = document.getElementById('manualOrderForm');
      const submitOrderBtn = document.getElementById('submitOrderBtn');
      const orderPriceInput = document.getElementById('orderPrice');
      const orderQtyInput = document.getElementById('orderQuantity');
      const priceInputGroup = document.getElementById('priceInputGroup');

      document.querySelectorAll('input[name="orderSide"]').forEach(radio => {
        radio.addEventListener('change', () => {
          const side = radio.value;
          submitOrderBtn.className = `btn btn-${side === 'BUY' ? 'buy' : 'sell'} btn-lg mt-3`;
          submitOrderBtn.textContent = `Submit ${side} Order`;
        });
      });

      document.querySelectorAll('input[name="orderType"]').forEach(radio => {
        radio.addEventListener('change', () => {
          if (radio.value === 'MARKET') {
            priceInputGroup.style.opacity = '0.4';
            priceInputGroup.style.pointerEvents = 'none';
          } else {
            priceInputGroup.style.opacity = '1';
            priceInputGroup.style.pointerEvents = 'auto';
          }
        });
      });

      document.getElementById('priceDecBtn').addEventListener('click', () => {
        orderPriceInput.value = (Math.max(1, parseFloat(orderPriceInput.value) - 0.50)).toFixed(2);
      });
      document.getElementById('priceIncBtn').addEventListener('click', () => {
        orderPriceInput.value = (parseFloat(orderPriceInput.value) + 0.50).toFixed(2);
      });
      document.getElementById('qtyDecBtn').addEventListener('click', () => {
        orderQtyInput.value = Math.max(1, parseInt(orderQtyInput.value, 10) - 10);
      });
      document.getElementById('qtyIncBtn').addEventListener('click', () => {
        orderQtyInput.value = parseInt(orderQtyInput.value, 10) + 10;
      });

      // Presets
      document.getElementById('presetAtBid').addEventListener('click', () => {
        const bid = this.book.getBestBid();
        if (bid) orderPriceInput.value = bid.toFixed(2);
      });
      document.getElementById('presetMid').addEventListener('click', () => {
        const bid = this.book.getBestBid();
        const ask = this.book.getBestAsk();
        if (bid && ask) orderPriceInput.value = ((bid + ask) / 2).toFixed(2);
      });
      document.getElementById('presetAtAsk').addEventListener('click', () => {
        const ask = this.book.getBestAsk();
        if (ask) orderPriceInput.value = ask.toFixed(2);
      });

      manualOrderForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const side = document.querySelector('input[name="orderSide"]:checked').value;
        const type = document.querySelector('input[name="orderType"]:checked').value;
        const qty = parseInt(orderQtyInput.value, 10) || 10;
        let price = parseFloat(orderPriceInput.value) || 100.00;

        if (type === 'MARKET') {
          price = side === 'BUY' ? (this.book.getBestAsk() || 100.00) : (this.book.getBestBid() || 100.00);
        }

        const id = this.generator.nextOrderId++;
        const order = new Order(id, side, price, qty);
        this.totalOrdersCount++;
        this.opsThisSecond++;

        const trades = this.book.addOrder(order);
        if (trades.length > 0) this.appendTrades(trades);

        this.render();
      });

      document.getElementById('cancelRandomBtn').addEventListener('click', () => {
        if (this.book.orders.size > 0) {
          const ids = Array.from(this.book.orders.keys());
          const target = ids[Math.floor(Math.random() * ids.length)];
          this.book.cancelOrder(target);
          this.opsThisSecond++;
          this.render();
        }
      });

      document.getElementById('modifyRandomBtn').addEventListener('click', () => {
        if (this.book.orders.size > 0) {
          const ids = Array.from(this.book.orders.keys());
          const target = ids[Math.floor(Math.random() * ids.length)];
          const delta = (Math.random() - 0.5) * 0.5;
          const newPrice = Math.max(1, (this.generator.midPrice + delta).toFixed(2));
          const newQty = Math.floor(Math.random() * 50) + 5;
          this.book.modifyOrder(target, parseFloat(newPrice), newQty);
          this.opsThisSecond++;
          this.render();
        }
      });

      // Benchmark Triggers
      document.querySelectorAll('.benchmark-trigger').forEach(btn => {
        btn.addEventListener('click', () => {
          const count = parseInt(btn.getAttribute('data-count'), 10);
          this.runBenchmark(count);
        });
      });

      this.runBenchmarkHeaderBtn.addEventListener('click', () => {
        this.runBenchmark(100000);
      });

      this.closeBenchmarkBanner.addEventListener('click', () => {
        this.benchmarkBanner.classList.add('hidden');
      });

      // Architecture Modal
      this.openArchModalBtn.addEventListener('click', () => this.archModal.classList.remove('hidden'));
      this.closeArchModalBtn.addEventListener('click', () => this.archModal.classList.add('hidden'));
      this.closeArchModalBtn2.addEventListener('click', () => this.archModal.classList.add('hidden'));
      this.archModal.addEventListener('click', (e) => {
        if (e.target === this.archModal) this.archModal.classList.add('hidden');
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !this.archModal.classList.contains('hidden')) {
          this.archModal.classList.add('hidden');
        }
      });

      // Resize observer for depth chart canvas
      window.addEventListener('resize', () => this.drawDepthChart());
    }

    seedInitialBook() {
      const basePrice = 100.00;
      // Seed 20 bid levels and 20 ask levels
      for (let i = 1; i <= 20; i++) {
        const bidPrice = Math.round((basePrice - i * 0.05) * 100) / 100;
        const askPrice = Math.round((basePrice + i * 0.05) * 100) / 100;
        const bidQty = Math.floor(Math.random() * 40) + 10;
        const askQty = Math.floor(Math.random() * 40) + 10;

        this.book.addOrder(new Order(this.generator.nextOrderId++, 'BUY', bidPrice, bidQty));
        this.book.addOrder(new Order(this.generator.nextOrderId++, 'SELL', askPrice, askQty));
        this.totalOrdersCount += 2;
      }
    }

    resetOrderBook() {
      this.pauseStream();
      this.book.clear();
      this.totalOrdersCount = 0;
      this.tradesStream.innerHTML = '<div class="empty-state">Order book reset. Seeded fresh liquidity.</div>';
      this.seedInitialBook();
      this.render();
    }

    startStream() {
      if (this.isRunning) return;
      this.isRunning = true;
      this.startStreamBtn.disabled = true;
      this.pauseStreamBtn.disabled = false;
      this.streamStatusBadge.textContent = 'STREAMING';
      this.streamStatusBadge.className = 'badge badge-status';

      this.restartStreamInterval();
    }

    pauseStream() {
      this.isRunning = false;
      this.startStreamBtn.disabled = false;
      this.pauseStreamBtn.disabled = true;
      this.streamStatusBadge.textContent = 'PAUSED';
      this.streamStatusBadge.className = 'badge';

      if (this.streamTimer) {
        clearInterval(this.streamTimer);
        this.streamTimer = null;
      }
    }

    restartStreamInterval() {
      if (this.streamTimer) clearInterval(this.streamTimer);

      // Distribute stream execution evenly
      const intervalMs = Math.max(16, Math.floor(1000 / Math.min(this.streamSpeed, 60)));
      const batchPerTick = Math.max(1, Math.round(this.streamSpeed / (1000 / intervalMs)));

      this.streamTimer = setInterval(() => {
        let hasTrades = false;
        const batchTrades = [];

        for (let i = 0; i < batchPerTick; i++) {
          const res = this.generator.step();
          this.totalOrdersCount++;
          this.opsThisSecond++;
          if (res.trades && res.trades.length > 0) {
            hasTrades = true;
            batchTrades.push(...res.trades);
          }
        }

        if (hasTrades) {
          this.appendTrades(batchTrades);
        }

        // Animate SPSC ring buffer fill simulate batch threshold
        const pending = (this.totalOrdersCount % 30000);
        this.queuePendingCount.textContent = formatNumber(pending);
        this.queueFillBar.style.width = `${Math.min(100, (pending / 30000) * 100)}%`;

        this.render();
      }, intervalMs);
    }

    startMetricsLoop() {
      setInterval(() => {
        const now = performance.now();
        const elapsed = (now - this.lastSecondTime) / 1000;
        this.currentThroughput = Math.round(this.opsThisSecond / elapsed);
        this.opsThisSecond = 0;
        this.lastSecondTime = now;

        this.elThroughput.textContent = formatNumber(this.currentThroughput);
        this.elTotalOrders.textContent = formatNumber(this.totalOrdersCount);
        this.elTotalTrades.textContent = formatNumber(this.book.totalTradesCount);
        this.elTradeVolume.textContent = `${formatNumber(this.book.totalTradeVolume)} qty`;

        // Synthesize realistic microsecond latency variance based on load
        const baseLatency = this.currentThroughput > 500 ? 58.4 : 41.2;
        const jitter = (Math.random() * 8).toFixed(1);
        this.elLatency.textContent = (baseLatency + parseFloat(jitter)).toFixed(1);
      }, 1000);
    }

    appendTrades(trades) {
      if (!trades || trades.length === 0) return;
      const fragment = document.createDocumentFragment();

      // Show top 30 trades in tape
      trades.slice(-15).forEach(trade => {
        const row = document.createElement('div');
        row.className = `trade-item trade-${trade.side.toLowerCase()}`;
        row.innerHTML = `
          <span class="trade-time">${trade.time}</span>
          <span class="trade-price">$${formatPrice(trade.price)}</span>
          <span class="trade-qty">${trade.qty}</span>
          <span class="trade-side">${trade.side}</span>
        `;
        fragment.appendChild(row);
      });

      // Keep recent items
      if (this.tradesStream.querySelector('.empty-state')) {
        this.tradesStream.innerHTML = '';
      }
      this.tradesStream.prepend(fragment);

      while (this.tradesStream.children.length > 40) {
        this.tradesStream.removeChild(this.tradesStream.lastChild);
      }
    }

    runBenchmark(count) {
      this.pauseStream();
      this.benchmarkBanner.classList.remove('hidden');
      this.benchmarkText.textContent = `Running batch benchmark of ${formatNumber(count)} operations...`;

      // Use requestAnimationFrame so UI renders the banner first
      requestAnimationFrame(() => {
        setTimeout(() => {
          const t0 = performance.now();
          let adds = 0;
          let cancels = 0;
          let modifies = 0;

          for (let i = 0; i < count; i++) {
            const r = Math.random();
            if (r < 0.65) {
              this.generator.step();
              adds++;
            } else if (r < 0.85 && this.book.orders.size > 10) {
              const ids = Array.from(this.book.orders.keys());
              this.book.cancelOrder(ids[i % ids.length]);
              cancels++;
            } else if (this.book.orders.size > 10) {
              const ids = Array.from(this.book.orders.keys());
              this.book.modifyOrder(ids[i % ids.length], this.generator.midPrice + 0.1, 20);
              modifies++;
            }
          }

          const t1 = performance.now();
          const elapsedSec = (t1 - t0) / 1000;
          const opsPerSec = Math.round(count / elapsedSec);

          this.totalOrdersCount += count;
          this.benchmarkText.innerHTML = `
            <strong>Benchmark Finished:</strong> Processed <strong>${formatNumber(count)}</strong> ops in <strong>${elapsedSec.toFixed(3)}s</strong> 
            (Throughput: <strong class="glow-cyan">${formatNumber(opsPerSec)} ops/sec</strong>) • Adds: ${formatNumber(adds)}, Cancels: ${formatNumber(cancels)}, Modifies: ${formatNumber(modifies)}
          `;

          this.render();
        }, 30);
      });
    }

    render() {
      const bestBid = this.book.getBestBid();
      const bestAsk = this.book.getBestAsk();

      // Update HUD best bid / ask
      this.elBestBid.textContent = bestBid !== null ? `$${formatPrice(bestBid)}` : '-';
      this.elBestAsk.textContent = bestAsk !== null ? `$${formatPrice(bestAsk)}` : '-';

      let spread = 0;
      let spreadTicks = 0;
      let mid = 100.00;

      if (bestBid !== null && bestAsk !== null) {
        spread = Math.max(0, bestAsk - bestBid);
        spreadTicks = Math.round(spread * 100);
        mid = (bestBid + bestAsk) / 2;
        this.elSpread.textContent = `$${formatPrice(spread)}`;
        this.elSpreadTicks.textContent = `${spreadTicks} ticks`;
        this.ladderSpreadAmount.textContent = `$${formatPrice(spread)}`;
        this.ladderSpreadTicks.textContent = `${spreadTicks} ticks`;
        this.ladderMidPrice.textContent = `$${formatPrice(mid)}`;
        this.depthMidPrice.textContent = `Mid: $${formatPrice(mid)}`;
      } else {
        this.elSpread.textContent = '-';
        this.elSpreadTicks.textContent = '-';
      }

      // Render L2 Order Book Ladder
      this.renderLadder();
      // Render Market Depth Chart
      this.drawDepthChart();
      // Render Active User Orders
      this.renderActiveOrders();
    }

    renderLadder() {
      const sortedAsks = this.book.getSortedAsks().slice(0, 8); // Top 8 asks
      const sortedBids = this.book.getSortedBids().slice(0, 8); // Top 8 bids

      // Compute cumulative totals and max cumulative for depth bars
      let askCum = 0;
      const askRows = [];
      for (const a of sortedAsks) {
        askCum += a.quantity;
        askRows.push({ ...a, total: askCum });
      }

      let bidCum = 0;
      const bidRows = [];
      for (const b of sortedBids) {
        bidCum += b.quantity;
        bidRows.push({ ...b, total: bidCum });
      }

      const maxCum = Math.max(askCum, bidCum, 1);

      // Render Asks (Display highest price at top, lowest at bottom near spread)
      if (askRows.length === 0) {
        this.asksContainer.innerHTML = '<div class="empty-state">No active asks</div>';
      } else {
        const reversedAsks = [...askRows].reverse();
        this.asksContainer.innerHTML = reversedAsks.map(a => {
          const depthPct = Math.min(100, Math.round((a.total / maxCum) * 100));
          return `
            <div class="ladder-row" data-price="${a.price}">
              <div class="cell-depth-bar" style="width: ${depthPct}%;"></div>
              <span class="cell-price">${formatPrice(a.price)}</span>
              <span class="cell-size">${formatNumber(a.quantity)}</span>
              <span class="cell-total">${formatNumber(a.total)}</span>
              <span class="col-depth">${depthPct}%</span>
            </div>
          `;
        }).join('');
      }

      // Render Bids (Highest at top near spread, lowest downwards)
      if (bidRows.length === 0) {
        this.bidsContainer.innerHTML = '<div class="empty-state">No active bids</div>';
      } else {
        this.bidsContainer.innerHTML = bidRows.map(b => {
          const depthPct = Math.min(100, Math.round((b.total / maxCum) * 100));
          return `
            <div class="ladder-row" data-price="${b.price}">
              <div class="cell-depth-bar" style="width: ${depthPct}%;"></div>
              <span class="cell-price">${formatPrice(b.price)}</span>
              <span class="cell-size">${formatNumber(b.quantity)}</span>
              <span class="cell-total">${formatNumber(b.total)}</span>
              <span class="col-depth">${depthPct}%</span>
            </div>
          `;
        }).join('');
      }
    }

    drawDepthChart() {
      const canvas = this.depthCanvas;
      const ctx = this.depthCtx;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      // Handle HiDPI
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;

      ctx.clearRect(0, 0, width, height);

      const bids = this.book.getSortedBids().slice(0, 25);
      const asks = this.book.getSortedAsks().slice(0, 25);

      if (bids.length === 0 && asks.length === 0) return;

      // Cumulative curves
      let cumBid = 0;
      const bidPoints = [];
      for (const b of bids) {
        cumBid += b.quantity;
        bidPoints.push({ price: b.price, cum: cumBid });
      }

      let cumAsk = 0;
      const askPoints = [];
      for (const a of asks) {
        cumAsk += a.quantity;
        askPoints.push({ price: a.price, cum: cumAsk });
      }

      const maxCum = Math.max(cumBid, cumAsk, 100);
      const halfWidth = width / 2;

      // 1. Draw Mid-Market dashed line
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.moveTo(halfWidth, 0);
      ctx.lineTo(halfWidth, height);
      ctx.stroke();
      ctx.setLineDash([]);

      // 2. Draw Bid Depth Area (Green, left side meeting at center)
      if (bidPoints.length > 0) {
        ctx.beginPath();
        ctx.moveTo(halfWidth, height); // start at bottom mid

        for (let i = 0; i < bidPoints.length; i++) {
          const x = halfWidth - (i / bidPoints.length) * halfWidth;
          const y = height - (bidPoints[i].cum / maxCum) * (height - 20);
          ctx.lineTo(x, y);
        }

        ctx.lineTo(0, height);
        ctx.closePath();

        const bidGrad = ctx.createLinearGradient(0, 0, halfWidth, 0);
        bidGrad.addColorStop(0, 'rgba(16, 185, 129, 0.05)');
        bidGrad.addColorStop(1, 'rgba(16, 185, 129, 0.35)');
        ctx.fillStyle = bidGrad;
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#10b981';
        ctx.beginPath();
        for (let i = 0; i < bidPoints.length; i++) {
          const x = halfWidth - (i / bidPoints.length) * halfWidth;
          const y = height - (bidPoints[i].cum / maxCum) * (height - 20);
          if (i === 0) ctx.moveTo(halfWidth, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // 3. Draw Ask Depth Area (Red, right side starting at center)
      if (askPoints.length > 0) {
        ctx.beginPath();
        ctx.moveTo(halfWidth, height);

        for (let i = 0; i < askPoints.length; i++) {
          const x = halfWidth + (i / askPoints.length) * halfWidth;
          const y = height - (askPoints[i].cum / maxCum) * (height - 20);
          ctx.lineTo(x, y);
        }

        ctx.lineTo(width, height);
        ctx.closePath();

        const askGrad = ctx.createLinearGradient(halfWidth, 0, width, 0);
        askGrad.addColorStop(0, 'rgba(244, 63, 94, 0.35)');
        askGrad.addColorStop(1, 'rgba(244, 63, 94, 0.05)');
        ctx.fillStyle = askGrad;
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#f43f5e';
        ctx.beginPath();
        for (let i = 0; i < askPoints.length; i++) {
          const x = halfWidth + (i / askPoints.length) * halfWidth;
          const y = height - (askPoints[i].cum / maxCum) * (height - 20);
          if (i === 0) ctx.moveTo(halfWidth, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    renderActiveOrders() {
      const orders = Array.from(this.book.orders.values()).slice(-15);
      this.activeOrderCount.textContent = this.book.orders.size;

      if (orders.length === 0) {
        this.activeOrdersList.innerHTML = '<div class="empty-hint">No active orders</div>';
        return;
      }

      this.activeOrdersList.innerHTML = orders.map(o => `
        <div class="active-order-pill" data-id="${o.id}" title="Click to cancel order #${o.id}">
          <div class="order-pill-left">
            <span class="order-pill-side side-badge-${o.side.toLowerCase()}">${o.side}</span>
            <span>#${o.id}</span>
          </div>
          <div class="order-pill-right">
            <span>$${formatPrice(o.price)}</span>
            <span class="text-muted">(${o.remainingQty})</span>
          </div>
        </div>
      `).join('');

      // Add cancel handler
      this.activeOrdersList.querySelectorAll('.active-order-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          const id = parseInt(pill.getAttribute('data-id'), 10);
          this.book.cancelOrder(id);
          this.render();
        });
      });
    }
  }

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new EngineDashboard());
  } else {
    new EngineDashboard();
  }
})();
