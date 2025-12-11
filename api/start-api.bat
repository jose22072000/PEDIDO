@echo off
echo Iniciando API de Procavar Pedidos (Produccion)...
cd /d "%~dp0"

REM Verificar si existe el directorio dist
if not exist "dist" (
    echo ERROR: No se encontro la carpeta 'dist'
    echo Por favor ejecuta 'npm run build' primero
    pause
    exit /b 1
)

echo API corriendo en http://localhost:8400
call npm start
pause
