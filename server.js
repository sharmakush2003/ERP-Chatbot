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
  const searchRes = searchRecords(userMessage, 10);

  // Compact ERP Context string for LLM Grounding
  const contextData = {
    erpSummary: {
      totalSaleInvoices: summary.sales.totalInvoices,
      totalSaleRevenue: `₹${summary.sales.totalAmount.toFixed(2)}`,
      totalPurchaseInvoices: summary.purchases.totalInvoices,
      totalPurchaseExpense: `₹${summary.purchases.totalAmount.toFixed(2)}`
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
1. Use ONLY data from 'matchingSaleRecords' and 'matchingPurchaseRecords'. Do NOT hallucinate, invent, or assume any invoice numbers, party names, dates or amounts.
2. If those arrays are empty and the user asked for specific records, reply: "I couldn't find any matching records in the ERP database. Could you provide a different invoice number, date, or party name?"
3. Whenever matching records exist, list them clearly: Invoice No, Date, Customer/Vendor Name, Items, and Amount.
4. Financial summaries: use exact figures from 'erpSummary'. Never mention GST, CGST, SGST, IGST or any tax figures.
5. GREETING RULE: For greetings ('Hi', 'Hello', 'Hey'), respond warmly without showing any data.
6. GENERAL ENQUIRY RULE: For broad queries ('show sales', 'purchases', 'invoices'), do NOT dump lists. Ask for a specific filter:
   - Sales: Invoice No (e.g. GEE/26-27/0009), Date (e.g. 2026-04-15), or Customer Name.
   - Purchases: Supplier Invoice No (e.g. GEHOHR001VPO414), Date, or Vendor Name.
7. Format responses with Markdown: bold headings, bullet points, code backticks for invoice numbers, emojis.
8. Be concise, professional, and friendly.

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

  if (q.includes('summary') || q.includes('total') || q.includes('dashboard') || (q.includes('sale') && q.includes('purchase'))) {
    return `### 💰 ERP Financial Dashboard

- 🛒 **Total Sales Revenue:** ₹${summary.sales.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${summary.sales.totalInvoices} Invoices)
- 📦 **Total Purchase Expenses:** ₹${summary.purchases.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${summary.purchases.totalInvoices} Invoices)`;
  }

  const isGeneralSaleQuery = q === 'sales' || q === 'sale' || q === 'sale records' || q === 'sale invoices' || q.includes('show sale') || q.includes('search sale');
  const isGeneralPurchaseQuery = q === 'purchases' || q === 'purchase' || q === 'purchase records' || q === 'purchase invoices' || q.includes('show purchase') || q.includes('search purchase') || q === 'vendor' || q === 'supplier';

  if (isGeneralSaleQuery && !isGeneralPurchaseQuery) {
    return `### 🛒 Sales Enquiry
Please specify what sales information you need by providing one of the following:
1. **Invoice Number** (e.g., \`GEE/26-27/0009\`)
2. **Invoice Date** (e.g., \`2026-04-15\`)
3. **Customer Name** (e.g., \`The Great Eastern Export\`)
4. **GSTIN / PAN Number** or any unique customer identifier.`;
  }

  if (isGeneralPurchaseQuery && !isGeneralSaleQuery) {
    return `### 📦 Purchases Enquiry
Please specify what purchase information you need by providing one of the following:
1. **Supplier Invoice Number** (e.g., \`GEHOHR001VPO414\`)
2. **Invoice Date** (e.g., \`2026-04-15\`)
3. **Vendor / Supplier Name** (e.g., \`WONDER WEAVE EXPORTS\`)`;
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

app.get('/api/chartdata', async (req, res) => {
  await ensureDataLoaded();
  res.json({
    status: 'ok',
    data: getChartData()
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

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    await ensureDataLoaded();

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
