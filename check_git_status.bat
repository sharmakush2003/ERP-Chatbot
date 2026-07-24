@echo off
title Git Sync - Erp-Chatbot
powershell -ExecutionPolicy Bypass -File "%~dp0check_git_status.ps1"
pause