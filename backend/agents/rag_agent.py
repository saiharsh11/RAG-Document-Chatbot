# RAG Agent — wires together the LLM, skills, and rules

import os
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langchain_groq import ChatGroq
from skills.document_tools import build_skills
from rag import get_retriever

OPENROUTER_MODELS = [
    "openai/gpt-oss-120b:free",
]

GROQ_MODELS = [
    "llama-3.1-8b-instant",
]

ALL_MODELS = (
    [{"id": m, "provider": "openrouter"} for m in OPENROUTER_MODELS]
    + [{"id": m, "provider": "groq"} for m in GROQ_MODELS]
)


def get_llm(model_id: str):
    provider = next((m["provider"] for m in ALL_MODELS if m["id"] == model_id), None)

    if provider == "groq":
        return ChatGroq(
            model=model_id,
            api_key=os.getenv("GROQ_API_KEY"),
            temperature=0,
        )
    return ChatOpenAI(
        model=model_id,
        api_key=os.getenv("OPENROUTER_API_KEY"),
        base_url="https://openrouter.ai/api/v1",
        temperature=0,
    )


SYSTEM_PROMPT = """You are a helpful document assistant. You have access to tools to search an uploaded PDF document.

Rules:
- Always use the search_document tool to find information from the document before answering.
- Pass a clear, specific search query string to search_document.
- If the user's question is vague, make a reasonable search query based on context.
- Never call a tool with an empty or unclear input.
- If the document doesn't contain the answer, say so clearly."""


def run_agent(model_id: str, collection_name: str, user_message: str) -> str:
    """Full ReAct agent — slower but handles complex multi-step queries."""
    llm = get_llm(model_id)
    tools = build_skills(collection_name)

    agent = create_react_agent(model=llm, tools=tools, prompt=SYSTEM_PROMPT)
    result = agent.invoke({"messages": [{"role": "user", "content": user_message}]})
    return result["messages"][-1].content


def run_fast(model_id: str, collection_name: str, user_message: str) -> str:
    """Direct RAG — retrieve chunks then call LLM once. Much faster."""
    retriever = get_retriever(collection_name)
    docs = retriever.invoke(user_message)

    if not docs:
        context = "No relevant content found in the document."
    else:
        context = "\n\n".join([d.page_content for d in docs])

    llm = get_llm(model_id)
    messages = [
        SystemMessage(content="You are a helpful document assistant. Answer the user's question using only the provided document context. If the answer is not in the context, say so clearly."),
        HumanMessage(content=f"Document context:\n{context}\n\nQuestion: {user_message}"),
    ]
    response = llm.invoke(messages)
    return response.content
