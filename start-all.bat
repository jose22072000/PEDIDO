@echo off
title Procavar Pedidos - Sistema Completo (Produccion)
color 0A

echo ========================================
echo   PROCAVAR PEDIDOS - MODO PRODUCCION
echo ========================================
echo.

REM Guardar el directorio actual
set "ROOT_DIR=%~dp0"

REM Verificar NVM
where nvm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: NVM no esta instalado
    echo Por favor ejecuta setup-windows-service.bat primero
    pause
    exit /b 1
)

REM Verificar y activar Node.js v22.20.0
nvm list | find "22.20.0" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js v22.20.0 no esta instalado
    echo Por favor ejecuta setup-windows-service.bat primero
    pause
    exit /b 1
)

call nvm use 22.20.0

REM Verificar que existan las carpetas de servicio
if not exist "%ROOT_DIR%service-api\dist" (
    echo ERROR: No se encontro la carpeta 'service-api\dist'
    echo Por favor ejecuta 'build-all.bat' primero
    pause
    exit /b 1
)

if not exist "%ROOT_DIR%service-front\dist" (
    echo ERROR: No se encontro la carpeta 'service-front\dist'
    echo Por favor ejecuta 'build-all.bat' primero
    pause
    exit /b 1
)

REM Iniciar API en nueva ventana
echo [1/2] Iniciando API (Backend compilado)...
start "Procavar API" cmd /k "cd /d "%ROOT_DIR%service-api" && nvm use 22.20.0 && node dist/index.js"
timeout /t 3 /nobreak >nul

REM Iniciar Frontend en nueva ventana
echo [2/2] Iniciando Frontend (Build compilado)...
start "Procavar Frontend" cmd /k "cd /d "%ROOT_DIR%service-front" && nvm use 22.20.0 && serve -s dist -l 5000"

echo.
echo ========================================
echo Sistema iniciado correctamente!
echo.
echo API:      http://localhost:8400
echo Frontend: http://localhost:5000
echo ========================================
echo.
echo Presiona cualquier tecla para cerrar esta ventana
echo (Las ventanas de API y Frontend seguiran abiertas)
pause >nul
