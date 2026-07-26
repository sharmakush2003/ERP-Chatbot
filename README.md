# 🤖 Digify Soft ERP AI Chatbot Server

An Enterprise AI-powered search and conversational assistant for Digify Soft Cloud ERP Purchase and Sale APIs.
Built with **Node.js, Express, Groq LLM API (Llama-3)** and a lightweight **Embeddable Floating Chat Widget UI**.

---

## 🚀 Quick Start Guide

### 1. Installation
Run the following command to install dependencies:
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
# Server Port
PORT=3000

# Groq LLM API Key (Get a free key at https://console.groq.com/keys)
GROQ_API_KEY=gsk_your_groq_api_key_here

# ERP Cloud API Endpoints
PURCHASE_API_URL=https://thegreateasternexports.jbbs.in/API/purchase_api.php
SALE_API_URL=https://thegreateasternexports.jbbs.in/API/sale_api.php
```
*Note: If no `GROQ_API_KEY` is provided, the chatbot will automatically fall back to the built-in Deterministic ERP Search Engine.*

### 3. Start the Server
```bash
npm start
```
The server will start at `http://localhost:3000`.

---

## 🌐 Senior Developer Integration Guide (PHP ERP)

Integrating the chatbot widget into your PHP ERP requires **zero changes to your PHP backend code**.

### Embed via 1-Line Script Tag
Paste this single `<script>` tag into your PHP ERP footer template (e.g. `footer.php` or `header.php`):

```html
<!-- Digify ERP AI Floating Chatbot Widget -->
<script src="http://YOUR-SERVER-IP:3000/widget.js" defer></script>
```

> **Replace `YOUR-SERVER-IP`** with your actual domain or IP address where this Node.js server is hosted (e.g. `https://chatbot.yourdomain.com/widget.js` or `http://localhost:3000/widget.js`).

---

## 📡 REST API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/chat` | Main Chat endpoint. Body: `{ "message": "Show total sales", "history": [] }` |
| `GET` | `/api/summary` | Financial & GST collection totals JSON |
| `GET` | `/api/status` | Server status and ERP record connection status |
| `POST` | `/api/refresh` | Force reload ERP Cloud records |
| `GET` | `/widget.js` | Embeddable Floating Chat UI Script |

---

## 🏢 Powered By
**Digify Soft Solutions** — India's Premier SaaS & Cloud ERP Provider  
Official Website: [https://digifysoft.in](https://digifysoft.in)  
Helpline: +91 7425016636
