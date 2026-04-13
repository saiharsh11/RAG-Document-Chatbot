import os
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEndpointEmbeddings
from langchain_community.vectorstores import Chroma

CHROMA_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")

embeddings = HuggingFaceEndpointEmbeddings(
    model="sentence-transformers/all-MiniLM-L6-v2",
    huggingfacehub_api_token=os.getenv("HF_API_KEY"),
)


def ingest_pdf(file_path: str, collection_name: str):
    loader = PyPDFLoader(file_path)
    docs = loader.load()

    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    chunks = splitter.split_documents(docs)

    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=CHROMA_DIR,
        collection_name=collection_name,
    )
    return len(chunks)


def get_retriever(collection_name: str):
    vectorstore = Chroma(
        persist_directory=CHROMA_DIR,
        embedding_function=embeddings,
        collection_name=collection_name,
    )
    return vectorstore.as_retriever(search_kwargs={"k": 4})


def list_collections():
    import chromadb
    client = chromadb.PersistentClient(path=CHROMA_DIR)
    return [col.name for col in client.list_collections()]
