@echo off
cd /d C:\Users\NETHAN\Projects\MediKiosk\backend
start "MediKiosk Backend" cmd /k python -m uvicorn app.main:app --port 8000
cd /d C:\Users\NETHAN\Projects\MediKiosk\frontend
start "MediKiosk Frontend" cmd /k npm run dev
timeout /t 5 >nul
start http://localhost:5173
