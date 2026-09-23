@echo off
cd /d "%~dp0"
py -3.11 -m venv .venv
call .\.venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r Backend\requirements.txt
python -m uvicorn Backend.server:app --reload --host 127.0.0.1 --port 8000
pause