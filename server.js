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
const PURCHASE_API_URL = process.env.PURCHASE_API_URL || 'https://thegreateasternexports.jbbs.in/API/purchase_api.php';
const SALE_API_URL = process.env.SALE_API_URL || 'https://thegreateasternexports.jbbs.in/API/sale_api.php';

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

// Fetch ERP Data from Cloud Services
async function loadAPIData() {
  isLoadingData = true;
  console.log('🔄 Fetching real-time ERP data from Cloud Services...');
  try {
    const [pRes, sRes] = await Promise.all([
      fetch(PURCHASE_API_URL).then(r => r.json()).catch(() => ({ Vouchers: [] })),
      fetch(SALE_API_URL).then(r => r.json()).catch(() => ({ Vouchers: [] }))
    ]);

    purchases = pRes.Vouchers || pRes.data || [];
    sales = sRes.Vouchers || sRes.data || [];
    lastFetchedTime = new Date().toISOString();

    console.log(`✅ Digify ERP Data Loaded! Purchases: ${purchases.length} | Sales: ${sales.length}`);
  } catch (err) {
    console.error('❌ Failed to fetch ERP APIs:', err.message);
  } finally {
    isLoadingData = false;
  }
}

// Auto Refresh ERP Data every 10 minutes
setInterval(loadAPIData, 10 * 60 * 1000);

// Calculate Exact Financial & GST Totals (100% Deterministic Code Math)
function getErpSummaryStats() {
  let saleTotalAmt = 0, saleCGST = 0, saleSGST = 0, saleIGST = 0, saleItems = 0;
  sales.forEach(s => {
    saleTotalAmt += Number(s.invoiceamount || 0);
    (s.items || []).forEach(item => {
      saleItems++;
      saleTotalAmt += Math.abs(Number(item.itemAmount || 0));
      saleCGST += Number(item.cgst || 0);
      saleSGST += Number(item.sgst || 0);
      saleIGST += Number(item.igst || 0);
    });
  });
  const totalSaleGST = saleCGST + saleSGST + saleIGST;

  let purchaseTotalAmt = 0, purchaseCGST = 0, purchaseSGST = 0, purchaseIGST = 0, purchaseItems = 0;
  purchases.forEach(p => {
    purchaseTotalAmt += Number(p.invoiceamount || 0);
    (p.items || []).forEach(item => {
      purchaseItems++;
      purchaseTotalAmt += Math.abs(Number(item.itemAmount || 0));
      purchaseCGST += Number(item.cgst || 0);
      purchaseSGST += Number(item.sgst || 0);
      purchaseIGST += Number(item.igst || 0);
    });
  });
  const totalPurchaseGST = purchaseCGST + purchaseSGST + purchaseIGST;

  const netGST = totalSaleGST - totalPurchaseGST;

  return {
    sales: {
      totalInvoices: sales.length,
      totalItems: saleItems,
      totalAmount: saleTotalAmt,
      cgst: saleCGST,
      sgst: saleSGST,
      igst: saleIGST,
      totalGST: totalSaleGST
    },
    purchases: {
      totalInvoices: purchases.length,
      totalItems: purchaseItems,
      totalAmount: purchaseTotalAmt,
      cgst: purchaseCGST,
      sgst: purchaseSGST,
      igst: purchaseIGST,
      totalGST: totalPurchaseGST
    },
    financialPosition: {
      netGSTLiability: netGST >= 0 ? netGST : 0,
      availableITC: netGST < 0 ? Math.abs(netGST) : 0,
      summaryText: netGST >= 0 
        ? `Net Tax Liability to pay: ₹${netGST.toFixed(2)}` 
        : `Net Input Tax Credit (ITC Available): ₹${Math.abs(netGST).toFixed(2)}`
    }
  };
}

// Search & Filter ERP Records
function searchRecords(query, maxResults = 10) {
  if (!query || query.trim() === '') return { pMatches: [], sMatches: [] };
  const q = query.toLowerCase().trim();

  const pMatches = purchases.filter(p => JSON.stringify(p).toLowerCase().includes(q)).slice(0, maxResults);
  const sMatches = sales.filter(s => JSON.stringify(s).toLowerCase().includes(q)).slice(0, maxResults);

  return { pMatches, sMatches };
}

// Groq LLM Processing Engine with Grounding
async function askGroqLLM(userMessage, conversationHistory = []) {
  if (!groqClient) {
    return null; // Fallback to local smart search if no Groq key
  }

  const summary = getErpSummaryStats();
  const searchRes = searchRecords(userMessage, 15);

  // Compact ERP Context string for LLM Grounding
  const contextData = {
    erpSummary: {
      totalSaleInvoices: summary.sales.totalInvoices,
      totalSaleRevenue: `₹${summary.sales.totalAmount.toFixed(2)}`,
      totalSaleGSTCollected: `₹${summary.sales.totalGST.toFixed(2)}`,
      totalPurchaseInvoices: summary.purchases.totalInvoices,
      totalPurchaseExpense: `₹${summary.purchases.totalAmount.toFixed(2)}`,
      totalPurchaseGSTPaid: `₹${summary.purchases.totalGST.toFixed(2)}`,
      netGSTPosition: summary.financialPosition.summaryText
    },
    matchingPurchaseRecords: searchRes.pMatches.map(p => ({
      invoiceNo: p.invoiceNo || p.supplierinvoiceno,
      date: p.invoiceDate || p.supplierinvoicedate,
      partyName: p.partyName,
      partyGroup: p.partyGroup,
      amount: p.invoiceamount || 0,
      items: (p.items || []).map(i => ({ name: i.itemName, qty: i.itemQty || i.qty, amount: i.itemAmount }))
    })),
    matchingSaleRecords: searchRes.sMatches.map(s => ({
      invoiceNo: s.invoiceNo,
      date: s.invoiceDate,
      customerName: s.partyName || s.shipping_add_lin1,
      state: s.state || s.placeofsupply,
      amount: s.invoiceamount || 0,
      items: (s.items || []).map(i => ({ name: i.itemName, qty: i.itemQty || i.qty, amount: i.itemAmount }))
    }))
  };

  const systemPrompt = `You are Digify Soft ERP AI Assistant — an expert enterprise AI for Digify Soft Solutions (https://digifysoft.in).
You are answering user queries based on real-time Digify Soft Cloud ERP Purchase and Sales records.

STRICT GROUNDING & ACCURACY RULES:
1. Use ONLY the provided ERP Context to answer. Do NOT invent invoice numbers, parties, or amounts.
2. If exact information is found in matching records, give precise details (Invoice No, Party, Date, Items, Amount, GST).
3. If asked about financial summaries (Total Sales, Total Purchases, GST Position), state the exact numbers from 'erpSummary'.
4. If no matching record is found for a specific search, state clearly: "No matching ERP record found in Digify Soft Cloud."
5. Format your response cleanly using Markdown, bold highlights, bullet points, and emojis.
6. Keep responses professional, helpful, concise, and polite.

CURRENT REAL-TIME ERP CONTEXT:
${JSON.stringify(contextData, null, 2)}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-4), // keep last 4 messages for context
    { role: 'user', content: userMessage }
  ];

  try {
    const completion = await groqClient.chat.completions.create({
      messages: messages,
      model: 'llama-3.3-70b-versatile',
      temperature: 0.2, // Low temperature for high factual accuracy
      max_tokens: 1024
    });

    return completion.choices[0]?.message?.content || null;
  } catch (err) {
    console.error('Groq API Error:', err.message);
    // Fall back to Llama-3-8b if 70b fails
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

// Local Smart Search Fallback (if Groq Key is not set or network fails)
function generateDeterministicFallback(query) {
  const q = query.toLowerCase().trim();
  const summary = getErpSummaryStats();

  if (q.includes('summary') || q.includes('total') || q.includes('gst') || q.includes('dashboard') || q.includes('sale') && q.includes('purchase')) {
    return `### 💰 Digify Soft ERP Financial & GST Dashboard

- 🛒 **Total Sales Revenue:** ₹${summary.sales.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${summary.sales.totalInvoices} Invoices)
- 📦 **Total Purchase Expenses:** ₹${summary.purchases.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${summary.purchases.totalInvoices} Invoices)

---
#### 📊 GST Collection Breakdown:
- **Output GST Collected (Sales):** ₹${summary.sales.totalGST.toFixed(2)}
  - *CGST:* ₹${summary.sales.cgst.toFixed(2)} | *SGST:* ₹${summary.sales.sgst.toFixed(2)} | *IGST:* ₹${summary.sales.igst.toFixed(2)}
- **Input GST Paid (Purchases):** ₹${summary.purchases.totalGST.toFixed(2)}
  - *CGST:* ₹${summary.purchases.cgst.toFixed(2)} | *SGST:* ₹${summary.purchases.sgst.toFixed(2)} | *IGST:* ₹${summary.purchases.igst.toFixed(2)}

**💵 Net GST Position:** ${summary.financialPosition.summaryText}`;
  }

  const { pMatches, sMatches } = searchRecords(query, 5);
  const total = pMatches.length + sMatches.length;

  if (total === 0) {
    return `❌ No matching ERP records found for **"${query}"** in Digify Soft Cloud Services.\n\n*Tip: Try searching by Supplier Invoice No (e.g. GEHOHR001VPO338), Party Name (e.g. KESHAV), or Item (e.g. Rug).*`;
  }

  let text = `✅ Found **${total} matching ERP record(s)** for **"${query}"**:\n\n`;

  if (sMatches.length > 0) {
    text += `### 🛒 Sale Invoice Matches (${sMatches.length})\n`;
    sMatches.forEach((s, i) => {
      const invNo = s.invoiceNo || 'N/A';
      const party = s.partyName || s.shipping_add_lin1 || 'N/A';
      const amt = s.invoiceamount || 0;
      text += `**${i + 1}. Invoice:** \`${invNo}\` | **Date:** ${s.invoiceDate || 'N/A'}\n`;
      text += `   - **Customer:** ${party} (${s.state || 'N/A'})\n`;
      text += `   - **Invoice Amount:** ₹${amt}\n`;
      if (s.items && s.items.length) {
        text += `   - **Items:** ${s.items.map(it => `${it.itemName} (Qty: ${it.itemQty || it.qty || 1})`).join(', ')}\n`;
      }
      text += `\n`;
    });
  }

  if (pMatches.length > 0) {
    text += `### 📦 Purchase Invoice Matches (${pMatches.length})\n`;
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

// 1. Health Status API
app.get('/api/status', (req, res) => {
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

// 2. Financial Summary API
app.get('/api/summary', (req, res) => {
  res.json({
    status: 'ok',
    data: getErpSummaryStats()
  });
});

// 3. Force Data Refresh API
app.post('/api/refresh', async (req, res) => {
  await loadAPIData();
  res.json({
    status: 'ok',
    message: 'ERP Cloud Data Refreshed Successfully',
    purchasesCount: purchases.length,
    salesCount: sales.length,
    lastFetchedTime: lastFetchedTime
  });
});

// 4. Core AI Chat API Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message cannot be empty' });
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

// Serve Standalone Chat Widget JS & Preview
app.get('/widget.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'widget.js'));
});

// Start Server
app.listen(PORT, async () => {
  console.log(`\n=============================================================`);
  console.log(`🚀 Digify Soft ERP AI Chatbot Server running on port ${PORT}`);
  console.log(`🌐 API Endpoint: http://localhost:${PORT}/api/chat`);
  console.log(`💬 Embed Script: <script src="http://localhost:${PORT}/widget.js"></script>`);
  console.log(`=============================================================\n`);
  
  await loadAPIData();
});
