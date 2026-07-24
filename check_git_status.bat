@echo off
title Master Git Sync - All App & Web Projects
powershell -ExecutionPolicy Bypass -File "%~dp0check_git_status.ps1"
pause