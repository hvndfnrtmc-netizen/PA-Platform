@echo off
setlocal

set "NODE_EXE=C:\Users\admin\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
set "OUT_FILE=C:\Users\admin\PA-Platform\vercel-secrets.txt"

echo ============================================================
echo  PA-Platform - Vercel secrets generator
echo  Values are also saved to: %OUT_FILE%
echo ============================================================
echo.

if not exist "%NODE_EXE%" (
    echo  ERROR: node.exe not found at %NODE_EXE%
    goto :end
)

"%NODE_EXE%" -e "const c=require('crypto');const fs=require('fs');const NL=String.fromCharCode(13,10);const lines=['# Generated for Vercel Environment Variables','NEXTAUTH_SECRET='+c.randomBytes(32).toString('base64'),'ASSET_ENCRYPTION_KEY='+c.randomBytes(32).toString('hex'),'ADMIN_PASSWORD=Pa'+c.randomBytes(6).toString('hex')+'!'];fs.writeFileSync('C:/Users/admin/PA-Platform/vercel-secrets.txt',lines.join(NL)+NL);lines.forEach(function(l){console.log(l)});"

echo.
echo ============================================================
echo  Copy the 3 values above into Vercel Environment Variables.
echo  ADMIN_PASSWORD is your NEW super-admin login password.
echo  KEEP IT SAFE.
echo ============================================================

:end
echo.
pause
