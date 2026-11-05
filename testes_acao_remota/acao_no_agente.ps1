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

$writer = [IO.StreamWriter]::new([Console]::OpenStandardOutput(), $encoding)
try {
    $writer.WriteLine("$marker $whenUtc")
    $writer.WriteLine("computer=$env:COMPUTERNAME")
    $writer.WriteLine("user=$env:USERDOMAIN\$env:USERNAME")
    $writer.WriteLine("os=$osCaption")
    $writer.WriteLine("arch=$arch")
    $writer.WriteLine("pid=$PID")
    $writer.WriteLine("local_time=$whenLocal")
    $writer.WriteLine("script=$scriptPath")
    $writer.WriteLine("PLUG_REMOTE_ECHO=$received")
} finally {
    $writer.Dispose()
}
exit 0
