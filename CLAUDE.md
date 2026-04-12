# RAG Document Chatbot with LangChain Agents

A full-stack RAG chatbot where users upload documents and chat with them using a LangChain agent that decides how to answer each question.

## Stack

| Layer | Tool |
|---|---|
| LLM | OpenRouter + Groq (multiple free models, user-selectable) |
| RAG Framework | LangChain |
| Agent Pattern | ReAct (Reason + Act) |
| Vector DB | Chroma (local) |
| Embeddings | HuggingFace (local, free) |
| Backend | FastAPI (Python) |
| Frontend | React + Tailwind CSS |

## Project Structure

```
antigravity4/
├── CLAUDE.md
├── backend/
│   ├── main.py              # FastAPI app, all routes
│   ├── rag.py               # Chroma setup + document ingestion
│   ├── requirements.txt
│   ├── agents/
│   │   └── rag_agent.py     # LangChain ReAct agent + LLM wiring
│   ├── skills/
│   │   └── document_tools.py  # Tools the agent can call
│   ├── rules/
│   │   └── system_prompt.py   # Agent behavior rules
│   └── chroma_db/           # Chroma vector store (auto-created, gitignored)
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── components/
    │   │   ├── ChatWindow.jsx      # Chat messages UI
    │   │   ├── FileUpload.jsx      # PDF upload
    │   │   └── ModelSelector.jsx   # Free model dropdown
    │   └── main.jsx
    ├── package.json
    └── index.html
```

## Local Setup

### Prerequisites
- Python 3.10+
- Node 18+
- OpenRouter API key → https://openrouter.ai/keys

### Environment
Create `backend/.env`:
```
OPENROUTER_API_KEY=your_openrouter_key_here
GROQ_API_KEY=your_groq_key_here
```

### Backend
```bash
cd backend
python -m venv venv
venv/Scripts/activate        # Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173
```

## API Endpoints

| Method | Route | Description |
|---|---|---|
| POST | `/upload` | Upload PDF → chunk → embed → store in Chroma |
| POST | `/chat` | Send message + model choice → agent responds |
| GET | `/models` | Returns list of available free models |
| GET | `/documents` | Lists all uploaded documents |
| GET | `/health` | Health check |

## How the Agent Works (ReAct Pattern)

```
User message
     ↓
LangChain ReAct Agent
     ↓ reasons and picks a tool
  ┌─────────────────────────────┐
  │ Tool 1: search_document     │ → searches Chroma vector DB
  │ Tool 2: list_documents      │ → shows uploaded doc names
  │ Tool 3: general_answer      │ → answers from LLM knowledge
  └─────────────────────────────┘
     ↓
  Final Answer → streamed to frontend
```

The agent internally runs a Thought → Action → Observation loop until it has enough info to answer.

## Available Models

### OpenRouter (free)
- `google/gemma-3-27b-it:free`

### Groq (free tier)
- `llama-3.1-8b-instant`
- `llama3-8b-8192`
- `gemma2-9b-it`
- `mixtral-8x7b-32768`

## Key Dependencies (backend)

- `fastapi` + `uvicorn` — web server
- `langchain` + `langchain-community` — RAG + agent pipeline
- `langchain-openai` — OpenRouter integration (OpenAI-compatible)
- `langchain-groq` — Groq integration
- `chromadb` — local vector store
- `sentence-transformers` — local HuggingFace embeddings
- `pypdf` — PDF parsing
- `python-multipart` — file upload handling
- `python-dotenv` — env vars

## Notes

- OpenRouter is OpenAI-compatible — LangChain uses `langchain-openai` with a custom base URL
- Embeddings run locally via HuggingFace `sentence-transformers` — no API cost
- Chroma DB persisted in `backend/chroma_db/` — gitignored
- Each uploaded PDF gets its own Chroma collection keyed by filename
- Model is selected per chat session from the frontend dropdown
