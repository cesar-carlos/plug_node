$ErrorActionPreference = 'Stop'

$marker = 'PLUG_REMOTE_ACTION_OK'
$whenUtc = [DateTime]::UtcNow.ToString('o')
$whenLocal = [DateTime]::Now.ToString('o')
$arch = 'x86'
if ([Environment]::Is64BitOperatingSystem) {
    $arch = 'amd64'
}
$scriptPath = $PSCommandPath
if ([string]::IsNullOrWhiteSpace($scriptPath)) {
    $scriptPath = $MyInvocation.MyCommand.Path
}
$osCaption = [Environment]::OSVersion.VersionString
try {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    if (-not [string]::IsNullOrWhiteSpace([string]$os.Caption)) {
        $osCaption = "$($os.Caption) $($os.Version)"
    }
} catch {
    # Environment.OSVersion already names Windows when CIM is unavailable.
}

$stdin = [Console]::OpenStandardInput()
$encoding = New-Object System.Text.UTF8Encoding $false
$reader = New-Object System.IO.StreamReader -ArgumentList @($stdin, $encoding, $false, 1024, $true)
try {
    $received = $reader.ReadToEnd()
} finally {
    $reader.Dispose()
}

Write-Output "$marker $whenUtc"
Write-Output "computer=$env:COMPUTERNAME"
Write-Output "user=$env:USERDOMAIN\$env:USERNAME"
Write-Output "os=$osCaption"
Write-Output "arch=$arch"
Write-Output "pid=$PID"
Write-Output "local_time=$whenLocal"
Write-Output "script=$scriptPath"
Write-Output "PLUG_REMOTE_ECHO=$received"
exit 0
