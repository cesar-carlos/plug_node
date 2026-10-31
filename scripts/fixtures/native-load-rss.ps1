param([int]$ClientId, [int]$HubId, [int]$AgentId, [string]$ChildFile)
$ErrorActionPreference = 'Stop'
while ($true) {
    $targets = @{client=$ClientId; hub=$HubId; agent=$AgentId}
    if (Test-Path -LiteralPath $ChildFile) {
        $childId = Get-Content -LiteralPath $ChildFile -ErrorAction SilentlyContinue
        if ($childId -match '^\d+$') { $targets.child = [int]$childId }
    }
    $row = @{}
    foreach ($role in $targets.Keys) {
        $p = Get-Process -Id $targets[$role] -ErrorAction SilentlyContinue
        if ($p) { $row[$role] = $p.WorkingSet64 }
    }
    if (!$row.client) { break }
    ConvertTo-Json -Compress $row
    Start-Sleep -Milliseconds 150
}
