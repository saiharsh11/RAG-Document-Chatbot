# RAG Document Chatbot

A full-stack AI chatbot that lets you upload PDF documents and chat with them using Retrieval-Augmented Generation (RAG) and LangChain Agents.

---

## What This Project Does

1. You upload a PDF document
2. The backend splits it into chunks, embeds them, and stores them in a local vector database (Chroma)
3. You ask a question in the chat
4. The system retrieves the most relevant chunks from the document
5. An LLM reads those chunks and answers your question

---

## Tech Stack

| Layer | Technology |
|---|---|
| **LLM Providers** | Groq API, OpenRouter API |
| **AI Framework** | LangChain + LangGraph |
| **Agent Pattern** | ReAct (Reason + Act) via LangGraph |
| **Vector Database** | ChromaDB (local) |
| **Embeddings** | HuggingFace `all-MiniLM-L6-v2` (runs locally, free) |
| **Backend** | FastAPI + Uvicorn |
| **Frontend** | React + Vite + Tailwind CSS |
| **PDF Parsing** | PyPDF |

---

## Project Structure

```
antigravity4/
├── CLAUDE.md                  # Project context for Claude Code
├── README.md                  # This file
├── .gitignore
├── start_backend.bat          # Double-click to start backend
├── start_frontend.bat         # Double-click to start frontend
│
├── backend/
│   ├── main.py                # FastAPI app — all API routes
│   ├── rag.py                 # PDF ingestion, Chroma vector store, embeddings
│   ├── .env                   # API keys (never commit this)
│   ├── requirements.txt       # Python dependencies
│   ├── uploads/               # Uploaded PDFs stored here
│   ├── chroma_db/             # Local vector database (auto-created)
│   │
│   ├── agents/
│   │   └── rag_agent.py       # LangGraph ReAct agent + direct RAG (fast mode)
│   │
│   ├── skills/
│   │   └── document_tools.py  # Tools the agent can call (search_document, list_docs)
│   │
│   └── rules/
│       └── system_prompt.py   # Agent behavior rules and instructions
│
└── frontend/
    ├── src/
    │   ├── App.jsx             # Main layout — sidebar + chat
    │   └── components/
    │       ├── ChatWindow.jsx  # Chat UI with messages, input, mode toggle
    │       ├── FileUpload.jsx  # PDF upload component
    │       └── ModelSelector.jsx # Model dropdown
    ├── package.json
    └── vite.config.js
```

---

## How RAG Works

**RAG = Retrieval-Augmented Generation**

Instead of sending the entire document to the LLM (expensive and slow), RAG:

1. **Chunks** the document into small pieces (~500 characters)
2. **Embeds** each chunk into a vector (a list of numbers that captures meaning)
3. **Stores** vectors in Chroma (a vector database)
4. At query time, **embeds the question** and finds the most similar chunks
5. Sends only those relevant chunks to the LLM as context

```
PDF → chunks → embeddings → Chroma DB
                                 ↕
User question → embed → similarity search → top 4 chunks → LLM → answer
```

---

## How the Agent Works

The project uses **LangGraph's ReAct agent** — a modern AI agent pattern.

**ReAct = Reason + Act**

The LLM is given a set of tools and decides which to call:

```
User: "What does the document say about revenue?"

Agent:
  Thought → "I should search the document for revenue"
  Action  → calls search_document("revenue")
  Observation → [relevant chunks returned]
  Thought → "I have enough info to answer"
  Final Answer → "The document mentions revenue of..."
```

### Agent Tools (Skills)

| Tool | What it does |
|---|---|
| `search_document` | Searches the Chroma vector DB for relevant chunks |
| `list_docs` | Lists all uploaded documents |

---

## Two Response Modes

The frontend has a toggle (bottom-right of chat input):

### ⚡ Fast Mode (default)
- Skips the agent loop entirely
- Directly retrieves chunks → sends to LLM → gets answer
- **1 LLM call** → much faster
- Best for straightforward questions

### 🤖 Agent Mode
- Full LangGraph ReAct agent loop
- LLM decides which tools to call and how many times
- **2-3 LLM calls** → slower but smarter
- Best for complex, multi-step questions

---

## Available Models

### Groq (recommended — fast & reliable)
| Model | Notes |
|---|---|
| `llama-3.1-8b-instant` | Fastest, most reliable |

### OpenRouter (free tier)
| Model | Notes |
|---|---|
| `z-ai/glm-4.5-air:free` | Works but can be slow/unstable |

> **Note:** Most free OpenRouter models do not support tool calling (required for Agent mode). Groq's llama model is the most reliable choice.

---

## API Reference

### `GET /health`
Returns server status.
```json
{ "status": "ok" }
```

### `GET /models`
Returns all available models.
```json
{
  "models": [
    { "id": "llama-3.1-8b-instant", "provider": "groq" },
    { "id": "z-ai/glm-4.5-air:free", "provider": "openrouter" }
  ]
}
```

### `GET /documents`
Returns all uploaded and indexed documents.
```json
{ "documents": ["my_document", "report_2024"] }
```

### `POST /upload`
Upload a PDF file.
- **Body:** `multipart/form-data` with `file` field
- **Response:**
```json
{
  "message": "Uploaded and indexed 'report.pdf'",
  "chunks": 42,
  "collection": "report"
}
```

### `POST /chat`
Send a message and get a response.
- **Body:**
```json
{
  "message": "What is this document about?",
  "model_id": "llama-3.1-8b-instant",
  "document_name": "report.pdf",
  "mode": "fast"
}
```
- **Response:**
```json
{ "answer": "This document is about..." }
```

---

## Local Setup

### Prerequisites
- Python 3.10+
- Node 18+
- API Keys:
  - Groq: [console.groq.com](https://console.groq.com)
  - OpenRouter: [openrouter.ai/keys](https://openrouter.ai/keys)

### 1. Clone and navigate
```bash
cd antigravity4
```

### 2. Backend setup
```bash
cd backend
python -m venv ../venv
../venv/Scripts/activate       # Windows
pip install -r requirements.txt
```

Create `backend/.env`:
```
GROQ_API_KEY=your_groq_key
OPENROUTER_API_KEY=your_openrouter_key
```

Start backend:
```bash
uvicorn main:app --reload --port 8000
```

Or double-click `start_backend.bat`

### 3. Frontend setup
```bash
cd frontend
npm install
npm run dev
```

Or double-click `start_frontend.bat`

### 4. Open the app
Go to `http://localhost:5173`

---

## Key Concepts Covered (for Job Applications)

This project demonstrates:

| JD Requirement | How it's covered |
|---|---|
| LLM API integration | OpenRouter + Groq via LangChain |
| RAG frameworks | LangChain + ChromaDB |
| Vector databases | ChromaDB with HuggingFace embeddings |
| LangChain agents | LangGraph ReAct agent with custom tools |
| REST API (FastAPI) | Full CRUD API with file upload |
| React frontend | React + Vite + Tailwind |
| Python (primary) | All backend in Python |
| Prompt engineering | System prompt in `rules/system_prompt.py` |

---

## Known Limitations

- Free OpenRouter models often don't support tool calling → use Groq for Agent mode
- Response time in Agent mode is 10-30s depending on model and query complexity
- Only PDF files are supported currently
- No conversation memory across sessions (each chat starts fresh)
