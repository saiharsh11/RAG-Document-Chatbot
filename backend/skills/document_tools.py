# Skills (tools) available to the agent

import sys, os
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from langchain_core.tools import tool
from rag import get_retriever, list_collections

_active_collection: dict = {"name": None}


def set_collection(name: str):
    _active_collection["name"] = name


@tool
def search_document(query: str) -> str:
    """Search the uploaded PDF document for information relevant to the query. Use this when the user asks about document content."""
    collection_name = _active_collection["name"]
    if not collection_name:
        return "No document selected."
    retriever = get_retriever(collection_name)
    docs = retriever.invoke(query)
    if not docs:
        return "No relevant content found in the document."
    return "\n\n".join([d.page_content for d in docs])


@tool
def list_docs(query: str = "") -> str:
    """List all documents that have been uploaded. Use this when the user asks what documents are available."""
    collections = list_collections()
    if not collections:
        return "No documents uploaded yet."
    return "Uploaded documents: " + ", ".join(collections)


def build_skills(collection_name: str) -> list:
    set_collection(collection_name)
    return [search_document, list_docs]
