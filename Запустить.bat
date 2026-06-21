@echo off
rem Запуск конструктора фоторобота в нативном окне (через Python + pywebview).
rem Требуется один раз:  py -m pip install pywebview
cd /d "%~dp0"
start "" pyw app.py
