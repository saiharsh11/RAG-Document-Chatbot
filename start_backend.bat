@echo off
cd /d "%~dp0backend"
call ..\venv\Scripts\activate
uvicorn main:app --reload --port 8000
pause
