param(
    [switch]$SomenteValidar
)

$ErrorActionPreference = 'Stop'

$terminalStatuses = @(
    'succeeded',
    'failed',
    'skipped',
    'cancelled',
    'killed',
    'timedOut',
    'interrupted',
    'unknown'
)

function Read-LocalConfig {
    $path = Join-Path $PSScriptRoot 'config.local.json'
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Crie $path a partir de config.example.json e preencha Hub, agente, ação e credencial."
    }
    $config = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($name in @('hubUrl', 'agentId', 'clientToken', 'actionId', 'echo')) {
        $value = [string]$config.$name
        if ([string]::IsNullOrWhiteSpace($value)) {
            throw "config.local.json está sem $name."
        }
    }
    if ([string]$config.echo -match '[\r\n]') {
        throw 'O echo precisa ser uma única linha, sem quebra.'
    }
    $hasToken = -not [string]::IsNullOrWhiteSpace([string]$config.accessToken)
    $hasLogin = -not [string]::IsNullOrWhiteSpace([string]$config.email) -and -not [string]::IsNullOrWhiteSpace([string]$config.password)
    if (-not $hasToken -and -not $hasLogin) {
        throw 'Informe accessToken ou email e password em config.local.json.'
    }
    return $config
}

function ConvertTo-HubJson {
    param($Value)
    return ($Value | ConvertTo-Json -Depth 12 -Compress)
}

function Read-ResponseText {
    param($Response)
    if ($null -eq $Response) {
        return $null
    }
    $content = $Response.PSObject.Properties['Content']
    if ($null -ne $content -and $null -ne $content.Value -and $content.Value.PSObject.Methods.Name -contains 'ReadAsStringAsync') {
        return $content.Value.ReadAsStringAsync().GetAwaiter().GetResult()
    }
    $stream = $Response.GetResponseStream()
    if ($null -eq $stream) {
        return $null
    }
    $reader = New-Object System.IO.StreamReader($stream)
    try {
        return $reader.ReadToEnd()
    } finally {
        $reader.Dispose()
    }
}

function Invoke-HubJson {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)]$Body,
        [string]$AccessToken
    )

    $headers = @{ 'Content-Type' = 'application/json; charset=utf-8' }
    if (-not [string]::IsNullOrWhiteSpace($AccessToken)) {
        $headers.Authorization = "Bearer $AccessToken"
    }
    $payload = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-HubJson $Body))
    try {
        $response = Invoke-WebRequest -Uri $Url -Method Post -Headers $headers -Body $payload -UseBasicParsing
        $text = [string]$response.Content
        $parsed = $null
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            $parsed = $text | ConvertFrom-Json
        }
        return @{ StatusCode = [int]$response.StatusCode; Body = $parsed; Raw = $text }
    } catch {
        $webResponse = $_.Exception.Response
        if ($null -eq $webResponse) {
            throw
        }
        $text = Read-ResponseText $webResponse
        if ([string]::IsNullOrWhiteSpace($text)) {
            $text = [string]$_.ErrorDetails.Message
        }
        $statusCode = 0
        if ($webResponse.PSObject.Properties.Name -contains 'StatusCode') {
            $statusCode = [int]$webResponse.StatusCode
        }
        $parsed = $null
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            try {
                $parsed = $text | ConvertFrom-Json
            } catch {
                $parsed = $null
            }
        }
        return @{ StatusCode = $statusCode; Body = $parsed; Raw = $text }
    }
}

function Get-BridgeItem {
    param($Body)
    if ($null -eq $Body -or $null -eq $Body.response) {
        return $null
    }
    return $Body.response.item
}

function Get-ErrorReason {
    param($Item, $Body)
    if ($null -ne $Item -and $null -ne $Item.error) {
        $data = $Item.error.data
        if ($null -ne $data -and $null -ne $data.reason) {
            return [string]$data.reason
        }
        if ($null -ne $data -and $null -ne $data.code) {
            return [string]$data.code
        }
        if ($null -ne $Item.error.message) {
            return [string]$Item.error.message
        }
    }
    if ($null -ne $Body -and $null -ne $Body.error -and $null -ne $Body.error.details -and $null -ne $Body.error.details.reason) {
        return [string]$Body.error.details.reason
    }
    if ($null -ne $Body -and $null -ne $Body.code) {
        return [string]$Body.code
    }
    if ($null -ne $Body -and $null -ne $Body.message) {
        return [string]$Body.message
    }
    return 'resposta sem motivo legível'
}

function Get-EchoBase64 {
    param([string]$Echo)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Echo)
    return [Convert]::ToBase64String($bytes)
}

function Read-FaithfulStdout {
    param(
        [string]$HubUrl,
        [string]$AccessToken,
        [string]$AgentId,
        [int]$TimeoutMs,
        [string]$ClientToken,
        [string]$ExecutionId,
        [string]$IdempotencyKey,
        [datetime]$Deadline
    )

    $after = 0
    $chunks = @()
    while ([DateTime]::UtcNow -lt $Deadline) {
        $read = Invoke-HubJson -Url "$HubUrl/api/v1/agents/commands" -AccessToken $AccessToken -Body @{
            agentId   = $AgentId
            timeoutMs = $TimeoutMs
            command   = @{
                jsonrpc = '2.0'
                id      = "read-$IdempotencyKey-$after"
                method  = 'agent.action.readIo'
                params  = @{
                    client_token   = $ClientToken
                    execution_id   = $ExecutionId
                    after_sequence = $after
                    max_bytes      = 65536
                    wait_ms        = 1000
                }
            }
        }
        $readItem = Get-BridgeItem $read.Body
        if ($read.StatusCode -ne 200 -or $null -eq $readItem -or $readItem.success -ne $true) {
            return $null
        }
        $page = $readItem.result
        foreach ($event in @($page.events)) {
            if ($null -eq $event -or [string]$event.type -ne 'output' -or [string]$event.stream -ne 'stdout') {
                continue
            }
            $chunks += [pscustomobject]@{
                Offset = [int64]$event.offset
                Text   = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$event.data_base64))
            }
        }
        $next = [int64]$page.next_sequence
        $complete = [bool]$page.output_complete
        if ($complete) {
            break
        }
        if ($next -le $after) {
            Start-Sleep -Seconds 1
            continue
        }
        $after = $next
    }

    return (($chunks | Sort-Object Offset | ForEach-Object { $_.Text }) -join '')
}

function Save-CallRecord {
    param(
        [string]$IdempotencyKey,
        [string]$ExecutionId,
        [string]$Status
    )
    $record = @{
        idempotencyKey = $IdempotencyKey
        executionId    = $ExecutionId
        status         = $Status
        savedAt        = [DateTime]::UtcNow.ToString('o')
    }
    $path = Join-Path $PSScriptRoot 'ultima_chamada.json'
    ConvertTo-HubJson $record | Set-Content -LiteralPath $path -Encoding UTF8
}

function Get-HubOrigin {
    param([string]$HubUrl)
    $origin = $HubUrl.Trim().TrimEnd('/')
    if ($origin.EndsWith('/api/v1', [System.StringComparison]::OrdinalIgnoreCase)) {
        $origin = $origin.Substring(0, $origin.Length - '/api/v1'.Length).TrimEnd('/')
    }
    if ([string]::IsNullOrWhiteSpace($origin)) {
        throw 'hubUrl está vazio.'
    }
    return $origin
}

$config = Read-LocalConfig
$hubUrl = Get-HubOrigin ([string]$config.hubUrl)
$accessToken = [string]$config.accessToken

if ([string]::IsNullOrWhiteSpace($accessToken)) {
    Write-Host 'Autenticando o Client no Hub...'
    $login = Invoke-HubJson -Url "$hubUrl/api/v1/client-auth/login" -Body @{
        email    = [string]$config.email
        password = [string]$config.password
    }
    if ($login.StatusCode -ne 200 -or $null -eq $login.Body) {
        throw "Login recusado pelo Hub (HTTP $($login.StatusCode))."
    }
    $accessToken = [string]$login.Body.accessToken
    if ([string]::IsNullOrWhiteSpace($accessToken)) {
        $accessToken = [string]$login.Body.token
    }
    if ([string]::IsNullOrWhiteSpace($accessToken)) {
        throw 'O login não devolveu accessToken.'
    }
}

$idempotencyKey = 'manual-' + [guid]::NewGuid().ToString('N')
$method = 'agent.action.run'
if ($SomenteValidar) {
    $method = 'agent.action.validateRun'
}
$rpcId = if ($SomenteValidar) { "validate-$idempotencyKey" } else { "run-$idempotencyKey" }
$params = @{
    client_token    = [string]$config.clientToken
    action_id       = [string]$config.actionId
    idempotency_key = $idempotencyKey
}
$triggerId = [string]$config.triggerId
if (-not [string]::IsNullOrWhiteSpace($triggerId)) {
    $params.trigger_id = $triggerId
}
$echo = [string]$config.echo
$params.io = @{
    version              = 1
    mode                 = 'faithful'
    close_input          = $true
    initial_input_base64 = (Get-EchoBase64 $echo)
}
Write-Host "ECO_ENVIADO valor=$echo"

$timeoutMs = 30000
if ($null -ne $config.timeoutMs -and [int]$config.timeoutMs -gt 0) {
    $timeoutMs = [int]$config.timeoutMs
}

Write-Host "Enviando $method ..."
$call = Invoke-HubJson -Url "$hubUrl/api/v1/agents/commands" -AccessToken $accessToken -Body @{
    agentId   = [string]$config.agentId
    timeoutMs = $timeoutMs
    command   = @{
        jsonrpc = '2.0'
        id      = $rpcId
        method  = $method
        params  = $params
    }
}

$item = Get-BridgeItem $call.Body
$callSucceeded = $call.StatusCode -eq 200 -and $null -ne $item -and $item.success -eq $true -and $null -ne $item.result
if (-not $callSucceeded) {
    $reason = Get-ErrorReason $item $call.Body
    Save-CallRecord -IdempotencyKey $idempotencyKey -ExecutionId '' -Status 'refused'
    Write-Host "PEDIDO_RECUSADO HTTP $($call.StatusCode) motivo=$reason"
    if ($null -ne $call.Body -and -not [string]::IsNullOrWhiteSpace([string]$call.Body.message)) {
        Write-Host "mensagem=$($call.Body.message)"
    }
    $errorData = $null
    if ($null -ne $item -and $null -ne $item.error) {
        $errorData = $item.error.data
    }
    if ($null -ne $errorData -and -not [string]::IsNullOrWhiteSpace([string]$errorData.user_message)) {
        Write-Host "mensagem=$($errorData.user_message)"
    }
    if ($null -ne $errorData -and -not [string]::IsNullOrWhiteSpace([string]$errorData.trigger_action_id)) {
        Write-Host "acao_do_gatilho=$($errorData.trigger_action_id)"
    }
    Write-Host "Chave guardada em ultima_chamada.json: $idempotencyKey"
    exit 1
}

$result = $item.result
$executionId = [string]$result.execution_id
$status = [string]$result.status
Write-Host "PEDIDO_ACEITO execution_id=$executionId status=$status chave=$idempotencyKey"
Save-CallRecord -IdempotencyKey $idempotencyKey -ExecutionId $executionId -Status $status

if ($SomenteValidar) {
    Write-Host 'VALIDACAO_OK O preflight não iniciou processo.'
    exit 0
}

if ([string]::IsNullOrWhiteSpace($executionId)) {
    Write-Host 'O Hub aceitou a chamada, mas não devolveu execution_id.'
    exit 2
}

$pollInterval = 2
if ($null -ne $config.pollIntervalSeconds -and [int]$config.pollIntervalSeconds -gt 0) {
    $pollInterval = [int]$config.pollIntervalSeconds
}
$pollTimeout = 120
if ($null -ne $config.pollTimeoutSeconds -and [int]$config.pollTimeoutSeconds -gt 0) {
    $pollTimeout = [int]$config.pollTimeoutSeconds
}
$deadline = [DateTime]::UtcNow.AddSeconds($pollTimeout)
$latest = $result

while ($terminalStatuses -notcontains $latest.status -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Seconds $pollInterval
    $query = Invoke-HubJson -Url "$hubUrl/api/v1/agents/commands" -AccessToken $accessToken -Body @{
        agentId   = [string]$config.agentId
        timeoutMs = $timeoutMs
        command   = @{
            jsonrpc = '2.0'
            id      = "get-$idempotencyKey"
            method  = 'agent.action.getExecution'
            params  = @{
                client_token   = [string]$config.clientToken
                execution_id   = $executionId
                include_output = $false
            }
        }
    }
    $queryItem = Get-BridgeItem $query.Body
    if ($query.StatusCode -ne 200 -or $null -eq $queryItem -or $queryItem.success -ne $true) {
        $reason = Get-ErrorReason $queryItem $query.Body
        Write-Host "CONSULTA_RECUSADA HTTP $($query.StatusCode) motivo=$reason"
        Write-Host "O pedido já foi aceito. Consulte de novo o execution_id $executionId sem nova chave."
        exit 3
    }
    $latest = $queryItem.result
    $status = [string]$latest.status
    Save-CallRecord -IdempotencyKey $idempotencyKey -ExecutionId $executionId -Status $status
    Write-Host "status=$status"
}

if ($terminalStatuses -notcontains $latest.status) {
    Write-Host "PEDIDO_ACEITO_AINDA_EM_CURSO execution_id=$executionId status=$($latest.status)"
    exit 3
}

$stdout = ''
if ($null -ne $latest.output -and $null -ne $latest.output.stdout) {
    $stdout = [string]$latest.output.stdout.text
}
$faithfulStdout = Read-FaithfulStdout -HubUrl $hubUrl -AccessToken $accessToken -AgentId ([string]$config.agentId) -TimeoutMs $timeoutMs -ClientToken ([string]$config.clientToken) -ExecutionId $executionId -IdempotencyKey $idempotencyKey -Deadline $deadline
if (-not [string]::IsNullOrEmpty($faithfulStdout)) {
    $stdout = $faithfulStdout
}
$exitCode = $null
if ($null -ne $latest.process) {
    $exitCode = $latest.process.exit_code
}
$markerFound = $stdout.Contains('PLUG_REMOTE_ACTION_OK')
$echoLine = "PLUG_REMOTE_ECHO=$echo"
$echoFound = $stdout.Contains($echoLine)

if (-not [string]::IsNullOrWhiteSpace($stdout)) {
    Write-Host '--- stdout do agente ---'
    Write-Host $stdout.TrimEnd()
    Write-Host '--- fim do stdout ---'
}

if ($latest.status -eq 'succeeded') {
    if ($markerFound) {
        Write-Host "PROCESSO_OK exit_code=$exitCode marcador=PLUG_REMOTE_ACTION_OK"
    } else {
        Write-Host "PROCESSO_OK exit_code=$exitCode marcador=ausente"
        Write-Host 'A execução terminou com sucesso. O marcador não apareceu no stdout capturado.'
    }
    if ($echoFound) {
        Write-Host "ECO_OK valor=$echo"
        exit 0
    }
    Write-Host "ECO_AUSENTE esperado=$echoLine"
    exit 2
}

$failureMessage = ''
if ($null -ne $latest.failure -and $null -ne $latest.failure.message) {
    $failureMessage = [string]$latest.failure.message
}
Write-Host "PROCESSO_FALHOU status=$($latest.status) exit_code=$exitCode $failureMessage"
exit 2
