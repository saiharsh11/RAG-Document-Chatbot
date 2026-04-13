import os
import sys
import shutil
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

sys.path.append(os.path.dirname(__file__))

from rag import ingest_pdf, list_collections
from agents.rag_agent import run_agent, run_fast, ALL_MODELS

load_dotenv()

app = FastAPI(title="RAG Chatbot API")

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


class ChatRequest(BaseModel):
    message: str
    model_id: str
    document_name: str
    mode: str = "fast"  # "fast" = direct RAG (1 LLM call), "agent" = full ReAct loop


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/models")
def get_models():
    return {"models": ALL_MODELS}


@app.get("/documents")
def get_documents():
    return {"documents": list_collections()}


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    collection_name = file.filename.replace(".pdf", "").replace(" ", "_")
    chunk_count = ingest_pdf(file_path, collection_name)

    return {
        "message": f"Uploaded and indexed '{file.filename}'",
        "chunks": chunk_count,
        "collection": collection_name,
    }


@app.post("/chat")
def chat(req: ChatRequest):
    collections = list_collections()
    collection_name = req.document_name.replace(".pdf", "").replace(" ", "_")

    if collection_name not in collections:
        raise HTTPException(
            status_code=404,
            detail=f"Document '{req.document_name}' not found. Please upload it first.",
        )

    try:
        if req.mode == "agent":
            answer = run_agent(req.model_id, collection_name, req.message)
        else:
            answer = run_fast(req.model_id, collection_name, req.message)
        return {"answer": answer}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model error: {str(e)[:200]}. Try a different model.")
