@echo off
setlocal

set "VS_VCVARS=I:\VStudio\18\Community\VC\Auxiliary\Build\vcvars64.bat"

if not exist "%VS_VCVARS%" (
  echo Visual Studio vcvars64.bat was not found at:
  echo %VS_VCVARS%
  exit /b 1
)

call "%VS_VCVARS%"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

npm run tauri build
