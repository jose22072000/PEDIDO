@echo off
echo Compilando API de Procavar Pedidos...
cd /d "%~dp0"

echo [1/5] Instalando dependencias...
call npm install

echo.
echo [2/5] Generando cliente de Prisma...
call npx prisma generate

echo.
echo [3/5] Ejecutando migraciones de base de datos...
call npx prisma migrate deploy

echo.
echo [4/5] Sembrando datos iniciales (seed)...
call npx prisma db seed

echo.
echo [5/5] Compilando TypeScript a JavaScript...
call npm run build

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo Compilacion exitosa!
    echo Los archivos compilados estan en 'dist\'
    echo Base de datos lista en 'prisma\dev.db'
    echo.
    echo Para iniciar la API ejecuta: start-api.bat
    echo ========================================
) else (
    echo.
    echo ERROR: La compilacion fallo
    echo Revisa los errores arriba
)

pause
