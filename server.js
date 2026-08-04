require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { Groq } = require('groq-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY: Helmet (Security Headers) ─────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      frameSrc: ["'none'"],
    }
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  hidePoweredBy: true
}));

// ── SECURITY: CORS — Restricted to Known Origins ─────────────────────────────
const ALLOWED_ORIGINS = [
  'https://erp-chatbot-two.vercel.app',
  process.env.ALLOWED_ORIGIN,   // Optional extra origin via env
  'http://localhost:3000'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server requests (no Origin header)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: Origin '${origin}' is not allowed`));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-admin-token'],
  credentials: false
}));

// ── SECURITY: Body Size Limit ────────────────────────────────────────────────
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── SECURITY: Rate Limiters ──────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Chat rate limit exceeded. Please wait before sending more messages.' }
});

app.use('/api/', apiLimiter);

// ── SECURITY: Admin Token Middleware ─────────────────────────────────────────
const ADMIN_SECRET = process.env.ADMIN_SECRET;

function requireAdminToken(req, res, next) {
  if (!ADMIN_SECRET) {
    return res.status(503).json({ error: 'Admin access not configured on this server.' });
  }
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || token !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized. Valid admin token required.' });
  }
  next();
}

// ── SECURITY: Prompt Injection Detection ─────────────────────────────────────
const INJECTION_PATTERNS = [
  /ignore (all )?previous instructions/i,
  /you are now/i,
  /reveal (your|the) system prompt/i,
  /forget everything/i,
  /disregard (all )?previous/i,
  /act as (a )?different/i
];

function detectPromptInjection(text) {
  return INJECTION_PATTERNS.some(pattern => pattern.test(text));
}

// ERP API Configuration
const PURCHASE_API_URL = (process.env.PURCHASE_API_URL || 'https://thegreateasternexports.jbbs.in/API/purchase_api.php').trim();
const SALE_API_URL = (process.env.SALE_API_URL || 'https://thegreateasternexports.jbbs.in/API/sale_api.php').trim();
const STOCK_API_URL = (process.env.STOCK_API_URL || 'https://thegreateasternexports.jbbs.in/API/stock_api.php').trim();

// Offline / Fallback ERP Data Cache
const FALLBACK_DATA_PATH = path.join(__dirname, 'data', 'fallback_erp_data.json');
let fallbackPurchases = [];
let fallbackSales = [];
let fallbackStock = [];

try {
  if (fs.existsSync(FALLBACK_DATA_PATH)) {
    const raw = fs.readFileSync(FALLBACK_DATA_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    fallbackPurchases = parsed.purchases || [];
    fallbackSales = parsed.sales || [];
    fallbackStock = parsed.stock || [];
    console.log(`📦 Fallback ERP Dataset loaded! Purchases: ${fallbackPurchases.length} | Sales: ${fallbackSales.length} | Stock Items: ${fallbackStock.length}`);
  }
} catch (err) {
  console.warn('⚠️ Could not load fallback ERP dataset:', err.message);
}

// In-Memory Data Store (initialize with fallback dataset so Vercel/serverless has data immediately)
let purchases = fallbackPurchases;
let sales = fallbackSales;
let stock = fallbackStock;
let lastFetchedTime = fallbackPurchases.length > 0 ? new Date().toISOString() : null;
let isLoadingData = false;

// Initialize Groq Client
let groqClient = null;
if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim() !== '' && !process.env.GROQ_API_KEY.includes('your_groq_api_key')) {
  try {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY.trim() });
    console.log('✅ Groq LLM API Client initialized successfully!');
  } catch (err) {
    console.warn('⚠️ Could not initialize Groq SDK:', err.message);
  }
} else {
  console.log('ℹ️  No GROQ_API_KEY set in .env — Server will use Deterministic Smart ERP Search Fallback.');
}

// Fetch ERP Data from REST APIs
async function loadAPIData() {
  isLoadingData = true;
  console.log('🔄 Fetching real-time data from ERP REST APIs...');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
  };

  const fetchWithTimeout = async (url, timeoutMs = 8000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const data = await res.json();
      return data;
    } catch (err) {
      clearTimeout(timer);
      console.error(`❌ Fetch Error for ${url}:`, err.message);
      return null;
    }
  };

  try {
    const [pRes, sRes, stRes] = await Promise.all([
      fetchWithTimeout(PURCHASE_API_URL),
      fetchWithTimeout(SALE_API_URL),
      fetchWithTimeout(STOCK_API_URL)
    ]);

    const fetchedPurchases = pRes ? (pRes.Vouchers || pRes.data || []) : [];
    const fetchedSales = sRes ? (sRes.Vouchers || sRes.data || []) : [];
    const fetchedStock = stRes ? (stRes.Stock || stRes.Vouchers || stRes.data || []) : [];

    if (fetchedPurchases.length > 0) { purchases = fetchedPurchases; } else if (purchases.length === 0) { purchases = fallbackPurchases; }
    if (fetchedSales.length > 0) { sales = fetchedSales; } else if (sales.length === 0) { sales = fallbackSales; }
    if (fetchedStock.length > 0) { stock = fetchedStock; } else if (stock.length === 0) { stock = fallbackStock; }

    lastFetchedTime = new Date().toISOString();
    console.log(`✅ Digify ERP API Data Loaded! Purchases: ${purchases.length} | Sales: ${sales.length} | Stock: ${stock.length}`);
  } catch (err) {
    console.error('❌ Failed to fetch ERP APIs:', err.message);
    if (purchases.length === 0) purchases = fallbackPurchases;
    if (sales.length === 0) sales = fallbackSales;
    if (stock.length === 0) stock = fallbackStock;
  } finally {
    isLoadingData = false;
  }
}

// Ensure data is loaded (crucial for Vercel/serverless environments where app.listen is bypassed)
async function ensureDataLoaded() {
  if (purchases.length === 0 || sales.length === 0) {
    if (fallbackPurchases.length > 0 && purchases.length === 0) purchases = fallbackPurchases;
    if (fallbackSales.length > 0 && sales.length === 0) sales = fallbackSales;
    if (fallbackStock.length > 0 && stock.length === 0) stock = fallbackStock;

    if (!isLoadingData) {
      console.log('⚠️ ERP cache empty. Fetching live data on demand...');
      await loadAPIData();
    } else {
      while (isLoadingData) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
  }
}

// Auto Refresh ERP Data every 10 minutes
setInterval(loadAPIData, 10 * 60 * 1000);

// Calculate Exact Financial Totals (100% Deterministic Code Math)
function getErpSummaryStats() {
  // SALES: invoiceamount is the top-level total. items[].itemAmount is NOT additive (it duplicates)
  let saleTotalAmt = 0, saleItems = 0;
  sales.forEach(s => {
    saleTotalAmt += Number(s.invoiceamount || 0);
    saleItems += (s.items || []).length;
  });

  // PURCHASES: invoiceamount is 0 in the API; total is sum of items[].itemAmount
  let purchaseTotalAmt = 0, purchaseItems = 0;
  purchases.forEach(p => {
    purchaseTotalAmt += Number(p.invoiceamount || 0);
    (p.items || []).forEach(item => {
      purchaseItems++;
      purchaseTotalAmt += Math.abs(Number(item.itemAmount || 0));
    });
  });

  return {
    sales: {
      totalInvoices: sales.length,
      totalItems: saleItems,
      totalAmount: saleTotalAmt
    },
    purchases: {
      totalInvoices: purchases.length,
      totalItems: purchaseItems,
      totalAmount: purchaseTotalAmt
    }
  };
}

// Sales Breakdown (Year, Month, Date)
function getSalesBreakdown() {
  const byYear = {};
  const byMonth = {};
  const byDate = {};

  sales.forEach(s => {
    const rawDate = s.invoiceDate || s.supplierinvoicedate || '';
    if (!rawDate) return;
    const year = rawDate.substring(0, 4);
    const month = rawDate.substring(0, 7);
    const date = rawDate.substring(0, 10);
    const amt = Number(s.invoiceamount || 0);
    let itemsQty = 0;
    (s.items || []).forEach(i => { itemsQty += Number(i.itemQty || i.qty || 1); });

    if (!byYear[year]) byYear[year] = { year, totalRevenue: 0, invoiceCount: 0, totalItemsQty: 0 };
    byYear[year].totalRevenue += amt;
    byYear[year].invoiceCount += 1;
    byYear[year].totalItemsQty += itemsQty;

    if (!byMonth[month]) byMonth[month] = { month, totalRevenue: 0, invoiceCount: 0, totalItemsQty: 0 };
    byMonth[month].totalRevenue += amt;
    byMonth[month].invoiceCount += 1;
    byMonth[month].totalItemsQty += itemsQty;

    if (!byDate[date]) byDate[date] = { date, totalRevenue: 0, invoiceCount: 0, totalItemsQty: 0 };
    byDate[date].totalRevenue += amt;
    byDate[date].invoiceCount += 1;
    byDate[date].totalItemsQty += itemsQty;
  });

  return { byYear, byMonth, byDate };
}

// Purchases Breakdown (Year, Month, Date)
function getPurchasesBreakdown() {
  const byYear = {};
  const byMonth = {};
  const byDate = {};

  purchases.forEach(p => {
    const rawDate = p.invoiceDate || p.supplierinvoicedate || '';
    if (!rawDate) return;
    const year = rawDate.substring(0, 4);
    const month = rawDate.substring(0, 7);
    const date = rawDate.substring(0, 10);
    
    let pAmt = Number(p.invoiceamount || 0);
    let itemsQty = 0;
    (p.items || []).forEach(i => {
      pAmt += Math.abs(Number(i.itemAmount || 0));
      itemsQty += Number(i.itemQty || i.qty || 1);
    });

    if (!byYear[year]) byYear[year] = { year, totalExpense: 0, invoiceCount: 0, totalItemsQty: 0 };
    byYear[year].totalExpense += pAmt;
    byYear[year].invoiceCount += 1;
    byYear[year].totalItemsQty += itemsQty;

    if (!byMonth[month]) byMonth[month] = { month, totalExpense: 0, invoiceCount: 0, totalItemsQty: 0 };
    byMonth[month].totalExpense += pAmt;
    byMonth[month].invoiceCount += 1;
    byMonth[month].totalItemsQty += itemsQty;

    if (!byDate[date]) byDate[date] = { date, totalExpense: 0, invoiceCount: 0, totalItemsQty: 0 };
    byDate[date].totalExpense += pAmt;
    byDate[date].invoiceCount += 1;
    byDate[date].totalItemsQty += itemsQty;
  });

  return { byYear, byMonth, byDate };
}

// Dispatch Summary (Sales represent outward dispatch)
function getDispatchSummary() {
  const monthDispatch = {};
  const dateDispatch = {};
  let grandTotalDispatchQty = 0;
  let grandTotalDispatchVal = 0;

  sales.forEach(s => {
    const rawDate = s.invoiceDate || s.supplierinvoicedate || '';
    if (!rawDate) return;
    const month = rawDate.substring(0, 7);
    const date = rawDate.substring(0, 10);
    const invAmt = Number(s.invoiceamount || 0);

    let sQty = 0;
    (s.items || []).forEach(i => { sQty += Number(i.itemQty || i.qty || 1); });

    grandTotalDispatchQty += sQty;
    grandTotalDispatchVal += invAmt;

    if (!monthDispatch[month]) monthDispatch[month] = { month, dispatchQty: 0, dispatchVal: 0, invoiceCount: 0 };
    monthDispatch[month].dispatchQty += sQty;
    monthDispatch[month].dispatchVal += invAmt;
    monthDispatch[month].invoiceCount += 1;

    if (!dateDispatch[date]) dateDispatch[date] = { date, dispatchQty: 0, dispatchVal: 0, invoiceCount: 0 };
    dateDispatch[date].dispatchQty += sQty;
    dateDispatch[date].dispatchVal += invAmt;
    dateDispatch[date].invoiceCount += 1;
  });

  return { monthDispatch, dateDispatch, grandTotalDispatchQty, grandTotalDispatchVal };
}

// Inventory Summary & Product-Wise Details
function getInventorySummary(productQuery = '') {
  const itemMap = {};

  purchases.forEach(p => {
    (p.items || []).forEach(i => {
      const name = (i.itemName || 'Unknown Item').trim();
      if (!itemMap[name]) {
        itemMap[name] = {
          name,
          category: i.itemgroup || 'General',
          purchasedQty: 0,
          purchasedVal: 0,
          dispatchedQty: 0,
          unitCost: 0
        };
      }
      const qty = Number(i.itemQty || i.qty || 1);
      const val = Math.abs(Number(i.itemAmount || 0));
      itemMap[name].purchasedQty += qty;
      itemMap[name].purchasedVal += val;
    });
  });

  sales.forEach(s => {
    (s.items || []).forEach(i => {
      const name = (i.itemName || 'Unknown Item').trim();
      if (!itemMap[name]) {
        itemMap[name] = {
          name,
          category: i.itemgroup || 'General',
          purchasedQty: 0,
          purchasedVal: 0,
          dispatchedQty: 0,
          unitCost: 0
        };
      }
      const qty = Number(i.itemQty || i.qty || 1);
      itemMap[name].dispatchedQty += qty;
    });
  });

  let totalUniqueProducts = 0;
  let totalStockQty = 0;
  let totalInventoryVal = 0;
  let totalDispatchedQty = 0;

  const productList = Object.values(itemMap).map(item => {
    totalUniqueProducts += 1;
    totalDispatchedQty += item.dispatchedQty;

    if (item.purchasedQty > 0 && item.purchasedVal > 0) {
      item.unitCost = item.purchasedVal / item.purchasedQty;
    } else {
      item.unitCost = 0;
    }

    item.netStockQty = Math.max(0, item.purchasedQty - item.dispatchedQty);
    item.totalStockValue = item.purchasedVal > 0 ? item.purchasedVal : (item.dispatchedQty * item.unitCost);

    totalStockQty += (item.purchasedQty > 0 ? item.netStockQty : item.dispatchedQty);
    totalInventoryVal += item.totalStockValue;

    return item;
  });

  let filteredProducts = productList;
  if (productQuery && productQuery.trim() !== '') {
    const q = productQuery.toLowerCase().trim();
    filteredProducts = productList.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }

  return {
    totalUniqueProducts,
    totalStockQty,
    totalDispatchedQty,
    totalInventoryVal,
    products: filteredProducts.sort((a, b) => b.dispatchedQty - a.dispatchedQty)
  };
}

// Compute Top Analytics (Customers, Suppliers, Items) for Business Intelligence Queries
function getTopAnalytics() {
  const summary = getErpSummaryStats();

  const customerMap = {};
  sales.forEach(s => {
    const party = (s.partyName || s.shipping_add_lin1 || 'Unknown Customer').trim();
    if (!customerMap[party]) customerMap[party] = { name: party, totalAmount: 0, invoiceCount: 0 };
    customerMap[party].totalAmount += Number(s.invoiceamount || 0);
    customerMap[party].invoiceCount += 1;
  });

  const topCustomers = Object.values(customerMap)
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 5)
    .map(c => ({ name: c.name, totalAmount: c.totalAmount, invoiceCount: c.invoiceCount }));

  const supplierMap = {};
  purchases.forEach(p => {
    const party = (p.partyName || 'Unknown Vendor').trim();
    if (!supplierMap[party]) supplierMap[party] = { name: party, totalAmount: 0, invoiceCount: 0 };
    let pAmt = Number(p.invoiceamount || 0);
    (p.items || []).forEach(item => {
      pAmt += Math.abs(Number(item.itemAmount || 0));
    });
    supplierMap[party].totalAmount += pAmt;
    supplierMap[party].invoiceCount += 1;
  });

  const topSuppliers = Object.values(supplierMap)
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 5)
    .map(s => ({ name: s.name, totalAmount: s.totalAmount, invoiceCount: s.invoiceCount }));

  const saleItemMap = {};
  sales.forEach(s => {
    (s.items || []).forEach(item => {
      const name = (item.itemName || 'Unknown Item').trim();
      if (!saleItemMap[name]) saleItemMap[name] = { name, totalQty: 0 };
      saleItemMap[name].totalQty += Number(item.itemQty || item.qty || 1);
    });
  });

  const topSaleItems = Object.values(saleItemMap)
    .sort((a, b) => b.totalQty - a.totalQty)
    .slice(0, 5)
    .map(i => ({ name: i.name, totalQty: i.totalQty }));

  // Gross Profit Margin
  const grossProfit = summary.sales.totalAmount - summary.purchases.totalAmount;
  const grossMarginPct = summary.sales.totalAmount > 0
    ? ((grossProfit / summary.sales.totalAmount) * 100).toFixed(2)
    : '0.00';

  return { topCustomers, topSuppliers, topSaleItems, grossProfit, grossMarginPct };
}

// Low Stock Alert Engine — flags products with netStockQty below threshold
function getLowStockAlerts(threshold = 10) {
  const inv = getInventorySummary();
  const outOfStock = inv.products.filter(p => p.netStockQty === 0 && p.purchasedQty > 0);
  const lowStock = inv.products.filter(p => p.netStockQty > 0 && p.netStockQty <= threshold);
  const overstocked = inv.products.filter(p => p.netStockQty > 100).slice(0, 5);

  return {
    threshold,
    outOfStockCount: outOfStock.length,
    lowStockCount: lowStock.length,
    outOfStock: outOfStock.slice(0, 10),
    lowStock: lowStock.slice(0, 10),
    overstocked
  };
}

// Build monthly chart data from raw records
function getChartData() {
  const monthlyData = {};

  sales.forEach(s => {
    const rawDate = s.invoiceDate || s.invoiceDateStr || '';
    const d = new Date(rawDate);
    if (!isNaN(d)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyData[key]) monthlyData[key] = { sales: 0, purchases: 0 };
      monthlyData[key].sales += Number(s.invoiceamount || 0);
    }
  });

  purchases.forEach(p => {
    const rawDate = p.invoiceDate || p.supplierinvoicedate || '';
    const d = new Date(rawDate);
    if (!isNaN(d)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyData[key]) monthlyData[key] = { sales: 0, purchases: 0 };
      (p.items || []).forEach(item => {
        monthlyData[key].purchases += Math.abs(Number(item.itemAmount || 0));
      });
    }
  });

  const sortedKeys = Object.keys(monthlyData).sort();
  return {
    labels: sortedKeys.map(k => {
      const [y, m] = k.split('-');
      return new Date(y, m - 1).toLocaleString('en-IN', { month: 'short', year: '2-digit' });
    }),
    salesData: sortedKeys.map(k => Math.round(monthlyData[k].sales)),
    purchasesData: sortedKeys.map(k => Math.round(monthlyData[k].purchases))
  };
}

// Smart Search & Filter ERP Records
function searchRecords(query, maxResults = 10) {
  if (!query || query.trim() === '') return { pMatches: [], sMatches: [] };
  const q = query.toLowerCase().trim();

  let pMatches = [];
  let sMatches = [];

  const isGeneralSaleQuery = q.includes('sale') || q.includes('customer') || q.includes('sell');
  const isGeneralPurchaseQuery = q.includes('purchase') || q.includes('vendor') || q.includes('supplier') || q.includes('buy');

  // List of words that constitute generic queries
  const genericWords = ['sale', 'sales', 'customer', 'customers', 'sell', 'purchase', 'purchases', 'vendor', 'vendors', 'supplier', 'suppliers', 'buy', 'show', 'search', 'list', 'all', 'record', 'records', 'invoice', 'invoices', 'show me', 'list of'];
  
  // Check if query is entirely comprised of generic words and is short
  const words = q.split(/\s+/);
  const isAllGeneric = words.every(w => genericWords.includes(w) || w.length <= 2);

  if (isAllGeneric) {
    // Return empty matches so the prompt/fallback handles the user guidance
    return { pMatches: [], sMatches: [] };
  }

  // Text search in all fields
  // SECURITY: Cap search query at 100 chars to prevent expensive serialization DoS
  const safeQ = q.substring(0, 100);
  pMatches = purchases.filter(p => JSON.stringify(p).toLowerCase().includes(safeQ)).slice(0, maxResults);
  sMatches = sales.filter(s => JSON.stringify(s).toLowerCase().includes(safeQ)).slice(0, maxResults);

  return { pMatches, sMatches };
}

// Groq LLM Processing Engine with Grounding
async function askGroqLLM(userMessage, conversationHistory = []) {
  if (!groqClient) {
    return null;
  }

  const summary = getErpSummaryStats();
  const salesBreakdown = getSalesBreakdown();
  const purchasesBreakdown = getPurchasesBreakdown();
  const dispatchSummary = getDispatchSummary();
  const inventorySummary = getInventorySummary();
  const searchRes = searchRecords(userMessage, 10);
  const analytics = getTopAnalytics();

  const contextData = {
    erpSummary: {
      totalSaleInvoices: summary.sales.totalInvoices,
      totalSaleRevenue: `₹${summary.sales.totalAmount.toFixed(2)}`,
      totalPurchaseInvoices: summary.purchases.totalInvoices,
      totalPurchaseExpense: `₹${summary.purchases.totalAmount.toFixed(2)}`
    },
    topAnalytics: analytics,
    salesBreakdown: {
      byYear: salesBreakdown.byYear,
      byMonth: salesBreakdown.byMonth,
      topDates: Object.values(salesBreakdown.byDate).slice(0, 10)
    },
    purchasesBreakdown: {
      byYear: purchasesBreakdown.byYear,
      byMonth: purchasesBreakdown.byMonth,
      topDates: Object.values(purchasesBreakdown.byDate).slice(0, 10)
    },
    dispatchSummary: {
      grandTotalQty: dispatchSummary.grandTotalDispatchQty,
      grandTotalVal: `₹${dispatchSummary.grandTotalDispatchVal.toFixed(2)}`,
      byMonth: dispatchSummary.monthDispatch,
      topDates: Object.values(dispatchSummary.dateDispatch).slice(0, 10)
    },
    inventorySummary: {
      totalProducts: inventorySummary.totalUniqueProducts,
      totalStockUnits: inventorySummary.totalStockQty,
      totalDispatchedUnits: inventorySummary.totalDispatchedQty,
      totalValuation: `₹${inventorySummary.totalInventoryVal.toFixed(2)}`,
      topProducts: inventorySummary.products.slice(0, 10)
    },
    matchingPurchaseRecords: searchRes.pMatches.map(p => ({
      invoiceNo: p.invoiceNo || p.supplierinvoiceno || 'N/A',
      date: p.invoiceDate || p.supplierinvoicedate || 'N/A',
      partyName: p.partyName || 'N/A',
      partyGroup: p.partyGroup || 'N/A',
      amount: p.invoiceamount || 0,
      items: (p.items || []).map(i => ({ name: i.itemName, qty: i.itemQty || i.qty || 1, amount: i.itemAmount || 0 }))
    })),
    matchingSaleRecords: searchRes.sMatches.map(s => ({
      invoiceNo: s.invoiceNo || 'N/A',
      date: s.invoiceDate || 'N/A',
      customerName: s.partyName || s.shipping_add_lin1 || 'N/A',
      state: s.state || s.placeofsupply || 'N/A',
      amount: s.invoiceamount || 0,
      items: (s.items || []).map(i => ({ name: i.itemName, qty: i.itemQty || i.qty || 1, amount: i.itemAmount || 0 }))
    }))
  };

  const systemPrompt = `You are Digify Soft ERP AI Assistant — an expert enterprise chatbot for real-time ERP data.
You answer user queries accurately using ONLY the real-time ERP API records provided below.

STRICT ACCURACY RULES:
1. Use ONLY data from 'matchingSaleRecords', 'matchingPurchaseRecords', 'erpSummary', 'salesBreakdown', 'purchasesBreakdown', 'dispatchSummary', 'inventorySummary', and 'topAnalytics'. Do NOT hallucinate, invent, or assume any figures.
2. If asked for Month-wise, Date-wise, or Year-wise Sales or Purchases, reply using the exact figures from 'salesBreakdown' or 'purchasesBreakdown'.
3. If asked for Dispatch details (for the month or day), reply using exact figures from 'dispatchSummary'.
4. If asked for Inventory totals or Product-wise Inventory, reply using exact figures from 'inventorySummary'.
5. If asked about Top Customers, Top Suppliers, or Top Selling Items, answer using exact figures from 'topAnalytics'.
6. Financial summaries: use exact figures provided. Never mention GST, CGST, SGST, IGST or tax rates unless explicitly requested.
7. GREETING RULE: For greetings ('Hi', 'Hello', 'Hey'), respond warmly without showing raw data tables.
8. Format responses cleanly with Markdown headings, bullet points, table formats where appropriate, code backticks for invoice numbers, and emojis.
9. Be concise, professional, executive-ready, and friendly.

REAL-TIME ERP API CONTEXT:
${JSON.stringify(contextData, null, 2)}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-4),
    { role: 'user', content: userMessage }
  ];

  try {
    const completion = await groqClient.chat.completions.create({
      messages: messages,
      model: 'llama-3.3-70b-versatile',
      temperature: 0.2,
      max_tokens: 1024
    });

    return completion.choices[0]?.message?.content || null;
  } catch (err) {
    console.error('Groq API Error:', err.message);
    try {
      const completion = await groqClient.chat.completions.create({
        messages: messages,
        model: 'llama3-8b-8192',
        temperature: 0.2,
        max_tokens: 1024
      });
      return completion.choices[0]?.message?.content || null;
    } catch (fallbackErr) {
      console.error('Groq Fallback Model Error:', fallbackErr.message);
      return null;
    }
  }
}

const MONTH_MAP = {
  'january': '01', 'jan': '01',
  'february': '02', 'feb': '02',
  'march': '03', 'mar': '03',
  'april': '04', 'apr': '04',
  'may': '05',
  'june': '06', 'jun': '06',
  'july': '07', 'jul': '07',
  'august': '08', 'aug': '08',
  'september': '09', 'sep': '09',
  'october': '10', 'oct': '10',
  'november': '11', 'nov': '11',
  'december': '12', 'dec': '12'
};

function parseMonthFilter(filterStr) {
  const str = filterStr.toLowerCase().trim();
  let year = '2026';
  const yearMatch = str.match(/\b(20\d\d)\b/);
  if (yearMatch) year = yearMatch[1];

  let monthNum = null;
  for (const [mName, mCode] of Object.entries(MONTH_MAP)) {
    if (str.includes(mName)) {
      monthNum = mCode;
      break;
    }
  }

  const codeMatch = str.match(/\b(0[1-9]|1[0-2])\b/);
  if (!monthNum && codeMatch) monthNum = codeMatch[1];

  let isoPrefix = null;
  if (year && monthNum) isoPrefix = `${year}-${monthNum}`;
  else if (year) isoPrefix = `${year}`;

  return { year, monthNum, isoPrefix, raw: str };
}

// Local Smart Search Fallback
function generateDeterministicFallback(query) {
  const q = query.toLowerCase().trim();
  const summary = getErpSummaryStats();
  const analytics = getTopAnalytics();
  const salesBreakdown = getSalesBreakdown();
  const purchasesBreakdown = getPurchasesBreakdown();
  const dispatchSummary = getDispatchSummary();

  const CURRENT_YEAR = new Date().getFullYear();
  const LAST_10_YEARS = Array.from({ length: 10 }, (_, i) => CURRENT_YEAR - i);

  const MONTHS_LIST = [
    { label: 'January', code: '01', icon: '❄️' },
    { label: 'February', code: '02', icon: '💖' },
    { label: 'March', code: '03', icon: '🌱' },
    { label: 'April', code: '04', icon: '🌸' },
    { label: 'May', code: '05', icon: '🌿' },
    { label: 'June', code: '06', icon: '☀️' },
    { label: 'July', code: '07', icon: '🏖️' },
    { label: 'August', code: '08', icon: '🌊' },
    { label: 'September', code: '09', icon: '🍂' },
    { label: 'October', code: '10', icon: '🎃' },
    { label: 'November', code: '11', icon: '🍁' },
    { label: 'December', code: '12', icon: '🎄' }
  ];

  // 1. Executive Summary query -> Under Construction / Deleted per user request
  if (q.includes('summary') || q.includes('executive')) {
    return "🚧 **Building... Will take some time**";
  }

  // ==========================================
  // 🛒 SALES GUIDED WORKFLOW
  // ==========================================

  // Step 1: User asks for "Sales"
  if (q === 'sales' || q === 'sale' || q === 'show sales' || q === 'sales report') {
    let resp = `### 🛒 Sales Reports\n\n`;
    resp += `ℹ️ *Note: Connected to real-time ERP REST API (Available Data: Year 2026)*\n\n`;
    resp += `Please select how you would like to view your Sales:\n\n`;
    resp += `<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">\n`;
    resp += `  <button onclick="sendPrompt('Sales by Year')" style="background:#fffbeb;border:1px solid #fde68a;color:#b45309;padding:9px 16px;border-radius:100px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;box-shadow:0 2px 6px rgba(245,158,11,0.08);">📅 Sales by Year</button>\n`;
    resp += `  <button onclick="sendPrompt('Sales by Month')" style="background:#eef2ff;border:1px solid #c7d2fe;color:#4338ca;padding:9px 16px;border-radius:100px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;box-shadow:0 2px 6px rgba(99,102,241,0.08);">🗓️ Sales by Month</button>\n`;
    resp += `  <button onclick="sendPrompt('Sales by Date')" style="background:#ecfdf5;border:1px solid #a7f3d0;color:#047857;padding:9px 16px;border-radius:100px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;box-shadow:0 2px 6px rgba(16,185,129,0.08);">📆 Sales by Date</button>\n`;
    resp += `</div>`;
    return resp;
  }

  // Step 2A: Sales by Year -> Show Years with ERP Data
  if (q === 'sales by year' || q === 'sale by year' || q === 'year-wise sales') {
    const availableYears = Object.keys(salesBreakdown.byYear);
    const yearsToShow = availableYears.length > 0 ? availableYears : ['2026'];
    let resp = `### 📅 Sales by Year\n\nPlease select the **Year** to view sales revenue:\n\n`;
    resp += `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">\n`;
    yearsToShow.forEach(yr => {
      resp += `  <button onclick="sendPrompt('Sales for Year ${yr}')" style="background:rgba(245,158,11,0.18);border:1px solid rgba(245,158,11,0.4);color:#fcd34d;padding:8px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📅 ${yr} Sales</button>\n`;
    });
    resp += `</div>\n\n`;
    resp += `#### 📊 Available Sales Records:\n`;
    Object.values(salesBreakdown.byYear).forEach(y => {
      resp += `- **Year ${y.year}:** ₹${y.totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${y.invoiceCount} Invoices, ${y.totalItemsQty} items sold)\n`;
    });
    return resp;
  }

  // Step 2B-1: Sales by Month -> Show Available Years First
  if (q === 'sales by month' || q === 'sale by month' || q === 'month-wise sales') {
    const availableYears = Object.keys(salesBreakdown.byYear);
    const yearsToShow = availableYears.length > 0 ? availableYears : ['2026'];
    let resp = `### 🗓️ Sales by Month\n\nPlease select the **Year** first:\n\n`;
    resp += `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">\n`;
    yearsToShow.forEach(yr => {
      resp += `  <button onclick="sendPrompt('Sales Months for Year ${yr}')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:8px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📅 Year ${yr}</button>\n`;
    });
    resp += `</div>`;
    return resp;
  }

  // Step 2B-2: Sales Months for specific Year -> Show REAL Months with Revenue Data
  if (q.includes('sales months for year')) {
    const yr = q.replace('sales months for year', '').trim();
    let resp = `### 🗓️ Sales by Month (Year ${yr})\n\nPlease select the **Month** for ${yr}:\n\n`;
    
    const realMonths = Object.values(salesBreakdown.byMonth).filter(m => m.month.startsWith(yr));
    
    resp += `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">\n`;
    if (realMonths.length > 0) {
      realMonths.forEach(m => {
        const [yStr, mCode] = m.month.split('-');
        const monthInfo = MONTHS_LIST.find(x => x.code === mCode) || { label: m.month, icon: '🗓️' };
        resp += `  <button onclick="sendPrompt('Sales for ${monthInfo.label} ${yStr}')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:8px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">${monthInfo.icon} ${monthInfo.label} ${yStr} (₹${m.totalRevenue.toLocaleString('en-IN')})</button>\n`;
      });
    } else {
      MONTHS_LIST.filter(m => parseInt(m.code, 10) <= 7).forEach(m => {
        resp += `  <button onclick="sendPrompt('Sales for ${m.label} ${yr}')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:8px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">${m.icon} ${m.label} ${yr}</button>\n`;
      });
    }
    resp += `</div>`;
    return resp;
  }

  // Step 2C-1: Sales by Date -> Show Available Years First
  if (q === 'sales by date' || q === 'sale by date' || q === 'day-wise sales') {
    const availableYears = Object.keys(salesBreakdown.byYear);
    const yearsToShow = availableYears.length > 0 ? availableYears : ['2026'];
    let resp = `### 📆 Sales by Date\n\nPlease select the **Year** first:\n\n`;
    resp += `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">\n`;
    yearsToShow.forEach(yr => {
      resp += `  <button onclick="sendPrompt('Sales Dates for Year ${yr}')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:8px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📅 Year ${yr}</button>\n`;
    });
    resp += `</div>`;
    return resp;
  }

  // Step 2C-2: Sales Dates for Year -> Show Real Months
  if (q.includes('sales dates for year')) {
    const yr = q.replace('sales dates for year', '').trim();
    let resp = `### 📆 Sales by Date (Year ${yr})\n\nPlease select the **Month**:\n\n`;
    const realMonths = Object.values(salesBreakdown.byMonth).filter(m => m.month.startsWith(yr));
    resp += `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">\n`;
    if (realMonths.length > 0) {
      realMonths.forEach(m => {
        const [yStr, mCode] = m.month.split('-');
        const monthInfo = MONTHS_LIST.find(x => x.code === mCode) || { label: m.month, icon: '🗓️' };
        resp += `  <button onclick="sendPrompt('Sales Dates for ${m.month}')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:8px 14px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">${monthInfo.icon} ${monthInfo.label} ${yStr}</button>\n`;
      });
    } else {
      MONTHS_LIST.filter(m => parseInt(m.code, 10) <= 7).forEach(m => {
        resp += `  <button onclick="sendPrompt('Sales Dates for ${yr}-${m.code}')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:8px 14px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">${m.icon} ${m.label} ${yr}</button>\n`;
      });
    }
    resp += `</div>`;
    return resp;
  }

  // Step 2C-3: Sales Dates for Month -> Show REAL Dates with Invoices
  if (q.includes('sales dates for')) {
    const ym = q.replace('sales dates for', '').trim();
    const parsed = parseMonthFilter(ym);
    const targetMonth = parsed.isoPrefix || '2026-04';

    const realDates = Object.values(salesBreakdown.byDate)
      .filter(d => d.date.startsWith(targetMonth))
      .sort((a, b) => b.date.localeCompare(a.date));

    let resp = `### 📆 Sales by Date (${targetMonth})\n\nPlease select the **Date**:\n\n`;
    resp += `<div style="display:flex;gap:6px;margin-top:14px;flex-wrap:wrap;">\n`;
    if (realDates.length > 0) {
      realDates.forEach(d => {
        resp += `  <button onclick="sendPrompt('Sales for ${d.date}')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:11.5px;font-weight:600;font-family:inherit;">📆 ${d.date} (₹${d.totalRevenue.toLocaleString('en-IN')})</button>\n`;
      });
    } else {
      for (let d = 1; d <= 30; d++) {
        const dayFormatted = d < 10 ? `0${d}` : `${d}`;
        const dateVal = `${targetMonth}-${dayFormatted}`;
        resp += `  <button onclick="sendPrompt('Sales for ${dateVal}')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:11.5px;font-weight:600;font-family:inherit;">📆 ${d}</button>\n`;
      }
    }
    resp += `</div>`;
    return resp;
  }

  // Specific Sales Detail Filter -> Summary First
  if (q.includes('sales for')) {
    const filter = q.replace('sales for', '').trim();
    const parsed = parseMonthFilter(filter);

    const matching = sales.filter(s => {
      const d = s.invoiceDate || s.supplierinvoicedate || '';
      if (parsed.isoPrefix && d.startsWith(parsed.isoPrefix)) return true;
      return d.toLowerCase().includes(filter.toLowerCase()) || JSON.stringify(s).toLowerCase().includes(filter.toLowerCase());
    });

    if (matching.length > 0) {
      let totalAmt = 0;
      let totalItems = 0;
      matching.forEach(s => {
        totalAmt += Number(s.invoiceamount || 0);
        totalItems += (s.items || []).length;
      });
      let resp = `### 🛒 Sales Summary for "${filter.toUpperCase()}"\n\n`;
      resp += `- 💰 **Total Revenue:** ₹${totalAmt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}\n`;
      resp += `- 📜 **Total Invoices:** ${matching.length} Invoices\n`;
      resp += `- 📦 **Line Items Sold:** ${totalItems} Line Items\n\n`;
      const sampleInv = matching[0]?.invoiceNo || 'GEHOHR001VPO414';
      resp += `💡 *Tip: Type or search any specific Invoice Number (e.g. \`${sampleInv}\`) or Customer Name to inspect itemized voucher details.*`;
      return resp;
    } else {
      return `ℹ️ No sales records found for **"${filter.toUpperCase()}"** (₹0.00 Revenue, 0 Invoices).`;
    }
  }


  // ==========================================
  // 📦 PURCHASES GUIDED WORKFLOW
  // ==========================================

  // Step 1: User asks for "Purchases"
  if (q === 'purchases' || q === 'purchase' || q === 'show purchases' || q === 'purchase report') {
    let resp = `### 📦 Purchase Reports\n\n`;
    resp += `ℹ️ *Note: Connected to real-time ERP REST API (Available Data: Year 2026)*\n\n`;
    resp += `Please select how you would like to view your Purchases:\n\n`;
    resp += `<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">\n`;
    resp += `  <button onclick="sendPrompt('Purchase by Year')" style="background:#fffbeb;border:1px solid #fde68a;color:#b45309;padding:9px 16px;border-radius:100px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;box-shadow:0 2px 6px rgba(245,158,11,0.08);">📅 Purchase by Year</button>\n`;
    resp += `  <button onclick="sendPrompt('Purchase by Month')" style="background:#ecfdf5;border:1px solid #a7f3d0;color:#047857;padding:9px 16px;border-radius:100px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;box-shadow:0 2px 6px rgba(16,185,129,0.08);">🗓️ Purchase by Month</button>\n`;
    resp += `  <button onclick="sendPrompt('Purchase by Date')" style="background:#eef2ff;border:1px solid #c7d2fe;color:#4338ca;padding:9px 16px;border-radius:100px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;box-shadow:0 2px 6px rgba(99,102,241,0.08);">📆 Purchase by Date</button>\n`;
    resp += `</div>`;
    return resp;
  }

  // Step 2A: Purchase by Year -> Show Available Years
  if (q === 'purchase by year' || q === 'purchases by year' || q === 'year-wise purchases') {
    const availableYears = Object.keys(purchasesBreakdown.byYear);
    const yearsToShow = availableYears.length > 0 ? availableYears : ['2026'];
    let resp = `### 📅 Purchase by Year\n\nPlease select the **Year** to view purchase expenses:\n\n`;
    resp += `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">\n`;
    yearsToShow.forEach(yr => {
      resp += `  <button onclick="sendPrompt('Purchases for Year ${yr}')" style="background:rgba(245,158,11,0.18);border:1px solid rgba(245,158,11,0.4);color:#fcd34d;padding:8px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📅 ${yr} Purchases</button>\n`;
    });
    resp += `</div>\n\n`;
    resp += `#### 📊 Available Purchase Records:\n`;
    Object.values(purchasesBreakdown.byYear).forEach(y => {
      resp += `- **Year ${y.year}:** ₹${y.totalExpense.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${y.invoiceCount} Invoices, ${y.totalItemsQty} items purchased)\n`;
    });
    return resp;
  }

  // Step 2B-1: Purchase by Month -> Show Available Years First
  if (q === 'purchase by month' || q === 'purchases by month' || q === 'month-wise purchases') {
    const availableYears = Object.keys(purchasesBreakdown.byYear);
    const yearsToShow = availableYears.length > 0 ? availableYears : ['2026'];
    let resp = `### 🗓️ Purchase by Month\n\nPlease select the **Year** first:\n\n`;
    resp += `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">\n`;
    yearsToShow.forEach(yr => {
      resp += `  <button onclick="sendPrompt('Purchase Months for Year ${yr}')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:8px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📅 Year ${yr}</button>\n`;
    });
    resp += `</div>`;
    return resp;
  }

  // Step 2B-2: Purchase Months for specific Year -> Show REAL Months with Expense Data
  if (q.includes('purchase months for year')) {
    const yr = q.replace('purchase months for year', '').trim();
    let resp = `### 🗓️ Purchase by Month (Year ${yr})\n\nPlease select the **Month** for ${yr}:\n\n`;
    
    const realMonths = Object.values(purchasesBreakdown.byMonth).filter(m => m.month.startsWith(yr));
    
    resp += `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">\n`;
    if (realMonths.length > 0) {
      realMonths.forEach(m => {
        const [yStr, mCode] = m.month.split('-');
        const monthInfo = MONTHS_LIST.find(x => x.code === mCode) || { label: m.month, icon: '🗓️' };
        resp += `  <button onclick="sendPrompt('Purchases for ${monthInfo.label} ${yStr}')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:8px 14px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">${monthInfo.icon} ${monthInfo.label} ${yStr} (₹${m.totalExpense.toLocaleString('en-IN')})</button>\n`;
      });
    } else {
      MONTHS_LIST.filter(m => parseInt(m.code, 10) <= 7).forEach(m => {
        resp += `  <button onclick="sendPrompt('Purchases for ${m.label} ${yr}')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:8px 14px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">${m.icon} ${m.label} ${yr}</button>\n`;
      });
    }
    resp += `</div>`;
    return resp;
  }

  // Step 2C-1: Purchase by Date -> Show Available Years First
  if (q === 'purchase by date' || q === 'purchases by date' || q === 'day-wise purchases') {
    const availableYears = Object.keys(purchasesBreakdown.byYear);
    const yearsToShow = availableYears.length > 0 ? availableYears : ['2026'];
    let resp = `### 📆 Purchase by Date\n\nPlease select the **Year** first:\n\n`;
    resp += `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">\n`;
    yearsToShow.forEach(yr => {
      resp += `  <button onclick="sendPrompt('Purchase Dates for Year ${yr}')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:8px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📅 Year ${yr}</button>\n`;
    });
    resp += `</div>`;
    return resp;
  }

  // Step 2C-2: Purchase Dates for Year -> Show Real Months
  if (q.includes('purchase dates for year')) {
    const yr = q.replace('purchase dates for year', '').trim();
    let resp = `### 📆 Purchase by Date (Year ${yr})\n\nPlease select the **Month**:\n\n`;
    const realMonths = Object.values(purchasesBreakdown.byMonth).filter(m => m.month.startsWith(yr));
    resp += `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">\n`;
    if (realMonths.length > 0) {
      realMonths.forEach(m => {
        const [yStr, mCode] = m.month.split('-');
        const monthInfo = MONTHS_LIST.find(x => x.code === mCode) || { label: m.month, icon: '🗓️' };
        resp += `  <button onclick="sendPrompt('Purchase Dates for ${m.month}')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:8px 14px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">${monthInfo.icon} ${monthInfo.label} ${yStr}</button>\n`;
      });
    } else {
      MONTHS_LIST.filter(m => parseInt(m.code, 10) <= 7).forEach(m => {
        resp += `  <button onclick="sendPrompt('Purchase Dates for ${yr}-${m.code}')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:8px 14px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">${m.icon} ${m.label} ${yr}</button>\n`;
      });
    }
    resp += `</div>`;
    return resp;
  }

  // Step 2C-3: Purchase Dates for Month -> Show Real Dates
  if (q.includes('purchase dates for')) {
    const ym = q.replace('purchase dates for', '').trim();
    const parsed = parseMonthFilter(ym);
    const targetMonth = parsed.isoPrefix || '2026-04';

    const realDates = Object.values(purchasesBreakdown.byDate)
      .filter(d => d.date.startsWith(targetMonth))
      .sort((a, b) => b.date.localeCompare(a.date));

    let resp = `### 📆 Purchase by Date (${targetMonth})\n\nPlease select the **Date**:\n\n`;
    resp += `<div style="display:flex;gap:6px;margin-top:14px;flex-wrap:wrap;">\n`;
    if (realDates.length > 0) {
      realDates.forEach(d => {
        resp += `  <button onclick="sendPrompt('Purchases for ${d.date}')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:11.5px;font-weight:600;font-family:inherit;">📆 ${d.date} (₹${d.totalExpense.toLocaleString('en-IN')})</button>\n`;
      });
    } else {
      for (let d = 1; d <= 30; d++) {
        const dayFormatted = d < 10 ? `0${d}` : `${d}`;
        const dateVal = `${targetMonth}-${dayFormatted}`;
        resp += `  <button onclick="sendPrompt('Purchases for ${dateVal}')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:11.5px;font-weight:600;font-family:inherit;">📆 ${d}</button>\n`;
      }
    }
    resp += `</div>`;
    return resp;
  }

  // Specific Purchases Detail Filter -> Summary First
  if (q.includes('purchases for') || q.includes('purchase for')) {
    const filter = q.replace('purchases for', '').replace('purchase for', '').trim();
    const parsed = parseMonthFilter(filter);

    const matching = purchases.filter(p => {
      const d = p.invoiceDate || p.supplierinvoicedate || '';
      if (parsed.isoPrefix && d.startsWith(parsed.isoPrefix)) return true;
      return d.toLowerCase().includes(filter.toLowerCase()) || JSON.stringify(p).toLowerCase().includes(filter.toLowerCase());
    });

    if (matching.length > 0) {
      let totalAmt = 0;
      let totalItems = 0;
      matching.forEach(p => {
        let pAmt = Number(p.invoiceamount || 0);
        (p.items || []).forEach(i => {
          pAmt += Math.abs(Number(i.itemAmount || 0));
          totalItems += 1;
        });
        totalAmt += pAmt;
      });
      let resp = `### 📦 Purchases Summary for "${filter.toUpperCase()}"\n\n`;
      resp += `- 💰 **Total Expenses:** ₹${totalAmt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}\n`;
      resp += `- 📜 **Total Invoices:** ${matching.length} Invoices\n`;
      resp += `- 📦 **Line Items Purchased:** ${totalItems} Line Items\n\n`;
      const sampleInv = matching[0]?.supplierinvoiceno || matching[0]?.invoiceNo || 'GEHOHR001VPO414';
      resp += `💡 *Tip: Type or search any specific Supplier Invoice Number (e.g. \`${sampleInv}\`) or Vendor Name to inspect itemized voucher details.*`;
      return resp;
    } else {
      return `ℹ️ No purchase records found for **"${filter.toUpperCase()}"** (₹0.00 Expense, 0 Invoices).`;
    }
  }

  // 4. Dispatch Analytics (For Day / For Month)
  if (q.includes('dispatch') || q.includes('shipment') || q.includes('dispatched')) {
    let resp = `### 🚚 ERP Dispatch Summary & Outward Shipped Report\n\n`;
    resp += `- 📊 **Grand Total Dispatched Items:** ${dispatchSummary.grandTotalDispatchQty.toLocaleString('en-IN')} units\n`;
    resp += `- 💰 **Total Dispatch Revenue Value:** ₹${dispatchSummary.grandTotalDispatchVal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}\n\n`;

    if (q.includes('day') || q.includes('today') || q.includes('date')) {
      resp += `#### 📆 Date-Wise Dispatch Details:\n`;
      const sortedDates = Object.values(dispatchSummary.dateDispatch).sort((a, b) => b.date.localeCompare(a.date));
      sortedDates.slice(0, 7).forEach(d => {
        resp += `- **${d.date}:** ${d.dispatchQty} units dispatched | Value: ₹${d.dispatchVal.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${d.invoiceCount} Invoices)\n`;
      });
    } else {
      resp += `#### 🗓️ Month-Wise Dispatch Details:\n`;
      Object.values(dispatchSummary.monthDispatch).forEach(m => {
        const dateObj = new Date(`${m.month}-01`);
        const monthLabel = isNaN(dateObj) ? m.month : dateObj.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
        resp += `- **${monthLabel} (${m.month}):** ${m.dispatchQty.toLocaleString('en-IN')} units dispatched | Value: ₹${m.dispatchVal.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${m.invoiceCount} Sales Orders)\n`;
      });
    }

    return resp;
  }

  // 5. Product Inventory & Total Valuation — Now powered by real Stock API
  if (q.includes('inventory') || q.includes('stock')) {
    const stopWords = ['and', 'the', 'for', 'of', 'in', 'is', 'or', 'to', 'all', 'summary', 'report', 'detail', 'details', 'list', 'units', 'quantity', 'value', 'inventory', 'stock', 'total', 'show', 'item', 'items', 'product', 'products', 'me'];
    const cleanedQuery = q
      .replace(/inventory/g, '').replace(/stock/g, '').replace(/total/g, '')
      .replace(/value/g, '').replace(/quantity/g, '').replace(/show/g, '')
      .replace(/for/g, '').replace(/of/g, '').replace(/and/g, '').replace(/me/g, '').trim();

    const isProductSearch = cleanedQuery.length >= 2 && !stopWords.includes(cleanedQuery);

    if (isProductSearch) {
      const stockData = getStockSummary(cleanedQuery);
      if (stockData.filteredCount === 0) {
        return `❌ No stock records found matching: **"${cleanedQuery}"**.\n\n*Tip: Try searching for "Bath Rug", "Basket", "Yoga Mat", "Taupe", or a brand like "HAUS".*`;
      }
      let resp = `### 🏭 Stock Lookup: "${cleanedQuery}"\n\nFound **${stockData.filteredCount} matching product(s)**:\n\n`;
      resp += `| # | Product | Code | Color | Brand | Qty | Broken | Missing |\n|---|---|---|---|---|---|---|---|\n`;
      stockData.products.forEach((p, i) => {
        const qty = Number(p.qty || 0);
        const qtyDisplay = qty === 0 ? '🔴 0 (OOS)' : qty <= 10 ? `🟡 ${qty} (Low)` : `✅ ${qty}`;
        resp += `| ${i + 1} | ${p.productname || 'N/A'} | \`${p.productcode || 'N/A'}\` | ${p.productcolor || 'N/A'} | ${p.brand || 'N/A'} | ${qtyDisplay} | ${p.broken || 0} | ${p.missing || 0} |\n`;
      });
      return resp;
    } else {
      const stockData = getStockSummary();
      let resp = `### 🏭 Live Stock Summary (${stockData.totalProducts} Products)\n\n`;
      resp += `| Metric | Value |\n|---|---|\n`;
      resp += `| 📦 Total Unique Products | **${stockData.totalProducts.toLocaleString('en-IN')}** |\n`;
      resp += `| 📊 Total Stock Qty | **${stockData.totalQty.toLocaleString('en-IN')} units** |\n`;
      resp += `| 🔴 Out of Stock | **${stockData.outOfStockCount} products** |\n`;
      resp += `| 🟡 Low Stock (≤10 units) | **${stockData.lowStockCount} products** |\n`;
      resp += `| ⚠️ Broken / Damaged | **${stockData.totalBroken} units** |\n`;
      resp += `| 🔍 Missing | **${stockData.totalMissing} units** |\n\n`;

      resp += `#### 🏷️ Top Brands by Stock Qty:\n`;
      stockData.brands.slice(0, 5).forEach((b, i) => {
        resp += `${i + 1}. **${b.name}** — ${b.count} SKUs | ${b.totalQty.toLocaleString('en-IN')} units\n`;
      });

      resp += `\n#### 📂 Top Categories by Stock Qty:\n`;
      stockData.categories.slice(0, 5).forEach((c, i) => {
        resp += `${i + 1}. **${c.name}** — ${c.count} products | ${c.totalQty.toLocaleString('en-IN')} units\n`;
      });

      resp += `\n*💡 Tip: Search specific product stock by typing "stock for Bath Rug" or "stock Basket" or a product code like "P0001".*`;
      return resp;
    }
  }

  // 6. Top Customer / Supplier / Product Analytics
  if (q.includes('top customer') || q.includes('best customer') || q.includes('customer analysis') || q.includes('top vendor') || q.includes('top supplier') || q.includes('supplier analysis') || q.includes('customers and vendor') || q.includes('customers & vendor') || q.includes('customers and supplier')) {
    const grossProfit = summary.sales.totalAmount - summary.purchases.totalAmount;
    const grossMarginPct = summary.sales.totalAmount > 0 ? ((grossProfit / summary.sales.totalAmount) * 100).toFixed(2) : '0.00';
    let resp = `### 🏆 Top Customers & Vendors Business Intelligence\n\n`;
    resp += `**💚 Gross Profit Margin: ${grossMarginPct}%** (₹${grossProfit.toLocaleString('en-IN', { maximumFractionDigits: 2 })})\n\n`;
    resp += `#### 👥 Top 5 Customers by Sales Revenue:\n`;
    resp += `| # | Customer | Revenue | Invoices |\n|---|---|---|---|\n`;
    analytics.topCustomers.forEach((c, idx) => { resp += `| ${idx + 1} | ${c.name} | ₹${c.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} | ${c.invoiceCount} |\n`; });
    resp += `\n#### 🏭 Top 5 Suppliers by Purchase Value:\n`;
    resp += `| # | Supplier | Purchased | Invoices |\n|---|---|---|---|\n`;
    analytics.topSuppliers.forEach((s, idx) => { resp += `| ${idx + 1} | ${s.name} | ₹${s.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} | ${s.invoiceCount} |\n`; });
    resp += `\n#### 📦 Top 5 Best-Selling Products:\n`;
    analytics.topSaleItems.forEach((item, idx) => { resp += `${idx + 1}. **${item.name}** — ${item.totalQty} units sold\n`; });
    return resp;
  }

  // 7. Low Stock Alerts — powered by real Stock API
  if (q.includes('low stock') || q.includes('stock alert') || q.includes('reorder') || q.includes('out of stock') || q.includes('low inventory')) {
    const stockData = getStockSummary();
    const outOfStock = stock.filter(s => Number(s.qty || 0) === 0).slice(0, 10);
    const lowStockItems = stock.filter(s => Number(s.qty || 0) > 0 && Number(s.qty || 0) <= 10).slice(0, 10);

    let resp = `### ⚠️ Live Stock Alerts (from ERP Stock API)\n\n`;
    resp += `- 🔴 **Out of Stock:** ${stockData.outOfStockCount} products\n`;
    resp += `- 🟡 **Low Stock (≤10 units):** ${stockData.lowStockCount} products\n`;
    resp += `- 📦 **Total Stock Items Tracked:** ${stockData.totalProducts.toLocaleString('en-IN')}\n\n`;

    if (outOfStock.length > 0) {
      resp += `#### 🔴 Out of Stock (Immediate Reorder Needed):\n`;
      resp += `| Product | Code | Brand | Category |\n|---|---|---|---|\n`;
      outOfStock.forEach(p => { resp += `| **${p.productname}** | \`${p.productcode}\` | ${p.brand || 'N/A'} | ${p.category || 'N/A'} |\n`; });
      resp += `\n`;
    }
    if (lowStockItems.length > 0) {
      resp += `#### 🟡 Low Stock (Reorder Soon):\n`;
      resp += `| Product | Code | Color | Qty | UOM |\n|---|---|---|---|---|\n`;
      lowStockItems.forEach(p => { resp += `| **${p.productname}** | \`${p.productcode}\` | ${p.productcolor || 'N/A'} | 🟡 ${p.qty} | ${p.uom || 'Pcs'} |\n`; });
    }
    if (stockData.outOfStockCount === 0 && stockData.lowStockCount === 0) {
      resp += `✅ **All products are well-stocked!** No reorder alerts at this time.`;
    }
    return resp;
  }


  if (q.includes('best selling') || q.includes('top product') || q.includes('top item') || q.includes('product analysis')) {
    let resp = `### 📦 Top Selling Products\n\n`;
    resp += `| # | Product | Units Sold |\n|---|---|---|\n`;
    analytics.topSaleItems.forEach((item, idx) => { resp += `| ${idx + 1} | **${item.name}** | ${item.totalQty} units |\n`; });
    return resp;
  }

  // 8. Profit Margin Query
  if (q.includes('profit') || q.includes('margin') || q.includes('gross profit')) {
    const grossProfit = summary.sales.totalAmount - summary.purchases.totalAmount;
    const grossMarginPct = summary.sales.totalAmount > 0 ? ((grossProfit / summary.sales.totalAmount) * 100).toFixed(2) : '0.00';
    let resp = `### 📈 Gross Profit & Margin Analysis\n\n`;
    resp += `| Metric | Value |\n|---|---|\n`;
    resp += `| 🛒 Total Sales Revenue | ₹${summary.sales.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} |\n`;
    resp += `| 📦 Total Purchase Expenses | ₹${summary.purchases.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} |\n`;
    resp += `| 💚 Gross Profit | ₹${grossProfit.toLocaleString('en-IN', { maximumFractionDigits: 2 })} |\n`;
    resp += `| 📈 Gross Margin % | **${grossMarginPct}%** |\n`;
    return resp;
  }

  const isGeneralSaleQuery = q === 'sales' || q === 'sale' || q === 'sale records' || q === 'sale invoices' || q.includes('show sale') || q.includes('search sale');
  const isGeneralPurchaseQuery = q === 'purchases' || q === 'purchase' || q === 'purchase records' || q === 'purchase invoices' || q.includes('show purchase') || q.includes('search purchase') || q === 'vendor' || q === 'supplier';

  if (isGeneralSaleQuery && !isGeneralPurchaseQuery) {
    return `### 🛒 Sales Enquiry
Please specify what sales information you need by providing one of the following:
1. **Invoice Number** (e.g., \`GEE/26-27/0009\`)
2. **Invoice Date** (e.g., \`2026-04-15\`)
3. **Month / Date Breakdown** (e.g., \`month-wise sales\`, \`date-wise sales\`, \`year sales\`)
4. **Customer Name** (e.g., \`The Great Eastern Export\`)`;
  }

  if (isGeneralPurchaseQuery && !isGeneralSaleQuery) {
    return `### 📦 Purchases Enquiry
Please specify what purchase information you need by providing one of the following:
1. **Supplier Invoice Number** (e.g., \`GEHOHR001VPO414\`)
2. **Invoice Date** (e.g., \`2026-04-15\`)
3. **Month / Date Breakdown** (e.g., \`month purchases\`, \`date-wise purchases\`, \`year purchases\`)
4. **Vendor / Supplier Name** (e.g., \`WONDER WEAVE EXPORTS\`)`;
  }

  const { pMatches, sMatches } = searchRecords(query, 5);
  const total = pMatches.length + sMatches.length;

  if (total === 0) {
    return `❌ No matching ERP API records found for **"${query}"**.\n\n*Tip: Try searching by Supplier Invoice No (e.g. GEHOHR001VPO338), Party Name (e.g. KESHAV), or Item (e.g. Rug).*`;
  }

  let text = `✅ Found **${total} ERP API record(s)** for **"${query}"**:\n\n`;

  if (sMatches.length > 0) {
    text += `### 🛒 Sale Invoice Records (${sMatches.length})\n`;
    sMatches.forEach((s, i) => {
      const invNo = s.invoiceNo || 'N/A';
      const party = s.partyName || s.shipping_add_lin1 || 'N/A';
      const amt = s.invoiceamount || 0;
      text += `**${i + 1}. Invoice:** \`${invNo}\` | **Date:** ${s.invoiceDate || 'N/A'}\n`;
      text += `   - **Customer:** ${party} (${s.state || 'N/A'})\n`;
      text += `   - **Amount:** ₹${amt}\n`;
      if (s.items && s.items.length) {
        text += `   - **Items:** ${s.items.map(it => `${it.itemName} (Qty: ${it.itemQty || it.qty || 1})`).join(', ')}\n`;
      }
      text += `\n`;
    });
  }

  if (pMatches.length > 0) {
    text += `### 📦 Purchase Invoice Records (${pMatches.length})\n`;
    pMatches.forEach((p, i) => {
      const invNo = p.invoiceNo || p.supplierinvoiceno || 'N/A';
      const party = p.partyName || 'N/A';
      text += `**${i + 1}. Invoice:** \`${invNo}\` | **Date:** ${p.invoiceDate || p.supplierinvoicedate || 'N/A'}\n`;
      text += `   - **Vendor:** ${party} (${p.partyGroup || 'N/A'})\n`;
      if (p.items && p.items.length) {
        text += `   - **Items:** ${p.items.map(it => `${it.itemName} (Qty: ${it.itemQty || it.qty || 1})`).join(', ')}\n`;
      }
      text += `\n`;
    });
  }

  return text;
}

// ── Stock Summary from stock_api.php ──────────────────────────────────────
function getStockSummary(productQuery = '') {
  if (!stock || stock.length === 0) return { totalProducts: 0, totalQty: 0, totalBroken: 0, totalMissing: 0, outOfStockCount: 0, lowStockCount: 0, brands: {}, categories: {}, products: [] };

  let totalQty = 0, totalBroken = 0, totalMissing = 0, outOfStockCount = 0, lowStockCount = 0;
  const brands = {};
  const categories = {};

  let filtered = stock;
  if (productQuery && productQuery.trim().length >= 2) {
    const q = productQuery.toLowerCase().trim();
    filtered = stock.filter(s =>
      (s.productname || '').toLowerCase().includes(q) ||
      (s.productcode || '').toLowerCase().includes(q) ||
      (s.productcolor || '').toLowerCase().includes(q) ||
      (s.brand || '').toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q)
    );
  }

  stock.forEach(s => {
    const qty = Number(s.qty || 0);
    const broken = Number(s.broken || 0);
    const missing = Number(s.missing || 0);
    totalQty += qty;
    totalBroken += broken;
    totalMissing += missing;
    if (qty === 0) outOfStockCount++;
    else if (qty <= 10) lowStockCount++;
    const brand = (s.brand || 'Unknown').trim();
    const cat = (s.category || 'General').trim();
    if (!brands[brand]) brands[brand] = { name: brand, count: 0, totalQty: 0 };
    brands[brand].count++;
    brands[brand].totalQty += qty;
    if (!categories[cat]) categories[cat] = { name: cat, count: 0, totalQty: 0 };
    categories[cat].count++;
    categories[cat].totalQty += qty;
  });

  const sortedFiltered = [...filtered].sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0));

  return {
    totalProducts: stock.length,
    filteredCount: filtered.length,
    totalQty,
    totalBroken,
    totalMissing,
    outOfStockCount,
    lowStockCount,
    brands: Object.values(brands).sort((a, b) => b.totalQty - a.totalQty).slice(0, 8),
    categories: Object.values(categories).sort((a, b) => b.totalQty - a.totalQty).slice(0, 8),
    products: sortedFiltered.slice(0, 20)
  };
}

// REST API Endpoints

// SECURITY: /api/status — minimal public response only
app.get('/api/status', async (req, res) => {
  await ensureDataLoaded();
  // Return only non-sensitive health info
  res.json({
    status: 'ok',
    system: 'Digify Soft ERP AI',
    timestamp: new Date().toISOString()
  });
});

// SECURITY: /api/status/admin — full details behind admin token
app.get('/api/status/admin', requireAdminToken, async (req, res) => {
  await ensureDataLoaded();
  res.json({
    status: 'ok',
    system: 'Digify Soft ERP AI System',
    groqEnabled: Boolean(groqClient),
    purchasesCount: purchases.length,
    salesCount: sales.length,
    stockCount: stock.length,
    lastFetchedTime: lastFetchedTime,
    isLoading: isLoadingData
  });
});

app.get('/api/summary', async (req, res) => {
  await ensureDataLoaded();
  res.json({
    status: 'ok',
    data: getErpSummaryStats()
  });
});

app.get('/api/analytics/sales', async (req, res) => {
  await ensureDataLoaded();
  res.json({
    status: 'ok',
    data: getSalesBreakdown()
  });
});

app.get('/api/analytics/purchases', async (req, res) => {
  await ensureDataLoaded();
  res.json({
    status: 'ok',
    data: getPurchasesBreakdown()
  });
});

app.get('/api/analytics/dispatch', async (req, res) => {
  await ensureDataLoaded();
  res.json({
    status: 'ok',
    data: getDispatchSummary()
  });
});

app.get('/api/analytics/inventory', async (req, res) => {
  await ensureDataLoaded();
  const q = req.query.product || '';
  res.json({
    status: 'ok',
    data: getInventorySummary(q)
  });
});

app.get('/api/chartdata', async (req, res) => {
  await ensureDataLoaded();
  res.json({
    status: 'ok',
    data: getChartData()
  });
});

app.get('/api/analytics/bi', async (req, res) => {
  await ensureDataLoaded();
  const summary = getErpSummaryStats();
  const analytics = getTopAnalytics();
  const alerts = getLowStockAlerts();
  const grossProfit = summary.sales.totalAmount - summary.purchases.totalAmount;
  const grossMarginPct = summary.sales.totalAmount > 0
    ? ((grossProfit / summary.sales.totalAmount) * 100).toFixed(2) : '0.00';
  res.json({
    status: 'ok',
    data: {
      grossProfit,
      grossMarginPct,
      topCustomers: analytics.topCustomers,
      topSuppliers: analytics.topSuppliers,
      topSaleItems: analytics.topSaleItems,
      lowStockAlerts: alerts
    }
  });
});

app.get('/api/stock', async (req, res) => {
  await ensureDataLoaded();
  const q = req.query.product || '';
  res.json({
    status: 'ok',
    data: getStockSummary(q)
  });
});

// SECURITY: /api/refresh — admin-only, rate limited
app.post('/api/refresh', requireAdminToken, chatLimiter, async (req, res) => {
  await loadAPIData();
  res.json({
    status: 'ok',
    message: 'ERP API Data Refreshed Successfully',
    purchasesCount: purchases.length,
    salesCount: sales.length,
    stockCount: stock.length,
    lastFetchedTime: lastFetchedTime
  });
});

// NOTE: All features now LIVE — MOCK_UNDER_CONSTRUCTION disabled
function checkUnderConstructionQuery(message) {
  // All queries are now handled by deterministic fallback or Groq LLM
  return null;
}

// SECURITY: /api/chat — rate limited, fully validated, injection protected
app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    const { message, history } = req.body;

    // --- Input validation ---
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Invalid message format.' });
    }

    const sanitizedMessage = message.trim();

    if (sanitizedMessage === '') {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    // Max length — prevents context overflow & cost amplification attacks
    if (sanitizedMessage.length > 500) {
      return res.status(400).json({ error: 'Message too long. Maximum 500 characters allowed.' });
    }

    // Prompt injection detection
    if (detectPromptInjection(sanitizedMessage)) {
      return res.status(400).json({ error: 'Invalid query. Please ask about sales, purchases, or inventory.' });
    }

    // Validate history array — accept only valid role/content pairs, max 4 items
    const safeHistory = Array.isArray(history)
      ? history
          .filter(h => h && typeof h.role === 'string' && typeof h.content === 'string')
          .slice(-4)
      : [];

    await ensureDataLoaded();

    // Check if query is for a feature currently under construction
    const underConstructionReply = checkUnderConstructionQuery(sanitizedMessage);
    if (underConstructionReply) {
      return res.json({
        reply: underConstructionReply,
        mode: 'placeholder',
        timestamp: new Date().toISOString()
      });
    }

    // Deterministic structured workflow first
    let reply = generateDeterministicFallback(sanitizedMessage);
    let mode = 'deterministic';

    // Fall back to Groq LLM for open-ended queries
    if (!reply && groqClient) {
      reply = await askGroqLLM(sanitizedMessage, safeHistory);
      if (reply) mode = 'groq-llm';
    }

    res.json({
      reply,
      mode,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    // SECURITY: Never expose internal error details to client
    console.error('Chat API Error:', err);
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

app.get('/widget.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'widget.js'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, async () => {
    console.log(`\n=============================================================`);
    console.log(`🚀 Digify Soft ERP AI Chatbot Server running on port ${PORT}`);
    console.log(`🌐 API Endpoint: http://localhost:${PORT}/api/chat`);
    console.log(`💬 Embed Script: <script src="http://localhost:${PORT}/widget.js"></script>`);
    console.log(`=============================================================\n`);
    
    await loadAPIData();
  });
}

module.exports = app;
