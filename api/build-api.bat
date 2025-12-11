@echo off
echo Compilando API de Procavar Pedidos...
cd /d "%~dp0"

echo [1/3] Instalando dependencias...
call npm install

echo.
echo [2/3] Generando cliente de Prisma...
call npx prisma generate

echo.
echo [3/3] Compilando TypeScript a JavaScript...
call npm run build

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo Compilacion exitosa!
    echo Los archivos compilados estan en 'dist\'
    echo.
    echo Para iniciar la API ejecuta: start-api.bat
    echo ========================================
) else (
    echo.
    echo ERROR: La compilacion fallo
    echo Revisa los errores arriba
)

pause
