# RAG Document Chatbot

A full-stack AI chatbot that lets you upload PDF documents and chat with them using Retrieval-Augmented Generation (RAG) and LangChain Agents.

**Live Demo:** [https://rag-document-chatbot.vercel.app](https://rag-document-chatbot.vercel.app)

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
| **Embeddings** | HuggingFace Inference API `all-MiniLM-L6-v2` |
| **Deployment** | Railway (backend) + Vercel (frontend) |
| **Backend** | FastAPI + Uvicorn |
| **Frontend** | React + Vite + Tailwind CSS |
| **PDF Parsing** | PyPDF |

---

## Project Structure

```
antigravity4/
├── backend/
│   ├── main.py                # FastAPI app — all API routes
│   ├── rag.py                 # PDF ingestion, Chroma vector store, embeddings
│   ├── requirements.txt       # Python dependencies
│   ├── agents/
│   │   └── rag_agent.py       # LangGraph ReAct agent + direct RAG (fast mode)
│   ├── skills/
│   │   └── document_tools.py  # Tools the agent can call
│   └── rules/
│       └── system_prompt.py   # Agent behavior rules
│
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   └── components/
    │       ├── ChatWindow.jsx
    │       ├── FileUpload.jsx
    │       └── ModelSelector.jsx
    └── package.json
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

### Agent Tools

| Tool | What it does |
|---|---|
| `search_document` | Searches the Chroma vector DB for relevant chunks |
| `list_docs` | Lists all uploaded documents |

---

## Two Response Modes

### ⚡ Fast Mode (default)
- Directly retrieves chunks → sends to LLM → gets answer
- **1 LLM call** — fast, best for straightforward questions

### 🤖 Agent Mode
- Full LangGraph ReAct agent loop
- LLM decides which tools to call and how many times
- Best for complex, multi-step questions

---

## Available Models

### Groq
| Model | Notes |
|---|---|
| `llama-3.1-8b-instant` | Fast and reliable |

### OpenRouter
| Model | Notes |
|---|---|
| `z-ai/glm-4.5-air:free` | Free tier |

---

## API Reference

| Method | Route | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/models` | List available models |
| GET | `/documents` | List uploaded documents |
| POST | `/upload` | Upload and index a PDF |
| POST | `/chat` | Send a message, get an answer |

---

## Key Concepts Covered

| Skill | How it's demonstrated |
|---|---|
| LLM API integration | OpenRouter + Groq via LangChain |
| RAG frameworks | LangChain + ChromaDB |
| Vector databases | ChromaDB with HuggingFace embeddings |
| LangChain agents | LangGraph ReAct agent with custom tools |
| REST API | FastAPI with file upload endpoints |
| Frontend | React + Vite + Tailwind CSS |
| Prompt engineering | System prompt in `rules/system_prompt.py` |
