# Fretboard Explorer

## Run in VS Code

1. Open this folder in VS Code.
2. Open **Terminal → New Terminal**.
3. Run these commands in the terminal:

```powershell
npm.cmd install
npm.cmd run dev
```

4. Open the local address printed in the terminal (usually http://localhost:5173).

The `.cmd` form works in PowerShell even when its script policy blocks `npm.ps1`.

## Production build

```powershell
npm.cmd run build
```
