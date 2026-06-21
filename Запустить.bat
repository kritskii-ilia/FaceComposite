@echo off
rem Запуск конструктора фоторобота в нативном окне (через Python + pywebview).
cd /d "%~dp0"

rem Проверяем наличие pywebview; ставим зависимости автоматически при первом запуске
py -c "import webview" 2>nul
if errorlevel 1 (
    echo Устанавливаю зависимости, подождите...
    py -m pip install -r requirements.txt --quiet
)

start "" pyw app.py
