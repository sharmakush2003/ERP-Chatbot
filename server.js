require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Groq } = require('groq-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for embedding in PHP ERP & external sites
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ERP API Configuration
const PURCHASE_API_URL = (process.env.PURCHASE_API_URL || 'https://thegreateasternexports.jbbs.in/API/purchase_api.php').trim();
const SALE_API_URL = (process.env.SALE_API_URL || 'https://thegreateasternexports.jbbs.in/API/sale_api.php').trim();

// In-Memory Data Store
let purchases = [];
let sales = [];
let lastFetchedTime = null;
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
  try {
    const [pRes, sRes] = await Promise.all([
      fetch(PURCHASE_API_URL).then(r => r.json()).catch((err) => { console.error('❌ Purchase API Fetch Error:', err.message); return { Vouchers: [] }; }),
      fetch(SALE_API_URL).then(r => r.json()).catch((err) => { console.error('❌ Sale API Fetch Error:', err.message); return { Vouchers: [] }; })
    ]);

    purchases = pRes.Vouchers || pRes.data || [];
    sales = sRes.Vouchers || sRes.data || [];
    lastFetchedTime = new Date().toISOString();

    console.log(`✅ Digify ERP API Data Loaded! Purchases: ${purchases.length} | Sales: ${sales.length}`);
  } catch (err) {
    console.error('❌ Failed to fetch ERP APIs:', err.message);
  } finally {
    isLoadingData = false;
  }
}

// Ensure data is loaded (crucial for Vercel/serverless environments where app.listen is bypassed)
async function ensureDataLoaded() {
  if ((purchases.length === 0 || sales.length === 0) && !isLoadingData) {
    console.log('⚠️ ERP cache empty. Fetching data on demand...');
    await loadAPIData();
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
  pMatches = purchases.filter(p => JSON.stringify(p).toLowerCase().includes(q)).slice(0, maxResults);
  sMatches = sales.filter(s => JSON.stringify(s).toLowerCase().includes(q)).slice(0, maxResults);

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

// Local Smart Search Fallback
function generateDeterministicFallback(query) {
  const q = query.toLowerCase().trim();
  const summary = getErpSummaryStats();
  const analytics = getTopAnalytics();
  const salesBreakdown = getSalesBreakdown();
  const purchasesBreakdown = getPurchasesBreakdown();
  const dispatchSummary = getDispatchSummary();

  // 1. Executive Summary query -> Under Construction / Deleted per user request
  if (q.includes('summary') || q.includes('executive')) {
    return "🚧 **Building... Will take some time**";
  }

  // 2. Primary "Sales" query (exact or generic sales request)
  if (q === 'sales' || q === 'sale' || q === 'show sales' || q === 'sales report') {
    let resp = `### 🛒 Sales Reports\n\n`;
    resp += `Which Sales report would you like to view? Please select an option below:\n\n`;
    resp += `<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">\n`;
    resp += `  <button onclick="sendPrompt('Month-wise Sales')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">🗓️ Month-wise Sales</button>\n`;
    resp += `  <button onclick="sendPrompt('Day-wise Sales')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📆 Day-wise Sales</button>\n`;
    resp += `  <button onclick="sendPrompt('Year-wise Sales')" style="background:rgba(245,158,11,0.18);border:1px solid rgba(245,158,11,0.4);color:#fcd34d;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📅 Year-wise Sales</button>\n`;
    resp += `</div>`;
    return resp;
  }

  // 2a. Year-wise Sales
  if (q.includes('year') && q.includes('sale')) {
    let resp = `### 📅 Year-wise Sales Report\n\n`;
    Object.values(salesBreakdown.byYear).forEach(y => {
      resp += `- **Year ${y.year}:** ₹${y.totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${y.invoiceCount} Invoices, ${y.totalItemsQty} items sold)\n`;
    });
    resp += `\nSelect a year or explore Month-wise Sales:\n\n`;
    resp += `<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">\n`;
    Object.keys(salesBreakdown.byYear).forEach(yr => {
      resp += `  <button onclick="sendPrompt('Sales for Year ${yr}')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📅 Year ${yr}</button>\n`;
    });
    resp += `  <button onclick="sendPrompt('Month-wise Sales')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">🗓️ View Month-wise Sales</button>\n`;
    resp += `</div>`;
    return resp;
  }

  // 2b. Month-wise Sales
  if (q.includes('month') && q.includes('sale')) {
    let resp = `### 🗓️ Month-wise Sales Report\n\n`;
    resp += `Select a month to view its detailed revenue and invoice report:\n\n`;
    resp += `<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">\n`;
    Object.values(salesBreakdown.byMonth).forEach(m => {
      const dateObj = new Date(`${m.month}-01`);
      const monthLabel = isNaN(dateObj) ? m.month : dateObj.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      resp += `  <button onclick="sendPrompt('Sales for ${monthLabel}')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">🗓️ ${monthLabel}</button>\n`;
    });
    resp += `</div>\n\n`;
    resp += `#### 📊 Overall Monthly Breakdown:\n`;
    Object.values(salesBreakdown.byMonth).forEach(m => {
      const dateObj = new Date(`${m.month}-01`);
      const monthLabel = isNaN(dateObj) ? m.month : dateObj.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      resp += `- **${monthLabel} (${m.month}):** ₹${m.totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 2 })} | ${m.invoiceCount} Invoices | ${m.totalItemsQty} Items Dispatched\n`;
    });
    return resp;
  }

  // 2c. Day-wise Sales
  if ((q.includes('day') || q.includes('date') || q.includes('daily')) && q.includes('sale')) {
    let resp = `### 📆 Day-wise Sales Summary\n\n`;
    resp += `Select a date to view daily sales records:\n\n`;
    const topDates = Object.values(salesBreakdown.byDate).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    resp += `<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">\n`;
    topDates.forEach(d => {
      resp += `  <button onclick="sendPrompt('Sales for ${d.date}')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📆 ${d.date}</button>\n`;
    });
    resp += `</div>\n\n`;
    resp += `#### 📋 Recent Daily Summaries:\n`;
    topDates.forEach(d => {
      resp += `- **Date ${d.date}:** ₹${d.totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${d.invoiceCount} Invoices, ${d.totalItemsQty} Qty)\n`;
    });
    return resp;
  }

  // Specific Sales Filter (e.g. "Sales for April 2026")
  if (q.includes('sales for') || q.includes('sale for')) {
    const filter = q.replace('sales for', '').replace('sale for', '').trim();
    const matching = sales.filter(s => {
      const d = s.invoiceDate || s.supplierinvoicedate || '';
      return d.toLowerCase().includes(filter) || JSON.stringify(s).toLowerCase().includes(filter);
    });
    if (matching.length > 0) {
      let totalAmt = 0;
      matching.forEach(s => totalAmt += Number(s.invoiceamount || 0));
      let resp = `### 🛒 Sales Report for "${filter.toUpperCase()}"\n\n`;
      resp += `- 💰 **Total Revenue:** ₹${totalAmt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}\n`;
      resp += `- 📜 **Total Invoices:** ${matching.length} Invoices\n\n`;
      resp += `#### 📋 Invoice List:\n`;
      matching.slice(0, 8).forEach((s, i) => {
        resp += `${i + 1}. Invoice \`${s.invoiceNo || 'N/A'}\` | Date: ${s.invoiceDate || 'N/A'} | ₹${s.invoiceamount || 0} (${s.partyName || s.shipping_add_lin1 || 'N/A'})\n`;
      });
      return resp;
    }
  }

  // 3. Primary "Purchases" query
  if (q === 'purchases' || q === 'purchase' || q === 'show purchases' || q === 'purchase report') {
    let resp = `### 📦 Purchase Reports\n\n`;
    resp += `Which Purchase report would you like to view? Please select an option below:\n\n`;
    resp += `<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">\n`;
    resp += `  <button onclick="sendPrompt('Month-wise Purchases')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">🗓️ Month-wise Purchases</button>\n`;
    resp += `  <button onclick="sendPrompt('Day-wise Purchases')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📆 Day-wise Purchases</button>\n`;
    resp += `  <button onclick="sendPrompt('Year-wise Purchases')" style="background:rgba(245,158,11,0.18);border:1px solid rgba(245,158,11,0.4);color:#fcd34d;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📅 Year-wise Purchases</button>\n`;
    resp += `</div>`;
    return resp;
  }

  // 3a. Year-wise Purchases
  if (q.includes('year') && q.includes('purchase')) {
    let resp = `### 📅 Year-wise Purchases Report\n\n`;
    Object.values(purchasesBreakdown.byYear).forEach(y => {
      resp += `- **Year ${y.year}:** ₹${y.totalExpense.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${y.invoiceCount} Invoices, ${y.totalItemsQty} items purchased)\n`;
    });
    resp += `\nSelect a year or explore Month-wise Purchases:\n\n`;
    resp += `<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">\n`;
    Object.keys(purchasesBreakdown.byYear).forEach(yr => {
      resp += `  <button onclick="sendPrompt('Purchases for Year ${yr}')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📅 Year ${yr}</button>\n`;
    });
    resp += `  <button onclick="sendPrompt('Month-wise Purchases')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">🗓️ View Month-wise Purchases</button>\n`;
    resp += `</div>`;
    return resp;
  }

  // 3b. Month-wise Purchases
  if (q.includes('month') && q.includes('purchase')) {
    let resp = `### 🗓️ Month-wise Purchases Report\n\n`;
    resp += `Select a month to view its detailed expense report:\n\n`;
    resp += `<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">\n`;
    Object.values(purchasesBreakdown.byMonth).forEach(m => {
      const dateObj = new Date(`${m.month}-01`);
      const monthLabel = isNaN(dateObj) ? m.month : dateObj.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      resp += `  <button onclick="sendPrompt('Purchases for ${monthLabel}')" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">🗓️ ${monthLabel}</button>\n`;
    });
    resp += `</div>\n\n`;
    resp += `#### 📊 Overall Monthly Breakdown:\n`;
    Object.values(purchasesBreakdown.byMonth).forEach(m => {
      const dateObj = new Date(`${m.month}-01`);
      const monthLabel = isNaN(dateObj) ? m.month : dateObj.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      resp += `- **${monthLabel} (${m.month}):** ₹${m.totalExpense.toLocaleString('en-IN', { maximumFractionDigits: 2 })} | ${m.invoiceCount} Invoices | ${m.totalItemsQty} Items Purchased\n`;
    });
    return resp;
  }

  // 3c. Day-wise Purchases
  if ((q.includes('day') || q.includes('date') || q.includes('daily')) && q.includes('purchase')) {
    let resp = `### 📆 Day-wise Purchases Summary\n\n`;
    resp += `Select a date to view daily purchase records:\n\n`;
    const topDates = Object.values(purchasesBreakdown.byDate).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    resp += `<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">\n`;
    topDates.forEach(d => {
      resp += `  <button onclick="sendPrompt('Purchases for ${d.date}')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:9px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">📆 ${d.date}</button>\n`;
    });
    resp += `</div>\n\n`;
    resp += `#### 📋 Recent Daily Summaries:\n`;
    topDates.forEach(d => {
      resp += `- **Date ${d.date}:** ₹${d.totalExpense.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${d.invoiceCount} Invoices, ${d.totalItemsQty} Qty)\n`;
    });
    return resp;
  }

  // Specific Purchase Filter (e.g. "Purchases for April 2026")
  if (q.includes('purchases for') || q.includes('purchase for')) {
    const filter = q.replace('purchases for', '').replace('purchase for', '').trim();
    const matching = purchases.filter(p => {
      const d = p.invoiceDate || p.supplierinvoicedate || '';
      return d.toLowerCase().includes(filter) || JSON.stringify(p).toLowerCase().includes(filter);
    });
    if (matching.length > 0) {
      let totalAmt = 0;
      matching.forEach(p => {
        let pAmt = Number(p.invoiceamount || 0);
        (p.items || []).forEach(i => pAmt += Math.abs(Number(i.itemAmount || 0)));
        totalAmt += pAmt;
      });
      let resp = `### 📦 Purchases Report for "${filter.toUpperCase()}"\n\n`;
      resp += `- 💰 **Total Expenses:** ₹${totalAmt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}\n`;
      resp += `- 📜 **Total Invoices:** ${matching.length} Invoices\n\n`;
      resp += `#### 📋 Invoice List:\n`;
      matching.slice(0, 8).forEach((p, i) => {
        const invNo = p.invoiceNo || p.supplierinvoiceno || 'N/A';
        resp += `${i + 1}. Invoice \`${invNo}\` | Date: ${p.invoiceDate || p.supplierinvoicedate || 'N/A'} | Vendor: ${p.partyName || 'N/A'}\n`;
      });
      return resp;
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

  // 5. Product Inventory & Total Valuation
  if (q.includes('inventory') || q.includes('stock')) {
    const stopWords = ['and', 'the', 'for', 'of', 'in', 'is', 'or', 'to', 'all', 'summary', 'report', 'detail', 'details', 'list', 'units', 'quantity', 'value', 'inventory', 'stock', 'total', 'show', 'item', 'items', 'product', 'products'];
    const cleanedQuery = q.replace(/inventory/g, '').replace(/stock/g, '').replace(/total/g, '').replace(/value/g, '').replace(/quantity/g, '').replace(/show/g, '').replace(/for/g, '').replace(/of/g, '').replace(/and/g, '').trim();

    const isProductSearch = cleanedQuery.length >= 3 && !stopWords.includes(cleanedQuery);

    if (isProductSearch) {
      const invData = getInventorySummary(cleanedQuery);
      if (invData.products.length === 0) {
        return `❌ No inventory records found matching product: **"${cleanedQuery}"**.\n\n*Tip: Try searching for keywords like "Rug", "Mat", "Runner", "Napkin", or "Placemat".*`;
      }

      let resp = `### 📦 Product Inventory Details for "${cleanedQuery}"\n\n`;
      resp += `Found **${invData.products.length} matching product(s)**:\n\n`;

      invData.products.forEach((p, idx) => {
        resp += `**${idx + 1}. ${p.name}** (${p.category})\n`;
        if (p.purchasedQty > 0) resp += `   - 📥 **Stock Inward (Purchased):** ${p.purchasedQty} units (Valuation: ₹${p.purchasedVal.toLocaleString('en-IN', { maximumFractionDigits: 2 })})\n`;
        resp += `   - 🚚 **Dispatched (Sold):** ${p.dispatchedQty} units\n`;
        resp += `   - 📊 **Current Stock Qty:** ${p.netStockQty} units\n`;
        if (p.unitCost > 0) resp += `   - 🏷️ **Estimated Unit Cost:** ₹${p.unitCost.toFixed(2)}\n`;
        resp += `   - 💰 **Total Stock Valuation:** ₹${p.totalStockValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}\n\n`;
      });
      return resp;
    } else {
      const invData = getInventorySummary();
      let resp = `### 🏭 Overall ERP Inventory Summary\n\n`;
      resp += `- 📦 **Total Unique Products:** ${invData.totalUniqueProducts}\n`;
      resp += `- 📊 **Total Stock Quantity:** ${invData.totalStockQty.toLocaleString('en-IN')} units\n`;
      resp += `- 🚚 **Total Dispatched Units:** ${invData.totalDispatchedQty.toLocaleString('en-IN')} units\n`;
      resp += `- 💰 **Total Inventory Valuation:** ₹${invData.totalInventoryVal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}\n\n`;

      resp += `#### 🏆 Top Product Inventory Stock & Dispatches:\n`;
      invData.products.slice(0, 7).forEach((p, idx) => {
        resp += `${idx + 1}. **${p.name}:** Dispatched ${p.dispatchedQty} units | Stock: ${p.netStockQty} units | Valuation: ₹${p.totalStockValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}\n`;
      });
      resp += `\n*💡 Tip: Search specific product inventory by typing "inventory for Bath Rug" or "stock of Yoga Mat".*`;
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

  // 7. Low Stock Alerts
  if (q.includes('low stock') || q.includes('stock alert') || q.includes('reorder') || q.includes('out of stock') || q.includes('low inventory')) {
    const alerts = getLowStockAlerts();
    let resp = `### ⚠️ Inventory Low Stock Alerts\n\n`;
    resp += `- 🔴 **Out of Stock Products:** ${alerts.outOfStockCount}\n`;
    resp += `- 🟡 **Low Stock Products** (< ${alerts.threshold} units): ${alerts.lowStockCount}\n\n`;
    if (alerts.outOfStock.length > 0) {
      resp += `#### 🔴 Out of Stock (Immediate Reorder Needed):\n`;
      resp += `| Product | Category | Purchased | Dispatched |\n|---|---|---|---|\n`;
      alerts.outOfStock.forEach(p => { resp += `| **${p.name}** | ${p.category} | ${p.purchasedQty} | ${p.dispatchedQty} |\n`; });
      resp += `\n`;
    }
    if (alerts.lowStock.length > 0) {
      resp += `#### 🟡 Low Stock (Reorder Soon):\n`;
      resp += `| Product | Net Stock | Unit Cost | Valuation |\n|---|---|---|---|\n`;
      alerts.lowStock.forEach(p => { resp += `| **${p.name}** | ${p.netStockQty} units | ₹${p.unitCost.toFixed(2)} | ₹${p.totalStockValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })} |\n`; });
    }
    if (alerts.outOfStockCount === 0 && alerts.lowStockCount === 0) {
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

// REST API Endpoints

app.get('/api/status', async (req, res) => {
  await ensureDataLoaded();
  res.json({
    status: 'ok',
    system: 'Digify Soft ERP AI System',
    groqEnabled: Boolean(groqClient),
    purchasesCount: purchases.length,
    salesCount: sales.length,
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

app.post('/api/refresh', async (req, res) => {
  await loadAPIData();
  res.json({
    status: 'ok',
    message: 'ERP API Data Refreshed Successfully',
    purchasesCount: purchases.length,
    salesCount: sales.length,
    lastFetchedTime: lastFetchedTime
  });
});

// Configuration: When true, returns 'Building... Will take some time' for features under construction
const MOCK_UNDER_CONSTRUCTION = true;

function checkUnderConstructionQuery(message) {
  if (!MOCK_UNDER_CONSTRUCTION) return null;

  const q = message.toLowerCase().trim();

  // Executive Summary query (deleted per user instruction)
  if (q.includes('summary') || q.includes('executive')) {
    return "🚧 **Building... Will take some time**";
  }

  // 1. Dispatch queries
  if (q.includes('dispatch') || q.includes('shipment') || q.includes('dispatched')) {
    return "🚧 **Building... Will take some time**";
  }

  // 2. Inventory & Stock queries
  if (q.includes('inventory') || q.includes('stock')) {
    return "🚧 **Building... Will take some time**";
  }

  // 3. Top Customers & Vendors / Suppliers queries
  if (q.includes('top customer') || q.includes('best customer') || q.includes('customer analysis') || 
      q.includes('top vendor') || q.includes('top supplier') || q.includes('supplier analysis') || 
      q.includes('customers and vendor') || q.includes('customers & vendor') || q.includes('customers and supplier') ||
      q.includes('best selling') || q.includes('top product') || q.includes('top item')) {
    return "🚧 **Building... Will take some time**";
  }

  // 4. Low Stock Alerts queries
  if (q.includes('low stock') || q.includes('stock alert') || q.includes('reorder') || q.includes('out of stock') || q.includes('low inventory')) {
    return "🚧 **Building... Will take some time**";
  }

  return null;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    await ensureDataLoaded();

    // Check if query is for a feature currently under construction
    const underConstructionReply = checkUnderConstructionQuery(message);
    if (underConstructionReply) {
      return res.json({
        reply: underConstructionReply,
        mode: 'placeholder',
        timestamp: new Date().toISOString()
      });
    }

    let reply = null;
    let mode = 'deterministic';

    if (groqClient) {
      reply = await askGroqLLM(message, history || []);
      if (reply) mode = 'groq-llm';
    }

    if (!reply) {
      reply = generateDeterministicFallback(message);
    }

    res.json({
      reply,
      mode,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Chat API Error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

app.get('/widget.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'widget.js'));
});

app.listen(PORT, async () => {
  console.log(`\n=============================================================`);
  console.log(`🚀 Digify Soft ERP AI Chatbot Server running on port ${PORT}`);
  console.log(`🌐 API Endpoint: http://localhost:${PORT}/api/chat`);
  console.log(`💬 Embed Script: <script src="http://localhost:${PORT}/widget.js"></script>`);
  console.log(`=============================================================\n`);
  
  await loadAPIData();
});

module.exports = app;
