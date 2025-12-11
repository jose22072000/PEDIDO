@echo off
echo Iniciando servidor de produccion...
cd /d "%~dp0"

REM Verificar si existe el build
if not exist "dist" (
    echo ERROR: No se encontro la carpeta 'dist'
    echo Por favor ejecuta build-frontend.bat primero
    pause
    exit /b 1
)

REM Instalar serve globalmente si no existe
where serve >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Instalando 'serve'...
    call npm install -g serve
)

echo Servidor corriendo en http://localhost:5000
serve -s dist -l 5000
pause
