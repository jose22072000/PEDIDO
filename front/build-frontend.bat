@echo off
echo Compilando aplicacion frontend...
cd /d "%~dp0"
call npm install
call npm run build
echo.
echo Compilacion completada. Los archivos estan en la carpeta 'dist'
pause
